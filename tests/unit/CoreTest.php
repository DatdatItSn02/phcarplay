<?php
declare(strict_types=1);

use App\Core\Config;
use App\Core\Container;
use App\Core\Env;
use App\Core\HttpException;
use App\Core\Request;
use App\Core\Response;
use App\Core\Router;
use App\Core\Validator;
use App\Middleware\Csrf;
use App\Services\EntitlementService;
use App\Services\Mailer;
use App\Services\PasswordHasher;

test('PasswordHasher: md5(md5(pw).salt) khớp vector chuẩn', function () {
    $h = new PasswordHasher();
    // Vector tính độc lập bằng Node: md5(md5('secret123') + 'abcd1234abcd1234')
    assertSame('94c78bfe806a5c3bacdac00c4d0eb1cc', $h->hash('secret123', 'abcd1234abcd1234'));
    assertTrue($h->verify('secret123', 'abcd1234abcd1234', '94c78bfe806a5c3bacdac00c4d0eb1cc'));
    assertTrue(!$h->verify('sai', 'abcd1234abcd1234', '94c78bfe806a5c3bacdac00c4d0eb1cc'));
});

test('PasswordHasher: salt dài 16 ký tự hex và khác nhau mỗi lần', function () {
    $h = new PasswordHasher();
    $a = $h->generateSalt();
    assertTrue(preg_match('/^[0-9a-f]{16}$/', $a) === 1, 'salt sai định dạng');
    assertTrue($a !== $h->generateSalt(), 'salt trùng nhau');
});

test('Validator: email chuẩn hóa chữ thường, từ chối email sai', function () {
    assertSame('a@b.com', Validator::email('  A@B.com '));
    assertSame(null, Validator::email('khong-phai-email'));
    assertSame(null, Validator::email(123));
    assertTrue(Validator::passwordOk('123456'));
    assertTrue(!Validator::passwordOk('12345'));
});

test('Env: đọc KEY=VALUE, bỏ ngoặc kép và dòng chú thích', function () {
    $f = tempnam(sys_get_temp_dir(), 'env');
    file_put_contents($f, "# ghi chú\nA_KEY=hello\nB_KEY=\"có dấu cách\"\nC_FLAG=true\n");
    Env::load($f);
    unlink($f);
    assertSame('hello', Env::get('A_KEY'));
    assertSame('có dấu cách', Env::get('B_KEY'));
    assertTrue(Env::bool('C_FLAG'));
    assertSame('mặc định', Env::get('KHONG_CO', 'mặc định'));
});

test('Config: đọc khóa lồng nhau và giá trị mặc định', function () {
    Config::override('demo', ['a' => ['b' => 5]]);
    assertSame(5, Config::get('demo.a.b'));
    assertSame('x', Config::get('demo.a.zzz', 'x'));
    Config::reset();
});

test('Response: định dạng ok và error', function () {
    assertSame('{"ok":true,"data":{"a":1}}', Response::ok(['a' => 1])->toJson());
    $err = Response::error(422, 'X', 'Lỗi tiếng Việt', ['f' => 'sai']);
    assertSame(422, $err->status);
    assertSame('{"ok":false,"error":{"code":"X","message":"Lỗi tiếng Việt","details":{"f":"sai"}}}', $err->toJson());
});

test('Router: khớp tham số, 404 và 405', function () {
    $r = new Router();
    $r->get('/items/{id}', fn(Request $q) => ['id' => $q->param('id')]);
    $r->post('/items', fn() => Response::ok('created', 201));

    $res = $r->dispatch(new Request('GET', '/items/42'));
    assertSame('{"ok":true,"data":{"id":"42"}}', $res->toJson());
    assertSame(201, $r->dispatch(new Request('POST', '/items'))->status);
    assertThrows(fn() => $r->dispatch(new Request('GET', '/nope')), 'NOT_FOUND');
    assertThrows(fn() => $r->dispatch(new Request('DELETE', '/items')), 'METHOD_NOT_ALLOWED');
});

final class RecordingMiddleware implements App\Middleware\MiddlewareInterface
{
    public static array $log = [];

    public function handle(Request $q, callable $next): Response
    {
        self::$log[] = 'mw';
        return $next($q);
    }
}

test('Router: middleware chạy trước handler', function () {
    RecordingMiddleware::$log = [];
    $r = new Router();
    $r->get('/a', function () {
        RecordingMiddleware::$log[] = 'handler';
        return 'ok';
    }, [RecordingMiddleware::class]);
    $r->dispatch(new Request('GET', '/a'));
    assertSame(['mw', 'handler'], RecordingMiddleware::$log);
});

test('Csrf: chặn POST thiếu token, cho GET đi qua', function () {
    $_SESSION = ['csrf' => 'tok123'];
    $mw = new Csrf();
    $next = fn(Request $q) => Response::ok('pass');
    assertSame('pass', $mw->handle(new Request('GET', '/x'), $next)->payload['data']);
    assertThrows(fn() => $mw->handle(new Request('POST', '/x'), $next), 'CSRF_INVALID', 'thiếu token');
    assertThrows(fn() => $mw->handle(new Request('POST', '/x', [], [], ['x-csrf-token' => 'sai']), $next), 'CSRF_INVALID', 'sai token');
    assertSame('pass', $mw->handle(new Request('POST', '/x', [], [], ['x-csrf-token' => 'tok123']), $next)->payload['data']);
    $_SESSION = [];
});

