<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Config;
use App\Core\HttpException;
use App\Core\Logger;
use App\Repositories\AdminRepository;
use App\Repositories\PasswordResetRepository;

/**
 * Quên mật khẩu của quản trị viên. Cách làm giống người dùng (token ngẫu nhiên, chỉ lưu bản băm SHA-256,
 * dùng một lần, có hạn) nhưng liên kết trỏ vào /admin/reset-password và có ghi nhật ký.
 */
final class AdminPasswordResetService
{
    private AdminRepository $admins;
    private PasswordResetRepository $resets;
    private PasswordHasher $hasher;
    private Mailer $mailer;
    private AuditService $audit;

    public function __construct(
        AdminRepository $admins,
        PasswordResetRepository $resets,
        PasswordHasher $hasher,
        Mailer $mailer,
        AuditService $audit
    ) {
        $this->admins = $admins;
        $this->resets = $resets;
        $this->hasher = $hasher;
        $this->mailer = $mailer;
        $this->audit = $audit;
    }

    /**
     * Luôn im lặng nếu email không tồn tại hoặc tài khoản bị khóa, để không lộ ai là quản trị viên.
     * @return string 'sent' | 'failed' (không gửi được email - giai đoạn 16) | 'none'
     */
    public function request(string $email, string $ip): string
    {
        $admin = $this->admins->findByEmail($email);
        if ($admin === null || $admin['status'] !== 'active') {
            return 'none';
        }
        if ($this->resets->countRecent('admin', (int) $admin['id'], 60) > 0) {
            return 'none';
        }
        $ttl = (int) Config::get('app.auth.reset_ttl_minutes', 60);
        $raw = bin2hex(random_bytes(32));
        $this->resets->create('admin', (int) $admin['id'], hash('sha256', $raw), date('Y-m-d H:i:s', time() + $ttl * 60));

        $link = rtrim((string) Config::get('app.url'), '/') . '/admin/reset-password?token=' . $raw;
        $appName = (string) Config::get('app.name', 'PH Car Play');
        $name = $admin['name'] !== '' ? $admin['name'] : 'bạn';
        $text = "Xin chào {$name},\n\nCó yêu cầu đặt lại mật khẩu quản trị cho {$appName}.\n"
            . "Mở liên kết sau để đặt mật khẩu mới (hiệu lực {$ttl} phút):\n{$link}\n\n"
            . "Nếu không phải bạn yêu cầu, hãy bỏ qua email này.";
        $html = '<p>Xin chào ' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8') . ',</p>'
            . '<p>Có yêu cầu đặt lại mật khẩu quản trị cho ' . htmlspecialchars($appName, ENT_QUOTES, 'UTF-8') . '.</p>'
            . '<p><a href="' . htmlspecialchars($link, ENT_QUOTES, 'UTF-8') . '">Đặt mật khẩu mới</a> (hiệu lực ' . $ttl . ' phút).</p>'
            . '<p>Nếu không phải bạn yêu cầu, hãy bỏ qua email này.</p>';

        try {
            $this->mailer->send($admin['email'], 'Đặt lại mật khẩu quản trị ' . $appName, $html, $text);
        } catch (\Throwable $e) {
            Logger::error('Gửi mail quên mật khẩu admin thất bại: ' . $e->getMessage(), ['admin_id' => $admin['id']]);
            $this->audit->record($admin, 'admin.password_forgot', 'admin', $admin['id'], 'KHÔNG gửi được liên kết đặt lại mật khẩu (lỗi gửi email)', $ip);
            return 'failed';
        }
        $this->audit->record($admin, 'admin.password_forgot', 'admin', $admin['id'], 'đã gửi liên kết đặt lại mật khẩu', $ip);
        return 'sent';
    }

    /** Website đang ở chế độ thử (MAIL_DRIVER=log): thư không gửi thật. */
    public function testMode(): bool
    {
        return !$this->mailer->sendsForReal();
    }

    public function reset(string $rawToken, string $newPassword, string $ip): void
    {
        $row = $this->resets->findValid('admin', hash('sha256', $rawToken), date('Y-m-d H:i:s'));
        $admin = $row === null ? null : $this->admins->find((int) $row['account_id']);
        if ($row === null || $admin === null || $admin['status'] !== 'active') {
            throw new HttpException(400, 'TOKEN_INVALID', 'Liên kết không hợp lệ hoặc đã hết hạn. Hãy yêu cầu liên kết mới.');
        }
        $salt = $this->hasher->generateSalt();
        $this->admins->setPassword((int) $admin['id'], $this->hasher->hash($newPassword, $salt), $salt, false);
        $this->resets->invalidateAll('admin', (int) $admin['id']);
        $this->audit->record($admin, 'admin.password_reset', 'admin', $admin['id'], 'đặt lại mật khẩu bằng liên kết email', $ip);
    }
}
