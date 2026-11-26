<?php
declare(strict_types=1);

/**
 * Giai đoạn 7 (rà soát bảo mật): chống dò mật khẩu và gọi dồn dập, tiêu đề bảo mật, IP sau proxy,
 * chặn truy cập trái phép khi đặt nhầm thư mục web, và các sửa đổi nhỏ khác.
 * Phần chạy qua Router dùng SQLite trong bộ nhớ (cần pdo_sqlite), giống AdminTest/ManageTest.
 */

use App\Core\Config;
use App\Core\Container;
use App\Core\Database;
use App\Core\ErrorHandler;
use App\Core\HttpException;
use App\Core\Request;
use App\Core\Router;
use App\Core\SecurityHeaders;
use App\Core\Session;
use App\Middleware\Csrf;
use App\Repositories\AdminRepository;
use App\Repositories\AuditLogRepository;
use App\Services\AuthService;
use App\Services\LoginThrottle;
use App\Services\PasswordHasher;
use App\Services\PlaylistService;
use App\Services\RateLimiter;

require_once dirname(__DIR__) . '/support/sqlite_schema.php';

/** Thư mục tạm mới cho mỗi kiểm thử. */
function secTempDir(string $name): string
{
    $dir = sys_get_temp_dir() . '/carweb-sec-' . $name . '-' . bin2hex(random_bytes(4));
    @mkdir($dir, 0777, true);
    return $dir;
}

test('RateLimiter: đếm trong cửa sổ, chặn khi đủ số lần, hết cửa sổ thì mở lại, xóa được', function () {
    $now = 1000;
    $rl = new RateLimiter(secTempDir('rl'), function () use (&$now) { return $now; }, true);
    assertSame(0, $rl->blockedFor('k', 3, 60), 'chưa có lần nào');
    assertSame(1, $rl->hit('k', 60));
    assertSame(2, $rl->hit('k', 60));
    assertSame(0, $rl->blockedFor('k', 3, 60), 'chưa đủ 3 lần');
    assertSame(3, $rl->hit('k', 60));
    assertSame(60, $rl->blockedFor('k', 3, 60), 'đủ 3 lần: chờ hết cửa sổ');
    $now = 1045;
    assertSame(15, $rl->blockedFor('k', 3, 60));
    $now = 1060;
    assertSame(0, $rl->blockedFor('k', 3, 60), 'hết cửa sổ thì mở lại');
    assertSame(1, $rl->hit('k', 60), 'cửa sổ mới đếm lại từ 1');
    $rl->hit('k', 60);
    $rl->hit('k', 60);
    $rl->clear('k');
    assertSame(0, $rl->blockedFor('k', 3, 60), 'xóa thì mở ngay');
    assertSame(0, $rl->blockedFor('khac', 1, 60), 'khóa khác không bị ảnh hưởng');
});

test('RateLimiter: consume/enforce tính mọi lượt; guard ném 429 có retry_after và lời nhắn theo phút', function () {
    $now = 5000;
    $rl = new RateLimiter(secTempDir('rl2'), function () use (&$now) { return $now; }, true);
    assertSame(0, $rl->consume('x', 2, 600));
    assertSame(0, $rl->consume('x', 2, 600));
    assertSame(600, $rl->consume('x', 2, 600), 'lượt thứ 3 vượt giới hạn 2');
    assertThrows(function () use ($rl) { $rl->enforce('x', 2, 600, 'Gọi quá nhanh.'); }, 'TOO_MANY_ATTEMPTS');
    try {
        $rl->guard([['x', 2, 600]], 'Gọi quá nhanh.');
        throw new RuntimeException('đáng lẽ phải bị chặn');
    } catch (HttpException $e) {
        assertSame(429, $e->status);
        assertSame(600, $e->details['retry_after']);
        assertSame('Gọi quá nhanh. Vui lòng thử lại sau 10 phút.', $e->getMessage());
    }
    $rl->guard([['chua-dung', 2, 600]]);   // không ném
    assertSame(0, $rl->consume('y', 0, 600), 'giới hạn 0 nghĩa là không giới hạn');
});

