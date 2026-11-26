<?php
declare(strict_types=1);

/** Đặt lại mật khẩu admin master (chạy trên server khi quên). Dùng: php bin/reset-master.php --password=MatKhauMoi */
require dirname(__DIR__) . '/app/bootstrap.php';

use App\Core\Container;
use App\Repositories\AdminRepository;
use App\Services\PasswordHasher;

if (PHP_SAPI !== 'cli') {
    exit('Chỉ chạy bằng dòng lệnh.');
}
$opts = getopt('', ['password:']);
$password = (string) ($opts['password'] ?? '');
if (mb_strlen($password) < 8) {
    fwrite(STDERR, 'Dùng: php bin/reset-master.php --password=MatKhauMoi (từ 8 ký tự)' . PHP_EOL);
    exit(1);
}
$hasher = Container::get(PasswordHasher::class);
$salt = $hasher->generateSalt();
$n = Container::get(AdminRepository::class)->updatePasswordByRole('master', $hasher->hash($password, $salt), $salt);
echo $n > 0 ? 'Đã đặt lại mật khẩu master.' . PHP_EOL : 'Chưa có tài khoản master. Hãy chạy php bin/install.php.' . PHP_EOL;
