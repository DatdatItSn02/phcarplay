<?php
declare(strict_types=1);

use App\Core\FileCache;
use App\Core\SecretBox;
use App\Repositories\UserApiKeyRepository;
use App\Repositories\UserRepository;
use App\Services\DeviceSessionService;
use App\Services\PipedClient;
use App\Services\RateLimiter;
use App\Services\UserApiKeyService;
use App\Services\YoutubeDirectClient;
use App\Services\YoutubeService;

// Giai đoạn 10: khóa YouTube Data API riêng của người dùng.

const UK_APP_KEY = 'khoa-bi-mat-cua-website-dung-de-thu';
const UK_KEY = 'AIzaSyKHOA-RIENG-CUA-NGUOI-DUNG-0001';

function ukApiSearch(string $id): array
{
    return ['items' => [['id' => ['videoId' => $id], 'snippet' => ['title' => 'Bài ' . $id, 'channelTitle' => 'Kênh', 'liveBroadcastContent' => 'none']]], 'nextPageToken' => 'TRANG2'];
}

function ukApiVideos(string $id): array
{
    return ['items' => [['id' => $id, 'contentDetails' => ['duration' => 'PT3M'], 'statistics' => ['viewCount' => '5']]]];
}

/** Dịch vụ thật trên SQLite trong bộ nhớ, mạng giả. */
function ukSetup(array $routes, ?array &$log = null, array $cfg = [], ?bool $enabled = true, string $appKey = UK_APP_KEY): array
{
    $db = adminSqliteDatabase();
    $dir = tmpCacheDir();
    $client = new YoutubeDirectClient(new FileCache($dir), ytCfg($cfg), ytNet($routes, $log), new RateLimiter($dir . '/rl', null, true));
    $users = new UserRepository($db);
    $svc = new UserApiKeyService(new UserApiKeyRepository($db), $users, new DeviceSessionService($users), $client, $appKey, $enabled);
    return [$svc, $client, $db, $dir];
}

test('Khóa riêng: SecretBox mã hóa/giải mã; sai APP_KEY hay dữ liệu hỏng thì trả null; APP_KEY ngắn thì không dùng được', function () {
    $box = new SecretBox(UK_APP_KEY);
    $enc = $box->encrypt(UK_KEY);
    assertTrue(strpos($enc, 'v1:') === 0 && strpos($enc, 'AIza') === false, 'không lưu khóa ở dạng đọc được');
    assertTrue($enc !== $box->encrypt(UK_KEY), 'mỗi lần mã hóa khác nhau');
    assertSame(UK_KEY, $box->decrypt($enc));
    assertSame(null, (new SecretBox('mot-khoa-khac-hoan-toan-123'))->decrypt($enc));
    assertSame(null, $box->decrypt('v1:' . base64_encode(str_repeat('x', 40))));
    assertSame(null, $box->decrypt('khong-dung-dang'));
    $gen = SecretBox::generateKey();
    assertTrue(strpos($gen, 'base64:') === 0 && SecretBox::available($gen));
    $g = new SecretBox($gen);
    assertSame(UK_KEY, $g->decrypt($g->encrypt(UK_KEY)));
    assertSame(false, SecretBox::available(''));
    assertSame(false, SecretBox::available('ngan'));
});