test('RateLimiter: tắt bằng cấu hình thì không đếm; thư mục không ghi được hay file hỏng thì cho qua, không làm hỏng website', function () {
    $off = new RateLimiter(secTempDir('rl3'), null, false);
    for ($i = 0; $i < 5; $i++) {
        assertSame(0, $off->consume('a', 1, 60));
    }
    $file = tempnam(sys_get_temp_dir(), 'carweb');   // một FILE đứng chỗ thư mục: không tạo được thư mục
    $broken = new RateLimiter($file . '/khong-tao-duoc', null, true);
    assertSame(0, $broken->hit('a', 60));
    assertSame(0, $broken->consume('a', 1, 60));
    @unlink($file);
    $dir = secTempDir('rl4');
    $rl = new RateLimiter($dir, null, true);
    file_put_contents($dir . '/' . sha1('h') . '.json', '{hỏng');
    assertSame(0, $rl->blockedFor('h', 1, 60));
    assertSame(1, $rl->hit('h', 60), 'file hỏng thì đếm lại từ đầu');
});

test('LoginThrottle: mặc định TẮT (quyết định dự án: không giới hạn số lần đăng nhập sai)', function () {
    $saved = Config::get('app', []);
    Config::override('app', []);
    $t = new LoginThrottle(new RateLimiter(secTempDir('lt0'), null, true));
    assertSame(false, $t->enabled());
    for ($i = 1; $i <= 25; $i++) {
        $t->failed('user', 'a@b.vn', '1.1.1.1');
    }
    $t->check('user', 'a@b.vn', '1.1.1.1');   // không ném dù sai 25 lần
    Config::override('app', ['security' => ['login_throttle' => true]]);
    assertSame(true, (new LoginThrottle(new RateLimiter(secTempDir('lt1'), null, true)))->enabled(), 'LOGIN_THROTTLE=true thì bật');
    Config::override('app', $saved);
});

test('LoginThrottle (khi bật): người dùng sai 10 lần trên một máy thì tạm chặn máy đó, máy khác vẫn đăng nhập được; đúng mật khẩu thì xóa bộ đếm', function () {
    $t = new LoginThrottle(new RateLimiter(secTempDir('lt'), null, true), true);
    for ($i = 1; $i <= 9; $i++) {
        assertSame(['log' => true, 'reached' => false], $t->failed('user', 'a@b.vn', '1.1.1.1'));
    }
    $t->check('user', 'a@b.vn', '1.1.1.1');   // 9 lần: chưa chặn
    assertSame(['log' => true, 'reached' => true], $t->failed('user', 'a@b.vn', '1.1.1.1'), 'lần thứ 10 vừa chạm ngưỡng');
    assertSame(['log' => false, 'reached' => false], $t->failed('user', 'a@b.vn', '1.1.1.1'), 'quá ngưỡng thì thôi ghi nhật ký từng lần');
    assertThrows(function () use ($t) { $t->check('user', 'a@b.vn', '1.1.1.1'); }, 'TOO_MANY_ATTEMPTS');
    $t->check('user', 'a@b.vn', '2.2.2.2');   // máy khác chưa bị chặn (giới hạn theo email là 30)
    $t->check('user', 'A@B.VN', '3.3.3.3');
    $t->succeeded('user', 'a@b.vn', '1.1.1.1');
    $t->check('user', 'a@b.vn', '1.1.1.1');   // đăng nhập đúng (ở máy khác rồi quay lại) thì máy đó được thử lại
    $a = new LoginThrottle(new RateLimiter(secTempDir('lt2'), null, true), true);
    for ($i = 1; $i <= 5; $i++) {
        $a->failed('admin', 'm@b.vn', '1.1.1.1');
    }
    assertThrows(function () use ($a) { $a->check('admin', 'm@b.vn', '1.1.1.1'); }, 'TOO_MANY_ATTEMPTS', 'quản trị: 5 lần đã chặn');
    $a->check('user', 'm@b.vn', '1.1.1.1');   // bộ đếm quản trị và người dùng tách riêng
});

