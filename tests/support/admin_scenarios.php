<?php
declare(strict_types=1);

/**
 * Các kịch bản kiểm thử khu vực quản trị, dùng chung cho hai cách chạy:
 *   - tests/unit/AdminTest.php          chạy trên SQLite trong bộ nhớ (không cần MySQL), dùng đúng Repository/Service/Controller thật
 *   - tests/integration/AdminFlowTest.php  chạy trên MySQL thật (php tests/run.php --integration)
 * Mỗi kịch bản tự dựng dữ liệu riêng (email có tiền tố ngẫu nhiên) và tự dọn sau khi chạy xong.
 *
 * Giới hạn: phiên được giả lập bằng biến $_SESSION; các hàm session_start/session_regenerate_id/session_destroy
 * không chạy thật trong CLI (cảnh báo bị @ che). Cookie và phiên thật được thử riêng bằng
 * tests/support/serve_sqlite.php + e2e-harness/admin-http.mjs.
 */

use App\Core\Config;
use App\Core\Container;
use App\Core\Database;
use App\Core\ErrorHandler;
use App\Core\Request;
use App\Core\Router;
use App\Middleware\Csrf;
use App\Repositories\AdminRepository;
use App\Repositories\AuditLogRepository;
use App\Repositories\PasswordResetRepository;
use App\Services\AdminAccountService;
use App\Services\AdminAuthService;
use App\Services\AdminPasswordResetService;
use App\Services\PasswordHasher;

require_once __DIR__ . '/sqlite_schema.php';

/** Đọc token đặt lại mật khẩu từ thư mới nhất trong storage/mail rồi xóa các thư mới. */
function adminTakeMailToken(array $before): array
{
    $dir = BASE_PATH . '/storage/mail';
    $now = glob($dir . '/*.txt') ?: [];
    $new = array_values(array_diff($now, $before));
    $tokens = [];
    foreach ($new as $txt) {
        if (preg_match('#/admin/reset-password\?token=([0-9a-f]{64})#', (string) file_get_contents($txt), $m) === 1) {
            $tokens[] = $m[1];
        }
        @unlink($txt);
        @unlink(substr($txt, 0, -4) . '.eml');
    }
    return $tokens;
}

/**
 * @param string $label tiền tố tên kiểm thử
 * @param callable $boot chuẩn bị Container (gắn Database) trước khi chạy
 * @param callable $cleanup function(string $tag): void dọn dữ liệu thử còn sót
 */
