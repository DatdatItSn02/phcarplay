<?php
declare(strict_types=1);

/** Giai đoạn 9: nguồn YouTube dự phòng (tìm kiếm trực tiếp hoặc Data API) với 5 biện pháp chống bị chặn, và phát bằng trình phát YouTube. */

use App\Core\FileCache;
use App\Services\InvidiousClient;
use App\Services\PipedClient;
use App\Services\RateLimiter;
use App\Services\YoutubeDirectClient;
use App\Services\YoutubeService;

function ytCfg(array $over = []): array
{
    return array_merge([
        'direct' => true, 'api_key' => '', 'per_hour' => 300, 'block_cooldown' => 1800, 'search_ttl' => 1800, 'embed' => true,
        'region' => 'VN', 'language' => 'vi', 'timeout' => 2, 'client_version' => '2.20251101.01.00',
        'web_base' => 'https://yt.test', 'api_base' => 'https://api.test/youtube/v3', 'suggest_url' => 'https://sg.test/complete/search',
    ], $over);
}

/** Cây JSON giống trang tìm kiếm youtubei: một videoRenderer, một video trực tiếp (không thời lượng), một lockupViewModel, mã trang sau. */
function ytSearchPage(string $a, string $b, string $token = 'TOKEN-2'): array
{
    return ['contents' => ['twoColumnSearchResultsRenderer' => ['primaryContents' => ['sectionListRenderer' => ['contents' => [
        ['itemSectionRenderer' => ['contents' => [
            ['videoRenderer' => [
                'videoId' => $a, 'title' => ['runs' => [['text' => 'Bài '], ['text' => 'một']]],
                'ownerText' => ['runs' => [['text' => 'Ca sĩ A']]], 'lengthText' => ['simpleText' => '4:12'],
                'viewCountText' => ['simpleText' => '1,234,567 views'], 'publishedTimeText' => ['simpleText' => '2 years ago'],
            ]],
            ['videoRenderer' => ['videoId' => 'LIVExxxxxxx', 'title' => ['runs' => [['text' => 'Trực tiếp']]], 'viewCountText' => ['runs' => [['text' => '900 watching']]]]],
            ['channelRenderer' => ['channelId' => 'UCxx']],
            ['lockupViewModel' => [
                'contentId' => $b, 'contentType' => 'LOCKUP_CONTENT_TYPE_VIDEO',
                'contentImage' => ['thumbnailViewModel' => ['overlays' => [['thumbnailOverlayBadgeViewModel' => ['thumbnailBadges' => [['thumbnailBadgeViewModel' => ['text' => '1:02:03']]]]]]]],
                'metadata' => ['lockupMetadataViewModel' => [
                    'title' => ['content' => 'Bài hai'],
                    'metadata' => ['contentMetadataViewModel' => ['metadataRows' => [
                        ['metadataParts' => [['text' => ['content' => 'Kênh B']]]],
                        ['metadataParts' => [['text' => ['content' => '1.2M views']], ['text' => ['content' => '3 days ago']]]],
                    ]]],
                ]],
            ]],
        ]]],
        ['continuationItemRenderer' => ['continuationEndpoint' => ['continuationCommand' => ['token' => $token, 'request' => 'CONTINUATION_REQUEST_TYPE_SEARCH']]]],
    ]]]]]];
}

/** Mạng giả theo tiền tố địa chỉ; ghi lại [phương thức, url, body]. */
function ytNet(array $routes, ?array &$log): callable
{
    $log = [];
    return function (string $method, string $url, array $headers, ?string $body) use ($routes, &$log) {
        $log[] = [$method, $url, $body, $headers];
        foreach ($routes as $prefix => $r) {
            if (strpos($method . ' ' . $url, $prefix) === 0) {
                if ($r instanceof Throwable) {
                    throw $r;
                }
                return is_callable($r) ? $r($body) : $r;
            }
        }
        return [404, 'not found'];
    };
}

function ytClient(array $routes, ?array &$log, array $cfg = []): array
{
    $dir = tmpCacheDir();
    $limiter = new RateLimiter($dir . '/rl', null, true);
    return [new YoutubeDirectClient(new FileCache($dir), ytCfg($cfg), ytNet($routes, $log), $limiter), $dir];
}