test('Request::clientIp: mặc định dùng REMOTE_ADDR; chỉ đọc header khi được cấu hình và giá trị là IP hợp lệ', function () {
    $h = ['cf-connecting-ip' => '203.0.113.9', 'x-forwarded-for' => '198.51.100.7, 10.0.0.1'];
    assertSame('10.0.0.2', Request::clientIp('10.0.0.2', $h, ''), 'không cấu hình: bỏ qua mọi header (không giả mạo được)');
    assertSame('203.0.113.9', Request::clientIp('10.0.0.2', $h, 'CF-Connecting-IP'));
    assertSame('198.51.100.7', Request::clientIp('10.0.0.2', $h, 'X-Forwarded-For'), 'lấy địa chỉ đầu tiên');
    assertSame('10.0.0.2', Request::clientIp('10.0.0.2', ['x-real-ip' => 'khong-phai-ip'], 'X-Real-IP'));
    assertSame('10.0.0.2', Request::clientIp('10.0.0.2', [], 'X-Real-IP'), 'thiếu header thì dùng REMOTE_ADDR');
    assertSame('2001:db8::1', Request::clientIp('10.0.0.2', ['x-real-ip' => '2001:db8::1'], 'x-real-ip'));
});

test('Tiêu đề bảo mật trang: CSP chỉ cho script của website, đúng mã băm đoạn khởi tạo, hls.js từ đúng nguồn; quản trị không cho nhúng khung', function () {
    $saved = Config::get('app', []);
    Config::override('app', ['security' => ['csp' => true, 'hsts_max_age' => 100]]);
    $script = "(function(){document.documentElement.setAttribute('data-theme','dark');})();\n";
    $hash = base64_encode(hash('sha256', $script, true));
    $user = SecurityHeaders::page(false, $script, SecurityHeaders::DEFAULT_HLS, false);
    $csp = $user['Content-Security-Policy'];
    assertTrue(contains($csp, "script-src 'self' 'sha256-" . $hash . "' https://cdnjs.cloudflare.com;"), $csp);
    assertTrue(contains($csp, "object-src 'none'") && contains($csp, "base-uri 'self'") && contains($csp, "frame-ancestors 'self'"), $csp);
    assertTrue(contains($csp, "worker-src 'self' blob:") && contains($csp, 'media-src * data: blob:'), 'hls.js cần worker blob: và media blob:');
    assertTrue(!contains($csp, "'unsafe-eval'") && !contains($csp, "script-src 'self' 'unsafe-inline'"), 'không cho chạy script nội tuyến tùy ý');
    assertSame('SAMEORIGIN', $user['X-Frame-Options']);
    assertSame('nosniff', $user['X-Content-Type-Options']);
    assertSame('strict-origin-when-cross-origin', $user['Referrer-Policy']);
    assertTrue(!isset($user['Strict-Transport-Security']), 'HTTP thường thì không gửi HSTS');
    $admin = SecurityHeaders::page(true, $script, '', true);
    assertTrue(contains($admin['Content-Security-Policy'], "frame-ancestors 'none'"));
    assertTrue(!contains($admin['Content-Security-Policy'], 'cdnjs'), 'trang quản trị không cần hls.js');
    assertSame('DENY', $admin['X-Frame-Options']);
    assertSame('max-age=100', $admin['Strict-Transport-Security'], 'HTTPS thì có HSTS');
    $local = SecurityHeaders::csp(false, $script, '/carweb/assets/vendor/hls.min.js');
    assertTrue(contains($local, "script-src 'self' 'sha256-" . $hash . "';"), 'hls.js trong website: không mở thêm nguồn ngoài');
    Config::override('app', ['security' => ['csp' => false, 'hsts_max_age' => 0]]);
    $off = SecurityHeaders::page(false, $script, '', true);
    assertTrue(!isset($off['Content-Security-Policy']) && !isset($off['Strict-Transport-Security']), 'CSP_ENABLED=false, HSTS_MAX_AGE=0');
    assertSame('SAMEORIGIN', $off['X-Frame-Options'], 'các tiêu đề khác vẫn giữ');
    $api = SecurityHeaders::api(false);
    assertSame("default-src 'none'; frame-ancestors 'none'", $api['Content-Security-Policy']);
    Config::override('app', $saved);
});

