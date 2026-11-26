<?php
declare(strict_types=1);

// Giai đoạn 14: đăng ký/đăng nhập bằng số điện thoại, mã OTP khi quên/đổi mật khẩu (gửi email; SMS chưa tích hợp).

use App\Core\Config;
use App\Core\Container;
use App\Core\Database;
use App\Core\ErrorHandler;
use App\Core\Request;
use App\Core\Router;
use App\Core\Validator;
use App\Middleware\Csrf;
use App\Repositories\UserRepository;
use App\Services\OtpService;
use App\Services\RateLimiter;

test('Số điện thoại: chuẩn hóa về 0xxxxxxxxx, nhận +84/84/dấu cách/dấu chấm; số sai bị từ chối; ô đăng nhập nhận email hoặc số', function () {
    assertSame('0912345678', Validator::phone('0912345678'));
    assertSame('0912345678', Validator::phone('0912 345 678'));
    assertSame('0912345678', Validator::phone('0912.345.678'));
    assertSame('0912345678', Validator::phone('+84 912 345 678'));
    assertSame('0912345678', Validator::phone('84912345678'));
    assertSame('0387654321', Validator::phone('(038) 765-4321'));
    foreach (['', '091234567', '09123456789', '0212345678', 'abc', '+1 912 345 678', null, []] as $bad) {
        assertSame(null, Validator::phone($bad), 'phải từ chối ' . json_encode($bad));
    }
    assertSame(['email', 'a@b.vn'], Validator::loginId(' A@B.vn '));
    assertSame(['phone', '0912345678'], Validator::loginId('+84912345678'));
    assertSame(null, Validator::loginId('khong-hop-le'));
    assertSame('ng*******@gmail.com', OtpService::maskEmail('nguyenvan@gmail.com'));
    assertSame('a*@x.vn', OtpService::maskEmail('ab@x.vn'));
});

if (adminSqliteDatabase() === null) {
    test('Số điện thoại + OTP (SQLite): BỎ QUA - PHP này chưa bật pdo_sqlite', function () {
    });
    return;
}

function ptBoot(array $sms = ['driver' => 'none']): stdClass
{
    $S = new stdClass();
    $S->sessions = [];
    $S->saved = ['app' => Config::get('app', []), 'mail' => Config::get('mail', []), 'sms' => Config::get('sms', [])];
    Container::reset();
    Config::override('app', ['url' => 'http://test.local', 'name' => 'PH Car Play', 'key' => 'khoa-thu',
        'auth' => ['reset_ttl_minutes' => 60, 'otp_ttl_minutes' => 10, 'single_device' => true]]);
    Config::override('mail', ['driver' => 'log', 'from_email' => 'no-reply@test.local', 'from_name' => 'Test']);
    Config::override('sms', $sms);
    $S->db = adminSqliteDatabase();
    Container::set(Database::class, $S->db);
    $dir = sys_get_temp_dir() . '/carweb-pt-' . bin2hex(random_bytes(4));
    @mkdir($dir, 0700, true);
    Container::set(RateLimiter::class, new RateLimiter($dir, null, true));
    $S->mailsBefore = glob(BASE_PATH . '/storage/mail/*.txt') ?: [];
    return $S;
}

function ptDone(stdClass $S): void
{
    Config::override('app', $S->saved['app']);
    Config::override('mail', $S->saved['mail']);
    Config::override('sms', $S->saved['sms']);
    Container::reset();
    ptMails($S);
}

/** Thư mới gửi từ lần gọi trước (lấy ra và xóa file thử). */
function ptMails(stdClass $S): array
{
    $new = array_values(array_diff(glob(BASE_PATH . '/storage/mail/*.txt') ?: [], $S->mailsBefore));
    $out = [];
    foreach ($new as $f) {
        $out[] = (string) file_get_contents($f);
        @unlink($f);
        @unlink(substr($f, 0, -4) . '.eml');
    }
    return $out;
}

function ptCode(string $mail): string
{
    return preg_match('/là: ([0-9]{6})/u', $mail, $m) === 1 ? $m[1] : '';
}

function ptCall(stdClass $S, string $sess, string $method, string $path, array $body = [], string $ip = '9.9.9.9')
{
    $_SESSION = $S->sessions[$sess] ?? ['csrf' => bin2hex(random_bytes(8))];
    $router = new Router();
    $router->setGlobalMiddleware([Csrf::class]);
    (require BASE_PATH . '/routes/api.php')($router);
    try {
        $res = @$router->dispatch(new Request($method, $path, [], $body, ['x-csrf-token' => (string) $_SESSION['csrf'], 'user-agent' => 'Thử'], $ip));
    } catch (Throwable $e) {
        $res = ErrorHandler::toResponse($e);
    }
    $S->sessions[$sess] = $_SESSION;
    return $res;
}

