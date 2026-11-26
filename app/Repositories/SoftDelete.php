<?php
declare(strict_types=1);

namespace App\Repositories;

/**
 * Xóa bằng cách đánh dấu (giai đoạn 8): website không bao giờ chạy lệnh DELETE trên database.
 * Dòng "đã xóa" có deleted_at (thời điểm) và người xóa (deleted_by_type, deleted_by_id, deleted_by_email);
 * mọi truy vấn thường đều lọc "deleted_at IS NULL".
 * Người xóa: ['type' => 'admin'|'user'|'system', 'id' => ?int, 'email' => string].
 */
final class SoftDelete
{
    public const SET = 'deleted_at = ?, deleted_by_type = ?, deleted_by_id = ?, deleted_by_email = ?';

    public static function byAdmin(array $admin): array
    {
        return ['type' => 'admin', 'id' => (int) ($admin['id'] ?? 0), 'email' => (string) ($admin['email'] ?? '')];
    }

    public static function byUser(int $userId, string $email = ''): array
    {
        return ['type' => 'user', 'id' => $userId, 'email' => $email];
    }

    /** @return array<int,mixed> tham số cho SET theo thứ tự */
    public static function params(array $by, ?string $at = null): array
    {
        return [$at ?? date('Y-m-d H:i:s'), (string) ($by['type'] ?? 'system'), isset($by['id']) ? (int) $by['id'] : null, (string) ($by['email'] ?? '')];
    }

    /** Thông tin xóa để hiển thị ở trang quản trị; null nếu dòng chưa bị xóa. */
    public static function view(array $row): ?array
    {
        if (empty($row['deleted_at'])) {
            return null;
        }
        return [
            'at' => (string) $row['deleted_at'],
            'by_type' => (string) ($row['deleted_by_type'] ?? ''),
            'by_id' => isset($row['deleted_by_id']) ? (int) $row['deleted_by_id'] : null,
            'by_email' => (string) ($row['deleted_by_email'] ?? ''),
        ];
    }

    /** Bộ lọc danh sách quản trị: deleted=1 chỉ xem mục đã xóa, còn lại chỉ xem mục đang dùng. */
    public static function filter(array $filters, string $alias): string
    {
        $col = ($alias !== '' ? $alias . '.' : '') . 'deleted_at';
        return (($filters['deleted'] ?? '') === '1') ? $col . ' IS NOT NULL' : $col . ' IS NULL';
    }
}