test('Nguồn hls.js: ưu tiên file trong assets/vendor, chỉ nhận https:// hoặc đường dẫn nội bộ, mã SRI phải đúng dạng', function () {
    $saved = Config::get('app', []);
    $pub = secTempDir('pub');
    Config::override('app', ['hls_js' => ['url' => '', 'integrity' => '']]);
    assertSame(['src' => SecurityHeaders::DEFAULT_HLS, 'integrity' => ''], SecurityHeaders::hlsSource($pub, ''));
    Config::override('app', ['hls_js' => ['url' => 'javascript:alert(1)', 'integrity' => 'khong-hop-le']]);
    assertSame(['src' => SecurityHeaders::DEFAULT_HLS, 'integrity' => ''], SecurityHeaders::hlsSource($pub, ''), 'địa chỉ lạ bị bỏ');
    Config::override('app', ['hls_js' => ['url' => 'http://cdn.example.com/hls.js', 'integrity' => '']]);
    assertSame(SecurityHeaders::DEFAULT_HLS, SecurityHeaders::hlsSource($pub, '')['src'], 'không nhận http:// (có thể bị tráo trên đường truyền)');
    Config::override('app', ['hls_js' => ['url' => 'https://cdn.example.com/hls@1.5.17/hls.min.js', 'integrity' => 'sha384-AbC+/1=']]);
    assertSame(['src' => 'https://cdn.example.com/hls@1.5.17/hls.min.js', 'integrity' => 'sha384-AbC+/1='], SecurityHeaders::hlsSource($pub, ''));
    assertSame('https://cdn.example.com', SecurityHeaders::origin('https://cdn.example.com/hls@1.5.17/hls.min.js'));
    assertSame('https://cdn.example.com:8443', SecurityHeaders::origin('https://CDN.example.com:8443/x.js'));
    assertSame(null, SecurityHeaders::origin('/assets/vendor/hls.min.js'));
    @mkdir($pub . '/assets/vendor', 0777, true);
    file_put_contents($pub . '/assets/vendor/hls.min.js', '/* hls */');
    assertSame(['src' => '/carweb/assets/vendor/hls.min.js', 'integrity' => ''], SecurityHeaders::hlsSource($pub, '/carweb'), 'có file tải về thì dùng file đó');
    Config::override('app', $saved);
});

test('Lỗi 429 trả header Retry-After; lỗi khác không có', function () {
    $r = ErrorHandler::toResponse(RateLimiter::tooMany(125, 'Thử nhiều quá.'));
    assertSame(429, $r->status);
    assertSame('125', $r->headers['Retry-After']);
    assertSame('TOO_MANY_ATTEMPTS', $r->payload['error']['code']);
    assertSame('Thử nhiều quá. Vui lòng thử lại sau 3 phút.', $r->payload['error']['message']);
    assertTrue(!isset(ErrorHandler::toResponse(HttpException::notFound())->headers['Retry-After']));
});

test('Phiên: lưu trong storage/sessions riêng cho người dùng và quản trị', function () {
    $user = Session::saveDir('user');
    $admin = Session::saveDir('admin');
    assertSame(BASE_PATH . '/storage/sessions/user', $user);
    assertSame(BASE_PATH . '/storage/sessions/admin', $admin);
    assertTrue(is_dir((string) $user) && is_writable((string) $user));
    $src = (string) file_get_contents(BASE_PATH . '/app/Core/Session.php');
    assertTrue(contains($src, "ini_set('session.use_strict_mode', '1')"), 'phải bật use_strict_mode trước session_start');
});

