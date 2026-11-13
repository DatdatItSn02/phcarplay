<?php
declare(strict_types=1);

namespace App\Repositories;

use App\Core\Database;
use App\Core\Sql;

/** Bảng audit_log: chỉ thêm và đọc, không bao giờ sửa hoặc xóa từng dòng. */
final class AuditLogRepository
{
    private Database $db;

    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function insert(?int $adminId, string $adminEmail, string $action, string $targetType, string $targetId, string $detail, string $ip): void
    {
        $this->db->insert(
            'INSERT INTO audit_log (admin_id, admin_email, action, target_type, target_id, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$adminId, $adminEmail, $action, $targetType, $targetId, $detail, $ip, date('Y-m-d H:i:s')]
        );
    }

    /** @return array<int,array> mới nhất đứng đầu */
    public function recent(int $limit = 50): array
    {
        return $this->db->all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ' . max(1, min(500, $limit)));
    }

    /**
     * Bộ lọc: action (đúng tên hành động), q (email người làm, đối tượng hoặc chi tiết), from / to (ngày "Y-m-d").
     * @return array<int,array> mới nhất đứng đầu
     */
    public function search(array $filters, int $limit, int $offset): array
    {
        [$where, $params] = $this->where($filters);
        return $this->db->all(
            'SELECT * FROM audit_log' . $where . ' ORDER BY id DESC LIMIT ' . max(1, $limit) . ' OFFSET ' . max(0, $offset),
            $params
        );
    }

    public function countSearch(array $filters): int
    {
        [$where, $params] = $this->where($filters);
        return (int) $this->db->value('SELECT COUNT(*) FROM audit_log' . $where, $params);
    }

    /** @return array<int,string> các tên hành động đã có trong nhật ký (để làm ô lọc) */
    public function actions(): array
    {
        return array_map('strval', array_column($this->db->all('SELECT DISTINCT action FROM audit_log ORDER BY action'), 'action'));
    }

    /** @return array{0:string,1:array} */
    private function where(array $f): array
    {
        $cond = [];
        $params = [];
        if (isset($f['action']) && is_string($f['action']) && $f['action'] !== '') {
            $cond[] = 'action = ?';
            $params[] = $f['action'];
        }
        $q = isset($f['q']) ? trim((string) $f['q']) : '';
        if ($q !== '') {
            $cond[] = "(admin_email LIKE ? ESCAPE '!' OR detail LIKE ? ESCAPE '!' OR target_id = ?)";
            $like = Sql::like($q);
            array_push($params, $like, $like, $q);
        }
        if (isset($f['from']) && is_string($f['from']) && $f['from'] !== '') {
            $cond[] = 'created_at >= ?';
            $params[] = $f['from'] . ' 00:00:00';
        }
        if (isset($f['to']) && is_string($f['to']) && $f['to'] !== '') {
            $cond[] = 'created_at <= ?';
            $params[] = $f['to'] . ' 23:59:59';
        }
        return [$cond ? ' WHERE ' . implode(' AND ', $cond) : '', $params];
    }
}
