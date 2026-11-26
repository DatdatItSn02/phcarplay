<?php
declare(strict_types=1);

/**
 * Kịch bản kiểm thử các chức năng quản trị của giai đoạn 5.2-5.4 (người dùng, key kích hoạt, playlist, nhật ký, tổng quan),
 * dùng chung cho hai cách chạy (giống tests/support/admin_scenarios.php):
 *   - tests/unit/ManageTest.php             SQLite trong bộ nhớ, mã Repository/Service/Controller/Router thật
 *   - tests/integration/ManageFlowTest.php  MySQL thật (php tests/run.php --integration)
 * Dữ liệu thử có email bắt đầu bằng it_xxxxxxxx_ và được dọn sau khi chạy.
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
use App\Repositories\LicenseKeyRepository;
use App\Repositories\PasswordResetRepository;
use App\Repositories\PlaylistRepository;
use App\Repositories\UserRepository;
use App\Services\AdminPlaylistService;
use App\Services\AdminStatsService;
use App\Services\AdminUserService;
use App\Services\AuditViewService;
use App\Services\AuthService;
use App\Services\DeviceSessionService;
use App\Services\LicenseKeyService;
use App\Services\LicensePeriod;
use App\Services\PasswordHasher;

require_once __DIR__ . '/sqlite_schema.php';

/** Các tệp thư trong storage/mail chưa có trong danh sách $before (rồi xóa chúng), trả về nội dung. */
function manageTakeMails(array $before): array
{
    $dir = BASE_PATH . '/storage/mail';
    $new = array_values(array_diff(glob($dir . '/*.txt') ?: [], $before));
    $texts = [];
    foreach ($new as $txt) {
        $texts[] = (string) file_get_contents($txt);
        @unlink($txt);
        @unlink(substr($txt, 0, -4) . '.eml');
    }
    return $texts;
}

