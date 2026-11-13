<?php
declare(strict_types=1);

/**
 * Kiểm thử khu vực quản trị (giai đoạn 5.1) không cần MySQL:
 * chạy Repository/Service/Controller/Router thật trên SQLite trong bộ nhớ (cần PHP bật pdo_sqlite).
 * Phần tương tự chạy trên MySQL thật nằm ở tests/integration/AdminFlowTest.php.
 */

use App\Core\Container;
use App\Core\HttpException;
use App\Core\Request;
use App\Core\Response;
use App\Middleware\RequireMaster;
use App\Middleware\RequirePasswordChanged;
use App\Repositories\AdminRepository;

require_once dirname(__DIR__) . '/support/admin_scenarios.php';

test('Admin: bản SQLite dùng để thử có đúng các cột của schema.sql và các migration 005, 006', function () {
    $db = adminSqliteDatabase();
    if ($db === null) {
        return;   // máy chưa bật pdo_sqlite: bỏ qua (các kiểm thử SQLite bên dưới cũng được ghi là BỎ QUA)
    }
    $schema = BASE_PATH . '/database/schema.sql';
    $mig = BASE_PATH . '/database/migrations/005_audit_log.sql';
    foreach (['admins', 'password_resets', 'audit_log', 'users', 'user_preferences', 'playlists', 'playlist_items', 'license_keys'] as $table) {
        $actual = array_column($db->all('PRAGMA table_info(' . $table . ')'), 'name');
        $expected = adminSqlColumns($schema, $table);
        assertTrue($expected !== [], 'không đọc được bảng ' . $table . ' trong schema.sql');
        sort($actual);
        sort($expected);
        assertSame($expected, $actual, 'cột bảng ' . $table . ' trong schema.sql');
    }
    $fromMigration = adminSqlColumns($mig, 'audit_log');
    $fromSchema = adminSqlColumns($schema, 'audit_log');
    assertSame($fromSchema, $fromMigration, 'migration 005 và schema.sql phải giống nhau');
    $soft = ['deleted_at', 'deleted_by_type', 'deleted_by_id', 'deleted_by_email'];
    assertSame(adminSqlColumns($schema, 'license_keys'), array_merge(adminSqlColumns(BASE_PATH . '/database/migrations/006_license_keys.sql', 'license_keys'), $soft), 'migration 006 + 007 và schema.sql phải giống nhau');
    // migration 007 thêm đúng các cột mà schema.sql có cho từng bảng
    $m7 = (string) file_get_contents(BASE_PATH . '/database/migrations/007_soft_delete.sql');
    foreach (['users' => true, 'admins' => true, 'playlists' => false, 'playlist_items' => false, 'license_keys' => false] as $table => $alive) {
        assertTrue(preg_match('/ALTER TABLE ' . $table . '\n(.*?);/s', $m7, $mm) === 1, 'migration 007 thiếu bảng ' . $table);
        foreach (array_merge($alive ? ['alive'] : [], $soft) as $col) {
            assertTrue(strpos($mm[1], 'ADD COLUMN ' . $col . ' ') !== false, 'migration 007: ' . $table . '.' . $col);
            assertTrue(in_array($col, adminSqlColumns($schema, $table), true), 'schema.sql: ' . $table . '.' . $col);
        }
    }
});

test('Admin: schema.sql đánh dấu migration 005, 006 đã chạy và không dùng khóa ngoại', function () {
    $sql = (string) file_get_contents(BASE_PATH . '/database/schema.sql');
    assertTrue(contains($sql, "'005_audit_log.sql'"), 'thiếu dòng migrations 005');
    assertTrue(contains($sql, "'006_license_keys.sql'"), 'thiếu dòng migrations 006');
    assertTrue(contains($sql, "'007_soft_delete.sql'"), 'thiếu dòng migrations 007');
    assertTrue(stripos((string) file_get_contents(BASE_PATH . '/database/migrations/006_license_keys.sql'), 'FOREIGN KEY') === false, 'migration 006 không được dùng FOREIGN KEY');
    assertTrue(stripos((string) preg_replace('/^\s*--.*$/m', '', $sql), 'FOREIGN KEY') === false, 'không được dùng FOREIGN KEY');
    assertTrue(stripos((string) file_get_contents(BASE_PATH . '/database/migrations/005_audit_log.sql'), 'FOREIGN KEY') === false, 'migration 005 không được dùng FOREIGN KEY');
});

test('Admin: AdminRepository::publicView không lộ hash và salt', function () {
    $view = AdminRepository::publicView([
        'id' => '5', 'email' => 'a@b.c', 'name' => 'A', 'role' => 'admin', 'status' => 'active',
        'must_change_password' => '1', 'last_login_at' => null, 'created_at' => '2026-01-01 00:00:00',
        'password_hash' => str_repeat('a', 32), 'salt' => str_repeat('b', 16),
    ]);
    assertSame(5, $view['id']);
    assertSame(true, $view['must_change_password']);
    assertTrue(!array_key_exists('password_hash', $view) && !array_key_exists('salt', $view));
});

test('Admin: RequirePasswordChanged chặn admin đang dùng mật khẩu tạm', function () {
    $mw = new RequirePasswordChanged();
    $next = function (Request $r): Response { return Response::ok('qua'); };

    $blocked = new Request('GET', '/x');
    $blocked->attributes['admin'] = ['must_change_password' => '1'];
    assertThrows(function () use ($mw, $blocked, $next) { $mw->handle($blocked, $next); }, 'PASSWORD_CHANGE_REQUIRED');

    $ok = new Request('GET', '/x');
    $ok->attributes['admin'] = ['must_change_password' => '0'];
    assertSame('qua', $mw->handle($ok, $next)->payload['data']);
});

test('Admin: RequireMaster chỉ cho vai trò master', function () {
    $mw = new RequireMaster();
    $next = function (Request $r): Response { return Response::ok('qua'); };

    $admin = new Request('GET', '/x');
    $admin->attributes['admin'] = ['role' => 'admin'];
    assertThrows(function () use ($mw, $admin, $next) { $mw->handle($admin, $next); }, 'FORBIDDEN');
    assertThrows(function () use ($mw, $next) { $mw->handle(new Request('GET', '/x'), $next); }, 'FORBIDDEN', 'chưa có admin');

    $master = new Request('GET', '/x');
    $master->attributes['admin'] = ['role' => 'master'];
    assertSame('qua', $mw->handle($master, $next)->payload['data']);
});

if (adminSqliteDatabase() === null) {
    test('Admin (SQLite): BỎ QUA - PHP này chưa bật pdo_sqlite nên không chạy được các kịch bản trên SQLite (hãy dùng --integration với MySQL)', function () {
    });
} else {
    registerAdminScenarios(
        'Admin (SQLite)',
        function () {
            Container::set(App\Core\Database::class, adminSqliteDatabase());
        },
        function (string $tag) {
        }
    );
}
