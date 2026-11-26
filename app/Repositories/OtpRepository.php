<?php
declare(strict_types=1);

namespace App\Repositories;

use App\Core\Database;

/** Bảng otp_codes (giai đoạn 14). Không xóa dòng: hết dùng thì ghi used_at. */
final class OtpRepository
{
    private Database $db;

    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function create(string $type, int $accountId, string $purpose, string $codeHash, string $channels, string $expiresAt): void
    {
        $this->db->insert(
            'INSERT INTO otp_codes (account_type, account_id, purpose, code_hash, attempts, channels, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
            [$type, $accountId, $purpose, $codeHash, $channels, $expiresAt, date('Y-m-d H:i:s')]
        );
    }

    /** Mã mới nhất chưa dùng (còn hay đã hết hạn). */
    public function latestOpen(string $type, int $accountId, string $purpose): ?array
    {
        return $this->db->one(
            'SELECT * FROM otp_codes WHERE account_type = ? AND account_id = ? AND purpose = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1',
            [$type, $accountId, $purpose]
        );
    }

    public function addAttempt(int $id): void
    {
        $this->db->execute('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [$id]);
    }

    public function markUsed(int $id): void
    {
        $this->db->execute('UPDATE otp_codes SET used_at = ? WHERE id = ? AND used_at IS NULL', [date('Y-m-d H:i:s'), $id]);
    }

    /** Hủy mọi mã chưa dùng của tài khoản (purpose = null: mọi mục đích). */
    public function closeAll(string $type, int $accountId, ?string $purpose = null): void
    {
        $sql = 'UPDATE otp_codes SET used_at = ? WHERE account_type = ? AND account_id = ? AND used_at IS NULL';
        $params = [date('Y-m-d H:i:s'), $type, $accountId];
        if ($purpose !== null) {
            $sql .= ' AND purpose = ?';
            $params[] = $purpose;
        }
        $this->db->execute($sql, $params);
    }
}
