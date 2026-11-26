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

// ---------- Giai đoạn 17 (đợt 2): ghép đôi một lần, "Chia sẻ" một chạm, "Quên thiết bị" ----------

/** Gọi API ghép đôi với khóa thiết bị trong header X-Cast-Device. */
function ctDev(string $method, string $path, string $device, array $body = [], string $ip = '7.7.7.7')
{
    $_SESSION = ['csrf' => 'csrf-thu'];
    $router = new Router();
    $router->setGlobalMiddleware([Csrf::class]);
    (require BASE_PATH . '/routes/api.php')($router);
    $headers = ['user-agent' => 'Thử', 'x-csrf-token' => 'csrf-thu'];
    if ($device !== '') {
        $headers['x-cast-device'] = $device;
    }
    try {
        return @$router->dispatch(new Request($method, $path, [], $body, $headers, $ip));
    } catch (Throwable $e) {
        return ErrorHandler::toResponse($e);
    }
}

/** Ghép đôi xe (khóa $car) với điện thoại (khóa $phone) bằng mã; trả về [phiên xe, kết quả nhập mã]. */
function ctPairUp(string $car, string $phone, string $carName = 'TS10', string $phoneName = 'SM-A546E', string $ip = '7.7.7.7'): array
{
    $s = ctData(ctCall('POST', '/cast/sessions', ['device_key' => $car, 'device_name' => $carName], '', [], $ip));
    $j = ctData(ctCall('POST', '/cast/join', ['code' => $s['code'], 'device_name' => $phoneName, 'device_key' => $phone], '', [], $ip));
    return [$s, $j];
}

test('Ghép đôi: lần đầu nhập mã kèm khóa thiết bị thì hai máy thành một cặp; máy dùng chính khóa thiết bị cho phiên', function () {
    $S = ctBoot();
    try {
        $car = str_repeat('c1', 24);
        $phone = str_repeat('d2', 24);
        $s = ctData(ctCall('POST', '/cast/sessions', ['device_key' => $car, 'device_name' => 'TS10']));
        assertTrue(!isset($s['token']), 'có khóa thiết bị thì máy chủ không cấp khóa mới');
        $row = $S->db->one('SELECT * FROM cast_sessions WHERE id = ?', [$s['id']]);
        assertSame(CastService::hash($car), $row['receiver_hash']);
        assertSame(0, (int) $row['pair_id'], 'phiên ghép đôi được');
        assertSame('TS10', $row['device_name'], 'tạm giữ tên màn hình xe');
        $wait = ctData(ctCall('GET', '/cast/sessions/' . $s['id'] . '/signals', [], $car));
        assertSame('waiting', $wait['status']);
        assertSame('', $wait['device_name'], 'chưa có điện thoại thì không trả tên');

        $j = ctData(ctCall('POST', '/cast/join', ['code' => $s['code'], 'device_name' => 'SM-A546E', 'device_key' => $phone]));
        assertTrue(!isset($j['token']));
        assertSame('TS10', $j['pair']['name']);
        $pair = $S->db->one('SELECT * FROM cast_pairs WHERE id = ?', [$j['pair']['id']]);
        assertSame(CastService::hash($car), $pair['receiver_hash']);
        assertSame(CastService::hash($phone), $pair['sender_hash']);
        assertSame(['TS10', 'SM-A546E'], [$pair['receiver_name'], $pair['sender_name']]);
        assertTrue($pair['deleted_at'] === null && $pair['last_used_at'] !== null);
        $row = $S->db->one('SELECT * FROM cast_sessions WHERE id = ?', [$s['id']]);
        assertSame((int) $pair['id'], (int) $row['pair_id']);
        assertSame('SM-A546E', $row['device_name']);
        assertSame(CastService::hash($phone), $row['sender_hash']);

        // màn hình xe biết đã ghép đôi (để bắt đầu hỏi lời mời), tin kết nối đi bằng khóa thiết bị
        $seen = ctData(ctCall('GET', '/cast/sessions/' . $s['id'] . '/signals', [], $car));
        assertSame([(int) $pair['id'], 'SM-A546E', 'paired'], [$seen['pair_id'], $seen['device_name'], $seen['status']]);
        assertTrue(!isset($seen['picked']), 'phiên nhập mã không cần "picked"');
        assertSame(201, ctCall('POST', '/cast/sessions/' . $s['id'] . '/signals', ['kind' => 'offer', 'payload' => ['sdp' => 'o', 'gen' => 1]], $phone)->status);
        assertSame(['offer'], array_column(ctData(ctCall('GET', '/cast/sessions/' . $s['id'] . '/signals', [], $car))['signals'], 'kind'));

        // danh sách: mỗi máy thấy tên máy BÊN KIA
        $mine = ctData(ctDev('GET', '/cast/pairs', $phone));
        assertSame(1, count($mine['pairs']));
        assertSame(['sender', 'TS10'], [$mine['pairs'][0]['role'], $mine['pairs'][0]['name']]);
        assertSame(3, $mine['poll_seconds']);
        $carList = ctData(ctDev('GET', '/cast/pairs', $car))['pairs'];
        assertSame(['receiver', 'SM-A546E'], [$carList[0]['role'], $carList[0]['name']]);
        assertSame([], ctData(ctDev('GET', '/cast/pairs', str_repeat('e3', 24)))['pairs'], 'máy lạ không thấy gì');
        assertSame(422, ctDev('GET', '/cast/pairs', '')->status);
        assertSame(422, ctDev('GET', '/cast/pairs', 'khong-hop-le')->status);

        // ghép đôi lại (mã mới, đổi tên) thì dùng lại cặp cũ, không tạo thêm
        ctCall('POST', '/cast/sessions/' . $s['id'] . '/end', [], $car);
        [, $j2] = ctPairUp($car, $phone, 'TS10 Pro', 'Pixel 8');
        assertSame($j['pair']['id'], $j2['pair']['id']);
        assertSame(1, (int) $S->db->value('SELECT COUNT(*) FROM cast_pairs'));
        assertSame(['TS10 Pro', 'Pixel 8'], array_values($S->db->one('SELECT receiver_name, sender_name FROM cast_pairs WHERE id = ?', [$j['pair']['id']])));
    } finally {
        ctDone($S);
    }
});

