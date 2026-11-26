<?php
declare(strict_types=1);

/**
 * Kiểm thử khu vực quản trị với MySQL thật (cần đã chạy php bin/migrate.php, gồm migration 005).
 * Chạy: php tests/run.php --integration  (nên trỏ DB_NAME tới database thử riêng)
 * Dữ liệu thử có email bắt đầu bằng it_xxxxxxxx_ và được xóa ở bước cuối.
 */

use App\Core\Container;
use App\Core\Database;

require_once dirname(__DIR__) . '/support/admin_scenarios.php';

registerAdminScenarios(
    'Tích hợp (MySQL) Admin',
    function () {
        Container::reset();   // dùng Database thật theo cấu hình .env
    },
    function (string $tag) {
        $db = Container::get(Database::class);
        $like = $tag . '\\_%';
        $ids = array_column($db->all('SELECT id FROM admins WHERE email LIKE ?', [$like]), 'id');
        foreach ($ids as $id) {
            $db->execute('DELETE FROM password_resets WHERE account_type = ? AND account_id = ?', ['admin', $id]);
        }
        $db->execute('DELETE FROM audit_log WHERE admin_email LIKE ? OR detail LIKE ?', [$like, '%' . $tag . '\\_%']);
        $db->execute('DELETE FROM admins WHERE email LIKE ?', [$like]);
        $left = (int) $db->value('SELECT COUNT(*) FROM admins WHERE email LIKE ?', [$like]);
        assertSame(0, $left, 'dữ liệu thử phải được dọn sạch');
    }
);