test('Khóa riêng: lưu (thử khóa 1 lần với Google), chỉ trả 4 ký tự cuối, database chỉ có bản mã hóa; bỏ khóa = để trống (không DELETE)', function () {
    [$svc, $client, $db, $dir] = ukSetup(['GET https://api.test/youtube/v3/videos' => [200, json_encode(['items' => [['id' => 'dQw4w9WgXcQ']]])]], $log);
    if ($db === null) { rmCacheDir($dir); return; }
    $st = $svc->status(7);
    assertSame([true, false, null], [$st['enabled'], $st['has_key'], $st['last4']]);
    $r = $svc->save(7, '  ' . UK_KEY . ' ');
    assertSame([true, '0001', 'ok', 'ok'], [$r['has_key'], $r['last4'], $r['checked'], $r['state']]);
    assertTrue(strpos(json_encode($r), 'AIza') === false, 'không trả khóa đầy đủ');
    assertSame(1, count($log), 'thử khóa đúng một lần');
    assertTrue(strpos($log[0][1], '/videos?part=id&id=dQw4w9WgXcQ&key=') !== false, 'thử bằng lệnh rẻ nhất (1 đơn vị)');
    $row = $db->one('SELECT key_enc FROM user_api_keys WHERE user_id = 7');
    assertTrue(strpos((string) $row['key_enc'], 'AIza') === false && strpos((string) $row['key_enc'], 'v1:') === 0, 'database chỉ có bản mã hóa');
    assertSame(UK_KEY, $svc->keyFor(7));
    assertSame(null, $svc->keyFor(8), 'người khác không có khóa');
    $r = $svc->remove(7);
    assertSame([false, null], [$r['has_key'], $r['last4']]);
    assertSame(null, $svc->keyFor(7));
    assertSame(1, (int) $db->value('SELECT COUNT(*) FROM user_api_keys WHERE user_id = 7'), 'bỏ khóa không xóa dòng');
    rmCacheDir($dir);
});

test('Khóa riêng: khóa sai dạng hoặc Google báo sai thì không lưu; hết lượt hay mạng lỗi vẫn lưu và báo rõ', function () {
    $bad = [400, json_encode(['error' => ['code' => 400, 'errors' => [['reason' => 'keyInvalid']]]])];
    [$svc, , $db, $dir] = ukSetup(['GET https://api.test/youtube/v3/videos' => $bad], $log);
    if ($db === null) { rmCacheDir($dir); return; }
    assertThrows(fn() => $svc->save(7, 'ngắn'), 'VALIDATION_FAILED');
    assertThrows(fn() => $svc->save(7, 'AIza có dấu cách và chữ có dấu ê'), 'VALIDATION_FAILED');
    assertSame(0, count($log), 'sai dạng thì không gọi Google');
    assertThrows(fn() => $svc->save(7, UK_KEY), 'VALIDATION_FAILED');
    assertSame(false, $svc->status(7)['has_key']);
    rmCacheDir($dir);

    [$svc, , $db, $dir] = ukSetup(['GET https://api.test/youtube/v3/videos' => [403, json_encode(['error' => ['code' => 403, 'errors' => [['reason' => 'quotaExceeded']]]])]]);
    $r = $svc->save(7, UK_KEY);
    assertSame(['quota', 'quota', true], [$r['checked'], $r['state'], $r['has_key']]);
    rmCacheDir($dir);

    [$svc, , $db, $dir] = ukSetup(['GET https://api.test/youtube/v3/videos' => new RuntimeException('mất mạng')]);
    $r = $svc->save(7, UK_KEY);
    assertSame(['error', true], [$r['checked'], $r['has_key']]);
    rmCacheDir($dir);
});

test('Khóa riêng: YOUTUBE_USER_KEYS=false hoặc thiếu APP_KEY thì tính năng tắt, có lý do; đổi APP_KEY thì báo khóa không đọc được', function () {
    [$svc, , $db, $dir] = ukSetup([], $l, [], false);
    if ($db === null) { rmCacheDir($dir); return; }
    assertSame(false, $svc->status(7)['enabled']);
    assertThrows(fn() => $svc->save(7, UK_KEY), 'FEATURE_DISABLED');
    rmCacheDir($dir);
    [$svc, , $db, $dir] = ukSetup([], $l, [], true, '');
    assertTrue(strpos((string) $svc->status(7)['reason'], 'APP_KEY') !== false);
    assertSame(null, $svc->keyFor(7));
    rmCacheDir($dir);

    [$svc, , $db, $dir] = ukSetup(['GET https://api.test/youtube/v3/videos' => [200, '{"items":[]}']]);
    $svc->save(7, UK_KEY);
    $users = new UserRepository($db);
    $other = new UserApiKeyService(new UserApiKeyRepository($db), $users, new DeviceSessionService($users),
        new YoutubeDirectClient(new FileCache($dir), ytCfg(), ytNet([], $l)), 'app-key-moi-sau-khi-doi-0000', true);
    assertSame('unreadable', $other->status(7)['state']);
    assertSame(null, $other->keyFor(7));
    rmCacheDir($dir);
});

