<?php
declare(strict_types=1);

// Giai đoạn 17: lệnh php bin/migrate.php chạy lại được khi lần trước dừng giữa chừng / database đã được sửa tay,
// và --pending liệt kê migration còn thiếu (quy trình tự cập nhật lên alwaysdata dùng cả hai).

require_once dirname(__DIR__, 2) . '/bin/migrate.php';
require_once dirname(__DIR__) . '/support/sqlite_schema.php';

function migTempDir(array $files): string
{
    $dir = sys_get_temp_dir() . '/carweb-mig-' . bin2hex(random_bytes(4));
    mkdir($dir, 0700, true);
    foreach ($files as $name => $sql) {
        file_put_contents($dir . '/' . $name, $sql);
    }
    return $dir;
}

function migDb(): ?App\Core\Database
{
    if (!extension_loaded('pdo_sqlite')) {
        return null;
    }
    $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $db = new App\Core\Database([]);
    $prop = new ReflectionProperty(App\Core\Database::class, 'pdo');
    $prop->setAccessible(true);
    $prop->setValue($db, $pdo);
    return $db;
}

test('migrationAlreadyApplied: chỉ coi là "đã chạy rồi" với lỗi bảng/cột/chỉ mục đã có hoặc chỉ mục cần bỏ đã không còn', function () {
    $mk = static function (int $code, string $msg): PDOException {
        $e = new PDOException($msg);
        $e->errorInfo = ['42S01', $code, $msg];
        return $e;
    };
    foreach ([1050, 1060, 1061, 1068, 1091, 1826] as $code) {
        assertTrue(migrationAlreadyApplied($mk($code, 'x')), 'mã ' . $code);
    }
    foreach ([1064, 1146, 1054, 1045, 2002, 1062] as $code) {
        assertTrue(!migrationAlreadyApplied($mk($code, 'x')), 'mã ' . $code . ' là lỗi thật');
    }
    assertTrue(migrationAlreadyApplied($mk(1, 'SQLSTATE[HY000]: General error: 1 table ta already exists (sqlite)')));
    assertTrue(!migrationAlreadyApplied(new RuntimeException('table already exists')), 'chỉ xét lỗi của database');
});

test('migrationStatements: tách câu theo ; cuối dòng, bỏ chú thích', function () {
    $s = migrationStatements("-- chú thích\nCREATE TABLE a (id INT);\n\n-- nữa\nALTER TABLE a ADD COLUMN b INT;\r\nINSERT INTO a VALUES (1)");
    assertSame(['CREATE TABLE a (id INT)', 'ALTER TABLE a ADD COLUMN b INT', 'INSERT INTO a VALUES (1)'], $s);
});

if (migDb() === null) {
    test('migrate.php với SQLite: BỎ QUA - PHP này chưa bật pdo_sqlite', function () {
    });
    return;
}

test('runMigrations: chạy theo thứ tự tên file, ghi nhận, lần sau không chạy lại; --pending liệt kê đúng', function () {
    $db = migDb();
    $dir = migTempDir([
        '002_b.sql' => "CREATE TABLE tb (id INTEGER PRIMARY KEY);\n",
        '001_a.sql' => "CREATE TABLE ta (id INTEGER PRIMARY KEY);\n",
        'ghi-chu.txt' => 'không phải migration',
    ]);
    assertSame(['001_a.sql', '002_b.sql'], pendingMigrations($db, $dir));
    assertSame(['001_a.sql', '002_b.sql'], runMigrations($db, $dir));
    assertSame([], pendingMigrations($db, $dir));
    assertSame([], runMigrations($db, $dir), 'không chạy lại');
    file_put_contents($dir . '/003_c.sql', "CREATE TABLE tc (id INTEGER PRIMARY KEY);\n");
    assertSame(['003_c.sql'], pendingMigrations($db, $dir));
});

