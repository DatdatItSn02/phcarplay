<?php
declare(strict_types=1);

use App\Core\FileCache;
use App\Core\HttpException;
use App\Services\PipedClient;
use App\Services\InvidiousClient;
use App\Services\PlaylistService;
use App\Services\YoutubeService;

function tmpCacheDir(): string
{
    $dir = sys_get_temp_dir() . '/phcache_' . bin2hex(random_bytes(4));
    mkdir($dir, 0777, true);
    return $dir;
}

function rmCacheDir(string $dir): void
{
    foreach (glob($dir . '/*') ?: [] as $f) {
        @unlink($f);
    }
    @rmdir($dir);
}

test('FileCache: lưu, đọc lại, hết hạn thì mất, ghi đè được', function () {
    $dir = tmpCacheDir();
    $c = new FileCache($dir);
    assertSame(null, $c->get('a'));
    $c->set('a', ['x' => 'tiếng Việt', 'n' => 5], 60);
    assertSame(['x' => 'tiếng Việt', 'n' => 5], $c->get('a'));
    $c->set('a', ['x' => 'mới'], 60);
    assertSame(['x' => 'mới'], $c->get('a'));
    $c->set('het-han', [1], -5);
    assertSame(null, $c->get('het-han'));
    $c->forget('a');
    assertSame(null, $c->get('a'));
    rmCacheDir($dir);
});

function makeClient(array $responses, ?array &$log, array $cfgOverride = []): array
{
    $dir = tmpCacheDir();
    $log = [];
    $transport = function (string $url, int $timeout, bool $verify) use (&$responses, &$log) {
        $log[] = $url;
        $r = array_shift($responses);
        if ($r instanceof Throwable) {
            throw $r;
        }
        return $r;
    };
    $cfg = array_merge(['instances' => ['https://a.test', 'https://b.test', 'https://c.test'], 'timeout' => 2, 'max_tries' => 3, 'verify_ssl' => true], $cfgOverride);
    return [new PipedClient(new FileCache($dir), $cfg, $transport), $dir];
}

test('PipedClient: địa chỉ đầu lỗi thì tự chuyển sang địa chỉ sau và nhớ địa chỉ tốt', function () {
    [$client, $dir] = makeClient([[500, '{"error":"x"}'], [200, '{"items":[1]}'], [200, '{"items":[2]}']], $log);
    assertSame(['items' => [1]], $client->get('/search', ['q' => 'a b']));
    assertSame('https://a.test/search?q=a%20b', $log[0]);
    assertSame('https://b.test/search?q=a%20b', $log[1]);
    // Lần sau bắt đầu từ địa chỉ b (địa chỉ chạy tốt gần nhất)
    $client->get('/search', ['q' => 'c']);
    assertSame('https://b.test/search?q=c', $log[2]);
    rmCacheDir($dir);
});

test('PipedClient: lỗi mạng, JSON hỏng, trường error đều bị coi là thất bại; hết địa chỉ thì báo 502', function () {
    [$client, $dir] = makeClient([new RuntimeException('timeout'), [200, 'khong phai json'], [200, '{"error":"blocked","message":"Sign in"}']], $log);
    assertThrows(fn() => $client->get('/streams/abc'), 'UPSTREAM_FAILED');
    assertSame(3, count($log));
    rmCacheDir($dir);
});

test('PipedClient: có ttl thì lần gọi sau lấy từ bộ nhớ đệm, không gọi mạng', function () {
    [$client, $dir] = makeClient([[200, '{"items":["x"]}']], $log);
    $client->get('/search', ['q' => 'x'], 600);
    $again = $client->get('/search', ['q' => 'x'], 600);
    assertSame(['items' => ['x']], $again);
    assertSame(1, count($log));
    rmCacheDir($dir);
});

test('PipedClient: không cấu hình địa chỉ thì báo rõ', function () {
    [$client, $dir] = makeClient([], $log, ['instances' => []]);
    assertThrows(fn() => $client->get('/search'), 'PIPED_NOT_CONFIGURED');
    rmCacheDir($dir);
});

