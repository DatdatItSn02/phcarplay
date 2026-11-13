<?php
declare(strict_types=1);

namespace App\Core;

/** Phân trang cho các danh sách quản trị: đọc ?page= & ?per_page= từ địa chỉ và dựng kết quả trả về. */
final class Pagination
{
    /** @return array{0:int,1:int,2:int} [trang (từ 1), số dòng mỗi trang, vị trí bắt đầu] */
    public static function fromQuery(array $query, int $defaultPer = 20, int $maxPer = 100): array
    {
        $page = self::positive($query['page'] ?? null, 1, 100000);
        $per = self::positive($query['per_page'] ?? null, $defaultPer, $maxPer);
        return [$page, $per, ($page - 1) * $per];
    }

    public static function result(array $items, int $total, int $page, int $perPage): array
    {
        return ['items' => $items, 'total' => $total, 'page' => $page, 'per_page' => $perPage];
    }

    private static function positive($value, int $default, int $max): int
    {
        if (!is_scalar($value) || !ctype_digit((string) $value)) {
            return $default;
        }
        $n = (int) $value;
        return $n < 1 ? $default : min($n, $max);
    }
}
