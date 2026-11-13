<?php
declare(strict_types=1);

/**
 * Chạy các file database/migrations/*.sql chưa chạy (theo thứ tự tên file).
 * Dùng: php bin/migrate.php
 * Quy ước: mỗi câu lệnh kết thúc bằng dấu ; ở cuối dòng; không đặt ; trong chuỗi hay trigger.
 */
require dirname(__DIR__) . '/app/bootstrap.php';

use App\Core\Container;
use App\Core\Database;

function runMigrations(Database $db, string $dir): array
{
    $db->run('CREATE TABLE IF NOT EXISTS migrations (
        name VARCHAR(190) NOT NULL PRIMARY KEY,
        ran_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');

    $done = array_column($db->all('SELECT name FROM migrations'), 'name');
    $files = glob($dir . '/*.sql') ?: [];
    sort($files);
    $ran = [];
    foreach ($files as $file) {
        $name = basename($file);
        if (in_array($name, $done, true)) {
            continue;
        }
        $sql = (string) file_get_contents($file);
        $sql = preg_replace('/^\s*--.*$/m', '', $sql) ?? $sql;
        foreach (preg_split('/;\s*(?:\r?\n|$)/', $sql) ?: [] as $statement) {
            if (trim($statement) !== '') {
                $db->run($statement);
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
    try {
        $ran = runMigrations(Container::get(Database::class), BASE_PATH . '/database/migrations');
        echo $ran ? 'Đã chạy: ' . implode(', ', $ran) . PHP_EOL : 'Không có migration mới.' . PHP_EOL;
    } catch (Throwable $e) {
        fwrite(STDERR, 'Lỗi migration: ' . $e->getMessage() . PHP_EOL);
        exit(1);
    }
}
