<?php
declare(strict_types=1);

// Giai đoạn 15 (đợt 2): API ghép nối chiếu màn hình điện thoại lên màn hình xe (mã 6 số, khóa riêng từng máy, tin kết nối).

use App\Core\Config;
use App\Core\Container;
use App\Core\Database;
use App\Core\ErrorHandler;
use App\Core\Request;
use App\Core\Router;
use App\Middleware\Csrf;
use App\Services\CastService;
use App\Services\RateLimiter;

if (adminSqliteDatabase() === null) {
    test('Chiếu màn hình (SQLite): BỎ QUA - PHP này chưa bật pdo_sqlite', function () {
    });
    return;
}

function ctBoot(array $cast = []): stdClass
{
    $S = new stdClass();
    $S->saved = Config::get('cast', []);
    Container::reset();
    Config::override('cast', $cast + ['enabled' => true, 'code_ttl_seconds' => 300, 'session_hours' => 12, 'stun_urls' => ['stun:stun.test:3478']]);
    $S->db = adminSqliteDatabase();
    Container::set(Database::class, $S->db);
    $dir = sys_get_temp_dir() . '/carweb-ct-' . bin2hex(random_bytes(4));
    @mkdir($dir, 0700, true);
    Container::set(RateLimiter::class, new RateLimiter($dir, null, true));
    return $S;
}

function ctDone(stdClass $S): void
{
    Config::override('cast', $S->saved);
    Container::reset();
}

/** Gọi API như trình duyệt (có CSRF). $token: khóa X-Cast-Token. */
function ctCall(string $method, string $path, array $body = [], string $token = '', array $query = [], string $ip = '7.7.7.7', bool $csrf = true)
{
    $_SESSION = ['csrf' => 'csrf-thu'];
    $router = new Router();
    $router->setGlobalMiddleware([Csrf::class]);
    (require BASE_PATH . '/routes/api.php')($router);
    $headers = ['user-agent' => 'Thử'];
    if ($csrf) {
        $headers['x-csrf-token'] = 'csrf-thu';
    }
    if ($token !== '') {
        $headers['x-cast-token'] = $token;
    }
    try {
        return @$router->dispatch(new Request($method, $path, $query, $body, $headers, $ip));
    } catch (Throwable $e) {
        return ErrorHandler::toResponse($e);
    }
}

function ctData($res): array
{
    return $res->payload['data'] ?? [];
}

function ctErr($res): string
{
    return (string) ($res->payload['error']['code'] ?? '');
}

test('Chiếu màn hình: màn hình xe lấy mã, điện thoại nhập mã, mã chỉ dùng một lần', function () {
    $S = ctBoot();
    try {
        $res = ctCall('POST', '/cast/sessions');
        assertSame(201, $res->status);
        $car = ctData($res);
        assertTrue(preg_match('/^[0-9]{6}$/', $car['code']) === 1, 'mã 6 số');
        assertTrue(preg_match('/^[a-f0-9]{48}$/', $car['token']) === 1);
        assertSame('receiver', $car['role']);
        assertSame(300, $car['expires_in']);
        assertSame([['urls' => ['stun:stun.test:3478']]], $car['ice_servers']);
        $row = $S->db->one('SELECT * FROM cast_sessions WHERE id = ?', [$car['id']]);
        assertSame('waiting', $row['status']);
        assertSame(hash('sha256', $car['token']), $row['receiver_hash'], 'chỉ lưu bản băm của khóa');
        assertSame('7.7.7.7', $row['created_ip']);

        $wait = ctData(ctCall('GET', '/cast/sessions/' . $car['id'] . '/signals', [], $car['token']));
        assertSame('waiting', $wait['status']);
        assertSame([], $wait['signals']);
        assertTrue($wait['code_expires_in'] > 290 && $wait['code_expires_in'] <= 300);

        assertSame('CAST_CODE_INVALID', ctErr(ctCall('POST', '/cast/join', ['code' => '12'])));
        $wrong = $car['code'] === '000000' ? '111111' : '000000';
        $bad = ctCall('POST', '/cast/join', ['code' => $wrong]);
        assertSame(404, $bad->status);
        assertSame('CAST_CODE_INVALID', ctErr($bad));

        // gõ có dấu cách vẫn nhận
        $res = ctCall('POST', '/cast/join', ['code' => substr($car['code'], 0, 3) . ' ' . substr($car['code'], 3), 'device_name' => '  Pixel 7 ' . str_repeat('x', 100)], '', [], '8.8.8.8');
        assertSame(200, $res->status);
        $phone = ctData($res);
        assertSame($car['id'], $phone['id']);
        assertSame('sender', $phone['role']);
        assertTrue($phone['token'] !== $car['token']);
        $row = $S->db->one('SELECT * FROM cast_sessions WHERE id = ?', [$car['id']]);
        assertSame('paired', $row['status']);
        assertSame('8.8.8.8', $row['joined_ip']);
        assertTrue(strpos($row['device_name'], 'Pixel 7') === 0 && mb_strlen($row['device_name']) <= 60, 'tên máy được cắt gọn');

        assertSame('CAST_CODE_INVALID', ctErr(ctCall('POST', '/cast/join', ['code' => $car['code']])), 'mã đã dùng');
        $seen = ctData(ctCall('GET', '/cast/sessions/' . $car['id'] . '/signals', [], $car['token']));
        assertSame('paired', $seen['status']);
        assertTrue(strpos($seen['device_name'], 'Pixel 7') === 0);
    } finally {
        ctDone($S);
    }
});