test('Khóa riêng: chỉ người đang đăng nhập (đúng thiết bị, còn hoạt động) mới dùng khóa của mình; khách thì không', function () {
    [$svc, , $db, $dir] = ukSetup(['GET https://api.test/youtube/v3/videos' => [200, '{"items":[]}']]);
    if ($db === null) { rmCacheDir($dir); return; }
    $db->execute("INSERT INTO users (id, email, name, password_hash, salt, status, session_token, created_at, updated_at, alive) VALUES (7, 'a@b.c', 'A', 'x', 'y', 'active', ?, '2026-01-01', '2026-01-01', 1)", [hash('sha256', 'thiet-bi-1')]);
    $svc->save(7, UK_KEY);
    $old = $_SESSION ?? null;
    $_SESSION = [];
    assertSame(null, $svc->currentUserKey(), 'khách');
    $_SESSION = ['user_id' => 7, 'device_token' => 'thiet-bi-1'];
    assertSame(UK_KEY, $svc->currentUserKey());
    $_SESSION = ['user_id' => 7, 'device_token' => 'thiet-bi-cu'];
    assertSame(null, $svc->currentUserKey(), 'thiết bị đã bị đăng xuất');
    $db->execute("UPDATE users SET status = 'blocked' WHERE id = 7");
    $_SESSION = ['user_id' => 7, 'device_token' => 'thiet-bi-1'];
    assertSame(null, $svc->currentUserKey(), 'tài khoản bị khóa');
    $_SESSION = $old ?? [];
    rmCacheDir($dir);
});

