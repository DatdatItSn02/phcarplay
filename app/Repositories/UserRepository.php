<?php
declare(strict_types=1);

namespace App\Repositories;

use App\Core\Database;
use App\Core\Sql;
use App\Services\LicensePeriod;

/** Chỉ chứa câu SQL liên quan tới bảng users. */
final class UserRepository
{
    private Database $db;

    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function find(int $id): ?array
    {
        return $this->db->one('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [$id]);
    }

    public function findByEmail(string $email): ?array
    {
        return $this->db->one('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL', [strtolower($email)]);
    }

    /** Giai đoạn 14: tìm theo số điện thoại đã chuẩn hóa (0xxxxxxxxx). */
    public function findByPhone(string $phone): ?array
    {
        return $this->db->one('SELECT * FROM users WHERE phone = ? AND deleted_at IS NULL', [$phone]);
    }

    public function create(string $email, string $name, string $hash, string $salt, ?string $phone = null): int
    {
        return $this->db->insert(
            'INSERT INTO users (email, phone, name, password_hash, salt) VALUES (?, ?, ?, ?, ?)',
            [strtolower($email), $phone, $name, $hash, $salt]
        );
    }

    /** null = bỏ số điện thoại. */
    public function updatePhone(int $id, ?string $phone): void
    {
        $this->db->execute('UPDATE users SET phone = ? WHERE id = ?', [$phone, $id]);
    }

    public function updatePassword(int $id, string $hash, string $salt): void
    {
        $this->db->execute('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?', [$hash, $salt, $id]);
    }

    /** Ghi dấu phiên của thiết bị đang đăng nhập (tokenHash = null nghĩa là không thiết bị nào hợp lệ). */
    public function setSession(int $id, ?string $tokenHash, ?string $device, ?string $ip): void
    {
        $this->db->execute(
            'UPDATE users SET session_token = ?, session_device = ?, session_ip = ?, session_at = ? WHERE id = ?',
            [$tokenHash, $device, $ip, $tokenHash === null ? null : date('Y-m-d H:i:s'), $id]
        );
    }

    public function clearSession(int $id): void
    {
        $this->setSession($id, null, null, null);
    }

    public function touchLogin(int $id): void
    {
        $this->db->execute('UPDATE users SET last_login_at = ? WHERE id = ?', [date('Y-m-d H:i:s'), $id]);
    }

    // ---------- dành cho khu vực quản trị ----------

    /**
     * Tìm người dùng. Bộ lọc: q (email, tên hoặc số điện thoại), status (active|blocked), license (none|valid|expired), deleted (1 = chỉ xem đã xóa).
     * @return array<int,array> mới đăng ký đứng đầu, kèm cột playlist_count
     */
    public function search(array $filters, int $limit, int $offset): array
    {
        [$where, $params] = $this->searchWhere($filters);
        return $this->db->all(
            'SELECT u.*, (SELECT COUNT(*) FROM playlists p WHERE p.user_id = u.id AND p.deleted_at IS NULL) AS playlist_count FROM users u'
            . $where . ' ORDER BY u.id DESC LIMIT ' . max(1, $limit) . ' OFFSET ' . max(0, $offset),
            $params
        );
    }

    public function countSearch(array $filters): int
    {
        [$where, $params] = $this->searchWhere($filters);
        return (int) $this->db->value('SELECT COUNT(*) FROM users u' . $where, $params);
    }

    /** @return array{0:string,1:array} đoạn WHERE (có khoảng trắng đầu hoặc rỗng) và tham số */
    private function searchWhere(array $f): array
    {
        $cond = [SoftDelete::filter($f, 'u')];
        $params = [];
        $q = isset($f['q']) ? trim((string) $f['q']) : '';
        if ($q !== '') {
            $cond[] = "(u.email LIKE ? ESCAPE '!' OR u.name LIKE ? ESCAPE '!' OR u.phone LIKE ? ESCAPE '!')";
            $params[] = Sql::like($q);
            $params[] = Sql::like($q);
            // số điện thoại: tìm cả khi gõ +84, dấu cách, dấu chấm
            $digits = preg_replace('/[\s.\-()]/', '', $q) ?? '';
            if (strpos($digits, '+84') === 0) {
                $digits = '0' . substr($digits, 3);
            }
            $params[] = Sql::like($digits !== '' ? $digits : $q);
        }
        if (isset($f['status']) && in_array($f['status'], ['active', 'blocked'], true)) {
            $cond[] = 'u.status = ?';
            $params[] = $f['status'];
        }
        $now = date('Y-m-d H:i:s');
        if (($f['license'] ?? null) === 'none') {
            $cond[] = 'u.expires_at IS NULL';
        } elseif (($f['license'] ?? null) === 'valid') {
            $cond[] = 'u.expires_at IS NOT NULL AND u.expires_at > ?';
            $params[] = $now;
        } elseif (($f['license'] ?? null) === 'expired') {
            $cond[] = 'u.expires_at IS NOT NULL AND u.expires_at <= ?';
            $params[] = $now;
        }
        return [$cond ? ' WHERE ' . implode(' AND ', $cond) : '', $params];
    }

    public function updateProfile(int $id, string $email, string $name): void
    {
        $this->db->execute('UPDATE users SET email = ?, name = ? WHERE id = ?', [strtolower($email), $name, $id]);
    }

    public function setStatus(int $id, string $status): void
    {
        $this->db->execute('UPDATE users SET status = ? WHERE id = ?', [$status, $id]);
    }

    /** null = xóa hạn dùng (chưa có hạn). */
    public function setExpiry(int $id, ?string $expiresAt): void
    {
        $this->db->execute('UPDATE users SET expires_at = ? WHERE id = ?', [$expiresAt, $id]);
    }

    /**
     * "Xóa" người dùng cùng dữ liệu của họ bằng cách đánh dấu (không dùng DELETE), trong một giao dịch:
     * tài khoản (email được dùng lại để đăng ký mới), playlist và bài trong playlist cùng mang dấu người xóa/thời điểm;
     * đăng xuất thiết bị đang dùng; vô hiệu các liên kết đặt lại mật khẩu chưa dùng. Cài đặt giao diện giữ nguyên (không còn ai đọc).
     */
    public function softDeleteWithData(int $id, array $by): void
    {
        $this->db->transaction(function () use ($id, $by) {
            $now = date('Y-m-d H:i:s');
            $mark = SoftDelete::params($by, $now);
            $this->db->execute(
                'UPDATE playlist_items SET ' . SoftDelete::SET . ' WHERE deleted_at IS NULL AND playlist_id IN (SELECT id FROM playlists WHERE user_id = ?)',
                array_merge($mark, [$id])
            );
            $this->db->execute('UPDATE playlists SET ' . SoftDelete::SET . ' WHERE user_id = ? AND deleted_at IS NULL', array_merge($mark, [$id]));
            $this->db->execute(
                "UPDATE password_resets SET used_at = ? WHERE account_type = 'user' AND account_id = ? AND used_at IS NULL",
                [$now, $id]
            );
            $this->db->execute(
                "UPDATE otp_codes SET used_at = ? WHERE account_type = 'user' AND account_id = ? AND used_at IS NULL",
                [$now, $id]
            );
            $this->db->execute(
                'UPDATE users SET alive = NULL, session_token = NULL, session_device = NULL, session_ip = NULL, session_at = NULL, ' . SoftDelete::SET
                . ' WHERE id = ? AND deleted_at IS NULL',
                array_merge($mark, [$id])
            );
        });
    }

    /** @return array<string,int> số liệu tổng quan cho trang Tổng quan của quản trị */
    public function stats(): array
    {
        $now = date('Y-m-d H:i:s');
        $week = date('Y-m-d H:i:s', time() - 7 * 86400);
        $row = $this->db->one(
            "SELECT COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active,
                    COALESCE(SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END), 0) AS blocked,
                    COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS new_7d,
                    COALESCE(SUM(CASE WHEN expires_at IS NOT NULL AND expires_at > ? THEN 1 ELSE 0 END), 0) AS license_valid,
                    COALESCE(SUM(CASE WHEN expires_at IS NOT NULL AND expires_at <= ? THEN 1 ELSE 0 END), 0) AS license_expired,
                    COALESCE(SUM(CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END), 0) AS license_none
             FROM users WHERE deleted_at IS NULL",
            [$week, $now, $now]
        ) ?? [];
        $out = [];
        foreach (['total', 'active', 'blocked', 'new_7d', 'license_valid', 'license_expired', 'license_none'] as $k) {
            $out[$k] = (int) ($row[$k] ?? 0);
        }
        return $out;
    }