test('Ghép đôi: máy cũ không gửi khóa thiết bị vẫn chiếu như trước (không ghép đôi); không tự ghép đôi với chính mình', function () {
    $S = ctBoot();
    try {
        $phone = str_repeat('d2', 24);
        $old = ctData(ctCall('POST', '/cast/sessions'));
        assertTrue(isset($old['token']) && strlen($old['token']) === 48, 'máy cũ vẫn nhận khóa phiên');
        assertTrue($S->db->value('SELECT pair_id FROM cast_sessions WHERE id = ?', [$old['id']]) === null);
        $j = ctData(ctCall('POST', '/cast/join', ['code' => $old['code'], 'device_name' => 'A', 'device_key' => $phone]));
        assertSame(null, $j['pair'], 'màn hình xe kiểu cũ: không ghép đôi');
        assertSame(0, (int) $S->db->value('SELECT COUNT(*) FROM cast_pairs'));
        $j2 = ctData(ctCall('POST', '/cast/join', ['code' => ctData(ctCall('POST', '/cast/sessions', ['device_key' => str_repeat('c1', 24)]))['code'], 'device_name' => 'B']));
        assertTrue(isset($j2['token']) && $j2['pair'] === null, 'điện thoại kiểu cũ: không ghép đôi');

        $same = str_repeat('f6', 24);
        [, $self] = ctPairUp($same, $same);
        assertSame(null, $self['pair'], 'cùng một máy ở hai vai');
        assertSame(0, (int) $S->db->value('SELECT COUNT(*) FROM cast_pairs'));
    } finally {
        ctDone($S);
    }
});