test('Khóa riêng khi tìm kiếm: đi trước Piped, trang sau dùng tiếp khóa; hết lượt/sai thì tự tìm cách khác kèm thông báo nhẹ', function () {
    $dir = tmpCacheDir();
    $hits = [];
    $routes = [
        'GET https://api.test/youtube/v3/search' => function () use (&$hits) { $hits[] = 'api'; return [200, json_encode(ukApiSearch('uuuuuuuuuuu'))]; },
        'GET https://api.test/youtube/v3/videos' => [200, json_encode(ukApiVideos('uuuuuuuuuuu'))],
        'POST https://yt.test/youtubei/v1/search' => function () use (&$hits) { $hits[] = 'direct'; return [200, json_encode(ytSearchPage('ddddddddddd', 'eeeeeeeeeee'))]; },
    ];
    $direct = new YoutubeDirectClient(new FileCache($dir), ytCfg(), ytNet($routes, $log), new RateLimiter($dir . '/rl', null, true));
    $pipedCalls = 0;
    $piped = new PipedClient(new FileCache($dir), ['instances' => ['https://p.test']], function () use (&$pipedCalls) { $pipedCalls++; throw new RuntimeException('down'); });
    $svc = new YoutubeService($piped, null, $direct);

    $svc->useUserKey(UK_KEY);
    $r = $svc->search('mưa');
    assertSame(['uuuuuuuuuuu'], array_column($r['items'], 'id'));
    assertSame('own', $svc->lastSource());
    assertSame('u:TRANG2', $r['next']);
    assertSame(0, $pipedCalls, 'có khóa riêng thì không cần hỏi Piped');
    assertSame(null, $svc->keyNotice());
    assertTrue(strpos($log[0][1], 'key=' . UK_KEY) !== false, 'dùng đúng khóa của người dùng');
    $svc->search('mưa', 'u:TRANG2');
    assertTrue(strpos(end($log)[1], 'pageToken=TRANG2') !== false || strpos($log[count($log) - 2][1], 'pageToken=TRANG2') !== false, 'trang sau dùng tiếp khóa');

    // người khác (khách) không dùng được khóa này: đi đường thường (Piped hỏng -> đọc trực tiếp)
    $svc->useUserKey(null);
    $r = $svc->search('nắng');
    assertSame(['ddddddddddd', 'eeeeeeeeeee'], array_column($r['items'], 'id'));
    assertSame('youtube', $svc->lastSource(), 'phải dùng cách dự phòng (để giao diện nhắc thêm khóa)');
    assertTrue($pipedCalls > 0);
    $apiCalls = array_filter($log, static function ($l) { return strpos($l[1], 'api.test') !== false && strpos($l[1], 'nắng') !== false || strpos($l[1], rawurlencode('nắng')) !== false && strpos($l[1], 'api.test') !== false; });
    assertSame([], array_values($apiCalls), 'khách không dùng khóa của người khác');
    rmCacheDir($dir);

    // khóa hết lượt: tìm cách khác, có thông báo; lần sau không gọi API bằng khóa đó nữa
    $dir = tmpCacheDir();
    $routes['GET https://api.test/youtube/v3/search'] = [403, json_encode(['error' => ['code' => 403, 'errors' => [['reason' => 'quotaExceeded']]]])];
    $direct = new YoutubeDirectClient(new FileCache($dir), ytCfg(), ytNet($routes, $log), new RateLimiter($dir . '/rl', null, true));
    $svc = new YoutubeService(new PipedClient(new FileCache($dir), ['instances' => ['https://p.test']], function () { throw new RuntimeException('down'); }), null, $direct);
    $svc->useUserKey(UK_KEY);
    $r = $svc->search('gió');
    assertSame(['ddddddddddd', 'eeeeeeeeeee'], array_column($r['items'], 'id'), 'vẫn có kết quả');
    assertTrue(strpos((string) $svc->keyNotice(), 'hết lượt hôm nay') !== false);
    $n = count($log);
    $svc->useUserKey(UK_KEY);
    $svc->search('mây');
    foreach (array_slice($log, $n) as $l) {
        assertTrue(strpos($l[1], 'api.test') === false, 'khóa đã hết lượt thì không gọi lại');
    }
    rmCacheDir($dir);

    // khóa sai
    $dir = tmpCacheDir();
    $routes['GET https://api.test/youtube/v3/search'] = [400, json_encode(['error' => ['code' => 400, 'errors' => [['reason' => 'keyInvalid']]]])];
    $direct = new YoutubeDirectClient(new FileCache($dir), ytCfg(), ytNet($routes, $log), new RateLimiter($dir . '/rl', null, true));
    $svc = new YoutubeService(new PipedClient(new FileCache($dir), ['instances' => ['https://p.test']], function () { throw new RuntimeException('down'); }), null, $direct);
    $svc->useUserKey(UK_KEY);
    $r = $svc->search('sấm');
    assertSame(2, count($r['items']));
    assertTrue(strpos((string) $svc->keyNotice(), 'không dùng được') !== false);
    rmCacheDir($dir);
});

test('Khóa riêng: migration 008 khớp schema.sql và SQLite, không dùng khóa ngoại; khóa API không bị ghi vào log', function () {
    $schema = BASE_PATH . '/database/schema.sql';
    $mig = (string) file_get_contents(BASE_PATH . '/database/migrations/008_user_api_keys.sql');
    $tmp = tempnam(sys_get_temp_dir(), 'm8');
    file_put_contents($tmp, str_replace('CREATE TABLE user_api_keys', 'CREATE TABLE IF NOT EXISTS user_api_keys', $mig));
    assertSame(['user_id', 'key_enc', 'key_hint', 'updated_at'], adminSqlColumns($schema, 'user_api_keys'));
    assertSame(adminSqlColumns($schema, 'user_api_keys'), adminSqlColumns($tmp, 'user_api_keys'));
    @unlink($tmp);
    assertTrue(stripos($mig, 'FOREIGN KEY') === false && stripos((string) preg_replace('/^\s*--.*$/m', '', $mig), 'DELETE') === false);
    assertTrue(strpos((string) file_get_contents($schema), "'008_user_api_keys.sql'") !== false);
    $ddl = implode("\n", adminSqliteDdl());
    assertTrue(strpos($ddl, 'user_api_keys') !== false);

    $src = (string) file_get_contents(BASE_PATH . '/app/Services/YoutubeDirectClient.php');
    assertTrue(strpos($src, "preg_replace('/key=[^&\\s]+/', 'key=***'") !== false, 'che khóa trong log lỗi mạng');
});

