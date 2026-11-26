<?php
declare(strict_types=1);

/**
 * Kiểm thử quản trị 5.2-5.4 với MySQL thật (cần đã chạy php bin/migrate.php, gồm migration 005 và 006).
 * Chạy: php tests/run.php --integration  (nên trỏ DB_NAME tới database thử riêng)
 * Dữ liệu thử có email bắt đầu bằng it_xxxxxxxx_ và được xóa ở bước cuối.
 */

use App\Core\Container;
use App\Core\Database;

require_once dirname(__DIR__) . '/support/manage_scenarios.php';

registerManageScenarios(
    'Tích hợp (MySQL) Quản trị',
    function () {
        Container::reset();   // dùng Database thật theo cấu hình .env
    },
    function (string $tag) {
        $db = Container::get(Database::class);
        $like = $tag . '\\_%';
        $userIds = array_column($db->all('SELECT id FROM users WHERE email LIKE ?', [$like]), 'id');
        foreach ($userIds as $id) {
            $db->execute('DELETE FROM playlist_items WHERE playlist_id IN (SELECT id FROM playlists WHERE user_id = ?)', [$id]);
            $db->execute('DELETE FROM playlists WHERE user_id = ?', [$id]);
            $db->execute('DELETE FROM user_preferences WHERE user_id = ?', [$id]);
            $db->execute("DELETE FROM password_resets WHERE account_type = 'user' AND account_id = ?", [$id]);
        }
        // Người dùng đã bị xóa trong lúc thử nhưng playlist/key còn: dọn theo ghi chú và email đã lưu.
        $db->execute('DELETE FROM license_keys WHERE note LIKE ? OR used_by_email LIKE ?', ['%' . $tag . '%', $like]);
        $db->execute('DELETE FROM users WHERE email LIKE ?', [$like]);
        $adminIds = array_column($db->all('SELECT id FROM admins WHERE email LIKE ?', [$like]), 'id');
        foreach ($adminIds as $id) {
            $db->execute("DELETE FROM password_resets WHERE account_type = 'admin' AND account_id = ?", [$id]);
        }
        $db->execute('DELETE FROM audit_log WHERE admin_email LIKE ? OR detail LIKE ?', [$like, '%' . $tag . '%']);
        $db->execute('DELETE FROM admins WHERE email LIKE ?', [$like]);
        assertSame(0, (int) $db->value('SELECT COUNT(*) FROM users WHERE email LIKE ?', [$like]), 'dữ liệu thử phải được dọn sạch');
        assertSame(0, (int) $db->value('SELECT COUNT(*) FROM admins WHERE email LIKE ?', [$like]), 'admin thử phải được dọn sạch');
    }
);
