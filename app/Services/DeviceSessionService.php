<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Config;
use App\Repositories\UserRepository;

/**
 * Đăng nhập trên một thiết bị: mỗi lần đăng nhập tạo một "dấu phiên" ngẫu nhiên.
 * Bản băm của dấu này lưu ở users.session_token, bản gốc nằm trong cookie phiên của thiết bị.
 * Đăng nhập ở thiết bị mới ghi đè dấu cũ nên thiết bị cũ không còn khớp và bị đăng xuất.
 * Tắt cơ chế bằng SINGLE_DEVICE_LOGIN=false trong .env.
 */
final class DeviceSessionService
{
    private UserRepository $users;

    public function __construct(UserRepository $users)
    {
        $this->users = $users;
    }

    public function enabled(): bool
    {
        return (bool) Config::get('app.auth.single_device', true);
    }

    /** Gọi khi đăng nhập hoặc đăng ký thành công. Trả về dấu phiên gốc để lưu vào cookie phiên. */
    public function begin(array $user, string $userAgent, string $ip): string
    {
        $raw = bin2hex(random_bytes(32));
        $this->users->setSession((int) $user['id'], hash('sha256', $raw), $this->describe($userAgent), $ip);
        return $raw;
    }

    /** Dấu phiên trong cookie có còn là thiết bị hợp lệ của tài khoản không? */
    public function isCurrent(array $user, ?string $rawToken): bool
    {
        if (!$this->enabled()) {
            return true;
        }
        $stored = $user['session_token'] ?? null;
        return is_string($rawToken) && $rawToken !== '' && is_string($stored) && $stored !== ''
            && hash_equals($stored, hash('sha256', $rawToken));
    }

    /** Đăng xuất: chỉ xóa dấu phiên nếu thiết bị này đang là thiết bị hợp lệ. */
    public function end(array $user, ?string $rawToken): void
    {
        if ($this->isCurrent($user, $rawToken)) {
            $this->users->clearSession((int) $user['id']);
        }
    }

    /** Mô tả ngắn thiết bị từ User-Agent, ví dụ "Chrome / Android". */
    public function describe(string $userAgent): string
    {
        $ua = $userAgent;
        $os = 'Thiết bị khác';
        if (stripos($ua, 'Android') !== false) {
            $os = 'Android';
        } elseif (stripos($ua, 'iPhone') !== false || stripos($ua, 'iPad') !== false) {
            $os = 'iOS';
        } elseif (stripos($ua, 'Windows') !== false) {
            $os = 'Windows';
        } elseif (stripos($ua, 'Mac OS') !== false) {
            $os = 'macOS';
        } elseif (stripos($ua, 'Linux') !== false) {
            $os = 'Linux';
        }
        $browser = 'Trình duyệt';
        if (stripos($ua, 'PHCarPlayApp/') !== false) {
            $browser = 'Ứng dụng';   // vỏ Android/iOS (mobile/) thêm "PHCarPlayApp/<phiên bản> (Android|iOS)" vào User-Agent
        } elseif (stripos($ua, 'Edg') !== false) {
            $browser = 'Edge';
        } elseif (stripos($ua, 'OPR') !== false || stripos($ua, 'Opera') !== false) {
            $browser = 'Opera';
        } elseif (stripos($ua, 'Firefox') !== false) {
            $browser = 'Firefox';
        } elseif (stripos($ua, 'Chrome') !== false || stripos($ua, 'CriOS') !== false) {
            $browser = 'Chrome';
        } elseif (stripos($ua, 'Safari') !== false) {
            $browser = 'Safari';
        }
        return mb_substr($browser . ' / ' . $os, 0, 190);
    }
}
