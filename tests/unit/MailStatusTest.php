<?php
declare(strict_types=1);

// Giai đoạn 16: báo đúng tình trạng gửi email (không báo "Đã gửi" khi thư không đi) và nút "Gửi thư thử" của master.

use App\Core\Config;
use App\Core\Container;
use App\Core\Database;
use App\Core\ErrorHandler;
use App\Core\Request;
use App\Core\Router;
use App\Middleware\Csrf;
use App\Repositories\AdminRepository;
use App\Services\Mailer;
use App\Services\MailCheckService;
use App\Services\PasswordHasher;
use App\Services\RateLimiter;

require_once dirname(__DIR__) . '/support/sqlite_schema.php';

const MS_LOG = ['driver' => 'log', 'from_email' => 'no-reply@test.local', 'from_name' => 'Test'];
// Cổng 1 trên máy mình: bị từ chối ngay, giả lập máy chủ thư hỏng mà không cần mạng.
const MS_BROKEN = ['driver' => 'smtp', 'from_email' => 'gui@test.local', 'from_name' => 'Test',
    'smtp' => ['host' => '127.0.0.1', 'port' => 1, 'encryption' => '', 'username' => 'gui@test.local', 'password' => 'bi-mat-SMTP-123', 'helo' => 'localhost', 'timeout' => 2]];

test('Mailer::driver: smtp/mail là gửi thật, mọi giá trị khác là chế độ thử', function () {
    assertSame('smtp', (new Mailer(['driver' => ' SMTP ']))->driver());
    assertSame('mail', (new Mailer(['driver' => 'mail']))->driver());
    assertSame('log', (new Mailer(['driver' => 'log']))->driver());
    assertSame('log', (new Mailer(['driver' => 'gi-do']))->driver());
    assertSame('log', (new Mailer([]))->driver());
    assertTrue((new Mailer(['driver' => 'smtp']))->sendsForReal());
    assertTrue(!(new Mailer(['driver' => 'log']))->sendsForReal());
});

test('MailCheckService::hint: gợi ý đúng theo lỗi máy chủ thư trả về', function () {
    assertTrue(contains(MailCheckService::hint('Không kết nối được SMTP smtp.x.vn:587 (Connection refused)'), 'SMTP_HOST'));
    assertTrue(contains(MailCheckService::hint('SMTP trả lỗi: 535-5.7.8 Username and Password not accepted'), 'Mật khẩu ứng dụng'));
    assertTrue(contains(MailCheckService::hint('SMTP trả lỗi: 530 5.7.0 Must issue a STARTTLS command first'), 'SMTP_ENCRYPTION'));
    assertTrue(contains(MailCheckService::hint('Không bật được mã hóa TLS với máy chủ SMTP.'), 'cổng 587 dùng tls'));
    assertTrue(contains(MailCheckService::hint('Máy chủ SMTP không trả lời (hết thời gian chờ hoặc bị ngắt kết nối).'), 'cổng 465'));
    assertTrue(contains(MailCheckService::hint('SMTP trả lỗi: 553 5.7.1 Sender address rejected'), 'MAIL_FROM_EMAIL'));
    assertTrue(contains(MailCheckService::hint('Hàm mail() của PHP gửi thất bại.'), 'MAIL_DRIVER=smtp'));
    assertTrue(contains(MailCheckService::hint('lỗi lạ'), '.env'));
});

test('MailCheckService::describe: nêu chỗ cần sửa, không bao giờ trả mật khẩu SMTP', function () {
    $saved = Config::get('mail', []);
    try {
        Config::override('mail', MS_LOG);
        $d = (new MailCheckService(new Mailer()))->describe();
        assertSame('log', $d['driver']);
        assertSame(true, $d['test_mode']);
        assertSame(null, $d['smtp']);
        assertTrue(count($d['problems']) === 1 && contains($d['problems'][0], 'MAIL_DRIVER=smtp'));

        Config::override('mail', MS_BROKEN);
        $d = (new MailCheckService(new Mailer()))->describe();
        assertSame('smtp', $d['driver']);
        assertSame(false, $d['test_mode']);
        assertSame(['host' => '127.0.0.1', 'port' => 1, 'encryption' => '', 'username_set' => true, 'password_set' => true], $d['smtp']);
        assertSame([], $d['problems']);
        assertTrue(strpos((string) json_encode($d), 'bi-mat-SMTP-123') === false, 'lộ mật khẩu SMTP');

        Config::override('mail', ['driver' => 'smtp', 'from_email' => 'no-reply@example.com', 'smtp' => ['host' => '', 'username' => '', 'password' => '']]);
        $d = (new MailCheckService(new Mailer()))->describe();
        assertSame(4, count($d['problems']), 'thiếu host, user, pass và địa chỉ gửi mẫu');
    } finally {
        Config::override('mail', $saved);
    }
});