test('YouTube trực tiếp: đọc kết quả tìm kiếm (videoRenderer và dạng mới lockupViewModel), bỏ phát trực tiếp/kênh, có trang sau', function () {
    [$yt, $dir] = ytClient(['POST https://yt.test/youtubei/v1/search' => [200, json_encode(ytSearchPage('aaaaaaaaaaa', 'bbbbbbbbbbb'))]], $log);
    $r = $yt->search('nhạc trẻ');
    assertSame(['aaaaaaaaaaa', 'bbbbbbbbbbb'], array_column($r['items'], 'id'));
    assertSame('Bài một', $r['items'][0]['title']);
    assertSame('Ca sĩ A', $r['items'][0]['uploader']);
    assertSame(252, $r['items'][0]['duration']);
    assertSame(1234567, $r['items'][0]['views']);
    assertTrue($r['items'][0]['uploaded_at'] > 0);
    assertSame('https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg', $r['items'][0]['thumbnail']);
    assertSame(['Bài hai', 'Kênh B', 3723, 1200000], [$r['items'][1]['title'], $r['items'][1]['uploader'], $r['items'][1]['duration'], $r['items'][1]['views']]);
    assertSame('TOKEN-2', $r['next']);
    $body = json_decode((string) $log[0][2], true);
    assertSame('nhạc trẻ', $body['query']);
    assertSame('EgIQAQ%3D%3D', $body['params'], 'chỉ tìm video');
    assertSame('VN', $body['context']['client']['gl']);
    assertTrue(in_array('X-YouTube-Client-Name: 1', $log[0][3], true));
    rmCacheDir($dir);
});

test('YouTube trực tiếp: biện pháp 2 - cùng từ khóa lấy từ bộ nhớ đệm, không hỏi lại YouTube; trang sau gửi mã continuation', function () {
    [$yt, $dir] = ytClient(['POST https://yt.test/youtubei/v1/search' => function ($body) {
        $b = json_decode((string) $body, true);
        return [200, json_encode(isset($b['continuation']) ? ytSearchPage('ccccccccccc', 'ddddddddddd', 'TOKEN-3') : ytSearchPage('aaaaaaaaaaa', 'bbbbbbbbbbb'))];
    }], $log);
    $yt->search('a');
    $yt->search('a');
    assertSame(1, count($log), 'lần hai lấy từ bộ nhớ đệm');
    $p2 = $yt->search('a', 'TOKEN-2');
    assertSame(['ccccccccccc', 'ddddddddddd'], array_column($p2['items'], 'id'));
    assertSame('TOKEN-2', json_decode((string) $log[1][2], true)['continuation']);
    rmCacheDir($dir);
});

test('YouTube trực tiếp: biện pháp 3 - giới hạn số lần hỏi YouTube mỗi giờ cho cả website', function () {
    [$yt, $dir] = ytClient(['POST https://yt.test/youtubei/v1/search' => [200, json_encode(ytSearchPage('aaaaaaaaaaa', 'bbbbbbbbbbb'))]], $log, ['per_hour' => 2]);
    $yt->search('một');
    $yt->search('hai');
    assertThrows(fn() => $yt->search('ba'), 'YOUTUBE_UNAVAILABLE');
    assertSame(2, count($log), 'lần thứ ba không gửi tới YouTube');
    $yt->search('một');   // từ khóa cũ vẫn trả từ bộ nhớ đệm
    rmCacheDir($dir);
});

test('YouTube trực tiếp: biện pháp 4 - YouTube báo chặn (429, trang "xác nhận không phải robot", chuyển hướng) thì nghỉ, không gọi tiếp', function () {
    foreach ([[429, '{}'], [200, '<html>Sign in to confirm you’re not a bot</html>'], [302, '<a href="https://consent.youtube.com/">']] as $resp) {
        [$yt, $dir] = ytClient(['POST https://yt.test/youtubei/v1/search' => $resp], $log, ['block_cooldown' => 900]);
        assertThrows(fn() => $yt->search('a'), 'YOUTUBE_UNAVAILABLE');
        assertTrue($yt->cooldownLeft() > 800 && $yt->cooldownLeft() <= 900, 'đang nghỉ: ' . $yt->cooldownLeft());
        assertThrows(fn() => $yt->search('b'), 'YOUTUBE_UNAVAILABLE');
        assertSame(1, count($log), 'đang nghỉ thì không gửi gì tới YouTube');
        rmCacheDir($dir);
    }
    // lỗi thường (500) không làm nghỉ
    [$yt, $dir] = ytClient(['POST https://yt.test/youtubei/v1/search' => [500, '{"error":{}}']], $log);
    assertThrows(fn() => $yt->search('a'), 'YOUTUBE_UNAVAILABLE');
    assertSame(0, $yt->cooldownLeft());
    rmCacheDir($dir);
});

