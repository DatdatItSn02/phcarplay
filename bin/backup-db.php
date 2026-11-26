<?php
declare(strict_types=1);

/**
 * Sao lưu toàn bộ database của website ra một file .sql.gz (chỉ ĐỌC database, không sửa gì).
 * Dùng: php bin/backup-db.php --out=/duong/dan/sao-luu.sql.gz
 *
 * Giai đoạn 17: quy trình tự cập nhật (deploy/server.sh) gọi lệnh này trước mỗi lần cập nhật database.
 * Đọc thông tin kết nối từ .env như website. File sao lưu chỉ chứa CREATE TABLE và INSERT (không có DROP
 * hay DELETE): muốn khôi phục thì tạo một database MỚI, trống, nhập file này vào rồi trỏ .env sang database đó
 * (xem docs/DEPLOY.md, mục "Tự động cập nhật lên alwaysdata").
 */
require dirname(__DIR__) . '/app/bootstrap.php';

use App\Core\Container;
use App\Core\Database;

if (PHP_SAPI !== 'cli') {
    exit('Chỉ chạy bằng dòng lệnh.');
}

/**
 * Ghi bản sao lưu qua $write(string) (tách ra để kiểm thử). Trả về ['tables' => số bảng, 'rows' => số dòng].
 */
function backupDatabase(PDO $pdo, callable $write, string $dbName): array
{
    $write("-- PH Car Play: sao lưu database " . $dbName . ' lúc ' . date('Y-m-d H:i:s P') . "\n");
    $write("-- Khôi phục: nhập file này vào một database MỚI, trống (file không xóa hay ghi đè bảng nào).\n");
    $write("SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\nSET time_zone = '" . date('P') . "';\n\n");
    $tables = 0;
    $rows = 0;
    $list = $pdo->query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")->fetchAll(PDO::FETCH_NUM);
    foreach ($list as $t) {
        $name = (string) $t[0];
        $q = '`' . str_replace('`', '``', $name) . '`';
        $create = $pdo->query('SHOW CREATE TABLE ' . $q)->fetch(PDO::FETCH_NUM);
        $write('-- Bảng ' . $name . "\n" . $create[1] . ";\n");
        $tables++;
        $stmt = $pdo->query('SELECT * FROM ' . $q);
        $batch = [];
        $size = 0;
        $cols = null;
        while (($row = $stmt->fetch(PDO::FETCH_ASSOC)) !== false) {
            if ($cols === null) {
                $cols = '(' . implode(', ', array_map(static function ($c) {
                    return '`' . str_replace('`', '``', (string) $c) . '`';
                }, array_keys($row))) . ')';
            }
            $vals = [];
            foreach ($row as $v) {
                $vals[] = $v === null ? 'NULL' : $pdo->quote((string) $v);
            }
            $line = '(' . implode(', ', $vals) . ')';
            $batch[] = $line;
            $size += strlen($line);
            $rows++;
            if (count($batch) >= 200 || $size > 400000) {
                $write('INSERT INTO ' . $q . ' ' . $cols . " VALUES\n" . implode(",\n", $batch) . ";\n");
                $batch = [];
                $size = 0;
            }
        }
        if ($batch) {
            $write('INSERT INTO ' . $q . ' ' . $cols . " VALUES\n" . implode(",\n", $batch) . ";\n");
        }
        $write("\n");
    }
    $write("SET FOREIGN_KEY_CHECKS = 1;\n");
    return ['tables' => $tables, 'rows' => $rows];
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    $out = '';
    foreach (array_slice($_SERVER['argv'] ?? [], 1) as $arg) {
        if (strpos($arg, '--out=') === 0) {
            $out = substr($arg, 6);
        }
    }
    if ($out === '' || substr($out, -7) !== '.sql.gz') {
        fwrite(STDERR, 'Dùng: php bin/backup-db.php --out=/duong/dan/ten-file.sql.gz' . PHP_EOL);
        exit(2);
    }
    $tmp = $out . '.tmp';
    $old = umask(077);
    try {
        $gz = gzopen($tmp, 'wb6');
        if ($gz === false) {
            throw new RuntimeException('Không tạo được file ' . $tmp);
        }
        $db = Container::get(Database::class);
        $name = (string) $db->value('SELECT DATABASE()');
        $stats = backupDatabase($db->pdo(), static function (string $s) use ($gz, $tmp): void {
            if (gzwrite($gz, $s) === false) {
                throw new RuntimeException('Không ghi được file ' . $tmp . ' (hết dung lượng?)');
            }
        }, $name);
        gzclose($gz);
        if (!rename($tmp, $out)) {
            throw new RuntimeException('Không đổi tên được file sao lưu thành ' . $out);
        }
        chmod($out, 0600);
        echo 'Đã sao lưu database: ' . $stats['tables'] . ' bảng, ' . $stats['rows'] . ' dòng, '
            . round(filesize($out) / 1024) . ' KB -> ' . $out . PHP_EOL;
    } catch (Throwable $e) {
        if (isset($gz) && is_resource($gz)) {
            gzclose($gz);
        }
        @unlink($tmp);
        fwrite(STDERR, 'Lỗi sao lưu database: ' . $e->getMessage() . PHP_EOL);
        exit(1);
    } finally {
        umask($old);
    }
}