test('Chiếu màn hình: hai máy trao đổi tin kết nối, mỗi máy chỉ nhận tin của máy kia; khóa sai bị từ chối', function () {
    $S = ctBoot();
    try {
        $car = ctData(ctCall('POST', '/cast/sessions'));
        $base = '/cast/sessions/' . $car['id'];
        assertSame('CAST_NOT_PAIRED', ctErr(ctCall('POST', $base . '/signals', ['kind' => 'answer', 'payload' => ['sdp' => 'x']], $car['token'])));
        $phone = ctData(ctCall('POST', '/cast/join', ['code' => $car['code'], 'device_name' => 'Máy thử']));

        $r = ctCall('POST', $base . '/signals', ['kind' => 'offer', 'payload' => ['type' => 'offer', 'sdp' => "v=0\r\n", 'gen' => 1]], $phone['token']);
        assertSame(201, $r->status);
        $offerId = ctData($r)['id'];
        ctCall('POST', $base . '/signals', ['kind' => 'ice', 'payload' => ['candidate' => 'candidate:1 1 udp 1 192.168.43.1 5000 typ host', 'sdpMid' => '0']], $phone['token']);

        $got = ctData(ctCall('GET', $base . '/signals', [], $car['token']));
        assertSame(['offer', 'ice'], array_column($got['signals'], 'kind'));
        assertSame("v=0\r\n", $got['signals'][0]['payload']['sdp']);
        assertSame(1, $got['signals'][0]['payload']['gen']);
        assertSame([], ctData(ctCall('GET', $base . '/signals', [], $phone['token']))['signals'], 'không nhận lại tin của chính mình');

        ctCall('POST', $base . '/signals', ['kind' => 'answer', 'payload' => ['type' => 'answer', 'sdp' => 'a']], $car['token']);
        $back = ctData(ctCall('GET', $base . '/signals', [], $phone['token']));
        assertSame(['answer'], array_column($back['signals'], 'kind'));
        $after = ctData(ctCall('GET', $base . '/signals', [], $car['token'], ['after' => (string) $offerId]));
        assertSame(['ice'], array_column($after['signals'], 'kind'), 'tham số after');

        // tin không hợp lệ
        assertSame(422, ctCall('POST', $base . '/signals', ['kind' => 'hack', 'payload' => []], $car['token'])->status);
        assertSame(422, ctCall('POST', $base . '/signals', ['kind' => 'ice', 'payload' => 'chuỗi'], $car['token'])->status);
        assertSame(422, ctCall('POST', $base . '/signals', ['kind' => 'ice', 'payload' => ['x' => str_repeat('a', CastService::MAX_PAYLOAD)]], $car['token'])->status);

        // khóa sai / thiếu / phiên khác / thiếu CSRF
        assertSame(404, ctCall('GET', $base . '/signals', [], str_repeat('a', 48))->status);
        assertSame(404, ctCall('GET', $base . '/signals')->status);
        assertSame(404, ctCall('GET', '/cast/sessions/999999/signals', [], $car['token'])->status);
        assertSame(404, ctCall('POST', $base . '/end', [], str_repeat('b', 48))->status);
        assertSame(403, ctCall('POST', $base . '/signals', ['kind' => 'ice', 'payload' => []], $car['token'], [], '7.7.7.7', false)->status);
        $other = ctData(ctCall('POST', '/cast/sessions'));
        assertSame(404, ctCall('GET', $base . '/signals', [], $other['token'])->status, 'khóa của phiên khác');
    } finally {
        ctDone($S);
    }
});

