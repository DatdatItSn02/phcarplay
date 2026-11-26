<?php
declare(strict_types=1);

namespace App\Core;

/** Các hàm kiểm tra dữ liệu đầu vào dùng chung. */
final class Validator
{
    /** Trả về email đã chuẩn hóa (chữ thường) hoặc null nếu không hợp lệ. */
    public static function email($value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $v = strtolower(trim($value));
        if ($v === '' || strlen($v) > 190 || filter_var($v, FILTER_VALIDATE_EMAIL) === false) {
            return null;
        }
        return $v;
    }

    /**
     * Số điện thoại di động Việt Nam (giai đoạn 14). Nhận "0912 345 678", "0912.345.678", "+84912345678", "84912345678".
     * Trả về dạng 10 số bắt đầu bằng 0 (0912345678) hoặc null nếu không hợp lệ.
     */
    public static function phone($value): ?string
    {
        if (!is_string($value) && !is_int($value)) {
            return null;
        }
        $v = preg_replace('/[\s.\-()]/', '', (string) $value) ?? '';
        if (strpos($v, '+84') === 0) {
            $v = '0' . substr($v, 3);
        } elseif (strlen($v) === 11 && strpos($v, '84') === 0) {
            $v = '0' . substr($v, 2);
        }
        return preg_match('/^0[35789][0-9]{8}$/', $v) === 1 ? $v : null;
    }

    /** Ô đăng nhập "Email hoặc số điện thoại": ['email', '...'] | ['phone', '0...'] | null. */
    public static function loginId($value): ?array
    {
        if (!is_string($value) || trim($value) === '') {
            return null;
        }
        if (strpos($value, '@') !== false) {
            $email = self::email($value);
            return $email === null ? null : ['email', $email];
        }
        $phone = self::phone($value);
        return $phone === null ? null : ['phone', $phone];
    }

    public static function text($value, int $max = 100): string
    {
        $v = is_string($value) ? trim($value) : '';
        $v = preg_replace('/[\x00-\x1F\x7F]/u', '', $v) ?? '';
        return mb_substr($v, 0, $max);
    }

    public static function passwordOk($value, int $min = 6, int $max = 100): bool
    {
        return is_string($value) && mb_strlen($value) >= $min && mb_strlen($value) <= $max;
    }

    /**
     * Ngày giờ do quản trị nhập: "YYYY-MM-DD" (hiểu là hết ngày đó, 23:59:59) hoặc "YYYY-MM-DD HH:MM[:SS]" (cho phép chữ T ở giữa).
     * Trả về "Y-m-d H:i:s" hoặc null nếu không hợp lệ (ngày không có thật, năm ngoài 2000-2100).
     */
    public static function dateTime($value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/', trim($value), $m) !== 1) {
            return null;
        }
        $y = (int) $m[1];
        $mo = (int) $m[2];
        $d = (int) $m[3];
        if ($y < 2000 || $y > 2100 || !checkdate($mo, $d, $y)) {
            return null;
        }
        if (!isset($m[4])) {
            return sprintf('%04d-%02d-%02d 23:59:59', $y, $mo, $d);
        }
        $h = (int) $m[4];
        $mi = (int) $m[5];
        $s = isset($m[6]) && $m[6] !== '' ? (int) $m[6] : 0;
        if ($h > 23 || $mi > 59 || $s > 59) {
            return null;
        }
        return sprintf('%04d-%02d-%02d %02d:%02d:%02d', $y, $mo, $d, $h, $mi, $s);
    }
}