function ptBody($res): array
{
    return $res->payload;
}

test('Đăng ký bắt buộc số điện thoại, không trùng; đăng nhập bằng số (gõ kiểu nào cũng được) hoặc email', function () {
    $S = ptBoot();
    try {
        $r = ptCall($S, 'A', 'POST', '/auth/register', ['email' => 'pt1@test.local', 'name' => 'A', 'password' => 'matkhau1']);
        assertSame(422, $r->status, 'thiếu số điện thoại');
        assertTrue(isset(ptBody($r)['error']['details']['phone']), 'báo lỗi ở ô số điện thoại');
        $r = ptCall($S, 'A', 'POST', '/auth/register', ['email' => 'pt1@test.local', 'name' => 'A', 'phone' => '0212345678', 'password' => 'matkhau1']);
        assertSame(422, $r->status, 'số máy bàn / sai đầu số');
        $r = ptCall($S, 'A', 'POST', '/auth/register', ['email' => 'pt1@test.local', 'name' => 'A', 'phone' => '+84 912 345 678', 'password' => 'matkhau1']);
        assertSame(201, $r->status);
        assertSame('0912345678', ptBody($r)['data']['user']['phone']);
        $r = ptCall($S, 'B', 'POST', '/auth/register', ['email' => 'pt2@test.local', 'name' => 'B', 'phone' => '0912.345.678', 'password' => 'matkhau1']);
        assertSame(409, $r->status);
        assertSame('PHONE_TAKEN', ptBody($r)['error']['code']);
        foreach (['0912345678', '0912 345 678', '+84912345678'] as $i => $login) {
            $r = ptCall($S, 'L' . $i, 'POST', '/auth/login', ['login' => $login, 'password' => 'matkhau1']);
            assertSame(200, $r->status, 'đăng nhập bằng ' . $login);
            assertSame('pt1@test.local', ptBody($r)['data']['user']['email']);
        }
        assertSame(200, ptCall($S, 'E', 'POST', '/auth/login', ['email' => 'PT1@test.local', 'password' => 'matkhau1'])->status, 'giao diện cũ gửi email vẫn được');
        $r = ptCall($S, 'X', 'POST', '/auth/login', ['login' => '0912345678', 'password' => 'sai']);
        assertSame(401, $r->status);
        assertTrue(contains(ptBody($r)['error']['message'], 'số điện thoại'));
        assertSame(422, ptCall($S, 'X', 'POST', '/auth/login', ['login' => '12345', 'password' => 'x'])->status);
    } finally {
        ptDone($S);
    }
});

