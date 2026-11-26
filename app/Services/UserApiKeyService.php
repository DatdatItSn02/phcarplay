<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Config;
use App\Core\HttpException;
use App\Core\Logger;
use App\Core\SecretBox;
use App\Core\Session;
use App\Repositories\UserApiKeyRepository;
use App\Repositories\UserRepository;

/**
 * Giai đoạn 10: khóa YouTube Data API riêng của từng người dùng (không bắt buộc).
 *  - Người dùng tự nhập trong Cài đặt; khóa được thử (1 đơn vị hạn mức của chính khóa đó), mã hóa bằng APP_KEY rồi mới lưu.
 *  - Khóa chỉ dùng cho tìm kiếm của CHÍNH người đó (không bao giờ dùng cho người khác), không gửi lại về trình duyệt
 *    (chỉ hiện 4 ký tự cuối).
 *  - Không có khóa / khóa hết lượt / khóa sai: tìm kiếm đi theo đường thường (Piped, Invidious, khóa của website, đọc trực tiếp).
 * Tắt bằng YOUTUBE_USER_KEYS=false; thiếu APP_KEY thì tính năng tự tắt (bin/doctor.php nhắc tạo).
 */
final class UserApiKeyService
{
    /** Lý do Google từ chối khóa -> câu hướng dẫn sửa (theo đúng các bước trong Cài đặt). */
    public const KEY_PROBLEMS = [
        'bad_key' => 'Google báo khóa không đúng. Có thể bạn dán thiếu ký tự: hãy sao chép lại khóa ở bước 2 (biểu tượng sao chép hoặc "Hiện khóa").',
        'not_enabled' => 'Dự án của khóa này chưa bật YouTube Data API v3. Làm lại bước 1 (bấm "Bật"/Enable), đợi 1–2 phút rồi bấm lưu lại.',
        'referrer_blocked' => 'Khóa đang bị giới hạn theo trang web hoặc địa chỉ IP. Trên trang khóa của Google, ở mục "Giới hạn ứng dụng" (Application restrictions) hãy chọn "Không có" (None), bấm Lưu, đợi vài phút rồi thử lại.',
        'api_blocked' => 'Khóa chưa được phép dùng YouTube Data API v3. Trên trang khóa của Google, ở mục "Giới hạn API" (API restrictions) hãy tích "YouTube Data API v3", bấm Lưu, đợi vài phút rồi thử lại.',
        'invalid' => 'Google báo khóa này không dùng được. Kiểm tra lại khóa và đã bật "YouTube Data API v3" cho dự án chưa.',
    ];

    private UserApiKeyRepository $repo;
    private UserRepository $users;
    private DeviceSessionService $devices;
    private YoutubeDirectClient $client;
    private ?string $appKey;
    private ?bool $enabled;

    /** $appKey, $enabled: chỉ dùng khi kiểm thử (mặc định đọc APP_KEY và YOUTUBE_USER_KEYS). */
    public function __construct(UserApiKeyRepository $repo, UserRepository $users, DeviceSessionService $devices, YoutubeDirectClient $client, ?string $appKey = null, ?bool $enabled = null)
    {
        $this->repo = $repo;
        $this->users = $users;
        $this->devices = $devices;
        $this->client = $client;
        $this->appKey = $appKey;
        $this->enabled = $enabled;
    }

    private function appKey(): string
    {
        return $this->appKey ?? (string) Config::get('app.key', '');
    }

    /** null = dùng được; ngược lại là lý do tính năng đang tắt (hiện cho người dùng). */
    public function disabledReason(): ?string
    {
        if (!($this->enabled ?? (bool) Config::get('youtube.user_keys', true))) {
            return 'Chủ website đã tắt tính năng nhập khóa riêng.';
        }
        if (!SecretBox::available($this->appKey())) {
            return 'Chủ website chưa đặt APP_KEY nên chưa lưu được khóa riêng.';
        }
        return null;
    }

    /** Thông tin hiển thị trong Cài đặt (không bao giờ có khóa đầy đủ). */
    public function status(int $userId): array
    {
        $reason = $this->disabledReason();
        $row = $this->repo->find($userId);
        $has = $row !== null && $row['key_enc'] !== null && $row['key_enc'] !== '';
        $state = null;
        if ($has && $reason === null) {
            $key = $this->decrypt((string) $row['key_enc']);
            $state = $key === null ? 'unreadable' : ($this->client->keyState($key) ?? 'ok');
        }
        return [
            'enabled' => $reason === null,
            'reason' => $reason,
            'has_key' => $has,
            'last4' => $has ? $row['key_hint'] : null,
            'updated_at' => $has ? $row['updated_at'] : null,
            'state' => $state,   // 'ok' | 'quota' (hết lượt hôm nay) | 'invalid' (sai) | 'unreadable' (APP_KEY đã đổi) | null
        ];
    }

    /** Thử khóa rồi lưu. Trả status() kèm 'checked': 'ok' | 'quota' | 'error' (chưa thử được do mạng). */
    public function save(int $userId, string $key): array
    {
        $reason = $this->disabledReason();
        if ($reason !== null) {
            throw new HttpException(409, 'FEATURE_DISABLED', $reason);
        }
        $key = trim($key);
        if (preg_match('/^[A-Za-z0-9_-]{20,100}$/', $key) !== 1) {
            throw HttpException::validation(['key' => 'Khóa không đúng dạng. Khóa YouTube API thường bắt đầu bằng "AIza" và dài 39 ký tự.']);
        }
        $checked = $this->client->testKey($key);
        if (isset(self::KEY_PROBLEMS[$checked])) {
            throw HttpException::validation(['key' => self::KEY_PROBLEMS[$checked]]);
        }
        $box = new SecretBox($this->appKey());
        $this->repo->save($userId, $box->encrypt($key), substr($key, -4));
        Logger::info('Người dùng #' . $userId . ' đã lưu khóa YouTube API riêng (kết quả thử: ' . $checked . ')');
        return $this->status($userId) + ['checked' => $checked];
    }

    public function remove(int $userId): array
    {
        $this->repo->save($userId, null, null);
        return $this->status($userId);
    }

    /** Khóa đầy đủ của một người dùng (chỉ dùng phía máy chủ). */
    public function keyFor(int $userId): ?string
    {
        if ($this->disabledReason() !== null) {
            return null;
        }
        $row = $this->repo->find($userId);
        if ($row === null || $row['key_enc'] === null || $row['key_enc'] === '') {
            return null;
        }
        return $this->decrypt((string) $row['key_enc']);
    }

    /**
     * Khóa của người đang đăng nhập (đúng thiết bị, tài khoản còn hoạt động); khách hoặc lỗi bất kỳ -> null.
     * Lỗi ở đây không bao giờ làm hỏng tìm kiếm (ví dụ chưa chạy migration 008).
     */
    public function currentUserKey(): ?string
    {
        try {
            $id = Session::get('user_id');
            if (!$id) {
                return null;
            }
            $user = $this->users->find((int) $id);
            if ($user === null || ($user['status'] ?? '') !== 'active' || !$this->devices->isCurrent($user, Session::get('device_token'))) {
                return null;
            }
            return $this->keyFor((int) $user['id']);
        } catch (\Throwable $e) {
            Logger::error('Không đọc được khóa YouTube API của người dùng: ' . $e->getMessage());
            return null;
        }
    }

    private function decrypt(string $box): ?string
    {
        try {
            return (new SecretBox($this->appKey()))->decrypt($box);
        } catch (\InvalidArgumentException $e) {
            return null;
        }
    }
}