if (adminSqliteDatabase() === null) {
    test('Tình trạng gửi email (SQLite): BỎ QUA - PHP này chưa bật pdo_sqlite', function () {
    });
    return;
}

function msBoot(): stdClass
{
    $S = new stdClass();
    $S->sessions = [];
    $S->saved = ['app' => Config::get('app', []), 'mail' => Config::get('mail', []), 'sms' => Config::get('sms', [])];
    Container::reset();
    Config::override('app', ['url' => 'http://test.local', 'name' => 'PH Car Play', 'key' => 'khoa-thu',
        'auth' => ['reset_ttl_minutes' => 60, 'otp_ttl_minutes' => 10, 'single_device' => true]]);
    Config::override('mail', MS_LOG);
    Config::override('sms', ['driver' => 'none']);
    Container::set(Database::class, adminSqliteDatabase());
    $dir = sys_get_temp_dir() . '/carweb-ms-' . bin2hex(random_bytes(4));
    @mkdir($dir, 0700, true);
    Container::set(RateLimiter::class, new RateLimiter($dir, null, true));
    $S->mailsBefore = glob(BASE_PATH . '/storage/mail/*.txt') ?: [];
    return $S;
}

function msDone(stdClass $S): void
{
    Config::override('app', $S->saved['app']);
    Config::override('mail', $S->saved['mail']);
    Config::override('sms', $S->saved['sms']);
    Container::reset();
    msMails($S);
}

/** Thư (chế độ thử) ghi ra từ lần gọi trước; đọc xong thì xóa file thử. */
function msMails(stdClass $S): array
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

/** Đổi cách gửi mail giữa chừng: các Service đã tạo giữ Mailer đọc cấu hình mỗi lần gửi nên không cần dựng lại. */
function msMail(array $cfg): void
{
    Config::override('mail', $cfg);
}

function msCall(stdClass $S, string $area, string $sess, string $method, string $path, array $body = [])
{
    $_SESSION = $S->sessions[$area . ':' . $sess] ?? ['csrf' => bin2hex(random_bytes(8))];
    $router = new Router();
    $router->setGlobalMiddleware([Csrf::class]);
    (require BASE_PATH . '/routes/' . ($area === 'admin' ? 'admin.php' : 'api.php'))($router);
    try {
        $res = @$router->dispatch(new Request($method, $path, [], $body, ['x-csrf-token' => (string) $_SESSION['csrf'], 'user-agent' => 'Thử'], '9.9.9.9'));
    } catch (Throwable $e) {
        $res = ErrorHandler::toResponse($e);
    }
    $S->sessions[$area . ':' . $sess] = $_SESSION;
    return $res;
}

function msCode($res): string
{
    return (string) ($res->payload['error']['code'] ?? '');
}

