<?php
declare(strict_types=1);

namespace App\Repositories;

use App\Core\Database;

/** Bảng user_preferences: mỗi tài khoản một dòng, dữ liệu là chuỗi JSON. */
final class PreferencesRepository
{
    private Database $db;

    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function find(int $userId): ?string
    {
        $row = $this->db->one('SELECT data FROM user_preferences WHERE user_id = ?', [$userId]);
        return $row === null ? null : (string) $row['data'];
    }

    public function save(int $userId, string $json): void
    {
        // INSERT IGNORE rồi UPDATE: chạy được trên cả MySQL lẫn SQLite (máy chủ thử), không cần ON DUPLICATE KEY.
        $now = date('Y-m-d H:i:s');
        $this->db->execute('INSERT IGNORE INTO user_preferences (user_id, data, updated_at) VALUES (?, ?, ?)', [$userId, $json, $now]);
        $this->db->execute('UPDATE user_preferences SET data = ?, updated_at = ? WHERE user_id = ?', [$json, $now, $userId]);
    }
}
