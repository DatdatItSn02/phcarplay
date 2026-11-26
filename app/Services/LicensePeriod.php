<?php
declare(strict_types=1);

namespace App\Services;

/** Tính hạn dùng mới khi cộng thêm ngày (key kích hoạt hoặc quản trị gia hạn tay). Hàm thuần, dễ kiểm thử. */
final class LicensePeriod
{
    /**
     * Còn hạn thì cộng nối tiếp từ hạn hiện tại; hết hạn hoặc chưa có hạn thì tính từ bây giờ.
     * @param string|null $current "Y-m-d H:i:s" hoặc null
     */
    public static function extend(?string $current, int $days, ?int $now = null): string
    {
        $now = $now ?? time();
        $base = $now;
        if ($current !== null && $current !== '') {
            $ts = strtotime($current);
            if ($ts !== false && $ts > $now) {
                $base = $ts;
            }
        }
        return date('Y-m-d H:i:s', $base + $days * 86400);
    }

    /** 'none' (chưa có hạn), 'valid' (còn hạn) hoặc 'expired' (hết hạn). */
    public static function state(?string $expiresAt, ?int $now = null): string
    {
        if ($expiresAt === null || $expiresAt === '') {
            return 'none';
        }
        $ts = strtotime($expiresAt);
        return $ts !== false && $ts > ($now ?? time()) ? 'valid' : 'expired';
    }
}