test('Chiếu màn hình: dừng chiếu không xóa dòng nào, chỉ đánh dấu và xóa trắng nội dung tin; máy kia được báo đã kết thúc', function () {
    $S = ctBoot();
    try {
        $car = ctData(ctCall('POST', '/cast/sessions'));
        $base = '/cast/sessions/' . $car['id'];
        $phone = ctData(ctCall('POST', '/cast/join', ['code' => $car['code']]));
        ctCall('POST', $base . '/signals', ['kind' => 'offer', 'payload' => ['sdp' => 'bí mật mạng nội bộ']], $phone['token']);

        $r = ctCall('POST', $base . '/end', [], $phone['token']);
        assertSame(200, $r->status);
        $row = $S->db->one('SELECT * FROM cast_sessions WHERE id = ?', [$car['id']]);
        assertSame('ended', $row['status']);
        assertSame('sender', $row['ended_by']);
        assertTrue($row['ended_at'] !== null);
        assertSame(1, (int) $S->db->value('SELECT COUNT(*) FROM cast_signals WHERE session_id = ?', [$car['id']]), 'dòng tin vẫn còn');
        assertSame('', $S->db->value('SELECT payload FROM cast_signals WHERE session_id = ?', [$car['id']]), 'nội dung đã xóa trắng');

        $gone = ctCall('GET', $base . '/signals', [], $car['token']);
        assertSame(410, $gone->status);
        assertSame('CAST_ENDED', ctErr($gone));
        assertSame('sender', $gone->payload['error']['details']['ended_by']);
        assertSame(410, ctCall('POST', $base . '/signals', ['kind' => 'ice', 'payload' => []], $car['token'])->status);
        assertSame(200, ctCall('POST', $base . '/end', [], $car['token'])->status, 'dừng lần nữa vẫn êm');
        assertSame('sender', $S->db->value('SELECT ended_by FROM cast_sessions WHERE id = ?', [$car['id']]), 'không ghi đè người kết thúc');
    } finally {
        ctDone($S);
    }
});

test('Chiếu màn hình: mã hết hạn, phiên quá hạn, tắt chức năng, giới hạn số lần nhập mã', function () {
    $S = ctBoot();
    try {
        // mã hết hạn
        $car = ctData(ctCall('POST', '/cast/sessions'));
        $S->db->execute('UPDATE cast_sessions SET code_expires_at = ? WHERE id = ?', [date('Y-m-d H:i:s', time() - 5), $car['id']]);
        assertSame('CAST_CODE_INVALID', ctErr(ctCall('POST', '/cast/join', ['code' => $car['code']], '', [], '1.1.1.1')));
        $gone = ctCall('GET', '/cast/sessions/' . $car['id'] . '/signals', [], $car['token']);
        assertSame('CAST_ENDED', ctErr($gone));
        assertSame('expired', $gone->payload['error']['details']['ended_by']);
        assertSame('expired', $S->db->value('SELECT ended_by FROM cast_sessions WHERE id = ?', [$car['id']]));

        // phiên đã ghép nối nhưng quá 12 giờ
        $car2 = ctData(ctCall('POST', '/cast/sessions'));
        $phone2 = ctData(ctCall('POST', '/cast/join', ['code' => $car2['code']], '', [], '1.1.1.2'));
        $S->db->execute('UPDATE cast_sessions SET expires_at = ? WHERE id = ?', [date('Y-m-d H:i:s', time() - 5), $car2['id']]);
        assertSame(410, ctCall('GET', '/cast/sessions/' . $car2['id'] . '/signals', [], $phone2['token'])->status);

        // mã đang chờ không bị cấp trùng
        $codes = [];
        for ($i = 0; $i < 5; $i++) {
            $codes[] = ctData(ctCall('POST', '/cast/sessions', [], '', [], '2.2.2.' . $i))['code'];
        }
        assertSame(5, count(array_unique($codes)));

        // dò mã: quá 12 lần trong 10 phút thì bị chặn
        $last = null;
        for ($i = 0; $i < 13; $i++) {
            $last = ctCall('POST', '/cast/join', ['code' => '999999'], '', [], '3.3.3.3');
        }
        assertSame(429, $last->status);
        assertSame(404, ctCall('POST', '/cast/join', ['code' => '999999'], '', [], '3.3.3.4')->status, 'máy khác không bị ảnh hưởng');

        // tắt chức năng
        Config::override('cast', ['enabled' => false]);
        $off = ctCall('POST', '/cast/sessions', [], '', [], '4.4.4.4');
        assertSame(503, $off->status);
        assertSame('CAST_DISABLED', ctErr($off));
        assertSame('CAST_DISABLED', ctErr(ctCall('POST', '/cast/join', ['code' => '123456'], '', [], '4.4.4.5')));
    } finally {
        ctDone($S);
    }
});

test('Chiếu màn hình: không có lệnh DELETE trong mã ghép nối', function () {
    foreach (['app/Repositories/CastRepository.php', 'app/Services/CastService.php', 'app/Controllers/CastController.php'] as $f) {
        $src = (string) file_get_contents(BASE_PATH . '/' . $f);
        assertTrue(preg_match('/\b(DELETE\s+FROM|TRUNCATE|REPLACE\s+INTO)\b/i', $src) === 0, $f);
    }
});
