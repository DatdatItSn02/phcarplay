<?php
declare(strict_types=1);

/**
 * Chạy kiểm thử:
 *   php tests/run.php                 chỉ kiểm thử đơn vị (không cần database)
 *   php tests/run.php --integration   thêm kiểm thử luồng đăng ký/đăng nhập/quên mật khẩu (cần MySQL thật,
 *                                     dùng database trong .env, nên trỏ DB_NAME tới database thử riêng)
 */
if (PHP_SAPI !== 'cli') {
    exit('Chỉ chạy bằng dòng lệnh.');
}
require __DIR__ . '/bootstrap.php';

foreach (glob(__DIR__ . '/unit/*Test.php') ?: [] as $file) {
    echo basename($file) . "\n";
    require $file;
}
if (in_array('--integration', $argv, true)) {
    foreach (glob(__DIR__ . '/integration/*Test.php') ?: [] as $file) {
        echo basename($file) . "\n";
        require $file;
    }
}
exit(runAll());