test('Quên mật khẩu bằng số điện thoại: mã 6 số gửi email; không lộ tài khoản; sai mã báo số lần còn lại; đúng mã đổi được mật khẩu, mã chỉ dùng 1 lần', function () {
    $S = ptBoot();
    try {
        assertSame(201, ptCall($S, 'A', 'POST', '/auth/register', ['email' => 'pt3@test.local', 'name' => 'C', 'phone' => '0987654321', 'password' => 'matkhau1'])->status);
        ptMails($S);
        $r = ptCall($S, 'F', 'POST', '/auth/forgot', ['login' => '0987 654 321']);
        assertSame(200, $r->status);
        $msg = ptBody($r)['data']['message'];
        $mails = ptMails($S);
        assertSame(1, count($mails), 'gửi đúng 1 thư');
        assertTrue(contains($mails[0], 'pt3@test.local'), 'gửi tới email của tài khoản');
        $code = ptCode($mails[0]);
        assertTrue(strlen($code) === 6, 'thư có mã 6 số');
        $none = ptCall($S, 'F', 'POST', '/auth/forgot', ['login' => '0911111111']);
        assertSame(200, $none->status);
        assertSame($msg, ptBody($none)['data']['message'], 'số chưa đăng ký: trả lời y hệt');
        assertSame(0, count(ptMails($S)), 'số chưa đăng ký: không gửi gì');
        ptCall($S, 'F', 'POST', '/auth/forgot', ['login' => 'pt3@test.local']);
        assertSame(0, count(ptMails($S)), 'xin lại trong 60 giây: im lặng, không gửi thư mới (mã cũ vẫn dùng được)');

        $wrong = $code === '000000' ? '111111' : '000000';
        $r = ptCall($S, 'F', 'POST', '/auth/reset', ['login' => '0987654321', 'code' => $wrong, 'password' => 'matkhaumoi']);
        assertSame(400, $r->status);
        assertSame('OTP_WRONG', ptBody($r)['error']['code']);
        assertTrue(contains(ptBody($r)['error']['message'], 'còn 4 lần'));
        $r = ptCall($S, 'F', 'POST', '/auth/reset', ['login' => '0987654321', 'code' => $code, 'password' => '123']);
        assertSame(422, $r->status, 'mật khẩu quá ngắn');
        $r = ptCall($S, 'F', 'POST', '/auth/reset', ['login' => '0987654321', 'code' => $code, 'password' => 'matkhaumoi']);
        assertSame(200, $r->status);
        assertSame(401, ptCall($S, 'G', 'POST', '/auth/login', ['login' => '0987654321', 'password' => 'matkhau1'])->status, 'mật khẩu cũ hết hiệu lực');
        assertSame(200, ptCall($S, 'G', 'POST', '/auth/login', ['login' => '0987654321', 'password' => 'matkhaumoi'])->status);
        $r = ptCall($S, 'F', 'POST', '/auth/reset', ['login' => '0987654321', 'code' => $code, 'password' => 'lannua123']);
        assertSame('OTP_INVALID', ptBody($r)['error']['code'], 'mã đã dùng');
        $r = ptCall($S, 'F', 'POST', '/auth/reset', ['login' => '0911111111', 'code' => $code, 'password' => 'lannua123']);
        assertSame('OTP_INVALID', ptBody($r)['error']['code'], 'số chưa đăng ký');
    } finally {
        ptDone($S);
    }
});

test('Mã OTP: sai 5 lần thì bị hủy (đúng cũng không dùng được nữa); hết hạn thì báo hết hạn; không dòng nào bị xóa', function () {
    $S = ptBoot();
    try {
        ptCall($S, 'A', 'POST', '/auth/register', ['email' => 'pt4@test.local', 'name' => 'D', 'phone' => '0333333333', 'password' => 'matkhau1']);
        ptMails($S);
        ptCall($S, 'F', 'POST', '/auth/forgot', ['login' => '0333333333']);
        $code = ptCode(ptMails($S)[0]);
        $wrong = $code === '000000' ? '111111' : '000000';
        $last = null;
        for ($i = 0; $i < 5; $i++) {
            $last = ptCall($S, 'F', 'POST', '/auth/reset', ['login' => '0333333333', 'code' => $wrong, 'password' => 'matkhaumoi']);
        }
        assertSame('OTP_LOCKED', ptBody($last)['error']['code']);
        $r = ptCall($S, 'F', 'POST', '/auth/reset', ['login' => '0333333333', 'code' => $code, 'password' => 'matkhaumoi']);
        assertSame('OTP_INVALID', ptBody($r)['error']['code'], 'mã đã bị hủy');

        $S->db->execute("UPDATE otp_codes SET created_at = '2020-01-01 00:00:00'");   // cho phép xin mã mới ngay
        ptCall($S, 'F', 'POST', '/auth/forgot', ['login' => '0333333333']);
        $code2 = ptCode(ptMails($S)[0]);
        assertTrue($code2 !== '', 'có mã mới');
        $S->db->execute("UPDATE otp_codes SET expires_at = '2020-01-01 00:00:00' WHERE used_at IS NULL");
        $r = ptCall($S, 'F', 'POST', '/auth/reset', ['login' => '0333333333', 'code' => $code2, 'password' => 'matkhaumoi']);
        assertSame('OTP_INVALID', ptBody($r)['error']['code'], 'mã hết hạn');
        assertSame(2, (int) $S->db->value("SELECT COUNT(*) FROM otp_codes"), 'các mã vẫn còn trong bảng, chỉ được đánh dấu');
        assertSame(0, (int) $S->db->value("SELECT COUNT(*) FROM otp_codes WHERE used_at IS NULL"));
        assertTrue(!contains((string) $S->db->value('SELECT code_hash FROM otp_codes LIMIT 1'), $code), 'không lưu mã gốc');
    } finally {
        ptDone($S);
    }
});

