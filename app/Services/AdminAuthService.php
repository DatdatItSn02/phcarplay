<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\HttpException;
use App\Repositories\AdminRepository;

/** Đăng nhập và đổi mật khẩu của quản trị viên. Không đụng tới phiên (Session). */
final class AdminAuthService
{
    /** Quản trị viên cần mật khẩu dài hơn người dùng thường. */
    public const PASSWORD_MIN = 8;

    private AdminRepository $admins;
    private PasswordHasher $hasher;

    public function __construct(AdminRepository $admins, PasswordHasher $hasher)
    {
        $this->admins = $admins;
        $this->hasher = $hasher;
    }

    /** @return array bản ghi admin nếu đúng email và mật khẩu */
    public function attempt(string $email, string $password): array
    {
        $admin = $this->admins->findByEmail($email);
        if ($admin === null || !$this->hasher->verify($password, $admin['salt'], $admin['password_hash'])) {
            throw new HttpException(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.');
        }
        if ($admin['status'] !== 'active') {
            throw new HttpException(403, 'ACCOUNT_BLOCKED', 'Tài khoản đã bị khóa. Hãy liên hệ quản trị viên master.');
        }
        $this->admins->touchLogin((int) $admin['id']);
        return $this->admins->find((int) $admin['id']);
    }

    /**
     * Dấu vân tay của mật khẩu hiện tại, lưu trong phiên lúc đăng nhập.
     * Mật khẩu đổi (tự đổi, master đặt lại, quên mật khẩu) thì dấu cũ không còn khớp và các phiên cũ bị đăng xuất.
     */
    public function fingerprint(array $admin): string
    {
        return hash('sha256', $admin['password_hash'] . $admin['salt']);
    }

    /** Trả về admin nếu phiên còn hợp lệ: tài khoản còn tồn tại, chưa bị khóa và mật khẩu chưa đổi kể từ lúc đăng nhập. */
    public function resolve($adminId, $fingerprint): ?array
    {
        if (!is_int($adminId) && !(is_string($adminId) && ctype_digit($adminId))) {
            return null;
        }
        $admin = $this->admins->find((int) $adminId);
        if ($admin === null || $admin['status'] !== 'active') {
            return null;
        }
        if (!is_string($fingerprint) || !hash_equals($this->fingerprint($admin), $fingerprint)) {
            return null;
        }
        return $admin;
    }

    /** @return array bản ghi admin sau khi đổi; cũng gỡ cờ "bắt buộc đổi mật khẩu" */
    public function changeOwnPassword(array $admin, string $current, string $new): array
    {
        if (!$this->hasher->verify($current, $admin['salt'], $admin['password_hash'])) {
            throw HttpException::validation(['current_password' => 'Mật khẩu hiện tại không đúng.']);
        }
        if ($current === $new) {
            throw HttpException::validation(['new_password' => 'Mật khẩu mới phải khác mật khẩu hiện tại.']);
        }
        $salt = $this->hasher->generateSalt();
        $this->admins->setPassword((int) $admin['id'], $this->hasher->hash($new, $salt), $salt, false);
        return $this->admins->find((int) $admin['id']);
    }
}
