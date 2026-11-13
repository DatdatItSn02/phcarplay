<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\HttpException;
use App\Repositories\LicenseKeyRepository;
use App\Repositories\PasswordResetRepository;
use App\Repositories\PlaylistRepository;
use App\Repositories\UserRepository;
use App\Repositories\SoftDelete;

/**
 * Quản trị viên quản lý người dùng: tìm, xem, sửa, khóa, gia hạn, đặt mật khẩu, đăng xuất thiết bị, xóa.
 * Mọi admin đang hoạt động đều dùng được (đã kiểm tra ở middleware). Dữ liệu đã được Controller kiểm tra định dạng.
 * Mọi thao tác ghi đều để lại nhật ký, không bao giờ ghi mật khẩu.
 */
final class AdminUserService
{
    private UserRepository $users;
    private PasswordResetRepository $resets;
    private PlaylistRepository $playlists;
    private LicenseKeyRepository $keys;
    private PasswordHasher $hasher;
    private PasswordResetService $resetMail;
    private AuditService $audit;

    public function __construct(
        UserRepository $users,
        PasswordResetRepository $resets,
        PlaylistRepository $playlists,
        LicenseKeyRepository $keys,
        PasswordHasher $hasher,
        PasswordResetService $resetMail,
        AuditService $audit
    ) {
        $this->users = $users;
        $this->resets = $resets;
        $this->playlists = $playlists;
        $this->keys = $keys;
        $this->hasher = $hasher;
        $this->resetMail = $resetMail;
        $this->audit = $audit;
    }

    public function search(array $filters, int $page, int $perPage, int $offset): array
    {
        $items = array_map([UserRepository::class, 'adminView'], $this->users->search($filters, $perPage, $offset));
        return ['items' => $items, 'total' => $this->users->countSearch($filters), 'page' => $page, 'per_page' => $perPage];
    }

    /** Chi tiết một người dùng kèm playlist và các key đã nhập. */
    public function get(int $id): array
    {
        $user = $this->mustFind($id);
        $view = UserRepository::adminView($user);
        $view['playlist_count'] = $this->playlists->countByUser($id);
        $view['playlists'] = array_map(static function (array $p): array {
            return ['id' => (int) $p['id'], 'name' => $p['name'], 'count' => (int) $p['item_count'], 'updated_at' => $p['updated_at']];
        }, $this->playlists->listByUser($id));
        $view['keys'] = array_map([LicenseKeyService::class, 'view'], $this->keys->usedBy($id));
        return $view;
    }

    /**
     * @param array $changes chỉ gồm name, email, phone (null = bỏ), status, expires_at (đã kiểm tra định dạng); expires_at = null nghĩa là xóa hạn
     */
    public function update(array $actor, int $id, array $changes, string $ip): array
    {
        $target = $this->mustFind($id);
        $diff = [];
        $email = $target['email'];
        $name = $target['name'];

        if (array_key_exists('email', $changes) && $changes['email'] !== $target['email']) {
            $other = $this->users->findByEmail($changes['email']);
            if ($other !== null && (int) $other['id'] !== $id) {
                throw $this->emailTaken();
            }
            $diff[] = 'email: ' . $target['email'] . ' → ' . $changes['email'];
            $email = $changes['email'];
        }
        $phone = $target['phone'] ?? null;
        if (array_key_exists('phone', $changes) && $changes['phone'] !== $phone) {
            if ($changes['phone'] !== null) {
                $other = $this->users->findByPhone($changes['phone']);
                if ($other !== null && (int) $other['id'] !== $id) {
                    throw AuthService::phoneTaken();
                }
            }
            $diff[] = 'SĐT: ' . ($phone ?? 'chưa có') . ' → ' . ($changes['phone'] ?? 'bỏ');
            $phone = $changes['phone'];
        }
        if (array_key_exists('name', $changes) && $changes['name'] !== $target['name']) {
            $diff[] = 'tên: ' . $target['name'] . ' → ' . $changes['name'];
            $name = $changes['name'];
        }
        $statusChanged = array_key_exists('status', $changes) && $changes['status'] !== $target['status'];
        if ($statusChanged) {
            $diff[] = 'trạng thái: ' . $target['status'] . ' → ' . $changes['status'];
        }
        $expiryChanged = array_key_exists('expires_at', $changes) && $changes['expires_at'] !== ($target['expires_at'] ?? null);
        if ($expiryChanged) {
            $diff[] = 'hạn dùng: ' . ($target['expires_at'] ?? 'chưa có') . ' → ' . ($changes['expires_at'] ?? 'xóa hạn');
        }

        if ($diff) {
            try {
                if ($email !== $target['email'] || $name !== $target['name']) {
                    $this->users->updateProfile($id, $email, $name);
                }
                if ($phone !== ($target['phone'] ?? null)) {
                    $this->users->updatePhone($id, $phone);
                }
                if ($statusChanged) {
                    $this->users->setStatus($id, (string) $changes['status']);
                }
                if ($expiryChanged) {
                    $this->users->setExpiry($id, $changes['expires_at']);
                }
            } catch (\PDOException $e) {
                throw $this->translateDuplicate($e);
            }
            $this->audit->record($actor, 'user.update', 'user', $id, implode('; ', $diff) . ' (' . $target['email'] . ')', $ip);
        }
        return UserRepository::adminView($this->mustFind($id));
    }