test('Đổi mật khẩu khi đang đăng nhập: xin mã (chờ 60 giây mới xin lại được), nhập mã + mật khẩu mới; máy này vẫn đăng nhập, máy khác bị đăng xuất', function () {
    $S = ptBoot();
    try {
        ptCall($S, 'Main', 'POST', '/auth/register', ['email' => 'pt5@test.local', 'name' => 'E', 'phone' => '0555555555', 'password' => 'matkhau1']);
        ptMails($S);
        assertSame(401, ptCall($S, 'Anon', 'POST', '/user/password/code')->status, 'phải đăng nhập');
        $r = ptCall($S, 'Main', 'POST', '/user/password/code');
        assertSame(200, $r->status);
        assertSame('pt*@test.local', ptBody($r)['data']['email']);
        assertSame(['email'], ptBody($r)['data']['channels'], 'SMS chưa bật: chỉ gửi email');
        $code = ptCode(ptMails($S)[0]);
        $again = ptCall($S, 'Main', 'POST', '/user/password/code');
        assertSame(429, $again->status);
        assertSame('OTP_TOO_SOON', ptBody($again)['error']['code']);
        $r = ptCall($S, 'Main', 'POST', '/user/password', ['code' => $code, 'password' => 'doimatkhau']);
        assertSame(200, $r->status);
        assertSame('pt5@test.local', ptBody(ptCall($S, 'Main', 'GET', '/auth/me'))['data']['user']['email'], 'máy đang dùng vẫn đăng nhập');
        assertSame(200, ptCall($S, 'Other', 'POST', '/auth/login', ['login' => '0555555555', 'password' => 'doimatkhau'])->status);
        $me = ptBody(ptCall($S, 'Main', 'GET', '/auth/me'))['data'];
        assertSame(null, $me['user'], 'đăng nhập máy khác thì máy cũ bị đăng xuất (một thiết bị)');
        $r = ptCall($S, 'Other', 'POST', '/user/password', ['code' => $code, 'password' => 'lannua123']);
        assertSame('OTP_INVALID', ptBody($r)['error']['code'], 'mã đổi mật khẩu chỉ dùng 1 lần');
    } finally {
        ptDone($S);
    }
});

test('Tài khoản cũ thêm/đổi số điện thoại; số trùng bị từ chối; tài khoản đã xóa trả lại số cho người khác', function () {
    $S = ptBoot();
    try {
        $users = Container::get(UserRepository::class);
        $id = $users->create('pt6@test.local', 'Cũ', str_repeat('a', 32), str_repeat('b', 16));   // tài khoản trước giai đoạn 14: chưa có số
        assertSame(null, $users->find($id)['phone']);
        ptCall($S, 'A', 'POST', '/auth/register', ['email' => 'pt7@test.local', 'name' => 'F', 'phone' => '0777777777', 'password' => 'matkhau1']);
        assertSame(422, ptCall($S, 'A', 'PUT', '/user/phone', ['phone' => '123'])->status);
        $r = ptCall($S, 'A', 'PUT', '/user/phone', ['phone' => '0788 888 888']);
        assertSame(200, $r->status);
        assertSame('0788888888', ptBody($r)['data']['user']['phone']);
        $users->updatePhone($id, '0799999999');
        $r = ptCall($S, 'A', 'PUT', '/user/phone', ['phone' => '0799999999']);
        assertSame('PHONE_TAKEN', ptBody($r)['error']['code']);
        $users->softDeleteWithData($id, ['type' => 'admin', 'id' => 1, 'email' => 'm@test.local']);
        assertSame(200, ptCall($S, 'A', 'PUT', '/user/phone', ['phone' => '0799999999'])->status, 'số của tài khoản đã xóa dùng lại được');
        ptMails($S);
    } finally {
        ptDone($S);
    }
});

test('Bật SMS (SMS_DRIVER=log): mã gửi cả email và SMS tới số của tài khoản', function () {
    $S = ptBoot(['driver' => 'log']);
    $log = BASE_PATH . '/storage/logs/sms.log';
    $before = is_file($log) ? (string) file_get_contents($log) : null;
    try {
        ptCall($S, 'A', 'POST', '/auth/register', ['email' => 'pt8@test.local', 'name' => 'G', 'phone' => '0866666666', 'password' => 'matkhau1']);
        ptMails($S);
        $r = ptCall($S, 'A', 'POST', '/user/password/code');
        assertSame(['email', 'sms'], ptBody($r)['data']['channels']);
        $code = ptCode(ptMails($S)[0]);
        $sms = (string) file_get_contents($log);
        assertTrue(contains($sms, '0866666666') && contains($sms, $code), 'SMS có số và mã');
    } finally {
        if ($before === null) {
            @unlink($log);
        } else {
            file_put_contents($log, $before);
        }
        ptDone($S);
    }
});