    /** Dữ liệu một người dùng cho quản trị viên (không có hash, salt, dấu phiên). */
    public static function adminView(array $user): array
    {
        $hasDevice = isset($user['session_token']) && $user['session_token'] !== null && $user['session_token'] !== '';
        return [
            'id' => (int) $user['id'],
            'email' => $user['email'],
            'phone' => $user['phone'] ?? null,
            'name' => $user['name'],
            'status' => $user['status'],
            'expires_at' => $user['expires_at'] ?? null,
            'license' => LicensePeriod::state($user['expires_at'] ?? null),
            'last_login_at' => $user['last_login_at'] ?? null,
            'created_at' => $user['created_at'] ?? null,
            'device' => $hasDevice
                ? ['label' => (string) ($user['session_device'] ?? ''), 'ip' => (string) ($user['session_ip'] ?? ''), 'since' => $user['session_at'] ?? null]
                : null,
            'playlist_count' => (int) ($user['playlist_count'] ?? 0),
            'deleted' => SoftDelete::view($user),
        ];
    }

    /** Dữ liệu an toàn để trả về trình duyệt (không có hash, salt). */
    public static function publicView(array $user): array
    {
        return [
            'id' => (int) $user['id'],
            'email' => $user['email'],
            'phone' => $user['phone'] ?? null,
            'name' => $user['name'],
            'status' => $user['status'],
            'expires_at' => $user['expires_at'] ?? null,
        ];
    }
}