    /** Cộng thêm số ngày dùng (nối tiếp hạn hiện tại nếu còn hạn). */
    public function extend(array $actor, int $id, int $days, string $ip): array
    {
        $target = $this->mustFind($id);
        $new = LicensePeriod::extend($target['expires_at'] ?? null, $days);
        $this->users->setExpiry($id, $new);
        $this->audit->record($actor, 'user.extend', 'user', $id, '+' . $days . ' ngày: ' . ($target['expires_at'] ?? 'chưa có') . ' → ' . $new . ' (' . $target['email'] . ')', $ip);
        return UserRepository::adminView($this->mustFind($id));
    }

    /** Đặt mật khẩu mới cho người dùng: mọi thiết bị của họ bị đăng xuất, token quên mật khẩu cũ mất hiệu lực. */
    public function setPassword(array $actor, int $id, string $password, string $ip): void
    {
        $target = $this->mustFind($id);
        $salt = $this->hasher->generateSalt();
        $this->users->updatePassword($id, $this->hasher->hash($password, $salt), $salt);
        $this->resets->invalidateAll('user', $id);
        $this->users->clearSession($id);
        $this->audit->record($actor, 'user.password_set', 'user', $id, 'email: ' . $target['email'], $ip);
    }

    /** Gửi mã OTP đặt lại mật khẩu tới email người dùng (cùng luồng "quên mật khẩu"; tối đa 1 mã mỗi 60 giây). */
    public function sendReset(array $actor, int $id, string $ip): void
    {
        $target = $this->mustFind($id);
        if ($target['status'] !== 'active') {
            throw new HttpException(409, 'USER_BLOCKED', 'Tài khoản đang bị khóa nên không gửi được thư đặt lại mật khẩu.');
        }
        $this->resetMail->request($target['email']);
        $this->audit->record($actor, 'user.reset_sent', 'user', $id, 'email: ' . $target['email'], $ip);
    }

    /** Đăng xuất thiết bị đang đăng nhập của người dùng (họ vẫn đăng nhập lại được). */
    public function logoutDevice(array $actor, int $id, string $ip): void
    {
        $target = $this->mustFind($id);
        $this->users->clearSession($id);
        $this->audit->record($actor, 'user.logout_device', 'user', $id, 'email: ' . $target['email'], $ip);
    }

    /** Xóa người dùng và playlist của họ (đánh dấu người xóa và thời điểm, không xóa khỏi database). Key đã nhập được giữ lại làm lịch sử. */
    public function delete(array $actor, int $id, string $ip): void
    {
        $target = $this->mustFind($id);
        $playlists = $this->playlists->countByUser($id);
        $this->users->softDeleteWithData($id, SoftDelete::byAdmin($actor));
        $this->audit->record($actor, 'user.delete', 'user', $id, 'email: ' . $target['email'] . '; đã xóa ' . $playlists . ' playlist', $ip);
    }

    private function mustFind(int $id): array
    {
        $user = $this->users->find($id);
        if ($user === null) {
            throw HttpException::notFound('Không tìm thấy người dùng.');
        }
        return $user;
    }

    private function emailTaken(): HttpException
    {
        return new HttpException(409, 'EMAIL_TAKEN', 'Email này đã được dùng cho người dùng khác.', ['email' => 'Email này đã được dùng.']);
    }

    /** Hai yêu cầu cùng lúc có thể vượt qua bước kiểm tra trùng; khóa UNIQUE của database là chốt cuối. */
    private function translateDuplicate(\PDOException $e): \Throwable
    {
        $driverCode = isset($e->errorInfo[1]) ? (int) $e->errorInfo[1] : 0;
        $message = strtolower($e->getMessage());
        $duplicate = $driverCode === 1062 || strpos($message, 'duplicate') !== false || strpos($message, 'unique') !== false;
        if ($duplicate && strpos($message, 'phone') !== false) {
            return AuthService::phoneTaken();
        }
        return $duplicate ? $this->emailTaken() : $e;
    }
}