function pipedItem(string $id, array $over = []): array
{
    return array_merge([
        'url' => '/watch?v=' . $id, 'type' => 'stream', 'title' => 'Bài ' . $id, 'thumbnail' => 'https://img.test/' . $id . '.jpg',
        'uploaderName' => 'Ca sĩ', 'duration' => 215, 'views' => 1234567, 'uploaded' => 1700000000000,
    ], $over);
}

test('YoutubeService::normalizeItem: lấy mã video, bỏ kênh/playlist/livestream/thiếu dữ liệu', function () {
    $ok = YoutubeService::normalizeItem(pipedItem('dQw4w9WgXcQ'));
    assertSame('dQw4w9WgXcQ', $ok['id']);
    assertSame(215, $ok['duration']);
    assertSame('Ca sĩ', $ok['uploader']);
    assertSame(1234567, $ok['views']);
    assertSame(null, YoutubeService::normalizeItem(pipedItem('dQw4w9WgXcQ', ['type' => 'channel'])), 'kênh');
    assertSame(null, YoutubeService::normalizeItem(pipedItem('dQw4w9WgXcQ', ['duration' => -1])), 'livestream');
    assertSame(null, YoutubeService::normalizeItem(pipedItem('dQw4w9WgXcQ', ['url' => '/watch?v=ngan'])), 'mã sai');
    assertSame(null, YoutubeService::normalizeItem(pipedItem('dQw4w9WgXcQ', ['title' => ''])), 'thiếu tiêu đề');
    assertSame('', YoutubeService::normalizeItem(pipedItem('dQw4w9WgXcQ', ['thumbnail' => 'javascript:alert(1)']))['thumbnail'], 'chặn địa chỉ lạ');
    assertSame(0, YoutubeService::normalizeItem(pipedItem('dQw4w9WgXcQ', ['views' => -1]))['views']);
});

test('YoutubeService::search: chuẩn hóa danh sách và trả mã trang kế tiếp', function () {
    $body = json_encode(['items' => [pipedItem('aaaaaaaaaaa'), ['type' => 'channel', 'url' => '/channel/x'], pipedItem('bbbbbbbbbbb')], 'nextpage' => 'TOKEN123']);
    [$client, $dir] = makeClient([[200, $body], [200, json_encode(['items' => [pipedItem('ccccccccccc')], 'nextpage' => null])]], $log);
    $yt = new YoutubeService($client);
    $r = $yt->search('nhạc');
    assertSame(['aaaaaaaaaaa', 'bbbbbbbbbbb'], array_column($r['items'], 'id'));
    assertSame('p:TOKEN123', $r['next'], 'mã trang có tiền tố nguồn Piped');
    $r2 = $yt->search('nhạc', 'p:TOKEN123');
    assertTrue(strpos($log[1], '/nextpage/search?nextpage=TOKEN123') !== false, 'phải gọi nextpage');
    assertSame(null, $r2['next']);
    rmCacheDir($dir);
});

test('YoutubeService::stream: chọn luồng mp4 có tiếng theo độ phân giải, bỏ luồng chỉ có hình, kèm liên quan', function () {
    $data = [
        'title' => 'Tên bài', 'uploader' => 'Ca sĩ', 'duration' => 200, 'thumbnailUrl' => 'https://img.test/t.jpg',
        'hls' => 'https://proxy.test/hls.m3u8',
        'videoStreams' => [
            ['url' => 'https://v.test/360', 'quality' => '360p', 'height' => 360, 'mimeType' => 'video/mp4', 'videoOnly' => false, 'bitrate' => 500000],
            ['url' => 'https://v.test/1080', 'quality' => '1080p', 'height' => 1080, 'mimeType' => 'video/mp4', 'videoOnly' => true, 'bitrate' => 4000000],
            ['url' => 'https://v.test/720', 'quality' => '720p', 'height' => 720, 'mimeType' => 'video/mp4', 'videoOnly' => false, 'bitrate' => 2000000],
        ],
        'audioStreams' => [
            ['url' => 'https://a.test/low', 'bitrate' => 48000, 'mimeType' => 'audio/mp4', 'quality' => '48 kbps'],
            ['url' => 'https://a.test/high', 'bitrate' => 128000, 'mimeType' => 'audio/mp4', 'quality' => '128 kbps'],
        ],
        'relatedStreams' => [pipedItem('rrrrrrrrrrr'), ['type' => 'playlist', 'url' => '/playlist?list=x']],
    ];
    [$client, $dir] = makeClient([[200, json_encode($data)]], $log);
    $s = (new YoutubeService($client))->stream('dQw4w9WgXcQ');
    assertSame('https://proxy.test/hls.m3u8', $s['hls']);
    assertSame([720, 360], array_column($s['sources'], 'height'));
    assertSame('https://a.test/high', $s['audio'][0]['url']);
    assertSame(['rrrrrrrrrrr'], array_column($s['related'], 'id'));
    assertThrows(fn() => (new YoutubeService($client))->stream('ngan'), 'VALIDATION_FAILED');
    rmCacheDir($dir);
});

