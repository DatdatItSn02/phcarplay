<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Config;

/**
 * Thử các địa chỉ Piped/Invidious (đang cấu hình + danh sách công khai có sẵn) theo 3 bước:
 * 1) tìm kiếm, 2) xin luồng phát một video, 3) tải thử 1 KB đầu của luồng phát (đúng như trình duyệt sẽ làm).
 * Dùng bởi lệnh php bin/video-scan.php để gợi ý dòng PIPED_API_URLS / INVIDIOUS_API_URLS dán vào .env.
 * $http (để kiểm thử): function (string $url, int $timeout, array $headers): array{0:int,1:string} (mã HTTP, nội dung).
 */
final class VideoSourceScanner
{
    /** Video thử: "Me at the zoo" - video đầu tiên của YouTube, công khai, ngắn, không bị chặn theo vùng. */
    public const TEST_VIDEO = 'jNQXAC9IVRw';

    /** Danh sách có sẵn: địa chỉ do chủ dự án cung cấp và danh sách công khai của Piped (có thể đã cũ - lệnh sẽ thử thật). */
    public const KNOWN = [
        'piped' => [
            'https://pipedapi.kavin.rocks', 'https://pipedapi.projectsegfau.lt', 'https://pipedapi-libre.kavin.rocks',
            'https://pipedapi.leptons.xyz', 'https://pipedapi.nosebs.ru', 'https://piped-api.privacy.com.de',
            'https://pipedapi.adminforge.de', 'https://api.piped.yt', 'https://pipedapi.drgns.space', 'https://pipedapi.owo.si',
            'https://pipedapi.ducks.party', 'https://piped-api.codespace.cz', 'https://pipedapi.reallyaweso.me',
            'https://api.piped.private.coffee', 'https://pipedapi.darkness.services', 'https://pipedapi.orangenet.cc',
        ],
        'invidious' => [
            'https://invidious.privacyredirect.com', 'https://vid.priv.au', 'https://invidious.nerdvpn.de',
            'https://invidious.protokolla.fi', 'https://inv.nadeko.net', 'https://yewtu.be',
        ],
    ];

    private $http;
    private int $timeout;

    public function __construct(?callable $http = null, int $timeout = 8)
    {
        $this->http = $http ?? [self::class, 'httpGet'];
        $this->timeout = $timeout;
    }

    /**
     * @param array<int,string> $extra địa chỉ thêm do người dùng nhập
     * @return array<int,array{kind:string,base:string,search:bool,stream:bool,play:bool,ms:int,note:string}>
     */
    public function scan(string $kind, array $extra = [], bool $includeKnown = true): array
    {
        $list = array_merge((array) Config::get($kind . '.instances', []), $extra, $includeKnown ? self::KNOWN[$kind] : []);
        $seen = [];
        $out = [];
        foreach ($list as $u) {
            $base = rtrim(trim((string) $u), '/');
            if ($base === '' || isset($seen[$base]) || preg_match('#^https?://#i', $base) !== 1) {
                continue;
            }
            $seen[$base] = true;
            $out[] = $this->probe($kind, $base);
        }
        usort($out, static function (array $a, array $b): int {
            return [$b['play'], $b['stream'], $b['search'], -$b['ms']] <=> [$a['play'], $a['stream'], $a['search'], -$a['ms']];
        });
        return $out;
    }

    /** Dòng .env gợi ý: các địa chỉ phát được video, nhanh nhất trước. */
    public static function envLine(string $kind, array $results): ?string
    {
        $ok = array_column(array_filter($results, static function (array $r): bool {
            return $r['play'];
        }), 'base');
        return $ok === [] ? null : strtoupper($kind) . '_API_URLS=' . implode(',', $ok);
    }