test('Quên mật khẩu: máy chủ thư hỏng thì báo MAIL_FAILED (không báo "đã gửi"), bấm lại được ngay; chế độ thử thì nói rõ thư không gửi thật', function () {
    $S = msBoot();
    try {
        assertSame(201, msCall($S, 'user', 'A', 'POST', '/auth/register', ['email' => 'ms1@test.local', 'name' => 'A', 'phone' => '0911000001', 'password' => 'matkhau1'])->status);
        msMails($S);

        msMail(MS_BROKEN);
        $r = msCall($S, 'user', 'F', 'POST', '/auth/forgot', ['login' => '0911000001']);
        assertSame(503, $r->status);
        assertSame('MAIL_FAILED', msCode($r));
        assertTrue(strpos((string) json_encode($r->payload), 'bi-mat-SMTP-123') === false, 'lộ mật khẩu SMTP');
        $r = msCall($S, 'user', 'F', 'POST', '/auth/forgot', ['login' => 'ms1@test.local']);
        assertSame('MAIL_FAILED', msCode($r), 'mã hỏng đã bị hủy nên lần bấm lại vẫn thử gửi (không im lặng chờ 60 giây)');
        $none = msCall($S, 'user', 'F', 'POST', '/auth/forgot', ['login' => '0999999999']);
        assertSame(200, $none->status, 'tài khoản không tồn tại: vẫn trả lời chung');
        assertSame(false, $none->payload['data']['test_mode']);

        msMail(MS_LOG);
        $r = msCall($S, 'user', 'F', 'POST', '/auth/forgot', ['login' => '0911000001']);
        assertSame(200, $r->status, 'sửa xong cấu hình thì gửi được ngay');
        assertSame(true, $r->payload['data']['test_mode']);
        assertTrue(contains($r->payload['data']['message'], 'KHÔNG được gửi thật'));
        assertSame(1, count(msMails($S)), 'chế độ thử: thư ghi ra storage/mail');
    } finally {
        msDone($S);
    }
});

test('Xin mã đổi mật khẩu (đang đăng nhập): thư không đi thì MAIL_FAILED chứ không bắt chờ 60 giây', function () {
    $S = msBoot();
    try {
        msCall($S, 'user', 'A', 'POST', '/auth/register', ['email' => 'ms2@test.local', 'name' => 'B', 'phone' => '0911000002', 'password' => 'matkhau1']);
        msMail(MS_BROKEN);
        assertSame('MAIL_FAILED', msCode(msCall($S, 'user', 'A', 'POST', '/user/password/code')));
        assertSame('MAIL_FAILED', msCode(msCall($S, 'user', 'A', 'POST', '/user/password/code')), 'không phải OTP_TOO_SOON');
        msMail(MS_LOG);
        $r = msCall($S, 'user', 'A', 'POST', '/user/password/code');
        assertSame(200, $r->status);
        assertSame(true, $r->payload['data']['delivered']);
        assertSame(true, $r->payload['data']['test_mode']);
        assertTrue(contains($r->payload['data']['message'], 'KHÔNG được gửi thật'));
        assertSame('OTP_TOO_SOON', msCode(msCall($S, 'user', 'A', 'POST', '/user/password/code')), 'gửi được rồi thì mới tính 60 giây');
    } finally {
        msDone($S);
    }
});

