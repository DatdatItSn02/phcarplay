<?php
declare(strict_types=1);

use App\Core\Env;
use App\Core\Request;
use App\Core\StaticFiles;

test('Request::resolvePath: đường dẫn gốc, thư mục con, /index.php và giải mã %xx', function () {
    assertSame('/', Request::resolvePath('/'));
    assertSame('/', Request::resolvePath(''));
    assertSame('/api/auth/me', Request::resolvePath('/api/auth/me?x=1'));
    assertSame('/api/auth/me', Request::resolvePath('/carweb/api/auth/me', '/carweb'));
    assertSame('/', Request::resolvePath('/carweb', '/carweb'));
    assertSame('/', Request::resolvePath('/carweb/', '/carweb/'));
    assertSame('/reset-password', Request::resolvePath('/carweb/reset-password?token=abc', '/carweb'));
    assertSame('/api/health', Request::resolvePath('/index.php/api/health'));
    assertSame('/', Request::resolvePath('/index.php'));
    assertSame('/a b', Request::resolvePath('/a%20b'));
    // chỉ bỏ thư mục con khi khớp trọn một đoạn đường dẫn
    assertSame('/carwebx/api', Request::resolvePath('/carwebx/api', '/carweb'));
});

test('Request::capture: bỏ tiền tố /api và xử lý đúng khi đường dẫn chỉ là /api (lỗi substr của PHP 7.4)', function () {
    $_SERVER['REQUEST_METHOD'] = 'GET';
    assertSame('/auth/me', Request::capture('/api', '/api/auth/me')->path);
    assertSame('/', Request::capture('/api', '/api')->path);
});

test('Env: giá trị rỗng như DB_PASS= không gây lỗi trên PHP 7.4', function () {
    $f = tempnam(sys_get_temp_dir(), 'env');
    file_put_contents($f, "EMPTY_ONE=\nEMPTY_TWO=\"\"\nLAST=x=y\n");
    Env::load($f);
    unlink($f);
    assertSame('', Env::get('EMPTY_ONE'));
    assertSame('', Env::get('EMPTY_TWO'));
    assertSame('x=y', Env::get('LAST'));
});

test('StaticFiles: cho file hợp lệ, chặn thoát thư mục, chặn đuôi lạ', function () {
    $dir = sys_get_temp_dir() . '/pubtest_' . bin2hex(random_bytes(3));
    mkdir($dir . '/assets/css', 0777, true);
    file_put_contents($dir . '/assets/css/a.css', 'body{}');
    file_put_contents($dir . '/assets/secret.php', '<?php echo 1;');
    file_put_contents($dir . '/outside.css', 'x');

    assertTrue(StaticFiles::locate($dir, '/assets/css/a.css') !== null, 'file css hợp lệ');
    assertSame(null, StaticFiles::locate($dir, '/assets/../outside.css'), 'thoát thư mục');
    assertSame(null, StaticFiles::locate($dir, '/assets/secret.php'), 'đuôi .php');
    assertSame(null, StaticFiles::locate($dir, '/assets/khong-co.css'), 'không tồn tại');
    assertSame(null, StaticFiles::locate($dir, "/assets/css/a.css\0.png"), 'ký tự null');

    ob_start();
    StaticFiles::serve($dir, '/assets/css/a.css');
    assertSame('body{}', ob_get_clean());

    array_map('unlink', [$dir . '/assets/css/a.css', $dir . '/assets/secret.php', $dir . '/outside.css']);
    rmdir($dir . '/assets/css');
    rmdir($dir . '/assets');
    rmdir($dir);
});