test('YoutubeService::stream: không có luồng nào: tắt trình phát YouTube thì báo STREAM_UNAVAILABLE, bật (mặc định) thì trả embed', function () {
    [$client, $dir] = makeClient([[200, json_encode(['title' => 'x', 'videoStreams' => [], 'audioStreams' => []])], [200, json_encode(['title' => 'x', 'videoStreams' => [], 'audioStreams' => []])]], $log);
    $saved = App\Core\Config::get('youtube', []);
    try {
        App\Core\Config::override('youtube', array_merge($saved, ['embed' => false]));
        assertThrows(fn() => (new YoutubeService($client))->stream('dQw4w9WgXcQ'), 'STREAM_UNAVAILABLE');
        App\Core\Config::override('youtube', array_merge($saved, ['embed' => true]));
        $e = (new YoutubeService($client))->stream('dQw4w9WgXcQ');
        assertSame(true, $e['embed']);
        assertSame('youtube', $e['source']);
        assertSame([], $e['sources']);
        assertSame('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', $e['thumbnail']);
    } finally {
        App\Core\Config::override('youtube', $saved);
    }
    rmCacheDir($dir);
});

// ---------- Giai đoạn 8: tạm bỏ qua địa chỉ hỏng, Invidious dự phòng ----------

/** Máy chủ giả theo đường dẫn: $routes = [tiền tố URL => [mã, nội dung] hoặc Throwable]. Ghi lại các URL đã gọi. */
function fakeNet(array $routes, ?array &$log): callable
{
    $log = [];
    return function (string $url) use ($routes, &$log) {
        $log[] = $url;
        foreach ($routes as $prefix => $r) {
            if (strpos($url, $prefix) === 0) {
                if ($r instanceof Throwable) {
                    throw $r;
                }
                return $r;
            }
        }
        throw new RuntimeException('không kết nối được');
    };
}

function makeSources(array $routes, ?array &$log, array $pipedUrls = ['https://p1.test', 'https://p2.test'], array $invUrls = ['https://i1.test', 'https://i2.test']): array
{
    $dir = tmpCacheDir();
    $net = fakeNet($routes, $log);
    $cache = new FileCache($dir);
    $piped = new PipedClient($cache, ['instances' => $pipedUrls, 'timeout' => 2, 'verify_ssl' => true], $net);
    $inv = new InvidiousClient($cache, ['instances' => $invUrls, 'timeout' => 2, 'verify_ssl' => true], $net);
    return [new YoutubeService($piped, $inv), $dir, $piped];
}

function invItem(string $id, array $over = []): array
{
    return array_merge(['type' => 'video', 'videoId' => $id, 'title' => 'Bài ' . $id, 'author' => 'Kênh', 'lengthSeconds' => 200, 'viewCount' => 99, 'published' => 1700000000], $over);
}

