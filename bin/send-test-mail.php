<?php
declare(strict_types=1);

/** Thử gửi mail bằng cấu hình trong .env. Dùng: php bin/send-test-mail.php ten@email.com */
require dirname(__DIR__) . '/app/bootstrap.php';

if (PHP_SAPI !== 'cli') {
    exit('Chỉ chạy bằng dòng lệnh.');
}

use App\Core\Config;
use App\Core\Container;
use App\Services\Mailer;

$to = $argv[1] ?? '';
if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
    fwrite(STDERR, 'Dùng: php bin/send-test-mail.php ten@email.com' . PHP_EOL);
    exit(1);
}
echo 'Driver: ' . Config::get('mail.driver') . PHP_EOL;
try {
    Container::get(Mailer::class)->send($to, 'Thư thử từ PH Car Play', '<p>Nếu bạn đọc được thư này, cấu hình gửi mail đã đúng.</p>');
    echo Config::get('mail.driver') === 'log'
        ? 'Đã ghi thư vào storage/mail/ (driver log không gửi thật).' . PHP_EOL
        : 'Đã gửi. Hãy kiểm tra hộp thư (cả thư rác).' . PHP_EOL;
} catch (Throwable $e) {
    fwrite(STDERR, 'Gửi thất bại: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