test('Chia sẻ một chạm: điện thoại bấm "Chia sẻ", màn hình xe đã ghép đôi nhận đúng một lần rồi nối như cũ', function () {
    $S = ctBoot();
    try {
        $car = str_repeat('c1', 24);
        $phone = str_repeat('d2', 24);
        [$s, $j] = ctPairUp($car, $phone);
        $pid = $j['pair']['id'];
        ctCall('POST', '/cast/sessions/' . $s['id'] . '/end', [], $phone);

        $idle = ctData(ctDev('GET', '/cast/incoming', $car));
        assertSame([1, null, []], [$idle['pairs'], $idle['incoming'], $idle['ice_servers']]);
        assertSame(3, $idle['poll_seconds']);

        $r = ctDev('POST', '/cast/pairs/' . $pid . '/share', $phone, ['device_name' => 'SM-A546E']);
        assertSame(201, $r->status);
        $sh = ctData($r);
        assertSame(['sender', 'TS10'], [$sh['role'], $sh['pair']['name']]);
        assertTrue($sh['ice_servers'] !== [] && !isset($sh['token']));
        $row = $S->db->one('SELECT * FROM cast_sessions WHERE id = ?', [$sh['id']]);
        assertSame(['', 'paired', $pid], [$row['code'], $row['status'], (int) $row['pair_id']]);
        assertSame([CastService::hash($car), CastService::hash($phone)], [$row['receiver_hash'], $row['sender_hash']]);
        assertSame(false, ctData(ctCall('GET', '/cast/sessions/' . $sh['id'] . '/signals', [], $phone))['picked'], 'chưa nhận');

        $in = ctData(ctDev('GET', '/cast/incoming', $car));
        assertSame(['id' => $sh['id'], 'device_name' => 'SM-A546E', 'pair_id' => $pid], $in['incoming']);
        assertTrue($in['ice_servers'] !== []);
        assertSame(null, ctData(ctDev('GET', '/cast/incoming', $car))['incoming'], 'chỉ nhận một lần (thẻ thứ hai không nhận trùng)');
        assertSame(true, ctData(ctCall('GET', '/cast/sessions/' . $sh['id'] . '/signals', [], $phone))['picked'], 'điện thoại biết màn hình xe đã nhận');

        // nối như phiên nhập mã: mỗi máy dùng khóa thiết bị của mình
        assertSame(201, ctCall('POST', '/cast/sessions/' . $sh['id'] . '/signals', ['kind' => 'offer', 'payload' => ['sdp' => 'o', 'gen' => 1]], $phone)->status);
        assertSame(['offer'], array_column(ctData(ctCall('GET', '/cast/sessions/' . $sh['id'] . '/signals', [], $car))['signals'], 'kind'));
        assertSame(201, ctCall('POST', '/cast/sessions/' . $sh['id'] . '/signals', ['kind' => 'answer', 'payload' => ['sdp' => 'a', 'gen' => 1]], $car)->status);
        assertSame(['answer'], array_column(ctData(ctCall('GET', '/cast/sessions/' . $sh['id'] . '/signals', [], $phone))['signals'], 'kind'));

        // quyền: màn hình xe không "chia sẻ" được, máy lạ không thấy cặp
        assertSame('CAST_NOT_SENDER', ctErr(ctDev('POST', '/cast/pairs/' . $pid . '/share', $car)));
        assertSame('CAST_PAIR_NOT_FOUND', ctErr(ctDev('POST', '/cast/pairs/' . $pid . '/share', str_repeat('e3', 24))));
        assertSame('CAST_PAIR_NOT_FOUND', ctErr(ctDev('POST', '/cast/pairs/999/share', $phone)));
        assertSame(422, ctDev('POST', '/cast/pairs/' . $pid . '/share', '')->status);
        assertSame(403, ctCall('POST', '/cast/pairs/' . $pid . '/share', [], '', [], '7.7.7.7', false)->status, 'thiếu CSRF');
        assertSame([0, null], array_values(array_intersect_key(ctData(ctDev('GET', '/cast/incoming', str_repeat('e3', 24))), ['pairs' => 1, 'incoming' => 1])), 'máy lạ hỏi: không có gì');

        // bấm "Chia sẻ" hai lần khi màn hình xe chưa nhận: lời mời trước kết thúc, màn hình xe chỉ nhận lời mời mới
        $a = ctData(ctDev('POST', '/cast/pairs/' . $pid . '/share', $phone));
        $b = ctData(ctDev('POST', '/cast/pairs/' . $pid . '/share', $phone));
        assertSame(['ended', 'sender'], array_values($S->db->one('SELECT status, ended_by FROM cast_sessions WHERE id = ?', [$a['id']])));
        assertSame($b['id'], ctData(ctDev('GET', '/cast/incoming', $car))['incoming']['id']);

        // lời mời quá cũ (điện thoại đã thôi chờ) hoặc phiên đã kết thúc: không nhận, dọn lời mời
        $c = ctData(ctDev('POST', '/cast/pairs/' . $pid . '/share', $phone));
        $S->db->execute('UPDATE cast_pairs SET request_at = ? WHERE id = ?', [date('Y-m-d H:i:s', time() - CastService::REQUEST_TTL - 5), $pid]);
        assertSame(null, ctData(ctDev('GET', '/cast/incoming', $car))['incoming']);
        assertTrue($S->db->value('SELECT request_session_id FROM cast_pairs WHERE id = ?', [$pid]) === null);
        $d = ctData(ctDev('POST', '/cast/pairs/' . $pid . '/share', $phone));
        ctCall('POST', '/cast/sessions/' . $d['id'] . '/end', [], $phone);
        assertSame(null, ctData(ctDev('GET', '/cast/incoming', $car))['incoming'], 'điện thoại đã hủy');
        unset($c);

        // tắt chức năng
        Config::override('cast', ['enabled' => false]);
        assertSame('CAST_DISABLED', ctErr(ctDev('POST', '/cast/pairs/' . $pid . '/share', $phone, [], '9.9.9.9')));
        assertSame('CAST_DISABLED', ctErr(ctDev('GET', '/cast/incoming', $car, [], '9.9.9.9')));
    } finally {
        ctDone($S);
    }
});

