<?php
declare(strict_types=1);

namespace App\Repositories;

use App\Core\Database;

/** Bảng user_api_keys: khóa YouTube API riêng (đã mã hóa) của mỗi tài khoản. Không xóa dòng: bỏ khóa = để trống key_enc. */
final class UserApiKeyRepository
{
    private Database $db;

    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    /** @return array{key_enc: ?string, key_hint: ?string, updated_at: string}|null */
    public function find(int $userId): ?array
    {
        $row = $this->db->one('SELECT key_enc, key_hint, updated_at FROM user_api_keys WHERE user_id = ?', [$userId]);
        if ($row === null) {
            return null;
        }
        return [
            'key_enc' => $row['key_enc'] === null ? null : (string) $row['key_enc'],
            'key_hint' => $row['key_hint'] === null ? null : (string) $row['key_hint'],
            'updated_at' => (string) $row['updated_at'],
        ];
    }

    /** Lưu khóa đã mã hóa; null = bỏ khóa (để trống cột, không xóa dòng). */
    public function save(int $userId, ?string $keyEnc, ?string $last4): void
    {
        $now = date('Y-m-d H:i:s');
        $this->db->execute('INSERT IGNORE INTO user_api_keys (user_id, key_enc, key_hint, updated_at) VALUES (?, NULL, NULL, ?)', [$userId, $now]);
        $this->db->execute('UPDATE user_api_keys SET key_enc = ?, key_hint = ?, updated_at = ? WHERE user_id = ?', [$keyEnc, $last4, $now, $userId]);
    }
}
