<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Phiên đăng nhập bằng cookie HttpOnly. Có hai phạm vi tách biệt: 'user' và 'admin'
 * (cookie khác tên) để đăng nhập trang người dùng không kéo theo quyền admin.
 *
 * File phiên lưu trong storage/sessions/user và storage/sessions/admin (không dùng thư mục chung của máy chủ):
 *  - website khác trên cùng hosting không đọc được phiên của mình;
 *  - Ubuntu/Debian có tác vụ tự xóa phiên sau ~24 phút trong thư mục chung, làm người dùng bị đăng xuất dù hạn là 30 ngày;
 *  - mỗi phạm vi một thư mục nên lần dọn phiên quản trị (hạn 8 giờ) không xóa nhầm phiên người dùng (hạn 30 ngày).
 * Không tạo/ghi được thư mục đó thì dùng thư mục mặc định của PHP như trước.
 */
final class Session
{
    public static function start(string $scope = 'user'): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        $cfg = (array) Config::get('app.session', []);
        $name = $scope === 'admin' ? ($cfg['admin_name'] ?? 'carweb_admin') : ($cfg['user_name'] ?? 'carweb_sid');
        $lifetime = $scope === 'admin' ? (int) ($cfg['admin_lifetime'] ?? 28800) : (int) ($cfg['lifetime'] ?? 2592000);
        $secure = ($cfg['secure'] ?? null) === null ? self::isHttps() : (bool) $cfg['secure'];

        ini_set('session.use_strict_mode', '1');    // không nhận mã phiên lạ do người khác gửi tới (chống session fixation)
        $dir = self::saveDir($scope);
        if ($dir !== null) {
            session_save_path($dir);
            ini_set('session.gc_probability', '1');  // tự dọn phiên hết hạn (Debian/Ubuntu tắt mặc định)
            ini_set('session.gc_divisor', '1000');
        }
        session_name($name);
        session_set_cookie_params([
            'lifetime' => $lifetime,
            'path' => '/',
            'secure' => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        ini_set('session.gc_maxlifetime', (string) $lifetime);
        session_start();
        if (empty($_SESSION['csrf'])) {
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
        }
    }

    public static function get(string $key, $default = null)
    {
        return $_SESSION[$key] ?? $default;
    }

    public static function set(string $key, $value): void
    {
        $_SESSION[$key] = $value;
    }

    public static function forget(string $key): void
    {
        unset($_SESSION[$key]);
    }

    public static function csrf(): string
    {
        return (string) ($_SESSION['csrf'] ?? '');
    }

    /** Đổi ID phiên sau khi đăng nhập để chống session fixation. */
    public static function regenerate(): void
    {
        session_regenerate_id(true);
    }

    /** Hủy phiên hiện tại và tạo phiên trắng mới (kèm CSRF token mới). */
    public static function reset(string $scope = 'user'): void
    {
        $_SESSION = [];
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_destroy();
        }
        self::start($scope);
        session_regenerate_id(true);
    }

    /** Thư mục lưu phiên của phạm vi, tạo nếu chưa có; null nếu không dùng được. */
    public static function saveDir(string $scope): ?string
    {
        $dir = BASE_PATH . '/storage/sessions/' . ($scope === 'admin' ? 'admin' : 'user');
        if (!is_dir($dir)) {
            @mkdir($dir, 0700, true);
        }
        return is_dir($dir) && is_writable($dir) ? $dir : null;
    }

    public static function isHttps(): bool
    {
        if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
            return true;
        }
        return strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
    }
}