test('UpstreamClient: thử TẤT CẢ địa chỉ; địa chỉ trả trang web / không kết nối được bị tạm bỏ qua ở lần sau', function () {
    $dir = tmpCacheDir();
    $net = fakeNet([
        'https://a.test' => new RuntimeException('Could not resolve host'),
        'https://b.test' => [200, '<html>Cloudflare</html>'],
        'https://c.test' => [502, '{"message":"bad gateway"}'],
        'https://d.test' => [200, '["ok"]'],
    ], $log);
    $c = new PipedClient(new FileCache($dir), ['instances' => ['https://a.test', 'https://b.test', 'https://c.test', 'https://d.test']], $net);
    assertSame(['ok'], $c->get('/suggestions', ['query' => 'x']));
    assertSame(4, count($log), 'trước đây chỉ thử 3 địa chỉ, nay thử cả 4');
    assertTrue($c->isDead('https://a.test') && $c->isDead('https://b.test') && $c->isDead('https://c.test'));
    assertTrue(!$c->isDead('https://d.test'));
    $log = [];
    $c->get('/suggestions', ['query' => 'y']);
    assertSame(['https://d.test/suggestions?query=y'], $log, 'lần sau đi thẳng tới địa chỉ tốt, không chờ địa chỉ hỏng');
    rmCacheDir($dir);
});

test('UpstreamClient: lỗi riêng một video (JSON có error) không làm địa chỉ bị bỏ qua; lỗi ghi rõ "trả về trang web"', function () {
    $dir = tmpCacheDir();
    $net = fakeNet(['https://a.test' => [500, '{"error":"Video unavailable"}'], 'https://b.test' => [200, '<!doctype html>']], $log);
    $c = new PipedClient(new FileCache($dir), ['instances' => ['https://a.test', 'https://b.test']], $net);
    assertThrows(fn() => $c->get('/streams/dQw4w9WgXcQ'), 'UPSTREAM_FAILED');
    assertTrue(!$c->isDead('https://a.test'), 'video lỗi không phải máy chủ hỏng');
    assertTrue($c->isDead('https://b.test'));
    $logFile = BASE_PATH . '/storage/logs/app.log';
    if (is_file($logFile)) {
        assertTrue(strpos((string) file_get_contents($logFile), 'trả về trang web, không phải dữ liệu') !== false);
    }
    rmCacheDir($dir);
});

test('YoutubeService: Piped hỏng hết thì tìm kiếm bằng Invidious, trang sau đi tiếp Invidious', function () {
    [$yt, $dir] = makeSources([
        'https://p' => new RuntimeException('timeout'),
        'https://i1.test/api/v1/search?q=nh%E1%BA%A1c&type=video&page=1' => [200, json_encode([invItem('aaaaaaaaaaa'), invItem('lllllllllll', ['liveNow' => true, 'lengthSeconds' => 0]), ['type' => 'channel', 'author' => 'x']])],
        'https://i1.test/api/v1/search?q=nh%E1%BA%A1c&type=video&page=2' => [200, json_encode([invItem('bbbbbbbbbbb')])],
    ], $log);
    $r = $yt->search('nhạc');
    assertSame(['aaaaaaaaaaa'], array_column($r['items'], 'id'), 'bỏ livestream và kênh');
    assertSame('https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg', $r['items'][0]['thumbnail']);
    assertSame(1700000000000, $r['items'][0]['uploaded_at']);
    assertSame('i:2', $r['next']);
    $log = [];
    $r2 = $yt->search('nhạc', 'i:2');
    assertSame(['bbbbbbbbbbb'], array_column($r2['items'], 'id'));
    assertTrue(count($log) === 1 && strpos($log[0], 'https://i1.test/api/v1/search') === 0, 'trang sau của Invidious không gọi lại Piped');
    rmCacheDir($dir);
});