test('Đặt nhầm thư mục web: có .htaccess chặn mọi thư mục nội bộ; lệnh trong bin/ và máy chủ thử không chạy qua web; .env.example an toàn', function () {
    $root = (string) file_get_contents(BASE_PATH . '/.htaccess');
    assertTrue(contains($root, 'RewriteRule ^(.*)$ public/$1 [L]'), '.htaccess gốc phải chuyển mọi yêu cầu vào public/');
    assertTrue(contains($root, '<FilesMatch "^\.">'), '.htaccess gốc phải chặn file ẩn như .env');
    foreach (['app', 'bin', 'config', 'database', 'routes', 'storage', 'tests', 'docs'] as $dir) {
        $file = BASE_PATH . '/' . $dir . '/.htaccess';
        assertTrue(is_file($file) && contains((string) file_get_contents($file), 'Require all denied'), 'thiếu chặn truy cập trong ' . $dir . '/');
    }
    foreach (['bin/install.php', 'bin/migrate.php', 'bin/reset-master.php', 'bin/send-test-mail.php', 'tests/run.php'] as $file) {
        assertTrue(contains((string) file_get_contents(BASE_PATH . '/' . $file), "PHP_SAPI !== 'cli'"), $file . ' phải từ chối chạy qua web');
    }
    assertTrue(contains((string) file_get_contents(BASE_PATH . '/tests/support/serve_sqlite.php'), "PHP_SAPI !== 'cli-server'"));
    assertTrue(is_file(BASE_PATH . '/.env.example'), 'thiếu file .env.example (mẫu cấu hình đi kèm mã nguồn): lấy lại từ file zip; khi tạo .env hãy SAO CHÉP .env.example, đừng đổi tên nó');
    $env = (string) file_get_contents(BASE_PATH . '/.env.example');
    assertTrue(preg_match('/^APP_DEBUG=false$/m', $env) === 1, '.env.example phải để APP_DEBUG=false');
    assertTrue(preg_match('/^RATE_LIMIT=true$/m', $env) === 1 && preg_match('/^CSP_ENABLED=true$/m', $env) === 1);
    assertTrue(preg_match('/^LOGIN_THROTTLE=false$/m', $env) === 1, 'chặn đăng nhập sai mặc định tắt (quyết định dự án)');
});

test('Gọi Piped/Invidious bằng curl chỉ cho http/https kể cả khi bị chuyển hướng', function () {
    $src = (string) file_get_contents(BASE_PATH . '/app/Services/UpstreamClient.php');
    assertTrue(contains($src, 'CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS') && contains($src, 'CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS'));
});