test('runMigrations: lần trước dừng giữa chừng (bảng đã tạo nhưng chưa ghi nhận) -> bỏ qua câu đã chạy, chạy tiếp câu sau', function () {
    $db = migDb();
    $dir = migTempDir(['001_x.sql' => "CREATE TABLE tx (id INTEGER PRIMARY KEY);\nALTER TABLE tx ADD COLUMN note TEXT;\nCREATE INDEX idx_tx_note ON tx (note);\n"]);
    $db->run('CREATE TABLE tx (id INTEGER PRIMARY KEY)');           // câu 1 đã chạy ở lần trước
    $db->run('ALTER TABLE tx ADD COLUMN note TEXT');                // câu 2 cũng đã chạy
    $logs = [];
    assertSame(['001_x.sql'], runMigrations($db, $dir, static function (string $l) use (&$logs): void { $logs[] = $l; }));
    assertSame(2, count($logs), 'hai câu bị bỏ qua: ' . implode(' | ', $logs));
    assertTrue(contains($logs[0], '001_x.sql: bỏ qua câu đã chạy trước đó (CREATE TABLE tx'));
    $idx = $db->all("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_tx_note'");
    assertSame(1, count($idx), 'câu 3 vẫn được chạy');
    assertSame([], pendingMigrations($db, $dir));
});

test('runMigrations: lỗi thật thì dừng, báo tên file, KHÔNG ghi nhận file lỗi, các file trước vẫn được ghi nhận', function () {
    $db = migDb();
    $dir = migTempDir([
        '001_ok.sql' => "CREATE TABLE tok (id INTEGER PRIMARY KEY);\n",
        '002_loi.sql' => "CREATE TABLE tl (id INTEGER PRIMARY KEY);\nALTER TABLE khong_co ADD COLUMN x TEXT;\n",
        '003_sau.sql' => "CREATE TABLE ts (id INTEGER PRIMARY KEY);\n",
    ]);
    $msg = '';
    try {
        runMigrations($db, $dir);
    } catch (RuntimeException $e) {
        $msg = $e->getMessage();
    }
    assertTrue(contains($msg, '002_loi.sql: '), 'báo tên file lỗi: ' . $msg);
    assertSame(['002_loi.sql', '003_sau.sql'], pendingMigrations($db, $dir));
    // sửa file lỗi rồi chạy lại: câu đã chạy (tạo tl) được bỏ qua, phần còn lại chạy tiếp
    file_put_contents($dir . '/002_loi.sql', "CREATE TABLE tl (id INTEGER PRIMARY KEY);\nALTER TABLE tl ADD COLUMN x TEXT;\n");
    assertSame(['002_loi.sql', '003_sau.sql'], runMigrations($db, $dir));
});

test('bin/migrate.php --pending và bin/backup-db.php từ chối chạy qua web; deploy/ có .htaccess chặn truy cập', function () {
    foreach (['bin/migrate.php', 'bin/backup-db.php'] as $f) {
        assertTrue(contains((string) file_get_contents(BASE_PATH . '/' . $f), "PHP_SAPI !== 'cli'"), $f);
    }
    assertTrue(contains((string) file_get_contents(BASE_PATH . '/bin/migrate.php'), "'--pending'"));
    assertTrue(contains((string) file_get_contents(BASE_PATH . '/deploy/.htaccess'), 'Require all denied'));
    $backup = (string) file_get_contents(BASE_PATH . '/bin/backup-db.php');
    assertTrue(!preg_match('/\b(DROP|DELETE|TRUNCATE)\b/', preg_replace('/^\s*(\*|\/\/|--).*$/m', '', $backup) ?? ''), 'file sao lưu không được chứa lệnh xóa');
});

test('/api/health: trả bản mã đang chạy (12 ký tự) chỉ khi app/deploy_revision.php hợp lệ', function () {
    $dir = sys_get_temp_dir() . '/carweb-rev-' . bin2hex(random_bytes(4));
    mkdir($dir);
    $n = 0;
    $file = static function (string $body) use ($dir, &$n): string {
        $f = $dir . '/rev' . (++$n) . '.php';   // mỗi lần một file mới: tránh bộ nhớ đệm PHP giữ nội dung cũ
        file_put_contents($f, $body);
        return $f;
    };
    assertSame('', App\Controllers\HealthController::revision($dir . '/khong-co.php'), 'không có file');
    assertSame('0ee21d3aae0c', App\Controllers\HealthController::revision($file("<?php\nreturn '0ee21d3aae0ceb5176a396112efcd05eaecc7bbe';\n")));
    assertSame('', App\Controllers\HealthController::revision($file("<?php\nreturn '<script>';\n")), 'sai dạng thì không trả gì');
    assertSame('', App\Controllers\HealthController::revision($file("<?php\nreturn 123;\n")));
    assertSame('', App\Controllers\HealthController::revision($file("<?php\n")));
    assertTrue(contains((string) file_get_contents(BASE_PATH . '/.gitignore'), 'app/deploy_revision.php'), 'file do máy chủ tạo, không đưa vào git');
});