test('YouTube Data API (biện pháp 5): có khóa thì dùng API chính thức, không đọc trực tiếp; lấy thời lượng, bỏ phát trực tiếp, giải mã &amp;', function () {
    $search = ['nextPageToken' => 'PG2', 'items' => [
        ['id' => ['videoId' => 'aaaaaaaaaaa'], 'snippet' => ['title' => 'Anh &amp; em &#39;mưa&#39;', 'channelTitle' => 'Kênh', 'publishedAt' => '2024-01-02T03:04:05Z', 'liveBroadcastContent' => 'none']],
        ['id' => ['videoId' => 'bbbbbbbbbbb'], 'snippet' => ['title' => 'Live', 'channelTitle' => 'K', 'liveBroadcastContent' => 'live']],
    ]];
    $videos = ['items' => [['id' => 'aaaaaaaaaaa', 'contentDetails' => ['duration' => 'PT1H2M3S'], 'statistics' => ['viewCount' => '987']]]];
    [$yt, $dir] = ytClient([
        'GET https://api.test/youtube/v3/search' => [200, json_encode($search)],
        'GET https://api.test/youtube/v3/videos' => [200, json_encode($videos)],
    ], $log, ['api_key' => 'KHOA-THU']);
    assertSame('api', $yt->mode());
    $r = $yt->search('mưa');
    assertSame(1, count($r['items']));
    assertSame(["Anh & em 'mưa'", 3723, 987], [$r['items'][0]['title'], $r['items'][0]['duration'], $r['items'][0]['views']]);
    assertSame('PG2', $r['next']);
    assertTrue(strpos($log[0][1], 'key=KHOA-THU') !== false && strpos($log[0][1], 'videoEmbeddable=true') !== false && strpos($log[0][1], 'type=video') !== false);
    assertTrue(strpos($log[1][1], 'id=aaaaaaaaaaa') !== false, 'chỉ hỏi chi tiết video không phải phát trực tiếp');
    foreach ($log as $l) {
        assertTrue(strpos($l[1], 'youtubei') === false, 'có khóa thì không đọc trực tiếp');
    }
    assertSame([], $yt->related('aaaaaaaaaaa'), 'Data API không có video liên quan');
    rmCacheDir($dir);

    // khóa của website hết hạn mức: ghi nhớ tới nửa đêm giờ Thái Bình Dương, lần này và các lần sau đọc trực tiếp (không nghỉ toàn bộ)
    [$yt, $dir] = ytClient([
        'GET https://api.test/youtube/v3/search' => [403, json_encode(['error' => ['code' => 403, 'errors' => [['reason' => 'quotaExceeded']]]])],
        'POST https://yt.test/youtubei/v1/search' => [200, json_encode(ytSearchPage('ccccccccccc', 'ddddddddddd'))],
    ], $log, ['api_key' => 'KHOA-HET-LUOT-0000000000']);
    $r = $yt->search('a');
    assertSame(['ccccccccccc', 'ddddddddddd'], array_column($r['items'], 'id'), 'hết lượt thì đọc trực tiếp');
    assertSame(0, $yt->cooldownLeft(), 'không nghỉ toàn bộ');
    assertSame('quota', $yt->keyState('KHOA-HET-LUOT-0000000000'));
    assertSame('direct', $yt->mode());
    $n = count($log);
    $yt->search('b');
    assertSame(1, count($log) - $n, 'lần sau không hỏi API nữa');
    rmCacheDir($dir);
    // khóa của website sai, YOUTUBE_DIRECT=false: báo lỗi chung, không lộ khóa
    [$yt, $dir] = ytClient(['GET https://api.test/youtube/v3/search' => [400, json_encode(['error' => ['code' => 400, 'errors' => [['reason' => 'keyInvalid']]]])]], $log, ['api_key' => 'KHOA-SAI-000000000000000', 'direct' => false]);
    assertThrows(fn() => $yt->search('a'), 'YOUTUBE_UNAVAILABLE');
    assertSame('invalid', $yt->keyState('KHOA-SAI-000000000000000'));
    rmCacheDir($dir);
    // nửa đêm giờ Thái Bình Dương: 2026-11-05 07:00 UTC = 23:00 ngày 4 ở Los Angeles -> còn 1 giờ
    assertSame(3600, YoutubeDirectClient::secondsToQuotaReset(gmmktime(7, 0, 0, 11, 5, 2026)));
});