test('Quản trị: xem cấu hình và gửi thư thử chỉ dành cho master; lỗi kèm gợi ý, không lộ mật khẩu; có ghi nhật ký', function () {
    $S = msBoot();
    try {
        $hasher = Container::get(PasswordHasher::class);
        $admins = Container::get(AdminRepository::class);
        $salt = $hasher->generateSalt();
        $admins->create('ms_master@test.local', 'Master', $hasher->hash('MatKhau-12345', $salt), $salt, 'master');
        $salt = $hasher->generateSalt();
        $admins->create('ms_admin@test.local', 'Admin', $hasher->hash('MatKhau-12345', $salt), $salt, 'admin', false);

        assertSame('UNAUTHORIZED', msCode(msCall($S, 'admin', 'anon', 'GET', '/mail')));
        assertSame('UNAUTHORIZED', msCode(msCall($S, 'admin', 'anon', 'POST', '/mail/test', ['email' => 'a@test.local'])));
        assertSame(200, msCall($S, 'admin', 'A', 'POST', '/auth/login', ['email' => 'ms_admin@test.local', 'password' => 'MatKhau-12345'])->status);
        assertSame('FORBIDDEN', msCode(msCall($S, 'admin', 'A', 'GET', '/mail')), 'admin thường không xem được');
        assertSame('FORBIDDEN', msCode(msCall($S, 'admin', 'A', 'POST', '/mail/test', ['email' => 'a@test.local'])));

        assertSame(200, msCall($S, 'admin', 'M', 'POST', '/auth/login', ['email' => 'ms_master@test.local', 'password' => 'MatKhau-12345'])->status);
        $st = msCall($S, 'admin', 'M', 'GET', '/mail');
        assertSame(200, $st->status);
        assertSame('log', $st->payload['data']['driver']);
        assertSame('VALIDATION_FAILED', msCode(msCall($S, 'admin', 'M', 'POST', '/mail/test', ['email' => 'khong-phai-email'])));

        msMails($S);
        $r = msCall($S, 'admin', 'M', 'POST', '/mail/test', ['email' => 'nhan@test.local']);
        assertSame(200, $r->status);
        assertSame(true, $r->payload['data']['test_mode']);
        assertTrue(contains($r->payload['data']['message'], 'KHÔNG gửi tới nhan@test.local'));
        $mails = msMails($S);
        assertTrue(count($mails) === 1 && contains($mails[0], 'nhan@test.local'), 'chế độ thử: thư ghi ra file');

        msMail(MS_BROKEN);
        $st = msCall($S, 'admin', 'M', 'GET', '/mail');
        assertSame('smtp', $st->payload['data']['driver']);
        assertSame(true, $st->payload['data']['smtp']['password_set']);
        $r = msCall($S, 'admin', 'M', 'POST', '/mail/test', ['email' => 'nhan@test.local']);
        assertSame(502, $r->status);
        assertSame('MAIL_TEST_FAILED', msCode($r));
        assertTrue(contains($r->payload['error']['details']['error'], 'Không kết nối được SMTP 127.0.0.1:1'));
        assertTrue(contains($r->payload['error']['details']['hint'], 'SMTP_HOST'));
        assertTrue(strpos((string) json_encode([$st->payload, $r->payload]), 'bi-mat-SMTP-123') === false, 'lộ mật khẩu SMTP');

        $rows = Container::get(Database::class)->all("SELECT detail FROM audit_log WHERE action = 'mail.test' ORDER BY id");
        assertSame(2, count($rows), 'mỗi lần gửi thử ghi một dòng nhật ký');
        assertTrue(contains($rows[0]['detail'], 'chế độ thử') && contains($rows[1]['detail'], 'thất bại'));
    } finally {
        msDone($S);
    }
});

test('Quản trị: gửi mã cho người dùng và quên mật khẩu admin cũng báo thật khi thư không đi', function () {
    $S = msBoot();
    try {
        $hasher = Container::get(PasswordHasher::class);
        $salt = $hasher->generateSalt();
        Container::get(AdminRepository::class)->create('ms_master2@test.local', 'Master', $hasher->hash('MatKhau-12345', $salt), $salt, 'master');
        msCall($S, 'user', 'U', 'POST', '/auth/register', ['email' => 'ms3@test.local', 'name' => 'C', 'phone' => '0911000003', 'password' => 'matkhau1']);
        $uid = (int) Container::get(Database::class)->one("SELECT id FROM users WHERE email = 'ms3@test.local'")['id'];
        msCall($S, 'admin', 'M', 'POST', '/auth/login', ['email' => 'ms_master2@test.local', 'password' => 'MatKhau-12345']);

        msMail(MS_BROKEN);
        $r = msCall($S, 'admin', 'M', 'POST', '/users/' . $uid . '/send-reset');
        assertSame(502, $r->status);
        assertSame('MAIL_FAILED', msCode($r));
        assertSame('MAIL_FAILED', msCode(msCall($S, 'admin', 'anon', 'POST', '/auth/forgot', ['email' => 'ms_master2@test.local'])));
        assertSame(200, msCall($S, 'admin', 'anon', 'POST', '/auth/forgot', ['email' => 'khong-co@test.local'])->status, 'email lạ: vẫn trả lời chung');

        msMail(MS_LOG);
        $r = msCall($S, 'admin', 'M', 'POST', '/users/' . $uid . '/send-reset');
        assertSame('test', $r->payload['data']['result']);
        assertTrue(contains($r->payload['data']['message'], 'KHÔNG được gửi thật'));
        $r = msCall($S, 'admin', 'M', 'POST', '/users/' . $uid . '/send-reset');
        assertSame('none', $r->payload['data']['result'], 'vừa gửi trong 60 giây');
        $f = msCall($S, 'admin', 'anon', 'POST', '/auth/forgot', ['email' => 'khong-co@test.local']);
        assertSame(true, $f->payload['data']['test_mode']);
    } finally {
        msDone($S);
    }
});