test('Container: tự tạo đối tượng theo kiểu khai báo', function () {
    Container::reset();
    $a = Container::get(App\Services\AuthService::class);
    assertTrue($a instanceof App\Services\AuthService);
    assertTrue(Container::get(App\Services\PasswordHasher::class) === Container::get(App\Services\PasswordHasher::class), 'phải dùng chung một thể hiện');
    Container::reset();
});

test('Entitlement: khách, thành viên, và khi bật enforce_license', function () {
    $e = new EntitlementService();
    Config::override('app', ['enforce_license' => false]);
    assertSame('guest', $e->forUser(null)['plan']);
    assertSame('member', $e->forUser(['expires_at' => null])['plan']);
    Config::override('app', ['enforce_license' => true]);
    assertSame('trial', $e->forUser(['expires_at' => null])['plan']);
    assertSame('member', $e->forUser(['expires_at' => date('Y-m-d H:i:s', time() + 3600)])['plan']);
    assertTrue(!$e->can(['expires_at' => null], 'playlists_cloud'));
    Config::reset();
});

test('Mailer: driver log ghi file .eml, tiêu đề và nội dung tiếng Việt mã hóa đúng', function () {
    $m = new Mailer(['driver' => 'log', 'from_email' => 'no-reply@x.com', 'from_name' => 'PH Car Play']);
    $before = glob(BASE_PATH . '/storage/mail/*.eml') ?: [];
    $m->send('khach@x.com', 'Đặt lại mật khẩu', '<p>Xin chào</p>', 'Xin chào');
    $after = glob(BASE_PATH . '/storage/mail/*.eml') ?: [];
    $new = array_values(array_diff($after, $before));
    assertSame(1, count($new));
    $raw = file_get_contents($new[0]);
    unlink($new[0]);
    assertTrue(contains($raw, 'To: <khach@x.com>'));
    assertTrue(contains($raw, 'Subject: =?UTF-8?B?' . base64_encode('Đặt lại mật khẩu') . '?='));
    assertTrue(contains($raw, base64_encode('<p>Xin chào</p>')), 'nội dung html phải được mã hóa base64');
});

test('DeviceSessionService: chỉ dấu phiên khớp mới hợp lệ; tắt cơ chế thì luôn hợp lệ', function () {
    $svc = new App\Services\DeviceSessionService(Container::get(App\Repositories\UserRepository::class));
    Config::override('app', ['auth' => ['single_device' => true]]);
    $raw = bin2hex(random_bytes(8));
    $user = ['id' => 1, 'session_token' => hash('sha256', $raw)];
    assertTrue($svc->isCurrent($user, $raw), 'đúng dấu phiên');
    assertTrue(!$svc->isCurrent($user, 'dau-khac'), 'sai dấu phiên');
    assertTrue(!$svc->isCurrent($user, null), 'không có dấu phiên');
    assertTrue(!$svc->isCurrent($user, ''), 'dấu rỗng');
    assertTrue(!$svc->isCurrent(['id' => 1, 'session_token' => null], $raw), 'tài khoản chưa có thiết bị nào');
    Config::override('app', ['auth' => ['single_device' => false]]);
    assertTrue($svc->isCurrent(['id' => 1, 'session_token' => null], null), 'tắt cơ chế');
    Config::reset();
});

test('DeviceSessionService: mô tả thiết bị từ User-Agent', function () {
    $svc = new App\Services\DeviceSessionService(Container::get(App\Repositories\UserRepository::class));
    assertSame('Chrome / Android', $svc->describe('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'));
    assertSame('Safari / iOS', $svc->describe('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'));
    assertSame('Edge / Windows', $svc->describe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0'));
    assertSame('Firefox / Linux', $svc->describe('Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0'));
    assertSame('Trình duyệt / Thiết bị khác', $svc->describe(''));
    // Giai đoạn 13: ứng dụng điện thoại (WebView có chữ Chrome/Safari trong User-Agent nhưng vẫn ghi là "Ứng dụng")
    assertSame('Ứng dụng / Android', $svc->describe('Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 PHCarPlayApp/1.0.0 (Android)'));
    assertSame('Ứng dụng / iOS', $svc->describe('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 PHCarPlayApp/1.0.0 (iOS)'));
});

test('PreferencesService::sanitize: kẹp giá trị, bỏ khóa lạ và kiểu sai', function () {
    $S = App\Services\PreferencesService::class;
    assertSame(['layout' => ['h' => 0.9, 'v' => 0.1]], $S::sanitize(['layout' => ['h' => 5, 'v' => -2]]));
    assertSame(['layout' => ['h' => 0.4]], $S::sanitize(['layout' => ['h' => 0.4, 'x' => 1, 'v' => 'abc']]));
    assertSame([], $S::sanitize(['layout' => ['h' => 'abc']]));
    assertSame([], $S::sanitize(['khac' => 1]));
    assertSame([], $S::sanitize(['layout' => 'chuoi']));
    assertSame(['layout' => ['h' => 0.333]], $S::sanitize(['layout' => ['h' => 1 / 3]]));
});
