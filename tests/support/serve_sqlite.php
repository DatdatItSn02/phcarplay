<?php
declare(strict_types=1);

/**
 * Máy chủ THỬ NGHIỆM: chạy website thật (public/index.php) nhưng thay MySQL bằng SQLite trong một file,
 * để thử đường đi HTTP thật (cookie, CSRF, phiên) khi máy không có MySQL. KHÔNG dùng cho website thật.
 *
 *   CARWEB_TEST_DB=/tmp/carweb.sqlite CARWEB_TEST_SEED=1 php -S 127.0.0.1:8099 -t public tests/support/serve_sqlite.php
 *
 * Biến môi trường:
 *   CARWEB_TEST_DB            đường dẫn file SQLite (mặc định: thư mục tạm)
 *   CARWEB_TEST_SEED=1        tạo sẵn tài khoản master nếu chưa có
 *   CARWEB_TEST_MASTER_EMAIL  mặc định master@test.local
 *   CARWEB_TEST_MASTER_PASS   mặc định Master-12345
 */
if (PHP_SAPI !== 'cli-server') {   // chỉ dùng với php -S khi kiểm thử, không bao giờ chạy trên website thật
    http_response_code(404);
    exit;
}
define('BASE_PATH', dirname(__DIR__, 2));
require BASE_PATH . '/app/bootstrap.php';
require __DIR__ . '/sqlite_schema.php';

use App\Core\Container;
use App\Core\Database;
use App\Repositories\AdminRepository;
use App\Services\PasswordHasher;

$file = getenv('CARWEB_TEST_DB') ?: sys_get_temp_dir() . '/carweb-test.sqlite';
// Bộ đếm chống dò mật khẩu riêng cho mỗi database thử (mỗi lần chạy kịch bản bắt đầu sạch).
App\Core\Env::set('RATE_LIMIT_DIR', $file . '.ratelimit');
$db = adminSqliteDatabase($file);
if ($db === null) {
    http_response_code(500);
    exit('Cần PHP bật pdo_sqlite.');
}
Container::set(Database::class, $db);

if (getenv('CARWEB_TEST_SEED') === '1') {
    $admins = Container::get(AdminRepository::class);
    if ($admins->countByRole('master') === 0) {
        $hasher = Container::get(PasswordHasher::class);
        $salt = $hasher->generateSalt();
        $admins->create(
            (string) (getenv('CARWEB_TEST_MASTER_EMAIL') ?: 'master@test.local'),
            'Master',
            $hasher->hash((string) (getenv('CARWEB_TEST_MASTER_PASS') ?: 'Master-12345'), $salt),
            $salt,
            'master'
        );
    }
}

require BASE_PATH . '/public/index.php';
