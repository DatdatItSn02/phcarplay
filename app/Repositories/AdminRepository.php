<?php
declare(strict_types=1);

namespace App\Repositories;

use App\Core\Database;

/** Chỉ chứa câu SQL liên quan tới bảng admins. */
final class AdminRepository
{
    private Database $db;

    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function find(int $id): ?array
    {
        return $this->db->one('SELECT * FROM admins WHERE id = ? AND deleted_at IS NULL', [$id]);
    }

    public function findByEmail(string $email): ?array
    {
        return $this->db->one('SELECT * FROM admins WHERE email = ? AND deleted_at IS NULL', [strtolower($email)]);
    }

    /** @return array<int,array> master đứng đầu, sau đó theo thứ tự tạo. $deleted = true: chỉ các tài khoản đã xóa (mới xóa trước). */
    public function all(bool $deleted = false): array
    {
        if ($deleted) {
            return $this->db->all('SELECT * FROM admins WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id DESC');
        }
        return $this->db->all("SELECT * FROM admins WHERE deleted_at IS NULL ORDER BY CASE WHEN role = 'master' THEN 0 ELSE 1 END, id ASC");
    }

    public function countAll(): int
    {
        return (int) $this->db->value('SELECT COUNT(*) FROM admins WHERE deleted_at IS NULL');
    }

    public function countByRole(string $role): int
    {
        return (int) $this->db->value('SELECT COUNT(*) FROM admins WHERE role = ? AND deleted_at IS NULL', [$role]);
    }

    public function create(string $email, string $name, string $hash, string $salt, string $role, bool $mustChange = false): int
    {
        return $this->db->insert(
            'INSERT INTO admins (email, name, password_hash, salt, role, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [strtolower($email), $name, $hash, $salt, $role, $mustChange ? 1 : 0, date('Y-m-d H:i:s'), date('Y-m-d H:i:s')]
        );
    }

    public function updateProfile(int $id, string $email, string $name): void
    {
        $this->db->execute(
            'UPDATE admins SET email = ?, name = ?, updated_at = ? WHERE id = ?',
            [strtolower($email), $name, date('Y-m-d H:i:s'), $id]
        );
    }

    public function setStatus(int $id, string $status): void
    {
        $this->db->execute('UPDATE admins SET status = ?, updated_at = ? WHERE id = ?', [$status, date('Y-m-d H:i:s'), $id]);
    }

    public function setPassword(int $id, string $hash, string $salt, bool $mustChange): void
    {
        $this->db->execute(
            'UPDATE admins SET password_hash = ?, salt = ?, must_change_password = ?, updated_at = ? WHERE id = ?',
            [$hash, $salt, $mustChange ? 1 : 0, date('Y-m-d H:i:s'), $id]
        );
    }

    public function touchLogin(int $id): void
    {
        $this->db->execute('UPDATE admins SET last_login_at = ? WHERE id = ?', [date('Y-m-d H:i:s'), $id]);
    }

    /** "Xóa" admin bằng cách đánh dấu (không dùng DELETE) và vô hiệu các liên kết đặt lại mật khẩu chưa dùng của họ. */
    public function softDelete(int $id, array $by): void
    {
        $this->db->transaction(function () use ($id, $by) {
            $now = date('Y-m-d H:i:s');
            $this->db->execute(
                'UPDATE password_resets SET used_at = ? WHERE account_type = ? AND account_id = ? AND used_at IS NULL',
                [$now, 'admin', $id]
            );
            $this->db->execute(
                'UPDATE admins SET alive = NULL, ' . SoftDelete::SET . ' WHERE id = ? AND deleted_at IS NULL',
                array_merge(SoftDelete::params($by, $now), [$id])
            );
        });
    }

    /** Dùng cho bin/reset-master.php: đặt lại mật khẩu mọi tài khoản của một vai trò và mở khóa. */
    public function updatePasswordByRole(string $role, string $hash, string $salt): int
    {
        return $this->db->execute(
            'UPDATE admins SET password_hash = ?, salt = ?, status = ?, must_change_password = 0 WHERE role = ? AND deleted_at IS NULL',
            [$hash, $salt, 'active', $role]
        );
    }

    /** Dữ liệu an toàn để trả về trình duyệt (không có hash, salt). */
    public static function publicView(array $a): array
    {
        return [
            'id' => (int) $a['id'],
            'email' => $a['email'],
            'name' => $a['name'],
            'role' => $a['role'],
            'status' => $a['status'],
            'must_change_password' => (int) $a['must_change_password'] === 1,
            'last_login_at' => $a['last_login_at'] ?? null,
            'created_at' => $a['created_at'] ?? null,
            'deleted' => SoftDelete::view($a),
        ];
    }
}
