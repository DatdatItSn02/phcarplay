<?php
declare(strict_types=1);

namespace App\Repositories;

use App\Core\Database;

/** Bảng password_resets, dùng chung cho người dùng ('user') và quản trị ('admin'). */
final class PasswordResetRepository
{
    private Database $db;

    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function create(string $type, int $accountId, string $tokenHash, string $expiresAt): void
    {
        $this->db->insert(
            'INSERT INTO password_resets (account_type, account_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
            [$type, $accountId, $tokenHash, $expiresAt, date('Y-m-d H:i:s')]
        );
    }

    public function findValid(string $type, string $tokenHash, string $now): ?array
    {
        return $this->db->one(
            'SELECT * FROM password_resets WHERE account_type = ? AND token_hash = ? AND used_at IS NULL AND expires_at > ? LIMIT 1',
            [$type, $tokenHash, $now]
        );
    }

    public function countRecent(string $type, int $accountId, int $seconds): int
    {
        return (int) $this->db->value(
            'SELECT COUNT(*) FROM password_resets WHERE account_type = ? AND account_id = ? AND created_at > ?',
            [$type, $accountId, date('Y-m-d H:i:s', time() - $seconds)]
        );
    }

    /** Vô hiệu mọi token chưa dùng của tài khoản (sau khi đổi mật khẩu). */
    public function invalidateAll(string $type, int $accountId): void
    {
        $this->db->execute(
            'UPDATE password_resets SET used_at = ? WHERE account_type = ? AND account_id = ? AND used_at IS NULL',
            [date('Y-m-d H:i:s'), $type, $accountId]
        );
    }
}
