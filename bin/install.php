<?php
declare(strict_types=1);

/**
 * Cài đặt lần đầu: chạy migration và tạo tài khoản admin master.
 * Dùng: php bin/install.php
 *   hoặc: php bin/install.php --email=admin@site.com --password=MatKhau123 --name="Quản trị"
 * Không có mật khẩu mặc định nào nằm trong code.
 */
require dirname(__DIR__) . '/app/bootstrap.php';
require __DIR__ . '/migrate.php';

use App\Core\Container;
use App\Core\Database;
use App\Core\Validator;
use App\Repositories\AdminRepository;
use App\Services\PasswordHasher;

if (PHP_SAPI !== 'cli') {
    exit('Chỉ chạy bằng dòng lệnh.');
}

function ask(string $label): string
{
    echo $label;
    return trim((string) fgets(STDIN));
}

try {
    $db = Container::get(Database::class);
    $ran = runMigrations($db, BASE_PATH . '/database/migrations');
    echo $ran ? 'Đã chạy migration: ' . implode(', ', $ran) . PHP_EOL : 'Database đã ở phiên bản mới nhất.' . PHP_EOL;

    $admins = Container::get(AdminRepository::class);
    if ($admins->countByRole('master') > 0) {
        echo 'Đã có tài khoản master, bỏ qua bước tạo. (Quên mật khẩu master: php bin/reset-master.php)' . PHP_EOL;
        exit(0);
    }

    $opts = getopt('', ['email:', 'password:', 'name::']);
    $email = Validator::email($opts['email'] ?? ask('Email admin master: '));
    if ($email === null) {
        fwrite(STDERR, 'Email không hợp lệ.' . PHP_EOL);
        exit(1);
    }
    $password = (string) ($opts['password'] ?? ask('Mật khẩu (từ 8 ký tự): '));
    if (mb_strlen($password) < 8) {
        fwrite(STDERR, 'Mật khẩu master cần từ 8 ký tự.' . PHP_EOL);
        exit(1);
    }
    $name = Validator::text($opts['name'] ?? 'Master', 100);

    $hasher = Container::get(PasswordHasher::class);
    $salt = $hasher->generateSalt();
    $admins->create($email, $name, $hasher->hash($password, $salt), $salt, 'master');
    echo "Đã tạo admin master: {$email}" . PHP_EOL;
} catch (Throwable $e) {
    fwrite(STDERR, 'Lỗi cài đặt: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
