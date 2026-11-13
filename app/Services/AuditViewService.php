<?php
declare(strict_types=1);

namespace App\Services;

use App\Repositories\AuditLogRepository;

/** Xem nhật ký thao tác quản trị (chỉ đọc). */
final class AuditViewService
{
    private AuditLogRepository $logs;

    public function __construct(AuditLogRepository $logs)
    {
        $this->logs = $logs;
    }

    public function search(array $filters, int $page, int $perPage, int $offset): array
    {
        $items = array_map([self::class, 'view'], $this->logs->search($filters, $perPage, $offset));
        return [
            'items' => $items,
            'total' => $this->logs->countSearch($filters),
            'page' => $page,
            'per_page' => $perPage,
            'actions' => $this->logs->actions(),
        ];
    }

    /** @return array<int,array> các dòng mới nhất, dùng cho trang Tổng quan */
    public function recent(int $limit): array
    {
        return array_map([self::class, 'view'], $this->logs->recent($limit));
    }

    public static function view(array $r): array
    {
        return [
            'id' => (int) $r['id'],
            'admin_id' => $r['admin_id'] === null ? null : (int) $r['admin_id'],
            'admin_email' => $r['admin_email'],
            'action' => $r['action'],
            'target_type' => $r['target_type'],
            'target_id' => $r['target_id'],
            'detail' => $r['detail'],
            'ip' => $r['ip'],
            'created_at' => $r['created_at'],
        ];
    }
}