function registerAdminScenarios(string $label, callable $boot, callable $cleanup): void
{
    $S = new stdClass();
    $S->sessions = [];
    $name = function (string $n) use ($label): string {
        return $label . ': ' . $n;
    };
    $ip = '1.2.3.4';

    test($name('chuẩn bị dữ liệu thử'), function () use ($S, $boot) {
        $S->saved = ['mail' => Config::get('mail', []), 'app' => Config::get('app', [])];
        Container::reset();
        Config::override('mail', ['driver' => 'log', 'from_email' => 'no-reply@test.local', 'from_name' => 'Test']);
        Config::override('app', ['url' => 'http://test.local', 'name' => 'PH Car Play', 'auth' => ['reset_ttl_minutes' => 60]]);
        $boot();
        $S->tag = 'it_' . bin2hex(random_bytes(4));
        $S->pw = 'MatKhau-12345';
        $S->masterEmail = $S->tag . '_master@test.local';
        $hasher = Container::get(PasswordHasher::class);
        $salt = $hasher->generateSalt();
        $S->masterId = Container::get(AdminRepository::class)->create($S->masterEmail, 'Master', $hasher->hash($S->pw, $salt), $salt, 'master');
        assertTrue($S->masterId > 0, 'phải tạo được master thử');
    });

    test($name('đăng nhập: đúng/sai mật khẩu, email lạ'), function () use ($S) {
        $auth = Container::get(AdminAuthService::class);
        $a = $auth->attempt($S->masterEmail, $S->pw);
        assertSame($S->masterEmail, $a['email']);
        assertTrue($a['last_login_at'] !== null, 'phải ghi lần đăng nhập cuối');
        assertThrows(function () use ($auth, $S) { $auth->attempt($S->masterEmail, 'sai-mat-khau'); }, 'INVALID_CREDENTIALS');
        assertThrows(function () use ($auth) { $auth->attempt('khong.co@test.local', 'x'); }, 'INVALID_CREDENTIALS');
    });

    test($name('tạo admin: chỉ vai trò admin, buộc đổi mật khẩu, trùng email bị từ chối'), function () use ($S, $ip) {
        $accounts = Container::get(AdminAccountService::class);
        $master = Container::get(AdminRepository::class)->find($S->masterId);
        $S->a1Email = $S->tag . '_a1@test.local';
        $created = $accounts->create($master, $S->a1Email, 'Admin Một', 'TamThoi-123', $ip);
        assertSame('admin', $created['role']);
        assertSame(true, $created['must_change_password']);
        assertSame('active', $created['status']);
        assertTrue(!array_key_exists('password_hash', $created) && !array_key_exists('salt', $created), 'không được lộ hash/salt');
        $S->a1 = $created['id'];
        assertThrows(function () use ($accounts, $master, $S, $ip) { $accounts->create($master, $S->a1Email, 'Trùng', 'TamThoi-456', $ip); }, 'EMAIL_TAKEN');
        assertThrows(function () use ($accounts, $master, $S, $ip) { $accounts->create($master, $S->masterEmail, 'Trùng master', 'TamThoi-456', $ip); }, 'EMAIL_TAKEN');
    });

    test($name('đổi mật khẩu của chính mình: sai mật khẩu cũ, trùng mật khẩu cũ, thành công thì gỡ cờ bắt buộc'), function () use ($S) {
        $auth = Container::get(AdminAuthService::class);
        $repo = Container::get(AdminRepository::class);
        $auth->attempt($S->a1Email, 'TamThoi-123');
        $admin = $repo->find($S->a1);
        assertThrows(function () use ($auth, $admin) { $auth->changeOwnPassword($admin, 'sai', 'MatKhauMoi-1'); }, 'VALIDATION_FAILED');
        assertThrows(function () use ($auth, $admin) { $auth->changeOwnPassword($admin, 'TamThoi-123', 'TamThoi-123'); }, 'VALIDATION_FAILED');
        $after = $auth->changeOwnPassword($admin, 'TamThoi-123', 'MatKhauMoi-1');
        assertSame(0, (int) $after['must_change_password']);
        assertSame($S->a1Email, $auth->attempt($S->a1Email, 'MatKhauMoi-1')['email']);
        assertThrows(function () use ($auth, $S) { $auth->attempt($S->a1Email, 'TamThoi-123'); }, 'INVALID_CREDENTIALS');
    });

    test($name('phiên cũ mất hiệu lực khi đổi mật khẩu, bị khóa; mở khóa thì đăng nhập lại được'), function () use ($S, $ip) {
        $auth = Container::get(AdminAuthService::class);
        $repo = Container::get(AdminRepository::class);
        $accounts = Container::get(AdminAccountService::class);
        $master = $repo->find($S->masterId);

        $a = $repo->find($S->a1);
        $fp = $auth->fingerprint($a);
        assertSame($S->a1, (int) $auth->resolve((int) $a['id'], $fp)['id']);
        assertSame(null, $auth->resolve((int) $a['id'], 'dau-van-tay-sai'));
        assertSame(null, $auth->resolve(null, $fp));
        assertSame(null, $auth->resolve('abc', $fp));
        assertSame(null, $auth->resolve(999999, $fp), 'tài khoản không tồn tại');

        $auth->changeOwnPassword($a, 'MatKhauMoi-1', 'MatKhauMoi-2');
        assertSame(null, $auth->resolve($S->a1, $fp), 'đổi mật khẩu thì phiên cũ hết hiệu lực');

        $fp2 = $auth->fingerprint($repo->find($S->a1));
        assertTrue($auth->resolve($S->a1, $fp2) !== null, 'dấu mới hợp lệ');
        $accounts->update($master, $S->a1, ['status' => 'blocked'], $ip);
        assertSame(null, $auth->resolve($S->a1, $fp2), 'bị khóa thì phiên hết hiệu lực');
        assertThrows(function () use ($auth, $S) { $auth->attempt($S->a1Email, 'MatKhauMoi-2'); }, 'ACCOUNT_BLOCKED');
        $accounts->update($master, $S->a1, ['status' => 'active'], $ip);
        assertTrue($auth->resolve($S->a1, $fp2) !== null, 'mở khóa thì dùng lại được');
        $auth->attempt($S->a1Email, 'MatKhauMoi-2');
    });

    test($name('bảo vệ master: không khóa, không xóa, không đặt mật khẩu, chỉ chính master sửa tên/email'), function () use ($S, $ip) {
        $accounts = Container::get(AdminAccountService::class);
        $repo = Container::get(AdminRepository::class);
        $master = $repo->find($S->masterId);
        $a1 = $repo->find($S->a1);
        $id = $S->masterId;

        assertThrows(function () use ($accounts, $master, $id, $ip) { $accounts->update($master, $id, ['status' => 'blocked'], $ip); }, 'MASTER_PROTECTED');
        assertThrows(function () use ($accounts, $master, $id, $ip) { $accounts->update($master, $id, ['status' => 'active'], $ip); }, 'MASTER_PROTECTED', 'kể cả gửi trạng thái cũ');
        assertThrows(function () use ($accounts, $a1, $id, $ip) { $accounts->update($a1, $id, ['name' => 'Hack'], $ip); }, 'MASTER_PROTECTED');
        assertThrows(function () use ($accounts, $master, $id, $ip) { $accounts->setPassword($master, $id, 'abcdefgh1', $ip); }, 'MASTER_PROTECTED');
        assertThrows(function () use ($accounts, $master, $id, $ip) { $accounts->delete($master, $id, $ip); }, 'MASTER_PROTECTED');
        assertSame('active', $repo->find($id)['status']);

        $r = $accounts->update($master, $id, ['name' => 'Master Mới'], $ip);
        assertSame('Master Mới', $r['name'], 'master tự sửa tên mình');
        assertThrows(function () use ($accounts, $master, $ip) { $accounts->get(999999); }, 'NOT_FOUND');
        assertThrows(function () use ($accounts, $master, $ip) { $accounts->update($master, 999999, ['name' => 'x'], $ip); }, 'NOT_FOUND');
        assertThrows(function () use ($accounts, $master, $ip) { $accounts->delete($master, 999999, $ip); }, 'NOT_FOUND');
    });

    test($name('sửa admin: email trùng bị từ chối; không đổi gì thì không ghi nhật ký'), function () use ($S, $ip) {
        $accounts = Container::get(AdminAccountService::class);
        $repo = Container::get(AdminRepository::class);
        $db = Container::get(Database::class);
        $master = $repo->find($S->masterId);
        $count = function () use ($db, $S) {
            return (int) $db->value('SELECT COUNT(*) FROM audit_log WHERE action = ? AND target_id = ?', ['admin.update', (string) $S->a1]);
        };

        assertThrows(function () use ($accounts, $master, $S, $ip) { $accounts->update($master, $S->a1, ['email' => $S->masterEmail], $ip); }, 'EMAIL_TAKEN');
        $n0 = $count();
        $current = $repo->find($S->a1);
        $accounts->update($master, $S->a1, ['name' => $current['name'], 'email' => $current['email']], $ip);
        assertSame($n0, $count(), 'không đổi gì thì không ghi nhật ký');

        $S->a1Email = $S->tag . '_a1b@test.local';
        $r = $accounts->update($master, $S->a1, ['name' => 'Tên Mới', 'email' => $S->a1Email], $ip);
        assertSame('Tên Mới', $r['name']);
        assertSame($S->a1Email, $r['email']);
        assertSame($n0 + 1, $count(), 'đổi thật thì ghi một dòng nhật ký');
    });

    test($name('master đặt mật khẩu tạm: buộc đổi, phiên cũ và token quên mật khẩu cũ bị vô hiệu'), function () use ($S, $ip) {
        $accounts = Container::get(AdminAccountService::class);
        $auth = Container::get(AdminAuthService::class);
        $repo = Container::get(AdminRepository::class);
        $resets = Container::get(PasswordResetRepository::class);
        $master = $repo->find($S->masterId);

        $fp = $auth->fingerprint($repo->find($S->a1));
        $resets->create('admin', $S->a1, hash('sha256', 'token-cu-' . $S->tag), date('Y-m-d H:i:s', time() + 600));
        $accounts->setPassword($master, $S->a1, 'TamThoi-999', $ip);

        assertSame(1, (int) $repo->find($S->a1)['must_change_password']);
        assertSame(null, $auth->resolve($S->a1, $fp), 'phiên cũ bị đăng xuất');
        assertSame(null, $resets->findValid('admin', hash('sha256', 'token-cu-' . $S->tag), date('Y-m-d H:i:s')), 'token cũ bị vô hiệu');
        assertSame($S->a1Email, $auth->attempt($S->a1Email, 'TamThoi-999')['email']);
        assertThrows(function () use ($auth, $S) { $auth->attempt($S->a1Email, 'MatKhauMoi-2'); }, 'INVALID_CREDENTIALS');
    });

    test($name('quên mật khẩu admin: thư có liên kết /admin, token dùng một lần, tách biệt với token người dùng'), function () use ($S, $ip) {
        $svc = Container::get(AdminPasswordResetService::class);
        $auth = Container::get(AdminAuthService::class);
        $repo = Container::get(AdminRepository::class);
        $resets = Container::get(PasswordResetRepository::class);
        $accounts = Container::get(AdminAccountService::class);
        $master = $repo->find($S->masterId);
        $before = glob(BASE_PATH . '/storage/mail/*.txt') ?: [];

        $svc->request('khong.co@test.local', $ip);
        assertSame([], adminTakeMailToken($before), 'email lạ: không gửi thư');

        $accounts->update($master, $S->a1, ['status' => 'blocked'], $ip);
        $svc->request($S->a1Email, $ip);
        assertSame([], adminTakeMailToken($before), 'tài khoản bị khóa: không gửi thư');
        $accounts->update($master, $S->a1, ['status' => 'active'], $ip);

        $svc->request($S->masterEmail, $ip);
        $tokens = adminTakeMailToken($before);
        assertSame(1, count($tokens), 'phải gửi đúng 1 thư có liên kết /admin/reset-password');
        $svc->request($S->masterEmail, $ip);
        assertSame([], adminTakeMailToken($before), 'yêu cầu dồn dập trong 60 giây bị bỏ qua');

        assertThrows(function () use ($svc, $ip) { $svc->reset('0000', 'Mat-khau-moi-1', $ip); }, 'TOKEN_INVALID');
        $userTokenHash = hash('sha256', 'usertoken-' . $S->tag);
        $resets->create('user', $S->masterId, $userTokenHash, date('Y-m-d H:i:s', time() + 600));
        assertThrows(function () use ($svc, $S, $ip) { $svc->reset('usertoken-' . $S->tag, 'Mat-khau-moi-1', $ip); }, 'TOKEN_INVALID', 'token người dùng không dùng cho admin');
        Container::get(Database::class)->execute('DELETE FROM password_resets WHERE token_hash = ?', [$userTokenHash]);

        $fp = $auth->fingerprint($repo->find($S->masterId));
        $svc->reset($tokens[0], 'Mat-khau-moi-1', $ip);
        assertThrows(function () use ($svc, $tokens, $ip) { $svc->reset($tokens[0], 'Lan-nua-12345', $ip); }, 'TOKEN_INVALID', 'token đã dùng');
        assertSame(null, $auth->resolve($S->masterId, $fp), 'đặt lại mật khẩu thì phiên cũ bị đăng xuất');
        assertSame($S->masterEmail, $auth->attempt($S->masterEmail, 'Mat-khau-moi-1')['email']);
        assertThrows(function () use ($auth, $S) { $auth->attempt($S->masterEmail, $S->pw); }, 'INVALID_CREDENTIALS');
        $S->pw = 'Mat-khau-moi-1';
    });

    test($name('nhật ký: đủ các hành động và tuyệt đối không chứa mật khẩu'), function () use ($S) {
        $rows = Container::get(AuditLogRepository::class)->recent(500);
        $mine = array_values(array_filter($rows, function ($r) use ($S) {
            return strpos((string) $r['admin_email'], $S->tag) === 0 || strpos((string) $r['detail'], $S->tag) !== false;
        }));
        $actions = array_column($mine, 'action');
        foreach (['admin.create', 'admin.update', 'admin.password_set', 'admin.password_forgot', 'admin.password_reset'] as $a) {
            assertTrue(in_array($a, $actions, true), 'thiếu dòng nhật ký ' . $a);
        }
        foreach ($mine as $r) {
            assertSame('1.2.3.4', $r['ip'], 'phải lưu địa chỉ IP');
        }
        $blob = (string) json_encode($rows, JSON_UNESCAPED_UNICODE);
        foreach (['MatKhau-12345', 'TamThoi-123', 'MatKhauMoi-1', 'MatKhauMoi-2', 'TamThoi-999', 'Mat-khau-moi-1'] as $secret) {
            assertTrue(strpos($blob, $secret) === false, 'nhật ký lộ mật khẩu: ' . $secret);
        }
    });

    test($name('API: chưa đăng nhập, CSRF, đăng nhập, bắt buộc đổi mật khẩu, quyền master'), function () use ($S) {
        $call = function (string $sess, string $method, string $path, array $body = [], bool $csrf = true) use ($S) {
            $_SESSION = $S->sessions[$sess] ?? ['csrf' => bin2hex(random_bytes(8))];
            $headers = $csrf ? ['x-csrf-token' => (string) ($_SESSION['csrf'] ?? '')] : [];
            $router = new Router();
            $router->setGlobalMiddleware([Csrf::class]);
            (require BASE_PATH . '/routes/admin.php')($router);
            try {
                $res = @$router->dispatch(new Request($method, $path, [], $body, $headers, '9.9.9.9'));
            } catch (Throwable $e) {
                $res = ErrorHandler::toResponse($e);
            }
            $S->sessions[$sess] = $_SESSION;
            return $res;
        };
        $code = function ($res): string {
            return (string) ($res->payload['error']['code'] ?? '');
        };

        $r = $call('anon', 'GET', '/auth/me');
        assertSame(200, $r->status);
        assertSame(null, $r->payload['data']['admin']);
        assertTrue($r->payload['data']['csrf'] !== '', 'phải có CSRF token');
        assertSame('UNAUTHORIZED', $code($call('anon', 'GET', '/admins')));
        assertSame(401, $call('anon', 'GET', '/admins')->status);
        assertSame('CSRF_INVALID', $code($call('anon', 'POST', '/auth/login', ['email' => $S->masterEmail, 'password' => $S->pw], false)));
        assertSame('VALIDATION_FAILED', $code($call('anon', 'POST', '/auth/login', ['email' => 'khong-phai-email', 'password' => 'x'])));
        assertSame('INVALID_CREDENTIALS', $code($call('anon', 'POST', '/auth/login', ['email' => $S->masterEmail, 'password' => 'sai'])));
        assertSame('NOT_FOUND', $code($call('anon', 'GET', '/khong-co')));
        assertSame('METHOD_NOT_ALLOWED', $code($call('anon', 'DELETE', '/auth/me')));

        // Master đăng nhập
        $r = $call('M', 'POST', '/auth/login', ['email' => strtoupper($S->masterEmail), 'password' => $S->pw]);
        assertSame(200, $r->status, 'đăng nhập master');
        assertSame('master', $r->payload['data']['admin']['role']);
        assertTrue(!array_key_exists('password_hash', $r->payload['data']['admin']) && !array_key_exists('salt', $r->payload['data']['admin']), 'không lộ hash');
        assertSame($S->masterEmail, $call('M', 'GET', '/auth/me')->payload['data']['admin']['email']);

        $items = $call('M', 'GET', '/admins')->payload['data']['items'];
        $ids = array_column($items, 'id');
        assertSame('master', $items[0]['role'], 'master đứng đầu danh sách');
        assertTrue(in_array($S->masterId, $ids, true) && in_array($S->a1, $ids, true), 'danh sách phải có master và admin thử');
        assertTrue(array_search($S->masterId, $ids, true) < array_search($S->a1, $ids, true), 'master đứng trước admin thường');

        // Tạo admin: kiểm tra dữ liệu
        $r = $call('M', 'POST', '/admins', ['email' => 'khong-hop-le', 'name' => '', 'password' => 'ngan']);
        assertSame('VALIDATION_FAILED', $code($r));
        assertSame(['email', 'name', 'password'], array_keys($r->payload['error']['details']));
        $a2Email = $S->tag . '_a2@test.local';
        $r = $call('M', 'POST', '/admins', ['email' => strtoupper($a2Email), 'name' => 'Admin Hai', 'password' => 'TamThoi-222']);
        assertSame(201, $r->status);
        assertSame($a2Email, $r->payload['data']['email'], 'email được chuẩn hóa chữ thường');
        $a2 = $r->payload['data']['id'];
        assertSame('EMAIL_TAKEN', $code($call('M', 'POST', '/admins', ['email' => $a2Email, 'name' => 'Trùng', 'password' => 'TamThoi-222'])));

        // Admin mới: phải đổi mật khẩu rồi mới dùng được; không phải master
        $r = $call('B', 'POST', '/auth/login', ['email' => $a2Email, 'password' => 'TamThoi-222']);
        assertSame(true, $r->payload['data']['admin']['must_change_password']);
        assertSame('PASSWORD_CHANGE_REQUIRED', $code($call('B', 'GET', '/admins')));
        assertSame(403, $call('B', 'GET', '/admins')->status);
        $r = $call('B', 'POST', '/account/password', ['current_password' => 'TamThoi-222', 'new_password' => 'ngan']);
        assertSame(['new_password'], array_keys($r->payload['error']['details']));
        $r = $call('B', 'POST', '/account/password', ['current_password' => 'sai-mat-khau', 'new_password' => 'MatKhau-moi-22']);
        assertSame(['current_password'], array_keys($r->payload['error']['details']));
        $r = $call('B', 'POST', '/account/password', ['current_password' => 'TamThoi-222', 'new_password' => 'MatKhau-moi-22']);
        assertSame(200, $r->status);
        assertSame(false, $r->payload['data']['admin']['must_change_password']);
        assertSame($a2Email, $call('B', 'GET', '/auth/me')->payload['data']['admin']['email'], 'đổi xong vẫn đăng nhập');
        assertSame('FORBIDDEN', $code($call('B', 'GET', '/admins')), 'admin thường không vào được quản lý admin');
        assertSame('FORBIDDEN', $code($call('B', 'POST', '/admins', ['email' => 'x@test.local', 'name' => 'x', 'password' => 'abcdefgh1'])));

        // Sửa: kiểm tra dữ liệu và quy tắc master
        assertSame('NOT_FOUND', $code($call('M', 'PATCH', '/admins/abc', ['name' => 'x'])));
        assertSame('VALIDATION_FAILED', $code($call('M', 'PATCH', '/admins/' . $a2, [])));
        assertSame('VALIDATION_FAILED', $code($call('M', 'PATCH', '/admins/' . $a2, ['status' => 'zzz'])));
        assertSame('VALIDATION_FAILED', $code($call('M', 'PATCH', '/admins/' . $a2, ['email' => 'khong-phai-email'])));
        assertSame('MASTER_PROTECTED', $code($call('M', 'PATCH', '/admins/' . $S->masterId, ['status' => 'blocked'])));
        assertSame('MASTER_PROTECTED', $code($call('M', 'DELETE', '/admins/' . $S->masterId)));
        assertSame('MASTER_PROTECTED', $code($call('M', 'POST', '/admins/' . $S->masterId . '/password', ['password' => 'abcdefgh1'])));

        // Khóa admin: phiên đang mở bị đăng xuất, đăng nhập lại bị từ chối; mở khóa thì vào lại được
        $r = $call('M', 'PATCH', '/admins/' . $a2, ['status' => 'blocked']);
        assertSame('blocked', $r->payload['data']['status']);
        assertSame('UNAUTHORIZED', $code($call('B', 'POST', '/account/password', ['current_password' => 'MatKhau-moi-22', 'new_password' => 'MatKhau-moi-33'])));
        assertSame(null, $call('B', 'GET', '/auth/me')->payload['data']['admin']);
        assertSame('ACCOUNT_BLOCKED', $code($call('B', 'POST', '/auth/login', ['email' => $a2Email, 'password' => 'MatKhau-moi-22'])));
        $call('M', 'PATCH', '/admins/' . $a2, ['status' => 'active']);
        assertSame(200, $call('B', 'POST', '/auth/login', ['email' => $a2Email, 'password' => 'MatKhau-moi-22'])->status);

        // Master đặt mật khẩu tạm: phiên của admin kia bị đăng xuất
        assertSame('VALIDATION_FAILED', $code($call('M', 'POST', '/admins/' . $a2 . '/password', ['password' => 'ngan'])));
        assertSame(200, $call('M', 'POST', '/admins/' . $a2 . '/password', ['password' => 'TamThoi-333'])->status);
        assertSame(null, $call('B', 'GET', '/auth/me')->payload['data']['admin'], 'mật khẩu đã đổi nên phiên cũ hết hiệu lực');

        // Xóa
        assertSame(200, $call('M', 'DELETE', '/admins/' . $a2)->status);
        assertSame('NOT_FOUND', $code($call('M', 'GET', '/admins/' . $a2)));
        assertSame('NOT_FOUND', $code($call('M', 'DELETE', '/admins/' . $a2)));

        // Đăng xuất
        $r = $call('M', 'POST', '/auth/logout');
        assertSame(200, $r->status);
        assertTrue($r->payload['data']['csrf'] !== '', 'đăng xuất trả CSRF token mới');
        assertSame('UNAUTHORIZED', $code($call('M', 'GET', '/admins')));
    });

    test($name('xóa admin: chỉ đánh dấu người xóa/thời điểm, vô hiệu token đặt lại mật khẩu, email dùng lại được, có nhật ký'), function () use ($S, $ip) {
        $db = Container::get(Database::class);
        $row = $db->one('SELECT * FROM admins WHERE email = ?', [$S->tag . '_a2@test.local']);
        assertTrue($row !== null, 'a2 vẫn còn trong database (không dùng DELETE)');
        assertTrue($row['deleted_at'] !== null && $row['alive'] === null, 'a2 được đánh dấu đã xóa');
        assertSame('admin', $row['deleted_by_type']);
        assertSame($S->masterId, (int) $row['deleted_by_id']);
        assertSame(null, Container::get(AdminRepository::class)->findByEmail($S->tag . '_a2@test.local'), 'không đăng nhập/tìm thấy được nữa');
        $accounts = Container::get(AdminAccountService::class);
        $repo = Container::get(AdminRepository::class);
        $resets = Container::get(PasswordResetRepository::class);
        $master = $repo->find($S->masterId);
        $resets->create('admin', $S->a1, hash('sha256', 'token-xoa-' . $S->tag), date('Y-m-d H:i:s', time() + 600));
        $accounts->delete($master, $S->a1, $ip);
        assertSame(null, $repo->find($S->a1));
        assertSame(0, (int) $db->value('SELECT COUNT(*) FROM password_resets WHERE account_type = ? AND account_id = ? AND used_at IS NULL', ['admin', $S->a1]), 'token của admin đã xóa phải hết hiệu lực');
        assertTrue((int) $db->value('SELECT COUNT(*) FROM password_resets WHERE account_type = ? AND account_id = ?', ['admin', $S->a1]) > 0, 'token vẫn còn trong database');
        $a1Email = (string) $db->value('SELECT email FROM admins WHERE id = ?', [$S->a1]);
        $newId = $repo->create($a1Email, 'Tạo lại', 'h', 's', 'admin');
        assertTrue($newId !== $S->a1 && $repo->findByEmail($a1Email)['id'] == $newId, 'email của admin đã xóa tạo lại được tài khoản mới');
        $accounts->delete($master, $newId, $ip);
        $logged = (int) $db->value('SELECT COUNT(*) FROM audit_log WHERE action = ? AND target_id = ?', ['admin.delete', (string) $S->a1]);
        assertSame(1, $logged, 'xóa admin phải để lại nhật ký');
        assertThrows(function () use ($accounts, $master, $ip) { $accounts->delete($master, (int) $master['id'], $ip); }, 'MASTER_PROTECTED');
    });

    test($name('dọn dữ liệu thử'), function () use ($S, $cleanup) {
        $cleanup($S->tag);
        Config::override('mail', $S->saved['mail']);
        Config::override('app', $S->saved['app']);
        Container::reset();
        $S->sessions = [];
    });
}
