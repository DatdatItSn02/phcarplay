<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\HttpException;
use App\Repositories\PasswordResetRepository;
use App\Repositories\UserRepository;

/**
 * Quên / đổi mật khẩu của người dùng. Từ giai đoạn 14 dùng mã OTP (OtpService) gửi qua email (và SMS khi đã bật).
 * Liên kết đặt lại kiểu cũ (token trong password_resets) vẫn được nhận cho tới khi hết hạn.
 */
final class PasswordResetService
{
    private UserRepository $users;
    private PasswordResetRepository $resets;
    private PasswordHasher $hasher;
    private AuthService $auth;
    private OtpService $otp;

    public function __construct(
        UserRepository $users,
        PasswordResetRepository $resets,
        PasswordHasher $hasher,
        AuthService $auth,
        OtpService $otp
    )
    {
        $this->users = $users;
        $this->resets = $resets;
        $this->hasher = $hasher;
        $this->auth = $auth;
        $this->otp = $otp;
    }

    /**
     * Quên mật khẩu (giai đoạn 14): gửi MÃ OTP 6 số tới email (và SMS khi đã bật) của tài khoản có email hoặc số điện thoại này.
     * Luôn im lặng khi không có tài khoản, tài khoản bị khóa hoặc vừa xin mã chưa đủ 60 giây, để không lộ ai đã đăng ký.
     * @return string 'sent' (đã gửi) | 'failed' (không gửi được qua kênh nào - giai đoạn 16) | 'none' (im lặng, không gửi gì)
     */
    public function request(string $login): string
    {
        $user = $this->auth->findByLogin($login);
        if ($user === null || $user['status'] !== 'active') {
            return 'none';
        }
        if ($this->otp->waitSeconds($user, 'reset') > 0) {
            return 'none';
        }
        $sent = $this->otp->issue($user, 'reset');
        return $sent['delivered'] ? 'sent' : 'failed';
    }

    /** Website đang ở chế độ thử (thư không gửi thật). */
    public function testMode(): bool
    {
        return $this->otp->testMode();
    }

    /** Đặt mật khẩu mới bằng mã OTP; đăng xuất mọi thiết bị. */
    public function resetWithCode(string $login, string $code, string $newPassword): void
    {
        $user = $this->auth->findByLogin($login);
        if ($user === null || $user['status'] !== 'active') {
            throw OtpService::invalid();
        }
        $this->otp->verify($user, 'reset', $code);
        $this->setPassword((int) $user['id'], $newPassword);
        $this->users->clearSession((int) $user['id']);   // buộc đăng nhập lại ở mọi thiết bị
    }

    /** Đổi mật khẩu khi đang đăng nhập (mã OTP 'change'). Phiên của máy đang dùng do AuthController mở lại. */
    public function changeWithCode(array $user, string $code, string $newPassword): void
    {
        $this->otp->verify($user, 'change', $code);
        $this->setPassword((int) $user['id'], $newPassword);
    }

    private function setPassword(int $userId, string $newPassword): void
    {
        $salt = $this->hasher->generateSalt();
        $this->users->updatePassword($userId, $this->hasher->hash($newPassword, $salt), $salt);
        $this->resets->invalidateAll('user', $userId);
        $this->otp->closeAll($userId);
    }

    /** Liên kết đặt lại mật khẩu (cách cũ, trước giai đoạn 14): vẫn nhận các liên kết đã gửi khi còn hạn. */
    public function reset(string $rawToken, string $newPassword): void
    {
        $row = $this->resets->findValid('user', hash('sha256', $rawToken), date('Y-m-d H:i:s'));
        if ($row === null) {
            throw new HttpException(400, 'TOKEN_INVALID', 'Liên kết không hợp lệ hoặc đã hết hạn. Hãy yêu cầu liên kết mới.');
        }
        $this->setPassword((int) $row['account_id'], $newPassword);
        $this->users->clearSession((int) $row['account_id']);   // buộc đăng nhập lại ở mọi thiết bị
    }
}