    private function probe(string $kind, string $base): array
    {
        $r = ['kind' => $kind, 'base' => $base, 'search' => false, 'stream' => false, 'play' => false, 'ms' => 0, 'note' => ''];
        $t0 = microtime(true);
        $searchPath = $kind === 'piped' ? '/search?q=music&filter=videos' : '/api/v1/search?q=music&type=video';
        [$status, $body] = $this->call($base . $searchPath);
        $r['ms'] = (int) round((microtime(true) - $t0) * 1000);
        $json = json_decode($body, true);
        $items = $kind === 'piped' ? ($json['items'] ?? null) : $json;
        if ($status === 0) {
            $r['note'] = 'không kết nối được';
            return $r;
        }
        if (!is_array($json)) {
            $r['note'] = 'HTTP ' . $status . ', trả về trang web chứ không phải dữ liệu';
            return $r;
        }
        if ($status !== 200 || isset($json['error']) || !is_array($items) || $items === []) {
            $r['note'] = 'tìm kiếm lỗi (HTTP ' . $status . ')' . self::errText($json);
            return $r;
        }
        $r['search'] = true;

        $streamPath = $kind === 'piped' ? '/streams/' . self::TEST_VIDEO : '/api/v1/videos/' . self::TEST_VIDEO . '?local=true';
        [$status, $body] = $this->call($base . $streamPath);
        $d = json_decode($body, true);
        if (!is_array($d) || $status !== 200 || isset($d['error'])) {
            $r['note'] = 'tìm được nhưng không xin được luồng phát (HTTP ' . $status . ')' . (is_array($d) ? self::errText($d) : '');
            return $r;
        }
        try {
            $norm = $kind === 'piped'
                ? YoutubeService::normalizeStream($d, self::TEST_VIDEO)
                : YoutubeService::normalizeInvidiousStream($d, self::TEST_VIDEO, $base);
        } catch (\Throwable $e) {
            $norm = ['sources' => [], 'audio' => [], 'hls' => null];
        }
        $stream = (string) ($norm['sources'][0]['url'] ?? ($norm['audio'][0]['url'] ?? ($norm['hls'] ?? '')));
        if ($stream === '') {
            $r['note'] = 'không có luồng phát';
            return $r;
        }
        $r['stream'] = true;

        [$status, $bytes] = $this->call($stream, ['Range: bytes=0-1023']);
        if (($status === 200 || $status === 206) && $bytes !== '' && json_decode($bytes, true) === null && stripos(substr($bytes, 0, 100), '<html') === false) {
            $r['play'] = true;
            $r['note'] = 'phát được';
        } else {
            $r['note'] = 'có luồng nhưng tải thử bị từ chối (HTTP ' . $status . ')';
        }
        return $r;
    }

    private static function errText(array $json): string
    {
        $m = $json['message'] ?? ($json['error'] ?? '');
        return is_string($m) && $m !== '' ? ': ' . mb_substr($m, 0, 80) : '';
    }

    /** @return array{0:int,1:string} */
    private function call(string $url, array $headers = []): array
    {
        try {
            $res = ($this->http)($url, $this->timeout, $headers);
            return [(int) $res[0], (string) $res[1]];
        } catch (\Throwable $e) {
            return [0, ''];
        }
    }

    /** @return array{0:int,1:string} */
    public static function httpGet(string $url, int $timeout, array $headers = []): array
    {
        if (!function_exists('curl_init')) {
            return UpstreamClient::fetch($url, $timeout);
        }
        $ch = curl_init($url);
        $buf = '';
        $limit = $headers === [] ? 2000000 : 4096;   // tải thử luồng phát: chỉ lấy vài KB rồi dừng, dù máy chủ bỏ qua Range
        curl_setopt_array($ch, [
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => min(5, $timeout),
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_USERAGENT => 'PHCarPlay/1.0',
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_ENCODING => '',
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_WRITEFUNCTION => static function ($ch, string $chunk) use (&$buf, $limit): int {
                $buf .= $chunk;
                return strlen($buf) > $limit ? -1 : strlen($chunk);
            },
        ]);
        curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return [$status, $buf];
    }
}