if (adminSqliteDatabase() === null) {
    test('Bảo mật qua Router (SQLite): BỎ QUA - PHP này chưa bật pdo_sqlite', function () {
    });
} else {
    /** Gọi API thật (routes/api.php hoặc routes/admin.php) với phiên giả lập; $ip là IP của "máy" gọi. */
    function secCall(stdClass $S, string $area, string $sess, string $method, string $path, array $body = [], string $ip = '9.9.9.9')
    {
        $_SESSION = $S->sessions[$sess] ?? ['csrf' => bin2hex(random_bytes(8))];
        $router = new Router();
        $router->setGlobalMiddleware([Csrf::class]);
        (require BASE_PATH . '/routes/' . ($area === 'admin' ? 'admin.php' : 'api.php'))($router);
        try {
            $res = @$router->dispatch(new Request($method, $path, [], $body, ['x-csrf-token' => (string) $_SESSION['csrf']], $ip));
        } catch (Throwable $e) {
            $res = ErrorHandler::toResponse($e);
        }
        $S->sessions[$sess] = $_SESSION;
        return $res;
    }

    function secBoot(): stdClass
    {
        $S = new stdClass();
        $S->sessions = [];
        $S->savedApp = Config::get('app', []);
        $S->savedMail = Config::get('mail', []);
        Container::reset();
        Config::override('app', ['url' => 'http://test.local', 'name' => 'PH Car Play', 'auth' => ['reset_ttl_minutes' => 60, 'single_device' => true],
            'playlists' => ['max_per_user' => 50, 'max_items' => 500]]);
        Config::override('mail', ['driver' => 'log', 'from_email' => 'no-reply@test.local', 'from_name' => 'Test']);
        Container::set(Database::class, adminSqliteDatabase());
        Container::set(RateLimiter::class, new RateLimiter(secTempDir('router'), null, true));
        return $S;
    }

    function secRestore(stdClass $S): void
    {
        Config::override('app', $S->savedApp);
        Config::override('mail', $S->savedMail);
        Container::reset();
        foreach (glob(BASE_PATH . '/storage/mail/*') ?: [] as $f) {
            if (basename($f) !== '.gitkeep' && filemtime($f) >= time() - 120 && contains((string) @file_get_contents($f), 'sec-')) {
                @unlink($f);
            }
        }
    }

    test('Đăng nhập người dùng: mặc định không giới hạn số lần sai (đúng quyết định dự án); bật LOGIN_THROTTLE thì sai 10 lần bị tạm chặn, báo 429 kèm số phút, máy khác vẫn vào được', function () {
        $S = secBoot();
        try {
            Container::get(AuthService::class)->register('sec-u1@test.local', 'Thử', 'matkhau-dung');
            for ($i = 1; $i <= 15; $i++) {
                $r = secCall($S, 'user', 'A', 'POST', '/auth/login', ['email' => 'sec-u1@test.local', 'password' => 'sai-' . $i], '5.5.5.5');
                assertSame('INVALID_CREDENTIALS', $r->payload['error']['code'], 'lần ' . $i);
            }
            $r = secCall($S, 'user', 'A', 'POST', '/auth/login', ['email' => 'sec-u1@test.local', 'password' => 'matkhau-dung'], '5.5.5.5');
            assertSame(200, $r->status, 'mặc định: sai 15 lần vẫn đăng nhập được khi gõ đúng');

            Config::override('app', array_merge(Config::get('app', []), ['security' => ['login_throttle' => true]]));
            for ($i = 1; $i <= 10; $i++) {
                $r = secCall($S, 'user', 'C', 'POST', '/auth/login', ['email' => 'sec-u1@test.local', 'password' => 'sai-' . $i], '5.5.5.6');
                assertSame('INVALID_CREDENTIALS', $r->payload['error']['code'], 'bật: lần ' . $i);
            }
            $r = secCall($S, 'user', 'C', 'POST', '/auth/login', ['email' => 'sec-u1@test.local', 'password' => 'matkhau-dung'], '5.5.5.6');
            assertSame(429, $r->status);
            assertSame('TOO_MANY_ATTEMPTS', $r->payload['error']['code']);
            assertTrue(contains($r->payload['error']['message'], 'Vui lòng thử lại sau 15 phút'), $r->payload['error']['message']);
            assertTrue((int) $r->headers['Retry-After'] > 0);
            $ok = secCall($S, 'user', 'B', 'POST', '/auth/login', ['email' => 'sec-u1@test.local', 'password' => 'matkhau-dung'], '6.6.6.6');
            assertSame(200, $ok->status, 'máy khác (IP khác) vẫn đăng nhập được');
        } finally {
            secRestore($S);
        }
    });

    test('Đăng nhập quản trị: mặc định không chặn nhưng ghi nhật ký có giới hạn (5 lần sai đầu + 1 dòng "sai nhiều lần"); bật LOGIN_THROTTLE thì sai 5 lần bị tạm chặn; nhật ký không chứa mật khẩu đã gõ', function () {
        $S = secBoot();
        try {
            $hasher = Container::get(PasswordHasher::class);
            $salt = $hasher->generateSalt();
            Container::get(AdminRepository::class)->create('sec-m@test.local', 'Master', $hasher->hash('Dung-12345', $salt), $salt, 'master');
            for ($i = 1; $i <= 8; $i++) {
                $r = secCall($S, 'admin', 'X', 'POST', '/auth/login', ['email' => 'sec-m@test.local', 'password' => 'DoMatKhau-' . $i], '7.7.7.7');
                assertSame('INVALID_CREDENTIALS', $r->payload['error']['code']);
            }
            $r = secCall($S, 'admin', 'X', 'POST', '/auth/login', ['email' => 'sec-m@test.local', 'password' => 'Dung-12345'], '7.7.7.7');
            assertSame(200, $r->status, 'mặc định: không chặn');
            $rows = Container::get(AuditLogRepository::class)->recent(100);
            $actions = array_count_values(array_column($rows, 'action'));
            assertSame(5, $actions['admin.login_failed'] ?? 0, 'chỉ ghi 5 lần sai đầu của máy này');
            assertSame(1, $actions['admin.login_failed_many'] ?? 0);
            assertSame(0, $actions['admin.login_locked'] ?? 0);

            Config::override('app', array_merge(Config::get('app', []), ['security' => ['login_throttle' => true]]));
            for ($i = 1; $i <= 5; $i++) {
                secCall($S, 'admin', 'W', 'POST', '/auth/login', ['email' => 'sec-m@test.local', 'password' => 'DoMatKhau-b' . $i], '9.8.7.6');
            }
            $r = secCall($S, 'admin', 'W', 'POST', '/auth/login', ['email' => 'sec-m@test.local', 'password' => 'Dung-12345'], '9.8.7.6');
            assertSame('TOO_MANY_ATTEMPTS', $r->payload['error']['code'], 'bật: sai 5 lần thì tạm chặn');
            $rows = Container::get(AuditLogRepository::class)->recent(100);
            $actions = array_count_values(array_column($rows, 'action'));
            assertSame(1, $actions['admin.login_locked'] ?? 0);
            $blob = (string) json_encode($rows, JSON_UNESCAPED_UNICODE);
            assertTrue(!contains($blob, 'DoMatKhau'), 'nhật ký không được chứa mật khẩu đã gõ');
            assertTrue(contains($blob, 'sec-m@test.local') && contains($blob, '7.7.7.7') && contains($blob, '9.8.7.6'));
            $ok = secCall($S, 'admin', 'Y', 'POST', '/auth/login', ['email' => 'sec-m@test.local', 'password' => 'Dung-12345'], '8.8.8.8');
            assertSame(200, $ok->status, 'master đăng nhập được từ máy khác');
        } finally {
            secRestore($S);
        }
    });

    test('Quên mật khẩu: một email chỉ yêu cầu được 5 lần mỗi giờ (chống gửi thư dồn dập), email chưa đăng ký cũng tính như nhau', function () {
        $S = secBoot();
        try {
            for ($i = 1; $i <= 5; $i++) {
                assertSame(200, secCall($S, 'user', 'A', 'POST', '/auth/forgot', ['email' => 'sec-khongco@test.local'])->status);
            }
            $r = secCall($S, 'user', 'A', 'POST', '/auth/forgot', ['email' => 'sec-khongco@test.local']);
            assertSame('TOO_MANY_ATTEMPTS', $r->payload['error']['code']);
            assertSame(200, secCall($S, 'user', 'A', 'POST', '/auth/forgot', ['email' => 'sec-khac@test.local'])->status, 'email khác vẫn được');
            $a = secCall($S, 'admin', 'Z', 'POST', '/auth/forgot', ['email' => 'sec-khongco@test.local']);
            assertSame(200, $a->status, 'bộ đếm quên mật khẩu quản trị tách riêng');
        } finally {
            secRestore($S);
        }
    });

    test('Nhập key: sai 10 lần trong 15 phút thì tạm chặn', function () {
        $S = secBoot();
        try {
            $r = secCall($S, 'user', 'U', 'POST', '/auth/register', ['email' => 'sec-key@test.local', 'name' => 'K', 'phone' => '0912000365', 'password' => 'matkhau1']);
            assertSame(201, $r->status);
            for ($i = 1; $i <= 10; $i++) {
                $bad = secCall($S, 'user', 'U', 'POST', '/user/license/redeem', ['code' => 'ZZZZ-ZZZZ-ZZZZ-ZZZ' . ($i % 10)]);
                assertSame('KEY_NOT_FOUND', $bad->payload['error']['code'], 'lần ' . $i);
            }
            $r = secCall($S, 'user', 'U', 'POST', '/user/license/redeem', ['code' => 'ZZZZ-ZZZZ-ZZZZ-ZZZZ']);
            assertSame('TOO_MANY_ATTEMPTS', $r->payload['error']['code']);
        } finally {
            secRestore($S);
        }
    });

    test('Kiểm tra sức khỏe /api/health không lộ phiên bản PHP', function () {
        $S = secBoot();
        try {
            $r = secCall($S, 'user', 'A', 'GET', '/health');
            assertSame(['status' => 'ok', 'database' => true], $r->payload['data']);
        } finally {
            secRestore($S);
        }
    });

    test('Chuyển playlist của khách lên tài khoản: giữ đủ bài (trước đây chỉ giữ 50 bài đầu)', function () {
        $S = secBoot();
        try {
            $u = Container::get(AuthService::class)->register('sec-pl@test.local', 'P', 'matkhau1');
            $items = [];
            for ($i = 0; $i < 120; $i++) {
                $items[] = ['id' => sprintf('v%010d', $i), 'title' => 'Bài ' . $i, 'uploader' => 'K', 'duration' => 100, 'thumbnail' => ''];
            }
            $svc = Container::get(PlaylistService::class);
            assertSame(['created' => 1], $svc->import((int) $u['id'], [['name' => 'Dài', 'items' => $items]]));
            $list = $svc->listFor((int) $u['id']);
            assertSame(120, $list[0]['count']);
            $full = $svc->get((int) $u['id'], $list[0]['id']);
            assertSame('Bài 0', $full['items'][0]['title']);
            assertSame('Bài 119', $full['items'][119]['title'], 'giữ đúng thứ tự');
        } finally {
            secRestore($S);
        }
    });
}