test('Khóa riêng: lỗi của Google được phân loại đúng (cả dạng errors[].reason lẫn details[].reason) và báo cách sửa theo đúng bước', function () {
    $g = function (int $code, string $reason, string $detail = '', string $status = '') {
        $e = ['code' => $code, 'errors' => [['reason' => $reason]]];
        if ($detail !== '') { $e['details'] = [['@type' => 'type.googleapis.com/google.rpc.ErrorInfo', 'reason' => $detail]]; }
        if ($status !== '') { $e['status'] = $status; }
        return ['error' => $e];
    };
    $cases = [
        [400, $g(400, 'badRequest', 'API_KEY_INVALID', 'INVALID_ARGUMENT'), 'bad_key'],
        [400, $g(400, 'keyInvalid'), 'bad_key'],
        [403, $g(403, 'accessNotConfigured', 'SERVICE_DISABLED', 'PERMISSION_DENIED'), 'not_enabled'],
        [403, $g(403, 'forbidden', 'API_KEY_HTTP_REFERRER_BLOCKED', 'PERMISSION_DENIED'), 'referrer_blocked'],
        [403, $g(403, 'ipRefererBlocked'), 'referrer_blocked'],
        [403, $g(403, 'forbidden', 'API_KEY_IP_ADDRESS_BLOCKED', 'PERMISSION_DENIED'), 'referrer_blocked'],
        [403, $g(403, 'forbidden', 'API_KEY_SERVICE_BLOCKED', 'PERMISSION_DENIED'), 'api_blocked'],
        [403, $g(403, 'quotaExceeded'), 'quota'],
        [403, $g(403, 'forbidden', '', 'PERMISSION_DENIED'), 'invalid'],
        [500, $g(500, 'backendError'), ''],
        [502, 'không phải JSON', ''],
    ];
    foreach ($cases as [$status, $data, $want]) {
        assertSame($want, YoutubeDirectClient::classifyApiError($status, $data), json_encode($data));
    }
    // qua đường lưu khóa: mỗi lý do có câu hướng dẫn riêng
    foreach (['not_enabled' => 'bước 1', 'referrer_blocked' => 'Không có', 'api_blocked' => 'Giới hạn API', 'bad_key' => 'dán thiếu'] as $kind => $hint) {
        $body = ['referrer_blocked' => $cases[3][1], 'not_enabled' => $cases[2][1], 'api_blocked' => $cases[6][1], 'bad_key' => $cases[0][1]][$kind];
        [$svc, , $db, $dir] = ukSetup(['GET https://api.test/youtube/v3/videos' => [$kind === 'bad_key' ? 400 : 403, json_encode($body)]]);
        if ($db === null) { rmCacheDir($dir); return; }
        try {
            $svc->save(7, UK_KEY);
            throw new RuntimeException('phải báo lỗi: ' . $kind);
        } catch (App\Core\HttpException $e) {
            assertSame('VALIDATION_FAILED', $e->errorCode);
            assertTrue(strpos((string) $e->details['key'], $hint) !== false, $kind . ': ' . $e->details['key']);
        }
        rmCacheDir($dir);
    }
});

test('Khóa riêng: người dùng sửa khóa trên Google rồi lưu lại thành công thì bỏ dấu "không dùng được" ngay', function () {
    $answer = [403, json_encode(['error' => ['code' => 403, 'errors' => [['reason' => 'forbidden']], 'details' => [['reason' => 'API_KEY_HTTP_REFERRER_BLOCKED']]]])];
    $routes = ['GET https://api.test/youtube/v3/videos' => function () use (&$answer) { return $answer; }];
    [$svc, $client, $db, $dir] = ukSetup($routes);
    if ($db === null) { rmCacheDir($dir); return; }
    assertThrows(fn() => $svc->save(7, UK_KEY), 'VALIDATION_FAILED');
    assertSame('invalid', $client->keyState(UK_KEY));
    $answer = [200, json_encode(['items' => [['id' => 'dQw4w9WgXcQ']]])];
    $r = $svc->save(7, UK_KEY);
    assertSame(['ok', 'ok'], [$r['checked'], $r['state']]);
    assertSame(null, $client->keyState(UK_KEY));
    rmCacheDir($dir);
});
