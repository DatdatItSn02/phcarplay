<?php
declare(strict_types=1);

namespace App\Repositories;

use App\Core\Database;
use App\Core\Sql;

/** Bảng license_keys (key kích hoạt). Chỉ chứa câu SQL; quy tắc nghiệp vụ nằm ở LicenseKeyService. */
final class LicenseKeyRepository
{
    private Database $db;

    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function create(string $code, int $days, string $note, ?int $adminId): int
    {
        return $this->db->insert(
            'INSERT INTO license_keys (code, days, note, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [$code, $days, $note, 'unused', $adminId, date('Y-m-d H:i:s')]
        );
    }

    public function find(int $id): ?array
    {
        return $this->db->one(self::SELECT . ' WHERE k.id = ? AND k.deleted_at IS NULL', [$id]);
    }

    public function findByCode(string $code): ?array
    {
        return $this->db->one(self::SELECT . ' WHERE k.code = ? AND k.deleted_at IS NULL', [$code]);
    }

    /**
     * Bộ lọc: status (unused|used|revoked), q (key, ghi chú hoặc email người dùng), deleted (1 = chỉ xem đã xóa).
     * @return array<int,array> mới nhất đứng đầu
     */
    public function search(array $filters, int $limit, int $offset): array
    {
        [$where, $params] = $this->where($filters);
        return $this->db->all(
            self::SELECT . $where . ' ORDER BY k.id DESC LIMIT ' . max(1, $limit) . ' OFFSET ' . max(0, $offset),
            $params
        );
    }

    public function countSearch(array $filters): int
    {
        [$where, $params] = $this->where($filters);
        return (int) $this->db->value('SELECT COUNT(*) FROM license_keys k' . $where, $params);
    }

    /** @return array<string,int> số key theo trạng thái */
    public function counts(): array
    {
        $out = ['unused' => 0, 'used' => 0, 'revoked' => 0];
        foreach ($this->db->all('SELECT status, COUNT(*) AS n FROM license_keys WHERE deleted_at IS NULL GROUP BY status') as $row) {
            if (isset($out[$row['status']])) {
                $out[$row['status']] = (int) $row['n'];
            }
        }
        return $out;
    }

    /** @return array<int,array> các key người này đã nhập, mới nhất đứng đầu */
    public function usedBy(int $userId): array
    {
        return $this->db->all(self::SELECT . ' WHERE k.used_by = ? ORDER BY k.used_at DESC, k.id DESC', [$userId]);
    }

    /** Thu hồi key chưa dùng. Trả true nếu thu hồi được (key đã dùng hoặc đã thu hồi thì false). */
    public function revoke(int $id, int $adminId): bool
    {
        return $this->db->execute(
            "UPDATE license_keys SET status = 'revoked', revoked_by = ?, revoked_at = ? WHERE id = ? AND status = 'unused'",
            [$adminId, date('Y-m-d H:i:s'), $id]
        ) > 0;
    }

    /** "Xóa" (đánh dấu) key chưa dùng hoặc đã thu hồi. Key đã dùng là lịch sử, không xóa được. */
    public function softDeleteUnlessUsed(int $id, array $by): bool
    {
        return $this->db->execute(
            'UPDATE license_keys SET ' . SoftDelete::SET . " WHERE id = ? AND status <> 'used' AND deleted_at IS NULL",
            array_merge(SoftDelete::params($by), [$id])
        ) > 0;
    }

    /**
     * Người dùng nhập key: trong MỘT giao dịch, khóa dòng người dùng, "chiếm" key (chỉ thành công nếu key còn
     * chưa dùng, nên hai người nhập cùng lúc chỉ một người được) rồi cộng hạn dùng.
     *
     * @param callable $extend function(?string $hạnHiệnTại): string hạnMới
     * @return array|null null nếu key không còn dùng được; ngược lại ['previous' => ?string, 'expires_at' => string]
     */
    public function redeem(int $keyId, int $userId, string $userEmail, callable $extend): ?array
    {
        return $this->db->transaction(function () use ($keyId, $userId, $userEmail, $extend) {
            // Ghi "không đổi gì" vào dòng người dùng để giữ khóa dòng đến hết giao dịch (hai key nhập cùng lúc không đè nhau).
            $this->db->execute('UPDATE users SET name = name WHERE id = ?', [$userId]);
            $claimed = $this->db->execute(
                "UPDATE license_keys SET status = 'used', used_by = ?, used_by_email = ?, used_at = ? WHERE id = ? AND status = 'unused'",
                [$userId, $userEmail, date('Y-m-d H:i:s'), $keyId]
            );
            if ($claimed < 1) {
                return null;
            }
            $current = $this->db->value('SELECT expires_at FROM users WHERE id = ?', [$userId]);
            $previous = $current === null ? null : (string) $current;
            $new = (string) $extend($previous);
            $this->db->execute('UPDATE users SET expires_at = ? WHERE id = ?', [$new, $userId]);
            return ['previous' => $previous, 'expires_at' => $new];
        });
    }

    private const SELECT = 'SELECT k.*, a.email AS created_by_email FROM license_keys k LEFT JOIN admins a ON a.id = k.created_by';

    /** @return array{0:string,1:array} */
    private function where(array $f): array
    {
        $cond = [SoftDelete::filter($f, 'k')];
        $params = [];
        if (isset($f['status']) && in_array($f['status'], ['unused', 'used', 'revoked'], true)) {
            $cond[] = 'k.status = ?';
            $params[] = $f['status'];
        }
        $q = isset($f['q']) ? trim((string) $f['q']) : '';
        if ($q !== '') {
            $cond[] = "(k.code LIKE ? ESCAPE '!' OR k.note LIKE ? ESCAPE '!' OR k.used_by_email LIKE ? ESCAPE '!')";
            $like = Sql::like($q);
            array_push($params, $like, $like, $like);
        }
        return [$cond ? ' WHERE ' . implode(' AND ', $cond) : '', $params];
    }
}