test('Dữ liệu: mã website không có lệnh xóa dòng nào khỏi database (DELETE, TRUNCATE, REPLACE INTO) - xóa chỉ là đánh dấu', function () {
    $bad = [];
    foreach (['app', 'bin', 'config', 'routes', 'database', 'public'] as $dir) {
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(BASE_PATH . '/' . $dir, FilesystemIterator::SKIP_DOTS));
        foreach ($it as $file) {
            if (!in_array($file->getExtension(), ['php', 'sql'], true)) {
                continue;
            }
            $src = (string) file_get_contents($file->getPathname());
            $src = (string) preg_replace('#^\s*(--|//|\*|/\*\*?).*$#m', '', $src);   // bỏ dòng chú thích
            if (preg_match('/\b(DELETE\s+FROM|TRUNCATE\s+TABLE|TRUNCATE\s+\w+|REPLACE\s+INTO|DROP\s+TABLE)\b/i', $src, $m) === 1) {
                $bad[] = substr($file->getPathname(), strlen(BASE_PATH) + 1) . ': ' . $m[1];
            }
        }
    }
    assertSame([], $bad, 'không được xóa dữ liệu khỏi database');
    foreach (['users', 'admins', 'playlists', 'playlist_items', 'license_keys'] as $table) {
        assertTrue(in_array('deleted_at', adminSqlColumns(BASE_PATH . '/database/schema.sql', $table), true), $table . ' phải có cột deleted_at');
    }
});

