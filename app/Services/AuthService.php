<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\HttpException;
use App\Repositories\UserRepository;

/** Nghiệp vụ tài khoản người dùng: đăng ký và kiểm tra đăng nhập. Không đụng tới phiên (Session). */
final class AuthService
{
    private UserRepository $users;
    private PasswordHasher $hasher;

    public function __construct(UserRepository $users, PasswordHasher $hasher)
    {
        $this->users = $users;
        $this->hasher = $hasher;
    }

    /**
     * @param string|null $phone số điện thoại đã chuẩn hóa (Validator::phone). Đăng ký qua web bắt buộc có (AuthController).
     * @return array bản ghi người dùng vừa tạo
     */
    public function register(string $email, string $name, string $password, ?string $phone = null): array
    {
        if ($this->users->findByEmail($email) !== null) {
            throw new HttpException(409, 'EMAIL_TAKEN', 'Email này đã được đăng ký.', ['email' => 'Email này đã được đăng ký.']);
        }
        if ($phone !== null && $this->users->findByPhone($phone) !== null) {
            throw self::phoneTaken();
        }
        $salt = $this->hasher->generateSalt();
        try {
            $id = $this->users->create($email, $name, $this->hasher->hash($password, $salt), $salt, $phone);
        } catch (\PDOException $e) {
            // hai người đăng ký cùng lúc: khóa UNIQUE của database là chốt cuối
            $msg = strtolower($e->getMessage());
            $duplicate = (isset($e->errorInfo[1]) && (int) $e->errorInfo[1] === 1062) || strpos($msg, 'duplicate') !== false || strpos($msg, 'unique') !== false;
            if (!$duplicate) {
                throw $e;
            }
            if (strpos($msg, 'phone') !== false) {
                throw self::phoneTaken();
            }
            throw new HttpException(409, 'EMAIL_TAKEN', 'Email này đã được đăng ký.', ['email' => 'Email này đã được đăng ký.']);
        }
        return $this->users->find($id);
    }

    /**
     * Đăng nhập bằng email hoặc số điện thoại.
     * @param string $login email hoặc số điện thoại (đã/chưa chuẩn hóa đều được)
     * @return array bản ghi người dùng nếu đúng
     */
    public function attempt(string $login, string $password): array
    {
        $user = $this->findByLogin($login);
        if ($user === null || !$this->hasher->verify($password, $user['salt'], $user['password_hash'])) {
            throw new HttpException(401, 'INVALID_CREDENTIALS', 'Email/số điện thoại hoặc mật khẩu không đúng.');
        }
        if ($user['status'] !== 'active') {
            throw new HttpException(403, 'ACCOUNT_BLOCKED', 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.');
        }
        $this->users->touchLogin((int) $user['id']);
        return $user;
    }

    /** Tìm tài khoản theo email hoặc số điện thoại. */
    public function findByLogin(string $login): ?array
    {
        $id = \App\Core\Validator::loginId($login);
        if ($id === null) {
            return null;
        }
        return $id[0] === 'email' ? $this->users->findByEmail($id[1]) : $this->users->findByPhone($id[1]);
    }

    public static function phoneTaken(): HttpException
    {
        return new HttpException(409, 'PHONE_TAKEN', 'Số điện thoại này đã được dùng cho tài khoản khác.', ['phone' => 'Số điện thoại này đã được dùng.']);
    }
}