test('Quên thiết bị: xóa mềm ở máy nào cũng được, không DELETE; máy bên kia hết thấy, lời mời đang chờ kết thúc', function () {
    $S = ctBoot();
    try {
        $car = str_repeat('c1', 24);
        $phone = str_repeat('d2', 24);
        $car2 = str_repeat('a9', 24);
        [, $j] = ctPairUp($car, $phone);
        [, $j2] = ctPairUp($car2, $phone, 'Xe 2', 'SM-A546E', '7.7.7.8');
        assertSame(2, count(ctData(ctDev('GET', '/cast/pairs', $phone))['pairs']), 'một điện thoại, hai xe');

        assertSame('CAST_PAIR_NOT_FOUND', ctErr(ctDev('POST', '/cast/pairs/' . $j['pair']['id'] . '/forget', str_repeat('e3', 24))), 'máy lạ không quên hộ được');
        $r = ctDev('POST', '/cast/pairs/' . $j['pair']['id'] . '/forget', $phone);
        assertSame(true, ctData($r)['forgotten']);
        $row = $S->db->one('SELECT * FROM cast_pairs WHERE id = ?', [$j['pair']['id']]);
        assertTrue($row !== null && $row['deleted_at'] !== null, 'dòng vẫn còn');
        assertSame('sender', $row['deleted_by']);
        assertSame(200, ctDev('POST', '/cast/pairs/' . $j['pair']['id'] . '/forget', $phone)->status, 'quên lần nữa: vẫn được');
        assertSame(200, ctDev('POST', '/cast/pairs/' . $j['pair']['id'] . '/forget', $car)->status, 'máy kia quên sau: vẫn được');
        assertSame(['Xe 2'], array_column(ctData(ctDev('GET', '/cast/pairs', $phone))['pairs'], 'name'));
        assertSame([], ctData(ctDev('GET', '/cast/pairs', $car))['pairs'], 'màn hình xe cũng hết thấy');
        assertSame(0, ctData(ctDev('GET', '/cast/incoming', $car))['pairs'], 'màn hình xe thôi hỏi');
        assertSame('CAST_PAIR_NOT_FOUND', ctErr(ctDev('POST', '/cast/pairs/' . $j['pair']['id'] . '/share', $phone)));

        // màn hình xe quên khi điện thoại đang chờ nó nhận
        $sh = ctData(ctDev('POST', '/cast/pairs/' . $j2['pair']['id'] . '/share', $phone));
        ctDev('POST', '/cast/pairs/' . $j2['pair']['id'] . '/forget', $car2);
        assertSame(['ended', 'receiver'], array_values($S->db->one('SELECT status, ended_by FROM cast_sessions WHERE id = ?', [$sh['id']])));
        assertSame('receiver', $S->db->value('SELECT deleted_by FROM cast_pairs WHERE id = ?', [$j2['pair']['id']]));
        assertSame(410, ctCall('GET', '/cast/sessions/' . $sh['id'] . '/signals', [], $phone)->status, 'điện thoại được báo đã kết thúc');

        // quên xong ghép đôi lại bằng mã: thành cặp mới
        [, $again] = ctPairUp($car, $phone);
        assertTrue($again['pair']['id'] !== $j['pair']['id']);
        assertSame(3, (int) $S->db->value('SELECT COUNT(*) FROM cast_pairs'), 'không xóa dòng cũ');
    } finally {
        ctDone($S);
    }
});

