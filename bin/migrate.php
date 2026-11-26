<?php
declare(strict_types=1);

/**
 * Chạy các file database/migrations/*.sql chưa chạy (theo thứ tự tên file).
 * Dùng: php bin/migrate.php            chạy các migration còn thiếu
 *       php bin/migrate.php --pending  chỉ liệt kê migration còn thiếu, không đổi gì
 * Quy ước: mỗi câu lệnh kết thúc bằng dấu ; ở cuối dòng; không đặt ; trong chuỗi hay trigger.
 *
 * Giai đoạn 17 (tự cập nhật lên alwaysdata): chạy lại được khi lần trước dừng giữa chừng hoặc database đã
 * được sửa tay (vd. chạy file database/bo-sung-*.sql). Câu lệnh báo "đã có rồi" (bảng, cột, chỉ mục đã tồn tại;
 * chỉ mục cần bỏ đã không còn) được bỏ qua và ghi ra màn hình, các câu sau vẫn chạy tiếp.
 */
require dirname(__DIR__) . '/app/bootstrap.php';

use App\Core\Container;
use App\Core\Database;

/**
 * Lỗi có nghĩa là câu lệnh này ĐÃ được chạy trước đó (không phải lỗi thật)?
 * MySQL/MariaDB: 1050 bảng đã có, 1060 cột đã có, 1061 tên chỉ mục đã có, 1068 đã có khóa chính,
 * 1091 không bỏ được vì cột/chỉ mục không còn, 1826 tên khóa ngoại đã có.
 */
function migrationAlreadyApplied(Throwable $e): bool
{
    if (!$e instanceof PDOException) {
        return false;
    }
    $code = (int) ($e->errorInfo[1] ?? 0);
    if (in_array($code, [1050, 1060, 1061, 1068, 1091, 1826], true)) {
        return true;
    }
    // SQLite (chỉ khi kiểm thử) báo mọi lỗi bằng mã 1; MySQL không có mã 1.
    $msg = strtolower($e->getMessage());
    return $code === 1 && (strpos($msg, 'already exists') !== false || strpos($msg, 'duplicate column name') !== false);
}

/** Tên các file migration chưa chạy, theo thứ tự. */
function pendingMigrations(Database $db, string $dir): array
{
    ensureMigrationsTable($db);
    $done = array_column($db->all('SELECT name FROM migrations'), 'name');
    $files = glob($dir . '/*.sql') ?: [];
    sort($files);
    $pending = [];
    foreach ($files as $file) {
        if (!in_array(basename($file), $done, true)) {
            $pending[] = basename($file);
        }
    }
    return $pending;
}

function ensureMigrationsTable(Database $db): void
{
    // SQLite chỉ dùng khi kiểm thử (không hiểu ENGINE/CHARSET).
    $sqlite = $db->pdo()->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
    $db->run('CREATE TABLE IF NOT EXISTS migrations (
        name VARCHAR(190) NOT NULL PRIMARY KEY,
        ran_at DATETIME NOT NULL
    )' . ($sqlite ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'));
}

/** Các câu lệnh trong một file migration (bỏ dòng chú thích --). */
function migrationStatements(string $sql): array
{
    $sql = preg_replace('/^\s*--.*$/m', '', $sql) ?? $sql;
    $out = [];
    foreach (preg_split('/;\s*(?:\r?\n|$)/', $sql) ?: [] as $statement) {
        if (trim($statement) !== '') {
            $out[] = trim($statement);
        }
    }
    return $out;
}

/**
 * Chạy các migration còn thiếu. $log(string) nhận từng dòng thông báo (câu lệnh bị bỏ qua vì đã chạy rồi).
 * @return array<int,string> tên các file đã chạy
 */
function runMigrations(Database $db, string $dir, ?callable $log = null): array
{
    $ran = [];
    foreach (pendingMigrations($db, $dir) as $name) {
        foreach (migrationStatements((string) file_get_contents($dir . '/' . $name)) as $statement) {
            try {
                $db->run($statement);
            } catch (Throwable $e) {
                if (!migrationAlreadyApplied($e)) {
                    throw new RuntimeException($name . ': ' . $e->getMessage(), 0, $e);
                }
                if ($log !== null) {
                    $first = preg_replace('/\s+/', ' ', $statement) ?? $statement;
                    $log('  ' . $name . ': bỏ qua câu đã chạy trước đó (' . mb_substr($first, 0, 70) . '...)');
                }
            }
        }
        $db->run('INSERT INTO migrations (name, ran_at) VALUES (?, ?)', [$name, date('Y-m-d H:i:s')]);
        $ran[] = $name;
    }
    return $ran;
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    if (PHP_SAPI !== 'cli') {
        exit('Chỉ chạy bằng dòng lệnh.');
    }
    $argv = $_SERVER['argv'] ?? [];
    try {
        $db = Container::get(Database::class);
        $dir = BASE_PATH . '/database/migrations';
        if (in_array('--pending', $argv, true)) {
            $pending = pendingMigrations($db, $dir);
            echo $pending ? implode(PHP_EOL, $pending) . PHP_EOL : '';
            exit(0);
        }
        $ran = runMigrations($db, $dir, static function (string $line): void {
            echo $line . PHP_EOL;
        });
        echo $ran ? 'Đã chạy: ' . implode(', ', $ran) . PHP_EOL : 'Không có migration mới.' . PHP_EOL;
    } catch (Throwable $e) {
        fwrite(STDERR, 'Lỗi migration: ' . $e->getMessage() . PHP_EOL);
        exit(1);
    }
}