test('CSP giai đoạn 9: bật trình phát YouTube thì chỉ mở đúng nguồn thư viện và khung YouTube; tắt hoặc trang quản trị thì không', function () {
    $on = App\Core\SecurityHeaders::csp(false, 'x', '', 'https://www.youtube.com/iframe_api');
    assertTrue(contains($on, "script-src 'self'") && contains($on, 'https://www.youtube.com') && contains($on, "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com"), $on);
    assertTrue(!contains($on, "'unsafe-inline' ") || !preg_match("/script-src[^;]*'unsafe-inline'/", $on), 'không cho script nội tuyến tùy ý');
    $off = App\Core\SecurityHeaders::csp(false, 'x', '', '');
    assertTrue(contains($off, "frame-src 'self'") && !contains($off, 'youtube'), $off);
    assertTrue(!contains(App\Core\SecurityHeaders::csp(true, 'x', '', 'https://www.youtube.com/iframe_api'), 'youtube'), 'trang quản trị không mở nguồn YouTube');
    assertSame(null, App\Core\SecurityHeaders::embedOrigin('http://evil.example/iframe_api'), 'chỉ nhận https (http chỉ cho localhost khi kiểm thử)');
    assertSame('http://localhost:8133', App\Core\SecurityHeaders::embedOrigin('http://localhost:8133/iframe_api'));
});