test('Ghép đôi: giới hạn số lần hỏi lời mời và số cặp mỗi máy', function () {
    $S = ctBoot();
    try {
        $car = str_repeat('c1', 24);
        $phone = str_repeat('d2', 24);
        ctPairUp($car, $phone);
        $last = null;
        for ($i = 0; $i < 61; $i++) {
            $last = ctDev('GET', '/cast/incoming', $car);
        }
        assertSame(429, $last->status, 'hỏi quá 60 lần/phút');
        assertSame(200, ctDev('GET', '/cast/incoming', str_repeat('a9', 24))->status, 'máy khác không bị ảnh hưởng');

        // một điện thoại tối đa MAX_PAIRS cặp: quá thì vẫn chiếu được, chỉ không ghép đôi thêm
        for ($i = 0; $i < CastService::MAX_PAIRS; $i++) {
            $S->db->insert('INSERT INTO cast_pairs (receiver_hash, sender_hash, created_at) VALUES (?, ?, ?)', [hash('sha256', 'x' . $i), CastService::hash($phone), date('Y-m-d H:i:s')]);
        }
        [, $j] = ctPairUp(str_repeat('b8', 24), $phone, 'Xe mới', 'P', '7.7.7.9');
        assertSame(null, $j['pair']);
        assertTrue($j['id'] > 0, 'vẫn chiếu được');
    } finally {
        ctDone($S);
    }
});

test('Ghép đôi: bảng SQLite thử, schema.sql và migration 011 + 012 khớp nhau; không có DELETE', function () {
    $schema = BASE_PATH . '/database/schema.sql';
    $parse = function (string $sql, string $table): array {
        if (preg_match('/CREATE TABLE (?:IF NOT EXISTS )?' . $table . ' \((.*?)\n\) ENGINE/s', $sql, $m) !== 1) {
            return [];
        }
        preg_match_all('/^  ([a-z_]+) [A-Z]/m', $m[1], $c);
        return $c[1];
    };
    $schemaSql = (string) file_get_contents($schema);
    $m11 = (string) file_get_contents(BASE_PATH . '/database/migrations/011_cast_sessions.sql');
    $m12 = (string) file_get_contents(BASE_PATH . '/database/migrations/012_cast_pairs.sql');
    $sessions = $parse($schemaSql, 'cast_sessions');
    $withPair = $parse($m11, 'cast_sessions');
    array_splice($withPair, array_search('device_name', $withPair, true) + 1, 0, ['pair_id']);
    assertSame($sessions, $withPair, 'schema.sql = migration 011 + cột pair_id sau device_name');
    assertTrue(strpos($m12, 'ALTER TABLE cast_sessions ADD COLUMN pair_id INT UNSIGNED NULL AFTER device_name;') !== false);
    assertSame($parse($schemaSql, 'cast_pairs'), $parse($m12, 'cast_pairs'), 'cast_pairs: migration 012 = schema.sql');
    assertTrue(contains($schemaSql, "'012_cast_pairs.sql'"), 'schema.sql đánh dấu migration 012');
    assertTrue(stripos((string) preg_replace('/^\s*--.*$/m', '', $m12), 'FOREIGN KEY') === false);
    $db = adminSqliteDatabase();
    if ($db !== null) {
        foreach (['cast_sessions', 'cast_signals', 'cast_pairs'] as $t) {
            $actual = array_column($db->all('PRAGMA table_info(' . $t . ')'), 'name');
            $expected = $parse($schemaSql, $t);
            sort($actual);
            sort($expected);
            assertSame($expected, $actual, 'bảng SQLite thử ' . $t);
        }
    }
    $repo = (string) file_get_contents(BASE_PATH . '/app/Repositories/CastRepository.php');
    assertTrue(preg_match('/\b(DELETE\s+FROM|TRUNCATE|REPLACE\s+INTO)\b/i', $repo) === 0);
});
