<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Config;
use App\Core\HttpException;
use App\Core\Logger;
use App\Repositories\OtpRepository;

/**
 * Mã OTP 6 số cho người dùng (giai đoạn 14): 'reset' = quên mật khẩu, 'change' = đổi mật khẩu khi đang đăng nhập.
 * - Gửi qua email; gửi thêm SMS nếu tài khoản có số điện thoại và đã bật SMS (config/sms.php, hiện tắt).
 * - Chỉ lưu bản băm (HMAC với APP_KEY), hết hạn sau auth.otp_ttl_minutes phút (mặc định 10).
 * - Sai MAX_ATTEMPTS lần thì mã bị hủy; xin mã mới thì mã cũ bị hủy; chỉ xin lại được sau RESEND_SECONDS giây.
 */
final class OtpService
{
    public const MAX_ATTEMPTS = 5;
    public const RESEND_SECONDS = 60;

    private OtpRepository $codes;
    private Mailer $mailer;
    private SmsSender $sms;

    public function __construct(OtpRepository $codes, Mailer $mailer, SmsSender $sms)
    {
        $this->codes = $codes;
        $this->mailer = $mailer;
        $this->sms = $sms;
    }

    public static function ttlMinutes(): int
    {
        return max(1, (int) Config::get('app.auth.otp_ttl_minutes', 10));
    }

    /** Số giây còn phải chờ trước khi xin mã mới (0 = xin được ngay). */
    public function waitSeconds(array $user, string $purpose): int
    {
        $open = $this->codes->latestOpen('user', (int) $user['id'], $purpose);
        if ($open === null) {
            return 0;
        }
        $left = strtotime((string) $open['created_at']) + self::RESEND_SECONDS - time();
        return max(0, $left);
    }

    /**
     * Tạo mã mới và gửi. Gọi waitSeconds() trước để chống gửi dồn dập.
     * @return array{channels:array<int,string>,email:string,expires_in:int}
     */
    public function issue(array $user, string $purpose): array
    {
        $id = (int) $user['id'];
        $this->codes->closeAll('user', $id, $purpose);
        $code = sprintf('%06d', random_int(0, 999999));
        $ttl = self::ttlMinutes();
        $channels = ['email'];
        $phone = (string) ($user['phone'] ?? '');
        if ($phone !== '' && $this->sms->enabled()) {
            $channels[] = 'sms';
        }
        $this->codes->create('user', $id, $purpose, self::hash($code, $id, $purpose), implode(',', $channels), date('Y-m-d H:i:s', time() + $ttl * 60));

        $appName = (string) Config::get('app.name', 'PH Car Play');
        $what = $purpose === 'change' ? 'đổi mật khẩu' : 'đặt lại mật khẩu';
        $name = ($user['name'] ?? '') !== '' ? (string) $user['name'] : 'bạn';
        $text = "Xin chào {$name},\n\nMã {$what} {$appName} của bạn là: {$code}\n"
            . "Mã có hiệu lực {$ttl} phút và chỉ dùng được một lần. Không đưa mã này cho bất kỳ ai.\n\n"
            . "Nếu bạn không yêu cầu, hãy bỏ qua email này: mật khẩu của bạn không thay đổi.";
        $html = '<p>Xin chào ' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8') . ',</p>'
            . '<p>Mã ' . $what . ' ' . htmlspecialchars($appName, ENT_QUOTES, 'UTF-8') . ' của bạn là:</p>'
            . '<p style="font-size:28px;font-weight:bold;letter-spacing:6px">' . $code . '</p>'
            . '<p>Mã có hiệu lực ' . $ttl . ' phút và chỉ dùng được một lần. Không đưa mã này cho bất kỳ ai.</p>'
            . '<p>Nếu bạn không yêu cầu, hãy bỏ qua email này: mật khẩu của bạn không thay đổi.</p>';
        try {
            $this->mailer->send((string) $user['email'], 'Mã ' . $what . ' ' . $appName . ': ' . $code, $html, $text);
        } catch (\Throwable $e) {
            Logger::error('Gửi mail mã OTP thất bại: ' . $e->getMessage(), ['user_id' => $id]);
        }
        if (in_array('sms', $channels, true)) {
            try {
                $this->sms->send($phone, $appName . ': ma ' . $code . ' (hieu luc ' . $ttl . ' phut). Khong dua ma cho ai.');
            } catch (\Throwable $e) {
                Logger::error('Gửi SMS mã OTP thất bại: ' . $e->getMessage(), ['user_id' => $id]);
            }
        }
        return ['channels' => $channels, 'email' => self::maskEmail((string) $user['email']), 'expires_in' => $ttl * 60];
    }

    /** Kiểm tra mã; đúng thì đánh dấu đã dùng. Sai thì ném lỗi tiếng Việt kèm số lần thử còn lại. */
    public function verify(array $user, string $purpose, string $code): void
    {
        $id = (int) $user['id'];
        $code = preg_replace('/\s+/', '', $code) ?? '';
        $row = $this->codes->latestOpen('user', $id, $purpose);
        if ($row === null || strtotime((string) $row['expires_at']) <= time() || (int) $row['attempts'] >= self::MAX_ATTEMPTS) {
            if ($row !== null) {
                $this->codes->markUsed((int) $row['id']);
            }
            throw self::invalid();
        }
        if (preg_match('/^[0-9]{6}$/', $code) !== 1 || !hash_equals((string) $row['code_hash'], self::hash($code, $id, $purpose))) {
            $this->codes->addAttempt((int) $row['id']);
            $left = self::MAX_ATTEMPTS - ((int) $row['attempts'] + 1);
            if ($left <= 0) {
                $this->codes->markUsed((int) $row['id']);
                throw new HttpException(400, 'OTP_LOCKED', 'Nhập sai mã quá nhiều lần. Hãy bấm "Gửi lại mã" để nhận mã mới.', ['code' => 'Mã đã bị hủy.']);
            }
            throw new HttpException(400, 'OTP_WRONG', 'Mã không đúng. Bạn còn ' . $left . ' lần thử.', ['code' => 'Mã không đúng, còn ' . $left . ' lần thử.']);
        }
        $this->codes->markUsed((int) $row['id']);
    }

    public function closeAll(int $userId): void
    {
        $this->codes->closeAll('user', $userId);
    }

    public static function invalid(): HttpException
    {
        return new HttpException(400, 'OTP_INVALID', 'Mã đã hết hạn hoặc không còn dùng được. Hãy bấm "Gửi lại mã".', ['code' => 'Mã đã hết hạn hoặc không đúng.']);
    }

    private static function hash(string $code, int $accountId, string $purpose): string
    {
        $key = (string) Config::get('app.key', '');
        return hash_hmac('sha256', $code . '|' . $accountId . '|' . $purpose, $key !== '' ? $key : 'carweb-otp');
    }

    /** "nguyenvan@gmail.com" -> "ng******@gmail.com" */
    public static function maskEmail(string $email): string
    {
        $at = strpos($email, '@');
        if ($at === false) {
            return '';
        }
        $local = substr($email, 0, $at);
        $keep = min(2, max(1, strlen($local) - 1));
        return substr($local, 0, $keep) . str_repeat('*', max(1, strlen($local) - $keep)) . substr($email, $at);
    }
}