test('YouTube: gợi ý tìm kiếm, video liên quan (next), tắt hẳn bằng YOUTUBE_DIRECT=false, lỗi mạng', function () {
    [$yt, $dir] = ytClient([
        'GET https://sg.test/complete/search' => [200, '["nhac",["nhạc trẻ","nhạc vàng"]]'],
        'POST https://yt.test/youtubei/v1/next' => [200, json_encode(['contents' => ['secondaryResults' => ytSearchPage('rrrrrrrrrrr', 'zzzzzzzzzzz')]])],
    ], $log);
    assertSame(['nhạc trẻ', 'nhạc vàng'], $yt->suggest('nhac'));
    assertTrue(strpos($log[0][1], 'ds=yt') !== false && strpos($log[0][1], 'q=nhac') !== false);
    assertSame(['rrrrrrrrrrr', 'zzzzzzzzzzz'], array_column($yt->related('qqqqqqqqqqq'), 'id'));
    assertSame('qqqqqqqqqqq', json_decode((string) $log[1][2], true)['videoId']);
    rmCacheDir($dir);

    [$yt, $dir] = ytClient([], $log, ['direct' => false]);
    assertSame('off', $yt->mode());
    assertThrows(fn() => $yt->search('a'), 'YOUTUBE_UNAVAILABLE');
    assertSame(0, count($log));
    rmCacheDir($dir);

    [$yt, $dir] = ytClient(['POST https://yt.test' => new RuntimeException('Could not resolve host')], $log);
    assertThrows(fn() => $yt->search('a'), 'YOUTUBE_UNAVAILABLE');
    rmCacheDir($dir);
    assertSame(0, YoutubeDirectClient::clock('LIVE'));
    assertSame(0, YoutubeDirectClient::isoDuration('P0D'));
    assertSame(90061, YoutubeDirectClient::isoDuration('P1DT1H1M1S'));
});

test('YoutubeService: biện pháp 1 - chỉ hỏi YouTube khi Piped và Invidious đều hỏng; trang sau có tiền tố y:/a: đi thẳng YouTube', function () {
    $dir = tmpCacheDir();
    $cache = new FileCache($dir);
    $calls = [];
    $pipedNet = function (string $url) use (&$calls) {
        $calls[] = $url;
        throw new RuntimeException('timeout');
    };
    $piped = new PipedClient($cache, ['instances' => ['https://p.test']], $pipedNet);
    $inv = new InvidiousClient($cache, ['instances' => ['https://i.test']], $pipedNet);
    $direct = new YoutubeDirectClient($cache, ytCfg(), ytNet(['POST https://yt.test/youtubei/v1/search' => [200, json_encode(ytSearchPage('aaaaaaaaaaa', 'bbbbbbbbbbb'))]], $ytLog), new RateLimiter($dir . '/rl', null, true));
    $svc = new YoutubeService($piped, $inv, $direct);
    $r = $svc->search('mưa');
    assertSame(['aaaaaaaaaaa', 'bbbbbbbbbbb'], array_column($r['items'], 'id'));
    assertSame('y:TOKEN-2', $r['next']);
    assertSame(2, count($calls), 'đã thử Piped và Invidious trước');
    $svc->search('mưa', 'y:TOKEN-2');
    assertSame(2, count($calls), 'trang sau của YouTube không gọi lại Piped/Invidious');
    assertSame('TOKEN-2', json_decode((string) end($ytLog)[2], true)['continuation']);
    rmCacheDir($dir);

    // Piped chạy được thì không hỏi YouTube
    $dir = tmpCacheDir();
    $cache = new FileCache($dir);
    $ok = function () { return [200, json_encode(['items' => [['url' => '/watch?v=ppppppppppp', 'type' => 'stream', 'title' => 'P', 'duration' => 100]], 'nextpage' => null])]; };
    $direct = new YoutubeDirectClient($cache, ytCfg(), ytNet([], $ytLog2), new RateLimiter($dir . '/rl', null, true));
    $svc = new YoutubeService(new PipedClient($cache, ['instances' => ['https://p.test']], $ok), null, $direct);
    assertSame(['ppppppppppp'], array_column($svc->search('x')['items'], 'id'));
    assertSame(0, count($ytLog2));
    rmCacheDir($dir);
});