test('YoutubeService: phát video bằng Invidious (luồng qua máy chủ Invidious, local=true), gợi ý tách dấu HTML', function () {
    $video = [
        'title' => 'Tên bài', 'author' => 'Ca sĩ', 'lengthSeconds' => 215, 'liveNow' => false,
        'formatStreams' => [
            ['url' => '/latest_version?id=dQw4w9WgXcQ&itag=18&local=true', 'type' => 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', 'quality' => 'medium', 'size' => '640x360', 'qualityLabel' => '360p'],
        ],
        'adaptiveFormats' => [
            ['url' => '/videoplayback?itag=140&local=true', 'type' => 'audio/mp4; codecs="mp4a.40.2"', 'bitrate' => '130000'],
            ['url' => '/videoplayback?itag=137', 'type' => 'video/mp4; codecs="avc1"', 'bitrate' => '4000000'],
        ],
        'recommendedVideos' => [['videoId' => 'rrrrrrrrrrr', 'title' => 'Liên quan', 'author' => 'K', 'lengthSeconds' => 180]],
    ];
    [$yt, $dir] = makeSources([
        'https://p1.test/streams' => [500, '{"error":"Sign in to confirm you are not a bot"}'],
        'https://p2.test' => [200, '<html>'],
        'https://i1.test' => new RuntimeException('timeout'),
        'https://i2.test/api/v1/videos/dQw4w9WgXcQ?local=true' => [200, json_encode($video)],
        'https://i2.test/api/v1/search/suggestions?q=a' => [200, '{"query":"a","suggestions":["anh &amp; em","l&#39;amour"]}'],
    ], $log);
    $s = $yt->stream('dQw4w9WgXcQ');
    assertSame('invidious', $s['source']);
    assertSame('https://i2.test/latest_version?id=dQw4w9WgXcQ&itag=18&local=true', $s['sources'][0]['url']);
    assertSame(360, $s['sources'][0]['height']);
    assertSame('video/mp4', $s['sources'][0]['mime']);
    assertSame(['https://i2.test/videoplayback?itag=140&local=true'], array_column($s['audio'], 'url'), 'chỉ lấy luồng âm thanh, bỏ luồng chỉ có hình');
    assertSame('130 kbps', $s['audio'][0]['quality']);
    assertSame(['rrrrrrrrrrr'], array_column($s['related'], 'id'));
    assertSame(215, $s['duration']);
    assertSame(['anh & em', "l'amour"], $yt->suggest('a'));
    rmCacheDir($dir);
});

test('YoutubeService: Piped trả lời nhưng video không có luồng thì thử Invidious; cả hai không được thì báo đúng lỗi', function () {
    [$yt, $dir] = makeSources([
        'https://p1.test/streams' => [200, json_encode(['title' => 'x', 'videoStreams' => [], 'audioStreams' => []])],
        'https://i' => new RuntimeException('timeout'),
    ], $log);
    $saved = App\Core\Config::get('youtube', []);
    App\Core\Config::override('youtube', array_merge($saved, ['embed' => false]));
    try {
        assertThrows(fn() => $yt->stream('dQw4w9WgXcQ'), 'STREAM_UNAVAILABLE');
    } finally {
        App\Core\Config::override('youtube', $saved);
    }
    assertSame(true, $yt->stream('dQw4w9WgXcQ')['embed'], 'mặc định: không có luồng thì phát bằng trình phát YouTube');
    rmCacheDir($dir);

    [$yt, $dir] = makeSources(['https://' => new RuntimeException('timeout')], $log);
    try {
        $yt->search('x');
        assertTrue(false, 'phải lỗi');
    } catch (App\Core\HttpException $e) {
        assertSame('UPSTREAM_FAILED', $e->errorCode);
        assertTrue(strpos($e->getMessage(), 'Piped, Invidious') !== false, $e->getMessage());
    }
    rmCacheDir($dir);

    [$yt, $dir] = makeSources(['https://' => [200, '[]']], $log, [], []);
    assertThrows(fn() => $yt->search('x'), 'PIPED_NOT_CONFIGURED');
    rmCacheDir($dir);
});

test('YoutubeService: VIDEO_SOURCES=invidious,piped thì gọi Invidious trước', function () {
    $saved = App\Core\Config::get('piped', []);
    try {
        App\Core\Config::override('piped', array_merge($saved, ['sources' => ['invidious', 'piped']]));
        [$yt, $dir] = makeSources(['https://i1.test' => [200, json_encode([invItem('aaaaaaaaaaa')])], 'https://p' => [200, '{"items":[]}']], $log);
        $yt->search('x');
        assertSame(0, strpos($log[0], 'https://i1.test'));
        rmCacheDir($dir);
    } finally {
        App\Core\Config::override('piped', $saved);
    }
});

test('PlaylistService::sanitizeItem: làm sạch dữ liệu bài hát từ trình duyệt', function () {
    $ok = PlaylistService::sanitizeItem(['id' => 'dQw4w9WgXcQ', 'title' => '  Bài hát  ', 'uploader' => 'A', 'duration' => '215', 'thumbnail' => 'https://i.test/a.jpg']);
    assertSame(['id' => 'dQw4w9WgXcQ', 'title' => 'Bài hát', 'uploader' => 'A', 'duration' => 215, 'thumbnail' => 'https://i.test/a.jpg'], $ok);
    assertSame(null, PlaylistService::sanitizeItem(['id' => 'sai', 'title' => 'x']));
    assertSame(null, PlaylistService::sanitizeItem(['id' => 'dQw4w9WgXcQ', 'title' => '']));
    assertSame(null, PlaylistService::sanitizeItem('chuoi'));
    assertSame('', PlaylistService::sanitizeItem(['id' => 'dQw4w9WgXcQ', 'title' => 'x', 'thumbnail' => 'ftp://x'])['thumbnail']);
    assertSame(86400, PlaylistService::sanitizeItem(['id' => 'dQw4w9WgXcQ', 'title' => 'x', 'duration' => 999999])['duration']);
});

test('VideoSourceScanner: xếp địa chỉ phát được lên đầu và gợi ý dòng .env; nhận ra trang web, lỗi luồng, tải thử bị chặn', function () {
    $saved = App\Core\Config::get('invidious', []);
    App\Core\Config::override('invidious', ['instances' => ['https://ok.test', 'https://web.test']]);
    try {
        $id = App\Services\VideoSourceScanner::TEST_VIDEO;
        $video = ['title' => 'x', 'lengthSeconds' => 19, 'formatStreams' => [['url' => '/latest_version?id=' . $id . '&itag=18&local=true', 'type' => 'video/mp4', 'size' => '320x240']], 'adaptiveFormats' => []];
        $http = function (string $url, int $t, array $headers) use ($id, $video) {
            $map = [
                'https://ok.test/api/v1/search' => [200, json_encode([invItem('aaaaaaaaaaa')])],
                'https://ok.test/api/v1/videos/' . $id => [200, json_encode($video)],
                'https://ok.test/latest_version' => [206, "\x00\x00\x00\x18ftypmp42"],
                'https://web.test' => [200, '<html>chặn</html>'],
                'https://blocked.test/api/v1/search' => [200, json_encode([invItem('aaaaaaaaaaa')])],
                'https://blocked.test/api/v1/videos/' . $id => [200, json_encode($video)],
                'https://blocked.test/latest_version' => [403, '<html>Forbidden</html>'],
            ];
            foreach ($map as $prefix => $r) {
                if (strpos($url, $prefix) === 0) {
                    if ($prefix === 'https://ok.test/latest_version') {
                        assertSame(['Range: bytes=0-1023'], $headers, 'tải thử chỉ xin 1 KB');
                    }
                    return $r;
                }
            }
            throw new RuntimeException('down');
        };
        $res = (new App\Services\VideoSourceScanner($http, 2))->scan('invidious', ['https://blocked.test', 'https://ok.test/'], false);
        assertSame(['https://ok.test', 'https://blocked.test', 'https://web.test'], array_column($res, 'base'), 'trùng địa chỉ chỉ thử một lần');
        assertTrue($res[0]['play'] && $res[1]['stream'] && !$res[1]['play'] && !$res[2]['search']);
        assertTrue(strpos($res[2]['note'], 'trả về trang web') !== false);
        assertSame('INVIDIOUS_API_URLS=https://ok.test', App\Services\VideoSourceScanner::envLine('invidious', $res));
        assertSame(null, App\Services\VideoSourceScanner::envLine('piped', []));
    } finally {
        App\Core\Config::override('invidious', $saved);
    }
});