function registerManageScenarios(string $label, callable $boot, callable $cleanup): void
{
    $S = new stdClass();
    $S->sessions = [];
    $name = function (string $n) use ($label): string {
        return $label . ': ' . $n;
    };
    $ip = '5.6.7.8';

    /** Gọi API quản trị ($area = 'admin') hoặc API người dùng ($area = 'user') như trình duyệt: có phiên và CSRF. */
    $call = function (string $area, string $sess, string $method, string $path, array $body = [], bool $csrf = true, array $query = []) use ($S) {
        $_SESSION = $S->sessions[$sess] ?? ['csrf' => bin2hex(random_bytes(8))];
        $headers = $csrf ? ['x-csrf-token' => (string) ($_SESSION['csrf'] ?? '')] : [];
        $router = new Router();
        $router->setGlobalMiddleware([Csrf::class]);
        (require BASE_PATH . '/routes/' . ($area === 'admin' ? 'admin.php' : 'api.php'))($router);
        try {
            $res = @$router->dispatch(new Request($method, $path, $query, $body, $headers, '9.9.9.9'));
        } catch (Throwable $e) {
            $res = ErrorHandler::toResponse($e);
        }
        $S->sessions[$sess] = $_SESSION;
        return $res;
    };
    $code = function ($res): string {
        return (string) ($res->payload['error']['code'] ?? '');
    };
    $data = function ($res) {
        return $res->payload['data'] ?? null;
    };

    test($name('chuẩn bị: master, admin thường, người dùng và playlist thử'), function () use ($S, $boot) {
        $S->saved = ['mail' => Config::get('mail', []), 'app' => Config::get('app', [])];
        Container::reset();
        Config::override('mail', ['driver' => 'log', 'from_email' => 'no-reply@test.local', 'from_name' => 'Test']);
        Config::override('app', ['url' => 'http://test.local', 'name' => 'PH Car Play', 'auth' => ['reset_ttl_minutes' => 60, 'single_device' => true], 'enforce_license' => false, 'playlists' => ['max_per_user' => 50, 'max_items' => 500]]);
        $boot();
        $S->tag = 'it_' . bin2hex(random_bytes(4));
        $S->pw = 'MatKhau-12345';
        $hasher = Container::get(PasswordHasher::class);
        $admins = Container::get(AdminRepository::class);
        $salt = $hasher->generateSalt();
        $S->masterEmail = $S->tag . '_master@test.local';
        $S->masterId = $admins->create($S->masterEmail, 'Master', $hasher->hash($S->pw, $salt), $salt, 'master');
        $salt = $hasher->generateSalt();
        $S->adminEmail = $S->tag . '_admin@test.local';
        $S->adminId = $admins->create($S->adminEmail, 'Admin thường', $hasher->hash($S->pw, $salt), $salt, 'admin', false);
        $salt = $hasher->generateSalt();
        $S->tempEmail = $S->tag . '_tam@test.local';
        $S->tempId = $admins->create($S->tempEmail, 'Admin mật khẩu tạm', $hasher->hash($S->pw, $salt), $salt, 'admin', true);

        $auth = Container::get(AuthService::class);
        $S->u = [];
        foreach (['u1' => 'Nguyễn An', 'u2' => 'Trần Bình', 'u3' => 'Lê Chi'] as $k => $n) {
            $row = $auth->register($S->tag . '_' . $k . '@test.local', $n, $S->pw);
            $S->u[$k] = (int) $row['id'];
        }
        $db = Container::get(Database::class);
        $pl = Container::get(PlaylistRepository::class);
        $S->p1 = $pl->create($S->u['u1'], 'Nhạc đi đường dài');
        $S->p2 = $pl->create($S->u['u1'], 'Nhạc buổi sáng');
        $S->p3 = $pl->create($S->u['u2'], 'Của Bình');
        $now = date('Y-m-d H:i:s');
        foreach ([[$S->p1, 'aaaaaaaaaaa', 'Bài một'], [$S->p1, 'bbbbbbbbbbb', 'Bài hai'], [$S->p2, 'ccccccccccc', 'Bài ba'], [$S->p3, 'ddddddddddd', 'Bài bốn']] as $i => $it) {
            $db->execute('INSERT INTO playlist_items (playlist_id, video_id, title, uploader, duration, thumbnail, sort_order, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [$it[0], $it[1], $it[2], 'Kênh', 100, '', $i + 1, $now]);
        }
        $db->execute('INSERT INTO user_preferences (user_id, data, updated_at) VALUES (?, ?, ?)', [$S->u['u1'], '{}', $now]);
        assertTrue($S->masterId > 0 && $S->u['u1'] > 0 && $S->p1 > 0, 'phải tạo được dữ liệu thử');
    });

    test($name('LicensePeriod: cộng ngày nối tiếp hạn còn lại, hết hạn thì tính từ bây giờ'), function () {
        $now = 1_800_000_000;
        assertSame(date('Y-m-d H:i:s', $now + 30 * 86400), LicensePeriod::extend(null, 30, $now));
        assertSame(date('Y-m-d H:i:s', $now + 30 * 86400), LicensePeriod::extend('', 30, $now));
        assertSame(date('Y-m-d H:i:s', $now + 30 * 86400), LicensePeriod::extend(date('Y-m-d H:i:s', $now - 5 * 86400), 30, $now), 'hết hạn thì tính từ bây giờ');
        assertSame(date('Y-m-d H:i:s', $now + 10 * 86400 + 30 * 86400), LicensePeriod::extend(date('Y-m-d H:i:s', $now + 10 * 86400), 30, $now), 'còn hạn thì cộng nối tiếp');
        assertSame('none', LicensePeriod::state(null, $now));
        assertSame('valid', LicensePeriod::state(date('Y-m-d H:i:s', $now + 60), $now));
        assertSame('expired', LicensePeriod::state(date('Y-m-d H:i:s', $now - 60), $now));
    });

    test($name('Validator::dateTime: ngày, giờ và các giá trị sai'), function () {
        assertSame('2026-12-31 23:59:59', App\Core\Validator::dateTime('2026-12-31'));
        assertSame('2026-12-31 08:05:00', App\Core\Validator::dateTime('2026-12-31 08:05'));
        assertSame('2026-12-31 08:05:09', App\Core\Validator::dateTime('2026-12-31T08:05:09'));
        foreach (['2026-02-30', '2026-13-01', '1999-01-01', '2101-01-01', '2026-12-31 24:00', '31/12/2026', '', 'abc', null, 5] as $bad) {
            assertSame(null, App\Core\Validator::dateTime($bad), 'phải từ chối: ' . var_export($bad, true));
        }
    });

    test($name('tìm người dùng: theo chữ, trạng thái, hạn dùng; ký tự đại diện không có tác dụng; phân trang'), function () use ($S) {
        $svc = Container::get(AdminUserService::class);
        $users = Container::get(UserRepository::class);
        $r = $svc->search(['q' => $S->tag . '_u'], 1, 20, 0);
        assertSame(3, $r['total'], 'tìm theo tiền tố email');
        assertSame($S->u['u3'], $r['items'][0]['id'], 'mới đăng ký đứng đầu');
        assertTrue($svc->search(['q' => 'Trần Bình'], 1, 20, 0)['total'] >= 1, 'tìm theo tên (có dấu tiếng Việt)');
        assertSame(1, $svc->search(['q' => $S->tag . '_u2'], 1, 20, 0)['total']);
        assertTrue($svc->search(['q' => '%'], 1, 20, 0)['total'] < $users->countSearch([]), 'dấu % không phải ký tự đại diện (không khớp mọi người)');
        assertSame(0, $svc->search(['q' => $S->tag . '_u_'], 1, 20, 0)['total'], 'dấu _ không phải ký tự đại diện');
        assertSame(3, $svc->search(['q' => $S->tag . '_u', 'status' => 'active'], 1, 20, 0)['total']);
        assertSame(0, $svc->search(['q' => $S->tag . '_u', 'status' => 'blocked'], 1, 20, 0)['total']);
        assertSame(3, $svc->search(['q' => $S->tag . '_u', 'license' => 'none'], 1, 20, 0)['total']);
        $page = $svc->search(['q' => $S->tag . '_u'], 2, 2, 2);
        assertSame(1, count($page['items']), 'trang 2 (mỗi trang 2) còn 1 dòng');
        assertSame(3, $page['total']);
        $first = $r['items'][0];
        foreach (['password_hash', 'salt', 'session_token'] as $secret) {
            assertTrue(!array_key_exists($secret, $first), 'lộ ' . $secret);
        }
        assertSame(2, $svc->search(['q' => $S->tag . '_u1'], 1, 20, 0)['items'][0]['playlist_count'], 'đếm playlist');
    });

    test($name('sửa người dùng: tên, email, khóa/mở khóa, hạn dùng; trùng email; không đổi gì thì không ghi nhật ký'), function () use ($S, $ip) {
        $svc = Container::get(AdminUserService::class);
        $admin = Container::get(AdminRepository::class)->find($S->adminId);
        $auth = Container::get(AuthService::class);
        $id = $S->u['u2'];
        $newEmail = $S->tag . '_u2b@test.local';
        $v = $svc->update($admin, $id, ['email' => $newEmail, 'name' => 'Bình Mới'], $ip);
        assertSame($newEmail, $v['email']);
        assertSame('Bình Mới', $v['name']);
        assertThrows(function () use ($svc, $admin, $id, $S, $ip) { $svc->update($admin, $id, ['email' => $S->tag . '_u1@test.local'], $ip); }, 'EMAIL_TAKEN');

        $log = Container::get(AuditLogRepository::class);
        $before = $log->countSearch([]);
        $svc->update($admin, $id, ['name' => 'Bình Mới', 'email' => $newEmail, 'status' => 'active'], $ip);
        assertSame($before, $log->countSearch([]), 'không đổi gì thì không ghi nhật ký');

        $v = $svc->update($admin, $id, ['status' => 'blocked'], $ip);
        assertSame('blocked', $v['status']);
        assertThrows(function () use ($auth, $newEmail, $S) { $auth->attempt($newEmail, $S->pw); }, 'ACCOUNT_BLOCKED');
        $v = $svc->update($admin, $id, ['status' => 'active'], $ip);
        assertSame('active', $v['status']);
        assertSame($newEmail, $auth->attempt($newEmail, $S->pw)['email'], 'mở khóa xong đăng nhập lại được');

        $v = $svc->update($admin, $id, ['expires_at' => '2030-01-02 03:04:05'], $ip);
        assertSame('2030-01-02 03:04:05', $v['expires_at']);
        assertSame('valid', $v['license']);
        $v = $svc->update($admin, $id, ['expires_at' => null], $ip);
        assertSame(null, $v['expires_at']);
        assertSame('none', $v['license']);
        $v = $svc->update($admin, $id, ['expires_at' => '2001-01-01 00:00:00'], $ip);
        assertSame('expired', $v['license']);
        $svc->update($admin, $id, ['expires_at' => null], $ip);
        assertThrows(function () use ($svc, $admin, $ip) { $svc->update($admin, 99999999, ['name' => 'x'], $ip); }, 'NOT_FOUND');
    });

    test($name('gia hạn tay: từ chưa có hạn, nối tiếp khi còn hạn, tính từ bây giờ khi đã hết hạn'), function () use ($S, $ip) {
        $svc = Container::get(AdminUserService::class);
        $admin = Container::get(AdminRepository::class)->find($S->adminId);
        $id = $S->u['u3'];
        $v = $svc->extend($admin, $id, 30, $ip);
        $d1 = strtotime($v['expires_at']) - time();
        assertTrue($d1 > 29.9 * 86400 && $d1 < 30.1 * 86400, 'chưa có hạn thì tính từ bây giờ');
        assertSame('valid', $v['license']);
        $v2 = $svc->extend($admin, $id, 10, $ip);
        assertSame(strtotime($v['expires_at']) + 10 * 86400, strtotime($v2['expires_at']), 'còn hạn thì nối tiếp');
        $svc->update($admin, $id, ['expires_at' => '2002-02-02 00:00:00'], $ip);
        $v3 = $svc->extend($admin, $id, 5, $ip);
        $d3 = strtotime($v3['expires_at']) - time();
        assertTrue($d3 > 4.9 * 86400 && $d3 < 5.1 * 86400, 'đã hết hạn thì tính từ bây giờ');
        $svc->update($admin, $id, ['expires_at' => null], $ip);
    });

    test($name('đặt mật khẩu mới cho người dùng: đăng nhập được bằng mật khẩu mới, cũ hết dùng, thiết bị bị đăng xuất, token cũ hết hiệu lực'), function () use ($S, $ip) {
        $svc = Container::get(AdminUserService::class);
        $admin = Container::get(AdminRepository::class)->find($S->adminId);
        $users = Container::get(UserRepository::class);
        $devices = Container::get(DeviceSessionService::class);
        $resets = Container::get(PasswordResetRepository::class);
        $auth = Container::get(AuthService::class);
        $id = $S->u['u3'];
        $email = $S->tag . '_u3@test.local';
        $raw = $devices->begin($users->find($id), 'Mozilla/5.0 (Linux; Android 13) Chrome/120', '1.1.1.1');
        assertTrue($devices->isCurrent($users->find($id), $raw), 'thiết bị đang hợp lệ');
        $resets->create('user', $id, hash('sha256', 'tok-' . $S->tag), date('Y-m-d H:i:s', time() + 600));
        $svc->setPassword($admin, $id, 'MatKhau-Moi-9', $ip);
        assertSame($email, $auth->attempt($email, 'MatKhau-Moi-9')['email']);
        assertThrows(function () use ($auth, $email, $S) { $auth->attempt($email, $S->pw); }, 'INVALID_CREDENTIALS');
        assertTrue(!$devices->isCurrent($users->find($id), $raw), 'thiết bị cũ phải bị đăng xuất');
        assertSame(null, $resets->findValid('user', hash('sha256', 'tok-' . $S->tag), date('Y-m-d H:i:s')), 'token cũ phải hết hiệu lực');
        $S->u3pw = 'MatKhau-Moi-9';
    });

    test($name('đăng xuất thiết bị của người dùng'), function () use ($S, $ip) {
        $svc = Container::get(AdminUserService::class);
        $admin = Container::get(AdminRepository::class)->find($S->adminId);
        $users = Container::get(UserRepository::class);
        $devices = Container::get(DeviceSessionService::class);
        $id = $S->u['u1'];
        $raw = $devices->begin($users->find($id), 'Mozilla/5.0 (iPhone) Safari', '2.2.2.2');
        $detail = $svc->get($id);
        assertSame('Safari / iOS', $detail['device']['label']);
        assertSame('2.2.2.2', $detail['device']['ip']);
        $svc->logoutDevice($admin, $id, $ip);
        assertTrue(!$devices->isCurrent($users->find($id), $raw), 'phải bị đăng xuất');
        assertSame(null, $svc->get($id)['device']);
    });

    test($name('gửi mã đặt lại mật khẩu: người dùng đang hoạt động nhận được; người bị khóa thì bị từ chối'), function () use ($S, $ip) {
        $svc = Container::get(AdminUserService::class);
        $admin = Container::get(AdminRepository::class)->find($S->adminId);
        $before = glob(BASE_PATH . '/storage/mail/*.txt') ?: [];
        $svc->sendReset($admin, $S->u['u1'], $ip);
        $mails = manageTakeMails($before);
        assertSame(1, count($mails), 'phải gửi đúng một thư');
        assertTrue(contains($mails[0], $S->tag . '_u1@test.local'), 'thư gửi đúng người');
        assertTrue(preg_match('/Mã đặt lại mật khẩu .* là: [0-9]{6}/u', $mails[0]) === 1, 'thư phải có mã OTP 6 số (giai đoạn 14)');
        $svc->update($admin, $S->u['u1'], ['status' => 'blocked'], $ip);
        assertThrows(function () use ($svc, $admin, $S, $ip) { $svc->sendReset($admin, $S->u['u1'], $ip); }, 'USER_BLOCKED');
        $svc->update($admin, $S->u['u1'], ['status' => 'active'], $ip);
    });

    test($name('key kích hoạt: tạo hàng loạt, định dạng, không trùng, chuẩn hóa khi nhập'), function () use ($S, $ip) {
        $keys = Container::get(LicenseKeyService::class);
        $admin = Container::get(AdminRepository::class)->find($S->adminId);
        $made = $keys->generate($admin, 12, 30, 'Lô ' . $S->tag, $ip);
        assertSame(12, count($made));
        $codes = array_column($made, 'code');
        assertSame(12, count(array_unique($codes)), 'key không được trùng');
        foreach ($made as $k) {
            assertTrue(preg_match('/^[A-HJKMNP-Z2-9]{4}(-[A-HJKMNP-Z2-9]{4}){3}$/', $k['code']) === 1, 'sai định dạng: ' . $k['code']);
            assertSame('unused', $k['status']);
            assertSame(30, $k['days']);
            assertSame($S->adminEmail, $k['created_by_email']);
        }
        $S->keys = $made;
        $c = $codes[0];
        assertSame($c, LicenseKeyService::normalize(strtolower(str_replace('-', ' ', $c))), 'chữ thường, dấu cách');
        assertSame($c, LicenseKeyService::normalize(str_replace('-', '', $c)), 'không có dấu gạch');
        assertSame($c, LicenseKeyService::normalize('  ' . $c . "\n"), 'khoảng trắng đầu/cuối');
        assertSame(null, LicenseKeyService::normalize('ABCD-EFGH'), 'quá ngắn');
        assertSame(null, LicenseKeyService::normalize('ABCD-EFGH-JKMN-PQRS-TUVW'), 'quá dài');
        assertSame(null, LicenseKeyService::normalize('ABCD-EFGH-JKMN-PQR!'), 'ký tự lạ');
        $one = $keys->generate($admin, 1, 90, '', $ip);
        $S->keyOne = $one[0];
    });

    test($name('người dùng nhập key: cộng ngày, nối tiếp, key dùng rồi/thu hồi/không có/sai định dạng bị từ chối'), function () use ($S, $ip) {
        $keys = Container::get(LicenseKeyService::class);
        $users = Container::get(UserRepository::class);
        $admin = Container::get(AdminRepository::class)->find($S->adminId);
        $user = $users->find($S->u['u1']);
        $k1 = $S->keys[0];
        $r = $keys->redeem($user, strtolower($k1['code']));
        assertSame(30, $r['days_added']);
        assertSame(null, $r['previous_expires_at']);
        $d = strtotime($r['expires_at']) - time();
        assertTrue($d > 29.9 * 86400 && $d < 30.1 * 86400, 'hạn mới = bây giờ + 30 ngày');
        assertSame($r['expires_at'], $users->find($S->u['u1'])['expires_at'], 'đã ghi vào tài khoản');

        $r2 = $keys->redeem($users->find($S->u['u1']), $S->keys[1]['code']);
        assertSame($r['expires_at'], $r2['previous_expires_at']);
        assertSame(strtotime($r['expires_at']) + 30 * 86400, strtotime($r2['expires_at']), 'key thứ hai nối tiếp hạn');

        assertThrows(function () use ($keys, $users, $S, $k1) { $keys->redeem($users->find($S->u['u2']), $k1['code']); }, 'KEY_USED');
        assertSame(null, $users->find($S->u['u2'])['expires_at'], 'key đã dùng không cộng cho người khác');
        assertThrows(function () use ($keys, $users, $S, $k1) { $keys->redeem($users->find($S->u['u1']), $k1['code']); }, 'KEY_USED', 'chính người đó nhập lại cũng không được');
        assertThrows(function () use ($keys, $users, $S) { $keys->redeem($users->find($S->u['u2']), 'ABCD-EFGH-JKMN-PQRS'); }, 'KEY_NOT_FOUND');
        assertThrows(function () use ($keys, $users, $S) { $keys->redeem($users->find($S->u['u2']), 'ngan'); }, 'VALIDATION_FAILED');

        $revoked = $keys->revoke($admin, $S->keys[2]['id'], $ip);
        assertSame('revoked', $revoked['status']);
        assertThrows(function () use ($keys, $users, $S) { $keys->redeem($users->find($S->u['u2']), $S->keys[2]['code']); }, 'KEY_REVOKED');
        assertThrows(function () use ($keys, $admin, $S, $ip) { $keys->revoke($admin, $S->keys[0]['id'], $ip); }, 'KEY_USED', 'key đã dùng không thu hồi được');
        assertSame('revoked', $keys->revoke($admin, $S->keys[2]['id'], $ip)['status'], 'thu hồi lần hai không lỗi');
    });

    test($name('hai người nhập cùng một key cùng lúc: chỉ một người được (tầng database)'), function () use ($S) {
        $repo = Container::get(LicenseKeyRepository::class);
        $key = $repo->findByCode($S->keys[3]['code']);
        $extend = function (?string $cur): string { return LicensePeriod::extend($cur, 30); };
        $first = $repo->redeem((int) $key['id'], $S->u['u2'], 'a@test.local', $extend);
        $second = $repo->redeem((int) $key['id'], $S->u['u3'], 'b@test.local', $extend);
        assertTrue($first !== null, 'người đầu tiên được');
        assertSame(null, $second, 'người thứ hai không được');
        $users = Container::get(UserRepository::class);
        assertSame(null, $users->find($S->u['u3'])['expires_at'], 'người thứ hai không được cộng ngày');
        assertSame($first['expires_at'], $users->find($S->u['u2'])['expires_at']);
        $after = $repo->find((int) $key['id']);
        assertSame('used', $after['status']);
        assertSame($S->u['u2'], (int) $after['used_by']);
        Container::get(UserRepository::class)->setExpiry($S->u['u2'], null);
    });

    test($name('danh sách key: lọc theo trạng thái và chữ, đếm, xóa key chưa dùng, không xóa key đã dùng'), function () use ($S, $ip) {
        $keys = Container::get(LicenseKeyService::class);
        $admin = Container::get(AdminRepository::class)->find($S->adminId);
        $all = $keys->search(['q' => $S->tag], 1, 50, 0);
        assertSame(12, $all['total'], 'tìm theo ghi chú của lô');
        $used = $keys->search(['q' => $S->tag, 'status' => 'used'], 1, 50, 0);
        assertSame(3, $used['total'], '3 key đã dùng (hai của u1, một của u2)');
        assertSame($S->tag . '_u1@test.local', $keys->search(['q' => $S->tag . '_u1', 'status' => 'used'], 1, 50, 0)['items'][0]['used_by_email']);
        assertSame(1, $keys->search(['q' => $S->tag, 'status' => 'revoked'], 1, 50, 0)['total']);
        $counts = $all['counts'];
        assertTrue($counts['used'] >= 3 && $counts['unused'] >= 8 && $counts['revoked'] >= 1, 'đếm theo trạng thái');
        assertSame(1, $keys->search(['q' => $S->keys[5]['code']], 1, 50, 0)['total'], 'tìm theo mã key');
        $page = $keys->search(['q' => $S->tag], 2, 5, 5);
        assertSame(5, count($page['items']));
        assertSame(12, $page['total']);

        $keys->delete($admin, $S->keys[5]['id'], $ip);
        assertSame(0, $keys->search(['q' => $S->keys[5]['code']], 1, 50, 0)['total'], 'key chưa dùng xóa được');
        $keys->delete($admin, $S->keys[2]['id'], $ip);
        assertThrows(function () use ($keys, $admin, $S, $ip) { $keys->delete($admin, $S->keys[0]['id'], $ip); }, 'KEY_USED');
        $repo = Container::get(LicenseKeyRepository::class);
        assertSame(false, $repo->softDeleteUnlessUsed($S->keys[0]['id'], App\Repositories\SoftDelete::byAdmin(['id' => 1, 'email' => 'a@x.vn'])), 'tầng database cũng không xóa key đã dùng');
        assertSame(false, $repo->revoke($S->keys[0]['id'], (int) $admin['id']), 'tầng database cũng không thu hồi key đã dùng');
        assertSame('used', $repo->find($S->keys[0]['id'])['status'], 'key đã dùng vẫn nguyên');
        assertThrows(function () use ($keys, $admin, $ip) { $keys->delete($admin, 99999999, $ip); }, 'NOT_FOUND');
    });

    test($name('chi tiết người dùng có playlist và key đã nhập'), function () use ($S) {
        $svc = Container::get(AdminUserService::class);
        $d = $svc->get($S->u['u1']);
        assertSame(2, count($d['playlists']));
        assertSame(2, $d['playlist_count']);
        assertSame(2, count($d['keys']));
        assertSame(30, $d['keys'][0]['days']);
        assertSame('valid', $d['license']);
        assertThrows(function () use ($svc) { $svc->get(99999999); }, 'NOT_FOUND');
    });

    test($name('playlist (quản trị): tìm theo tên, email chủ, người dùng; xem bài; xóa kèm nhật ký'), function () use ($S, $ip) {
        $svc = Container::get(AdminPlaylistService::class);
        $admin = Container::get(AdminRepository::class)->find($S->adminId);
        $r = $svc->search(['q' => $S->tag . '_u1'], 1, 20, 0);
        assertSame(2, $r['total'], 'tìm theo email chủ');
        assertSame($S->tag . '_u1@test.local', $r['items'][0]['user_email']);
        assertSame(1, $svc->search(['q' => 'Của Bình'], 1, 20, 0)['total']);
        assertSame(1, $svc->search(['user_id' => $S->u['u2']], 1, 20, 0)['total']);
        assertTrue($svc->search(['q' => '%%'], 1, 20, 0)['total'] < $svc->search([], 1, 20, 0)['total'], 'ký tự đại diện không có tác dụng');
        $g = $svc->get($S->p1);
        assertSame(2, count($g['items']));
        assertSame('Bài một', $g['items'][0]['title']);
        assertSame($S->tag . '_u1@test.local', $g['user_email']);
        $svc->delete($admin, $S->p1, $ip);
        assertThrows(function () use ($svc, $S) { $svc->get($S->p1); }, 'NOT_FOUND');
        $db = Container::get(Database::class);
        assertSame(0, (int) $db->value('SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ? AND deleted_at IS NULL', [$S->p1]), 'bài của playlist phải bị xóa theo');
        assertSame(2, (int) $db->value('SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ?', [$S->p1]), 'không dùng DELETE: các bài vẫn còn, chỉ bị đánh dấu');
        $row = $db->one('SELECT * FROM playlists WHERE id = ?', [$S->p1]);
        assertTrue($row['deleted_at'] !== null && $row['deleted_by_type'] === 'admin' && (int) $row['deleted_by_id'] === (int) $admin['id'] && $row['deleted_by_email'] === $admin['email'], 'ghi người xóa và thời điểm');
        $del = $svc->search(['q' => $S->tag . '_u1', 'deleted' => '1'], 1, 20, 0);
        assertSame(1, $del['total'], 'bộ lọc Đã xóa');
        assertSame(2, $del['items'][0]['count'] ?? $del['items'][0]['item_count'] ?? null, 'playlist đã xóa vẫn hiện số bài lúc xóa');
        assertSame($admin['email'], $del['items'][0]['deleted']['by_email']);
        assertThrows(function () use ($svc, $admin, $S, $ip) { $svc->delete($admin, $S->p1, $ip); }, 'NOT_FOUND');
    });

    test($name('xóa người dùng: đánh dấu cả tài khoản, playlist, bài; vô hiệu token; giữ lại key đã nhập; email đăng ký lại được; có nhật ký'), function () use ($S, $ip) {
        $svc = Container::get(AdminUserService::class);
        $db = Container::get(Database::class);
        $admin = Container::get(AdminRepository::class)->find($S->adminId);
        $id = $S->u['u1'];
        Container::get(PasswordResetRepository::class)->create('user', $id, hash('sha256', 'xoa-' . $S->tag), date('Y-m-d H:i:s', time() + 600));
        $svc->delete($admin, $id, $ip);
        assertSame(null, Container::get(UserRepository::class)->find($id));
        assertSame(0, (int) $db->value('SELECT COUNT(*) FROM playlists WHERE user_id = ? AND deleted_at IS NULL', [$id]));
        assertSame(0, (int) $db->value('SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ? AND deleted_at IS NULL', [$S->p2]), 'bài của playlist còn lại cũng bị đánh dấu xóa');
        assertTrue((int) $db->value('SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ?', [$S->p2]) > 0, 'không dùng DELETE: bài vẫn còn trong database');
        assertSame(0, (int) $db->value("SELECT COUNT(*) FROM password_resets WHERE account_type = 'user' AND account_id = ? AND used_at IS NULL", [$id]), 'token hết hiệu lực');
        $row = $db->one('SELECT * FROM users WHERE id = ?', [$id]);
        assertTrue($row !== null && $row['deleted_at'] !== null && $row['alive'] === null && $row['session_token'] === null, 'tài khoản còn trong database, được đánh dấu xóa và đăng xuất');
        assertSame((int) $admin['id'], (int) $row['deleted_by_id']);
        assertSame(1, Container::get(AdminUserService::class)->search(['q' => $row['email'], 'deleted' => '1'], 1, 20, 0)['total'], 'bộ lọc Đã xóa');
        assertSame(0, Container::get(AdminUserService::class)->search(['q' => $row['email']], 1, 20, 0)['total'], 'danh sách thường không hiện người đã xóa');
        $again = Container::get(UserRepository::class)->create($row['email'], 'Đăng ký lại', str_repeat('a', 32), str_repeat('b', 16));
        assertTrue($again !== $id, 'email của tài khoản đã xóa đăng ký lại được');
        Container::get(UserRepository::class)->softDeleteWithData($again, App\Repositories\SoftDelete::byAdmin($admin));
        assertSame(2, (int) $db->value('SELECT COUNT(*) FROM license_keys WHERE used_by = ?', [$id]), 'key đã nhập được giữ làm lịch sử');
        assertSame(1, (int) $db->value('SELECT COUNT(*) FROM playlists WHERE user_id = ?', [$S->u['u2']]), 'không đụng tới dữ liệu người khác');
        assertSame(1, (int) $db->value('SELECT COUNT(*) FROM audit_log WHERE action = ? AND target_id = ?', ['user.delete', (string) $id]));
        assertThrows(function () use ($svc, $admin, $id, $ip) { $svc->delete($admin, $id, $ip); }, 'NOT_FOUND');
    });

    test($name('tổng quan: số liệu khớp truy vấn trực tiếp; chỉ master có thao tác gần đây'), function () use ($S) {
        $stats = Container::get(AdminStatsService::class);
        $db = Container::get(Database::class);
        $m = $stats->overview(true);
        $a = $stats->overview(false);
        assertSame((int) $db->value('SELECT COUNT(*) FROM users WHERE deleted_at IS NULL'), $m['users']['total']);
        assertSame((int) $db->value("SELECT COUNT(*) FROM users WHERE status = 'blocked' AND deleted_at IS NULL"), $m['users']['blocked']);
        assertSame($m['users']['total'], $m['users']['license_valid'] + $m['users']['license_expired'] + $m['users']['license_none'], 'ba nhóm hạn dùng cộng lại bằng tổng');
        assertSame((int) $db->value('SELECT COUNT(*) FROM playlists WHERE deleted_at IS NULL'), $m['playlists']['playlists']);
        assertSame((int) $db->value("SELECT COUNT(*) FROM license_keys WHERE status = 'unused' AND deleted_at IS NULL"), $m['keys']['unused']);
        assertSame((int) $db->value('SELECT COUNT(*) FROM admins WHERE deleted_at IS NULL'), $m['admins']['total']);
        assertTrue(is_array($m['recent']) && count($m['recent']) <= 8 && count($m['recent']) > 0, 'master thấy thao tác gần đây');
        assertSame(null, $a['recent'], 'admin thường không có');
        assertTrue($m['users']['new_7d'] >= 2, 'người dùng thử mới tạo phải được tính là mới');
    });

    test($name('xem nhật ký: lọc theo hành động, chữ, ngày; phân trang; liệt kê hành động; không lộ mật khẩu'), function () use ($S) {
        $svc = Container::get(AuditViewService::class);
        $all = $svc->search(['q' => $S->tag], 1, 100, 0);
        $actions = array_column($all['items'], 'action');
        foreach (['user.update', 'user.extend', 'user.password_set', 'user.reset_sent', 'user.logout_device', 'user.delete', 'key.create', 'key.revoke', 'key.delete', 'playlist.delete'] as $a) {
            assertTrue(in_array($a, $actions, true), 'thiếu dòng nhật ký ' . $a);
        }
        assertTrue(in_array('key.create', $all['actions'], true), 'danh sách hành động để lọc');
        $only = $svc->search(['q' => $S->tag, 'action' => 'user.update'], 1, 100, 0);
        assertTrue($only['total'] > 0 && count(array_unique(array_column($only['items'], 'action'))) === 1, 'lọc theo hành động');
        $today = date('Y-m-d');
        assertTrue($svc->search(['q' => $S->tag, 'from' => $today, 'to' => $today], 1, 100, 0)['total'] > 0, 'lọc theo ngày hôm nay');
        assertSame(0, $svc->search(['q' => $S->tag, 'from' => '2001-01-01', 'to' => '2001-01-02'], 1, 100, 0)['total'], 'ngày xa trong quá khứ không có dòng nào');
        $p1 = $svc->search(['q' => $S->tag], 1, 5, 0);
        $p2 = $svc->search(['q' => $S->tag], 2, 5, 5);
        assertSame(5, count($p1['items']));
        assertTrue($p1['items'][4]['id'] > $p2['items'][0]['id'], 'mới nhất đứng đầu, trang sau cũ hơn');
        $blob = (string) json_encode($all, JSON_UNESCAPED_UNICODE);
        foreach ([$S->pw, 'MatKhau-Moi-9'] as $secret) {
            assertTrue(strpos($blob, $secret) === false, 'nhật ký lộ mật khẩu');
        }
        foreach ($S->keys as $k) {
            assertTrue(strpos($blob, $k['code']) === false, 'nhật ký lộ mã key');
        }
        assertTrue(strpos($blob, $S->keyOne['code']) === false, 'nhật ký lộ mã key');
    });

    test($name('API quản trị: quyền truy cập, kiểm tra dữ liệu, thao tác qua HTTP giả lập'), function () use ($S, $call, $code, $data) {
        $ip9 = '9.9.9.9';
        // chưa đăng nhập
        foreach (['/stats', '/users', '/users/1', '/keys', '/playlists', '/playlists/1', '/audit'] as $path) {
            assertSame('UNAUTHORIZED', $code($call('admin', 'anon', 'GET', $path)), 'chưa đăng nhập phải bị chặn: ' . $path);
        }
        // admin đang dùng mật khẩu tạm: bị chặn
        $call('admin', 'T', 'POST', '/auth/login', ['email' => $S->tempEmail, 'password' => $S->pw]);
        foreach (['/stats', '/users', '/keys', '/playlists'] as $path) {
            assertSame('PASSWORD_CHANGE_REQUIRED', $code($call('admin', 'T', 'GET', $path)), 'mật khẩu tạm phải bị chặn: ' . $path);
        }
        // admin thường
        $r = $call('admin', 'A', 'POST', '/auth/login', ['email' => $S->adminEmail, 'password' => $S->pw]);
        assertSame(200, $r->status);
        assertSame(200, $call('admin', 'A', 'GET', '/stats')->status);
        assertSame('FORBIDDEN', $code($call('admin', 'A', 'GET', '/audit')), 'nhật ký chỉ master xem');
        assertSame(null, $data($call('admin', 'A', 'GET', '/stats'))['recent']);
        // danh sách + lọc
        $r = $call('admin', 'A', 'GET', '/users', [], true, ['q' => $S->tag . '_u', 'per_page' => '2', 'page' => '1']);
        assertSame(200, $r->status);
        assertSame(2, $data($r)['per_page']);
        assertSame(2, count($data($r)['items']));
        assertSame('VALIDATION_FAILED', $code($call('admin', 'A', 'GET', '/users', [], true, ['status' => 'zzz'])));
        assertSame('VALIDATION_FAILED', $code($call('admin', 'A', 'GET', '/users', [], true, ['license' => 'zzz'])));
        assertSame('VALIDATION_FAILED', $code($call('admin', 'A', 'GET', '/keys', [], true, ['status' => 'zzz'])));
        $big = $call('admin', 'A', 'GET', '/users', [], true, ['per_page' => '99999']);
        assertSame(100, $data($big)['per_page'], 'mỗi trang tối đa 100');
        $blob = (string) json_encode($r->payload);
        foreach (['password_hash', 'salt', 'session_token'] as $secret) {
            assertTrue(strpos($blob, '"' . $secret . '"') === false, 'API lộ ' . $secret);
        }
        // id sai
        assertSame('NOT_FOUND', $code($call('admin', 'A', 'GET', '/users/abc')));
        assertSame('NOT_FOUND', $code($call('admin', 'A', 'GET', '/users/0')));
        assertSame('NOT_FOUND', $code($call('admin', 'A', 'GET', '/users/99999999')));
        assertSame('NOT_FOUND', $code($call('admin', 'A', 'DELETE', '/playlists/99999999')));
        // sửa người dùng
        $uid = $S->u['u3'];
        assertSame('CSRF_INVALID', $code($call('admin', 'A', 'PATCH', '/users/' . $uid, ['name' => 'x'], false)));
        assertSame('VALIDATION_FAILED', $code($call('admin', 'A', 'PATCH', '/users/' . $uid, [])));
        assertSame('VALIDATION_FAILED', $code($call('admin', 'A', 'PATCH', '/users/' . $uid, ['status' => 'zzz'])));
        assertSame('VALIDATION_FAILED', $code($call('admin', 'A', 'PATCH', '/users/' . $uid, ['email' => 'khong-phai'])));
        $r = $call('admin', 'A', 'PATCH', '/users/' . $uid, ['expires_at' => '2031-05-06']);
        assertSame('2031-05-06 23:59:59', $data($r)['expires_at']);
        assertSame('VALIDATION_FAILED', $code($call('admin', 'A', 'PATCH', '/users/' . $uid, ['expires_at' => '2031-02-31'])));
        $r = $call('admin', 'A', 'PATCH', '/users/' . $uid, ['expires_at' => '']);
        assertSame(null, $data($r)['expires_at'], 'chuỗi rỗng = xóa hạn');
        assertSame('EMAIL_TAKEN', $code($call('admin', 'A', 'PATCH', '/users/' . $uid, ['email' => $S->tag . '_u2b@test.local'])));
        // gia hạn
        foreach ([0, -1, 3651, 'abc', 1.5, null] as $bad) {
            assertSame('VALIDATION_FAILED', $code($call('admin', 'A', 'POST', '/users/' . $uid . '/extend', ['days' => $bad])), 'days không hợp lệ: ' . var_export($bad, true));
        }
        assertSame('valid', $data($call('admin', 'A', 'POST', '/users/' . $uid . '/extend', ['days' => 7]))['license']);
        $call('admin', 'A', 'PATCH', '/users/' . $uid, ['expires_at' => null]);
        // mật khẩu
        assertSame('VALIDATION_FAILED', $code($call('admin', 'A', 'POST', '/users/' . $uid . '/password', ['password' => '123'])));
        assertSame(200, $call('admin', 'A', 'POST', '/users/' . $uid . '/password', ['password' => 'MatKhau-Moi-10'])->status);
        $S->u3pw = 'MatKhau-Moi-10';
        assertSame(200, $call('admin', 'A', 'POST', '/users/' . $uid . '/logout-device')->status);
        // key qua API
        assertSame('VALIDATION_FAILED', $code($call('admin', 'A', 'POST', '/keys', ['count' => 0, 'days' => 30])));
        assertSame('VALIDATION_FAILED', $code($call('admin', 'A', 'POST', '/keys', ['count' => 101, 'days' => 30])));
        assertSame('VALIDATION_FAILED', $code($call('admin', 'A', 'POST', '/keys', ['count' => 1, 'days' => 0])));
        assertSame('VALIDATION_FAILED', $code($call('admin', 'A', 'POST', '/keys', ['count' => 'abc', 'days' => 30])));
        $r = $call('admin', 'A', 'POST', '/keys', ['count' => '3', 'days' => '15', 'note' => 'API ' . $S->tag]);
        assertSame(201, $r->status);
        assertSame(3, count($data($r)['items']));
        $S->apiKeys = $data($r)['items'];
        $r = $call('admin', 'A', 'POST', '/keys/' . $S->apiKeys[0]['id'] . '/revoke');
        assertSame('revoked', $data($r)['status']);
        assertSame(200, $call('admin', 'A', 'DELETE', '/keys/' . $S->apiKeys[0]['id'])->status);
        assertSame('NOT_FOUND', $code($call('admin', 'A', 'DELETE', '/keys/' . $S->apiKeys[0]['id'])));
        // playlist qua API
        $r = $call('admin', 'A', 'GET', '/playlists', [], true, ['q' => 'Của Bình']);
        assertSame(1, $data($r)['total']);
        $pid = $data($r)['items'][0]['id'];
        assertSame(1, count($data($call('admin', 'A', 'GET', '/playlists/' . $pid))['items']));
        // master
        $r = $call('admin', 'M', 'POST', '/auth/login', ['email' => $S->masterEmail, 'password' => $S->pw]);
        assertSame(200, $r->status);
        $r = $call('admin', 'M', 'GET', '/audit', [], true, ['q' => $S->tag, 'per_page' => '5']);
        assertSame(200, $r->status);
        assertSame(5, count($data($r)['items']));
        assertTrue(count($data($r)['actions']) > 0);
        assertSame('VALIDATION_FAILED', $code($call('admin', 'M', 'GET', '/audit', [], true, ['from' => '31/12/2026'])));
        assertTrue(is_array($data($call('admin', 'M', 'GET', '/stats'))['recent']), 'master thấy thao tác gần đây');
    });

    test($name('API người dùng: nhập key cần đăng nhập, kiểm tra dữ liệu, cộng ngày và trả quyền dùng'), function () use ($S, $call, $code, $data) {
        $email = $S->tag . '_u3@test.local';
        assertSame('UNAUTHORIZED', $code($call('user', 'anonU', 'POST', '/user/license/redeem', ['code' => 'ABCD-EFGH-JKMN-PQRS'])));
        $r = $call('user', 'U3', 'POST', '/auth/login', ['email' => $email, 'password' => $S->u3pw]);
        assertSame(200, $r->status, 'đăng nhập người dùng thử: ' . json_encode($r->payload));
        assertSame('VALIDATION_FAILED', $code($call('user', 'U3', 'POST', '/user/license/redeem', [])));
        assertSame('VALIDATION_FAILED', $code($call('user', 'U3', 'POST', '/user/license/redeem', ['code' => 'abc'])));
        assertSame('KEY_NOT_FOUND', $code($call('user', 'U3', 'POST', '/user/license/redeem', ['code' => 'ABCD-EFGH-JKMN-PQRS'])));
        assertSame('CSRF_INVALID', $code($call('user', 'U3', 'POST', '/user/license/redeem', ['code' => $S->keyOne['code']], false)));
        $r = $call('user', 'U3', 'POST', '/user/license/redeem', ['code' => strtolower($S->keyOne['code'])]);
        assertSame(200, $r->status, json_encode($r->payload));
        $d = $data($r);
        assertSame(90, $d['days_added']);
        assertSame('member', $d['plan']);
        assertTrue(in_array('playlists_cloud', $d['features'], true));
        assertTrue($d['user']['expires_at'] !== null && $d['expires_at'] === $d['user']['expires_at']);
        $blob = (string) json_encode($r->payload);
        foreach (['password_hash', 'salt', 'session_token'] as $secret) {
            assertTrue(strpos($blob, '"' . $secret . '"') === false, 'API lộ ' . $secret);
        }
        assertSame('KEY_USED', $code($call('user', 'U3', 'POST', '/user/license/redeem', ['code' => $S->keyOne['code']])));
        // /auth/me phản ánh hạn mới
        $me = $data($call('user', 'U3', 'GET', '/auth/me'));
        assertSame($d['expires_at'], $me['user']['expires_at']);
        // key đã thu hồi
        $revoked = $S->apiKeys[1];
        $call('admin', 'M', 'POST', '/keys/' . $revoked['id'] . '/revoke');
        assertSame('KEY_REVOKED', $code($call('user', 'U3', 'POST', '/user/license/redeem', ['code' => $revoked['code']])));
        // người dùng bị khóa không nhập được key
        $call('admin', 'M', 'PATCH', '/users/' . $S->u['u3'], ['status' => 'blocked']);
        assertSame('UNAUTHORIZED', $code($call('user', 'U3', 'POST', '/user/license/redeem', ['code' => $S->apiKeys[2]['code']])));
        $call('admin', 'M', 'PATCH', '/users/' . $S->u['u3'], ['status' => 'active']);
    });

    test($name('khi bật ENFORCE_LICENSE: người chưa có key chỉ như khách, nhập key xong dùng đủ tính năng'), function () use ($S) {
        $ent = Container::get(App\Services\EntitlementService::class);
        $users = Container::get(UserRepository::class);
        $saved = Config::get('app', []);
        Config::override('app', array_merge($saved, ['enforce_license' => true]));
        try {
            $u = $users->find($S->u['u2']);
            assertSame('trial', $ent->forUser($u)['plan'], 'chưa có hạn: chỉ như khách');
            assertTrue(!$ent->can($u, 'playlists_cloud'));
            $keys = Container::get(LicenseKeyService::class);
            $admin = Container::get(AdminRepository::class)->find($S->adminId);
            $k = $keys->generate($admin, 1, 10, 'enforce ' . $S->tag, '1.1.1.1')[0];
            $res = $keys->redeem($u, $k['code']);
            assertSame('member', $ent->forUser($res['user'])['plan']);
            assertTrue($ent->can($res['user'], 'playlists_cloud'));
        } finally {
            Config::override('app', $saved);
        }
    });

    test($name('dọn dữ liệu thử'), function () use ($S, $cleanup) {
        $cleanup($S->tag);
        Config::override('mail', $S->saved['mail']);
        Config::override('app', $S->saved['app']);
        Container::reset();
        $S->sessions = [];
    });
}