test('YoutubeService: không có luồng trực tiếp thì phát bằng trình phát YouTube kèm video liên quan; nguồn YouTube lỗi vẫn phát được', function () {
    $dir = tmpCacheDir();
    $cache = new FileCache($dir);
    $down = function () { throw new RuntimeException('down'); };
    $direct = new YoutubeDirectClient($cache, ytCfg(), ytNet(['POST https://yt.test/youtubei/v1/next' => [200, json_encode(ytSearchPage('rrrrrrrrrrr', 'sssssssssss'))]], $l), new RateLimiter($dir . '/rl', null, true));
    $svc = new YoutubeService(new PipedClient($cache, ['instances' => ['https://p.test']], $down), new InvidiousClient($cache, ['instances' => ['https://i.test']], $down), $direct);
    $s = $svc->stream('dQw4w9WgXcQ');
    assertSame([true, 'youtube', 'dQw4w9WgXcQ'], [$s['embed'], $s['source'], $s['id']]);
    assertSame(['rrrrrrrrrrr', 'sssssssssss'], array_column($s['related'], 'id'));
    rmCacheDir($dir);

    $dir = tmpCacheDir();
    $cache = new FileCache($dir);
    $direct = new YoutubeDirectClient($cache, ytCfg(), ytNet(['POST https://yt.test' => [429, '']], $l2), new RateLimiter($dir . '/rl', null, true));
    $svc = new YoutubeService(new PipedClient($cache, ['instances' => ['https://p.test']], $down), null, $direct);
    $s = $svc->stream('dQw4w9WgXcQ');
    assertSame(true, $s['embed']);
    assertSame([], $s['related'], 'YouTube chặn thì vẫn phát nhúng, chỉ thiếu bài liên quan');
    assertThrows(fn() => $svc->search('x'), 'UPSTREAM_FAILED');
    rmCacheDir($dir);
});

test('DEFAULT_VIDEO_URL: lấy mã video từ mọi dạng đường dẫn YouTube; sai dạng thì bỏ qua', function () {
    foreach ([
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=30s', 'youtu.be/dQw4w9WgXcQ',
        'https://youtu.be/dQw4w9WgXcQ?si=abc', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RD',
        'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ', '  dQw4w9WgXcQ  ',
    ] as $u) {
        assertSame('dQw4w9WgXcQ', YoutubeService::videoIdFromUrl($u), $u);
    }
    foreach (['', 'https://evil.example/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/', 'https://www.youtube.com/watch?v=ngan', 'javascript:alert(1)'] as $u) {
        assertSame(null, YoutubeService::videoIdFromUrl($u), $u);
    }
});

test('Nhạc mở đầu (trending): YouTube thật hay trả tuyển tập dài; ít bài vừa độ dài thì lấy cả danh sách, bài vừa độ dài trước', function () {
    $dir = tmpCacheDir();
    $cache = new FileCache($dir);
    $mk = function (string $id, string $len) { return ['videoRenderer' => ['videoId' => $id, 'title' => ['runs' => [['text' => $id]]], 'lengthText' => ['simpleText' => $len]]]; };
    $page = ['contents' => [$mk('aaaaaaaaaaa', '1:05:00'), $mk('bbbbbbbbbbb', '3:30'), $mk('ccccccccccc', '2:10:00')]];
    $down = function () { throw new RuntimeException('down'); };
    $direct = new YoutubeDirectClient($cache, ytCfg(), ytNet(['POST https://yt.test/youtubei/v1/search' => [200, json_encode($page)]], $l), new RateLimiter($dir . '/rl', null, true));
    $svc = new YoutubeService(new PipedClient($cache, ['instances' => ['https://p.test']], $down), null, $direct);
    assertSame(['bbbbbbbbbbb', 'aaaaaaaaaaa', 'ccccccccccc'], array_column($svc->trending(), 'id'));
    rmCacheDir($dir);
});
