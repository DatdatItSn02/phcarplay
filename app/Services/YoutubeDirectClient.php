<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Config;
use App\Core\FileCache;
use App\Core\HttpException;
use App\Core\Logger;
use App\Core\Validator;

/**
 * Nguồn dự phòng thứ ba: lấy kết quả tìm kiếm thẳng từ YouTube khi Piped và Invidious đều hỏng.
 *  - Có YOUTUBE_API_KEY: dùng YouTube Data API v3 chính thức (đúng điều khoản; mỗi lần tìm tốn 101 đơn vị hạn mức/ngày).
 *  - Không có khóa: đọc trực tiếp giao diện nội bộ "youtubei" mà chính trang youtube.com dùng (giống công cụ yt-dlp).
 * 5 biện pháp để không làm YouTube chặn địa chỉ IP của máy chủ:
 *  1. chỉ được gọi khi Piped/Invidious hỏng (thứ tự nguồn ở YoutubeService);
 *  2. lưu đệm kết quả (YOUTUBE_SEARCH_TTL, mặc định 30 phút): cùng từ khóa không hỏi lại YouTube;
 *  3. giới hạn tổng số lần hỏi YouTube của cả website mỗi giờ (YOUTUBE_DIRECT_PER_HOUR, mặc định 300);
 *  4. YouTube báo chặn (429, 403, trang "xác nhận không phải robot") thì nghỉ YOUTUBE_BLOCK_COOLDOWN giây (mặc định 30 phút);
 *  5. có khóa API thì không đọc trực tiếp nữa (trừ khi khóa hết hạn mức trong ngày hoặc sai: khi đó mới đọc trực tiếp).
 * Giai đoạn 10: người dùng có thể nhập khóa API riêng (UserApiKeyService); searchWithKey() tìm bằng khóa đó.
 * Mỗi khóa (của website hoặc của người dùng) hết hạn mức thì được ghi nhớ tới nửa đêm giờ Thái Bình Dương
 * (giờ YouTube đặt lại hạn mức), khóa sai thì ghi nhớ 1 giờ, để không gọi vô ích.
 * Lỗi của lớp này là HttpException mã YOUTUBE_UNAVAILABLE (hoặc YOUTUBE_KEY_QUOTA / YOUTUBE_KEY_INVALID khi tìm bằng
 * khóa riêng) để YoutubeService biết mà chuyển nguồn khác / báo lỗi chung.
 *
 * $http (để kiểm thử): function (string $method, string $url, array $headers, ?string $body, int $timeout): array{0:int,1:string}
 */
final class YoutubeDirectClient
{
    /** Bộ lọc "chỉ video" của trang tìm kiếm YouTube. */
    private const SEARCH_PARAMS = 'EgIQAQ%3D%3D';

    private FileCache $cache;
    private ?array $cfg;
    private $http;
    private RateLimiter $budget;

    /** @param RateLimiter|null $budget không khai báo kiểu để Container không tự tạo bộ đếm theo RATE_LIMIT (bộ đếm này luôn bật) */
    public function __construct(FileCache $cache, ?array $cfg = null, ?callable $http = null, $budget = null)
    {
        $this->cache = $cache;
        $this->cfg = $cfg;
        $this->http = $http ?? [self::class, 'httpRequest'];
        // Giới hạn số lần mỗi giờ luôn bật, kể cả khi RATE_LIMIT=false (đây là bảo vệ địa chỉ IP của máy chủ).
        $this->budget = $budget instanceof RateLimiter ? $budget : new RateLimiter(null, null, true);
    }

    /** Mã video dùng để thử khóa API (lệnh videos.list tốn 1 đơn vị hạn mức). */
    private const TEST_VIDEO = 'dQw4w9WgXcQ';

    /** 'api' (có khóa của website còn dùng được), 'direct' (đọc trực tiếp) hoặc 'off'. */
    public function mode(): string
    {
        $key = $this->siteKey();
        if ($key !== '' && $this->keyState($key) === null) {
            return 'api';
        }
        return $this->directEnabled() ? 'direct' : 'off';
    }

    private function siteKey(): string
    {
        return trim((string) ($this->config()['api_key'] ?? ''));
    }

    private function directEnabled(): bool
    {
        return !empty($this->config()['direct']);
    }

    /** Khóa API đang bị ghi nhớ là 'quota' (hết hạn mức hôm nay) hoặc 'invalid' (sai/không dùng được); null = dùng được. */
    public function keyState(string $key): ?string
    {
        $v = $this->cache->get('youtube:key:' . sha1($key));
        return $v === 'quota' || $v === 'invalid' ? $v : null;
    }

    private function markKey(string $key, string $state): void
    {
        $this->cache->set('youtube:key:' . sha1($key), $state, $state === 'quota' ? self::secondsToQuotaReset() : 3600);
    }

    /** Số giây tới nửa đêm giờ Thái Bình Dương (YouTube đặt lại hạn mức Data API lúc đó). */
    public static function secondsToQuotaReset(?int $now = null): int
    {
        $tz = new \DateTimeZone('America/Los_Angeles');
        $at = (new \DateTimeImmutable('@' . ($now ?? time())))->setTimezone($tz);
        $midnight = $at->setTime(0, 0)->modify('+1 day');
        return max(60, $midnight->getTimestamp() - $at->getTimestamp());
    }

    /** Số giây còn phải nghỉ vì YouTube vừa báo chặn (0 = không nghỉ). */
    public function cooldownLeft(): int
    {
        $until = $this->cache->get('youtube:blocked_until');
        return is_int($until) ? max(0, $until - time()) : 0;
    }

    /**
     * Tìm video. $page: mã trang kế tiếp do chính lớp này trả lần trước (null = trang đầu).
     * @return array{items: array<int,array>, next: ?string}
     */
    public function search(string $q, ?string $page = null): array
    {
        $mode = $this->mode();
        $ttl = max(60, (int) ($this->config()['search_ttl'] ?? 1800));
        $key = 'youtube:' . $mode . ':search:' . md5($q . '|' . (string) $page);
        $hit = $this->cache->get($key);
        if (is_array($hit) && isset($hit['items'])) {
            return $hit;
        }
        if ($mode === 'api') {
            try {
                $result = $this->apiSearch($this->siteKey(), $q, $page);
            } catch (HttpException $e) {
                // khóa của website vừa hết hạn mức / sai: đọc trực tiếp (chỉ được với trang đầu, mã trang của API không dùng được)
                if ($this->mode() !== 'direct' || ($page !== null && $page !== '')) {
                    throw new HttpException(502, 'YOUTUBE_UNAVAILABLE', $e->getMessage());
                }
                $result = $this->directSearch($q, null);
                $key = 'youtube:direct:search:' . md5($q . '|');
            }
        } else {
            $result = $this->directSearch($q, $page);
        }
        $this->cache->set($key, $result, $ttl);
        return $result;
    }

    /**
     * Tìm bằng khóa API riêng của người dùng. Kết quả lưu đệm chung với khóa của website (cùng từ khóa không tốn lượt lần nữa).
     * Lỗi: YOUTUBE_KEY_QUOTA (khóa hết hạn mức hôm nay), YOUTUBE_KEY_INVALID (khóa sai), YOUTUBE_UNAVAILABLE (mạng/YouTube lỗi).
     * @return array{items: array<int,array>, next: ?string}
     */
    public function searchWithKey(string $apiKey, string $q, ?string $page = null): array
    {
        $ttl = max(60, (int) ($this->config()['search_ttl'] ?? 1800));
        $key = 'youtube:api:search:' . md5($q . '|' . (string) $page);
        $hit = $this->cache->get($key);
        if (is_array($hit) && isset($hit['items'])) {
            return $hit;
        }
        $state = $this->keyState($apiKey);
        if ($state !== null) {
            throw self::keyError($state);
        }
        $result = $this->apiSearch($apiKey, $q, $page, true);
        $this->cache->set($key, $result, $ttl);
        return $result;
    }

    /**
     * Thử một khóa API (tốn 1 đơn vị hạn mức của chính khóa đó). Trả:
     *  'ok' | 'quota' (hết lượt hôm nay) | 'error' (mạng lỗi, chưa biết) |
     *  'bad_key' (khóa sai / dán thiếu) | 'not_enabled' (dự án chưa bật YouTube Data API v3) |
     *  'referrer_blocked' (khóa giới hạn theo website/IP) | 'api_blocked' (khóa không cho dùng YouTube Data API v3) | 'invalid' (lý do khác).
     * Thử thành công thì bỏ dấu "sai/hết lượt" đã ghi nhớ (người dùng vừa sửa khóa trên Google).
     */
    public function testKey(string $apiKey): string
    {
        try {
            $this->apiGet('videos', ['part' => 'id', 'id' => self::TEST_VIDEO, 'key' => $apiKey], $apiKey, true);
            $this->cache->forget('youtube:key:' . sha1($apiKey));
            return 'ok';
        } catch (HttpException $e) {
            if ($e->errorCode === 'YOUTUBE_KEY_QUOTA') {
                return 'quota';
            }
            if ($e->errorCode === 'YOUTUBE_KEY_INVALID') {
                return (string) ($e->details['reason'] ?? 'invalid');
            }
            return 'error';
        }
    }

    /**
     * Phân loại lỗi của Google từ mọi chỗ có lý do: error.errors[].reason, error.details[].reason (ErrorInfo), error.status.
     * @return string 'quota' | 'bad_key' | 'not_enabled' | 'referrer_blocked' | 'api_blocked' | 'invalid' | ''
     */
    public static function classifyApiError(int $status, $data): string
    {
        $reasons = [];
        if (is_array($data) && isset($data['error']) && is_array($data['error'])) {
            foreach ((array) ($data['error']['errors'] ?? []) as $e) {
                if (is_array($e) && isset($e['reason'])) { $reasons[] = (string) $e['reason']; }
            }
            foreach ((array) ($data['error']['details'] ?? []) as $d) {
                if (is_array($d) && isset($d['reason'])) { $reasons[] = (string) $d['reason']; }
            }
            if (isset($data['error']['status'])) { $reasons[] = (string) $data['error']['status']; }
        }
        $has = static function (array $list) use ($reasons): bool { return array_intersect($list, $reasons) !== []; };
        if ($has(['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'RATE_LIMIT_EXCEEDED', 'RESOURCE_EXHAUSTED'])) { return 'quota'; }
        if ($has(['accessNotConfigured', 'SERVICE_DISABLED'])) { return 'not_enabled'; }
        if ($has(['ipRefererBlocked', 'API_KEY_HTTP_REFERRER_BLOCKED', 'API_KEY_IP_ADDRESS_BLOCKED', 'API_KEY_ANDROID_APP_BLOCKED', 'API_KEY_IOS_APP_BLOCKED'])) { return 'referrer_blocked'; }
        if ($has(['API_KEY_SERVICE_BLOCKED'])) { return 'api_blocked'; }
        if ($has(['keyInvalid', 'API_KEY_INVALID', 'keyExpired', 'API_KEY_EXPIRED'])) { return 'bad_key'; }
        if ($has(['badRequest', 'forbidden', 'PERMISSION_DENIED', 'INVALID_ARGUMENT']) || ($status === 400 && $reasons === [])) { return 'invalid'; }
        return '';
    }

    private static function keyError(string $state): HttpException
    {
        return $state === 'quota'
            ? new HttpException(502, 'YOUTUBE_KEY_QUOTA', 'Khóa YouTube API của bạn đã hết lượt hôm nay.')
            : new HttpException(502, 'YOUTUBE_KEY_INVALID', 'Khóa YouTube API của bạn không dùng được.');
    }

    /** @return array<int,string> gợi ý tìm kiếm (dịch vụ gợi ý công khai của Google cho YouTube) */
    public function suggest(string $q): array
    {
        $key = 'youtube:suggest:' . md5($q);
        $hit = $this->cache->get($key);
        if (is_array($hit)) {
            return $hit;
        }
        $this->guard();
        $cfg = $this->config();
        $url = (string) $cfg['suggest_url'] . '?' . http_build_query([
            'client' => 'firefox', 'ds' => 'yt', 'hl' => (string) $cfg['language'], 'gl' => (string) $cfg['region'],
            'ie' => 'utf-8', 'oe' => 'utf-8', 'q' => $q,
        ], '', '&', PHP_QUERY_RFC3986);
        [$status, $body] = $this->send('GET', $url, ['Accept: application/json'], null);
        if (!mb_check_encoding($body, 'UTF-8')) {
            $body = (string) mb_convert_encoding($body, 'UTF-8', 'ISO-8859-1');
        }
        $data = json_decode($body, true);
        if ($status !== 200 || !is_array($data) || !isset($data[1]) || !is_array($data[1])) {
            throw $this->failure('gợi ý trả dữ liệu lạ (HTTP ' . $status . ')', $status, $body);
        }
        $out = [];
        foreach ($data[1] as $s) {
            if (is_string($s) && $s !== '') {
                $out[] = Validator::text($s, 100);
            }
            if (count($out) >= 8) {
                break;
            }
        }
        $this->cache->set($key, $out, 3600);
        return $out;
    }

    /**
     * Video liên quan (cho chế độ Mix khi phát bằng trình phát YouTube). Chỉ khi đọc trực tiếp;
     * Data API đã bỏ tìm video liên quan nên chế độ có khóa trả danh sách rỗng (Mix sẽ tìm theo tên bài).
     * @return array<int,array>
     */
    public function related(string $id): array
    {
        if ($this->mode() !== 'direct' || !YoutubeService::isVideoId($id)) {
            return [];
        }
        $key = 'youtube:related:' . $id;
        $hit = $this->cache->get($key);
        if (is_array($hit)) {
            return $hit;
        }
        $data = $this->innertube('next', ['videoId' => $id]);
        $items = array_values(array_filter(self::parseVideos($data), static function (array $v) use ($id): bool {
            return $v['id'] !== $id;
        }));
        $items = array_slice($items, 0, 20);
        $this->cache->set($key, $items, 3600);
        return $items;
    }

    // ---------- đọc trực tiếp (youtubei) ----------

    private function directSearch(string $q, ?string $page): array
    {
        $body = $page !== null && $page !== '' ? ['continuation' => $page] : ['query' => $q, 'params' => self::SEARCH_PARAMS];
        $data = $this->innertube('search', $body);
        return ['items' => self::parseVideos($data), 'next' => self::findContinuation($data)];
    }

    private function innertube(string $endpoint, array $body): array
    {
        $this->guard();
        $cfg = $this->config();
        $version = (string) $cfg['client_version'];
        $payload = array_merge([
            'context' => ['client' => ['clientName' => 'WEB', 'clientVersion' => $version, 'hl' => 'en', 'gl' => (string) $cfg['region']]],
        ], $body);
        $url = (string) $cfg['web_base'] . '/youtubei/v1/' . $endpoint . '?prettyPrint=false';
        [$status, $raw] = $this->send('POST', $url, [
            'Content-Type: application/json',
            'Accept: application/json',
            'Accept-Language: en',
            'Origin: ' . (string) $cfg['web_base'],
            'X-YouTube-Client-Name: 1',
            'X-YouTube-Client-Version: ' . $version,
            'Cookie: SOCS=CAI',   // bỏ qua trang hỏi đồng ý cookie (giống yt-dlp)
        ], (string) json_encode($payload));
        $data = json_decode($raw, true);
        if ($status !== 200 || !is_array($data)) {
            throw $this->failure('youtubei/' . $endpoint . ' HTTP ' . $status . (is_array($data) ? '' : ', không phải dữ liệu JSON'), $status, $raw);
        }
        return $data;
    }

    // ---------- YouTube Data API v3 ----------

    private function apiSearch(string $apiKey, string $q, ?string $page, bool $own = false): array
    {
        $cfg = $this->config();
        $params = [
            'part' => 'snippet', 'type' => 'video', 'maxResults' => 20, 'q' => $q,
            'regionCode' => (string) $cfg['region'], 'relevanceLanguage' => (string) $cfg['language'],
            'videoEmbeddable' => 'true',   // chỉ lấy video cho phép phát nhúng
            'key' => $apiKey,
        ];
        if ($page !== null && $page !== '') {
            $params['pageToken'] = $page;
        }
        $data = $this->apiGet('search', $params, $apiKey, $own);
        $ids = [];
        $snippets = [];
        foreach ((array) ($data['items'] ?? []) as $it) {
            $id = is_array($it) ? (string) ($it['id']['videoId'] ?? '') : '';
            $sn = is_array($it) ? (array) ($it['snippet'] ?? []) : [];
            if (YoutubeService::isVideoId($id) && (($sn['liveBroadcastContent'] ?? 'none') === 'none')) {
                $ids[] = $id;
                $snippets[$id] = $sn;
            }
        }
        $details = [];
        if ($ids !== []) {   // thời lượng và lượt xem nằm ở API khác (1 đơn vị hạn mức)
            $v = $this->apiGet('videos', ['part' => 'contentDetails,statistics', 'id' => implode(',', $ids), 'key' => $apiKey], $apiKey, $own);
            foreach ((array) ($v['items'] ?? []) as $it) {
                if (is_array($it) && isset($it['id'])) {
                    $details[(string) $it['id']] = $it;
                }
            }
        }
        $items = [];
        foreach ($ids as $id) {
            $sn = $snippets[$id];
            $d = $details[$id] ?? [];
            $duration = self::isoDuration((string) ($d['contentDetails']['duration'] ?? ''));
            $title = Validator::text(html_entity_decode((string) ($sn['title'] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8'), 255);
            if ($duration <= 0 || $title === '') {
                continue;
            }
            $published = strtotime((string) ($sn['publishedAt'] ?? ''));
            $items[] = [
                'id' => $id,
                'title' => $title,
                'uploader' => Validator::text(html_entity_decode((string) ($sn['channelTitle'] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8'), 150),
                'duration' => $duration,
                'thumbnail' => self::thumb($id),
                'views' => max(0, (int) ($d['statistics']['viewCount'] ?? 0)),
                'uploaded_at' => $published !== false ? $published * 1000 : 0,
            ];
        }
        $next = isset($data['nextPageToken']) && is_string($data['nextPageToken']) && $data['nextPageToken'] !== '' ? $data['nextPageToken'] : null;
        return ['items' => $items, 'next' => $next];
    }

    /**
     * Gọi YouTube Data API bằng khóa $apiKey ($own = khóa riêng của người dùng). API chính thức nên không tính vào giới hạn
     * mỗi giờ của việc đọc trực tiếp và không bị chặn bởi thời gian nghỉ. Khóa hết hạn mức / sai thì ghi nhớ (markKey).
     */
    private function apiGet(string $endpoint, array $params, string $apiKey, bool $own = false): array
    {
        $url = (string) $this->config()['api_base'] . '/' . $endpoint . '?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
        [$status, $raw] = $this->send('GET', $url, ['Accept: application/json'], null);
        $data = json_decode($raw, true);
        if ($status === 200 && is_array($data)) {
            return $data;
        }
        $reason = is_array($data) ? (string) ($data['error']['errors'][0]['reason'] ?? ($data['error']['status'] ?? '')) : '';
        $kind = self::classifyApiError($status, $data);
        $who = $own ? 'khóa của người dùng' : 'khóa của website (YOUTUBE_API_KEY)';
        if ($kind === 'quota') {
            $this->markKey($apiKey, 'quota');
            Logger::error('YouTube Data API: ' . $who . ' hết hạn mức trong ngày (' . $reason . ')');
            throw $own ? self::keyError('quota') : new HttpException(502, 'YOUTUBE_UNAVAILABLE', 'Khóa YouTube API của website đã hết lượt hôm nay.');
        }
        if ($kind !== '') {
            $this->markKey($apiKey, 'invalid');
            Logger::error('YouTube Data API: ' . $who . ' không dùng được (HTTP ' . $status . ', ' . $kind . ($reason !== '' ? ', ' . $reason : '') . ')');
            if ($own) {
                $err = self::keyError('invalid');
                $err->details['reason'] = $kind;
                throw $err;
            }
            throw new HttpException(502, 'YOUTUBE_UNAVAILABLE', 'Khóa YouTube Data API của website không dùng được (' . $kind . '). Hãy kiểm tra YOUTUBE_API_KEY.');
        }
        Logger::error('YouTube Data API HTTP ' . $status . ($reason !== '' ? ' (' . $reason . ')' : ''));
        throw new HttpException(502, 'YOUTUBE_UNAVAILABLE', 'Không lấy được kết quả từ YouTube. Vui lòng thử lại sau ít phút.');
    }

    // ---------- giới hạn, nghỉ khi bị chặn, gửi yêu cầu ----------

    /** Kiểm tra trước mỗi lần hỏi YouTube: còn đang nghỉ không, còn trong giới hạn mỗi giờ không. */
    private function guard(): void
    {
        if ($this->mode() === 'off') {
            throw new HttpException(503, 'YOUTUBE_UNAVAILABLE', 'Tìm kiếm trực tiếp từ YouTube đang tắt (YOUTUBE_DIRECT=false).');
        }
        if ($this->cooldownLeft() > 0) {
            throw new HttpException(503, 'YOUTUBE_UNAVAILABLE', 'YouTube đang tạm chặn máy chủ, sẽ thử lại sau ít phút.');
        }
        $max = (int) ($this->config()['per_hour'] ?? 300);
        if ($max > 0 && $this->budget->consume('youtube:direct:hour', $max, 3600) > 0) {
            throw new HttpException(503, 'YOUTUBE_UNAVAILABLE', 'Đã dùng hết số lần hỏi YouTube trong giờ này. Vui lòng thử lại sau.');
        }
    }

    /** @return array{0:int,1:string} */
    private function send(string $method, string $url, array $headers, ?string $body): array
    {
        $timeout = max(2, (int) ($this->config()['timeout'] ?? 8));
        try {
            $r = ($this->http)($method, $url, $headers, $body, $timeout);
            return [(int) $r[0], (string) $r[1]];
        } catch (\Throwable $e) {
            Logger::error('YouTube: không kết nối được: ' . (string) preg_replace('/key=[^&\s]+/', 'key=***', $e->getMessage()));   // không ghi khóa API vào log
            throw new HttpException(502, 'YOUTUBE_UNAVAILABLE', 'Không kết nối được YouTube. Vui lòng thử lại sau ít phút.');
        }
    }

    /** Lỗi khi YouTube trả dữ liệu lạ; nếu là dấu hiệu bị chặn thì cho nghỉ. */
    private function failure(string $what, int $status, string $body): HttpException
    {
        $blocked = in_array($status, [403, 429], true) || ($status >= 300 && $status < 400)   // bị chuyển sang trang đồng ý cookie/đăng nhập
            || stripos($body, 'confirm you') !== false || stripos($body, 'unusual traffic') !== false
            || stripos($body, 'consent.youtube.com') !== false || stripos($body, 'captcha') !== false;
        if ($blocked) {
            $this->rest($what, (int) ($this->config()['block_cooldown'] ?? 1800));
        } else {
            Logger::error('YouTube: ' . $what);
        }
        return new HttpException(502, 'YOUTUBE_UNAVAILABLE', 'Không lấy được kết quả từ YouTube. Vui lòng thử lại sau ít phút.');
    }

    private function rest(string $why, int $seconds): void
    {
        $seconds = max(60, $seconds);
        $this->cache->set('youtube:blocked_until', time() + $seconds, $seconds);
        Logger::error('YouTube báo chặn/giới hạn, tạm nghỉ ' . $seconds . ' giây: ' . $why);
    }

    private function config(): array
    {
        return $this->cfg ?? (array) Config::get('youtube', []);
    }

    // ---------- đọc dữ liệu youtubei ----------

    /**
     * Gom mọi video trong cây JSON của youtubei (videoRenderer, compactVideoRenderer, lockupViewModel),
     * không phụ thuộc vị trí cụ thể, để ít bị hỏng khi YouTube đổi bố cục trang.
     * @return array<int,array>
     */
    public static function parseVideos(array $data): array
    {
        $found = [];
        self::walk($data, $found, 0);
        $out = [];
        $seen = [];
        foreach ($found as $v) {
            if ($v !== null && !isset($seen[$v['id']])) {
                $seen[$v['id']] = true;
                $out[] = $v;
            }
        }
        return $out;
    }

    private static function walk($node, array &$found, int $depth): void
    {
        if (!is_array($node) || $depth > 40) {
            return;
        }
        foreach ($node as $key => $child) {
            if (($key === 'videoRenderer' || $key === 'compactVideoRenderer') && is_array($child)) {
                $found[] = self::fromRenderer($child);
                continue;
            }
            if ($key === 'lockupViewModel' && is_array($child)) {
                $found[] = self::fromLockup($child);
                continue;
            }
            self::walk($child, $found, $depth + 1);
        }
    }

    private static function fromRenderer(array $r): ?array
    {
        $id = (string) ($r['videoId'] ?? '');
        $title = self::text($r['title'] ?? null);
        $length = self::text($r['lengthText'] ?? null);
        $duration = self::clock($length);
        if (!YoutubeService::isVideoId($id) || $title === '' || $duration <= 0) {   // bỏ phát trực tiếp (không có thời lượng)
            return null;
        }
        return [
            'id' => $id,
            'title' => Validator::text($title, 255),
            'uploader' => Validator::text(self::text($r['ownerText'] ?? ($r['longBylineText'] ?? ($r['shortBylineText'] ?? null))), 150),
            'duration' => $duration,
            'thumbnail' => self::thumb($id),
            'views' => self::number(self::text($r['viewCountText'] ?? null)),
            'uploaded_at' => self::ago(self::text($r['publishedTimeText'] ?? null)),
        ];
    }

    /** Dạng mới của YouTube (2025): thông tin nằm rải rác trong các "view model". */
    private static function fromLockup(array $r): ?array
    {
        $id = (string) ($r['contentId'] ?? '');
        $type = (string) ($r['contentType'] ?? 'LOCKUP_CONTENT_TYPE_VIDEO');
        if (!YoutubeService::isVideoId($id) || $type !== 'LOCKUP_CONTENT_TYPE_VIDEO') {
            return null;
        }
        $meta = (array) ($r['metadata']['lockupMetadataViewModel'] ?? []);
        $title = (string) ($meta['title']['content'] ?? '');
        $texts = [];
        self::contents($meta['metadata'] ?? [], $texts, 0);
        $imageTexts = [];
        self::contents($r['contentImage'] ?? [], $imageTexts, 0);
        $duration = 0;
        foreach ($imageTexts as $t) {
            $duration = self::clock($t);
            if ($duration > 0) {
                break;
            }
        }
        if ($title === '' || $duration <= 0) {
            return null;
        }
        $views = 0;
        $uploaded = 0;
        foreach ($texts as $t) {
            if ($views === 0 && stripos($t, 'view') !== false) {
                $views = self::number($t);
            }
            if ($uploaded === 0 && stripos($t, 'ago') !== false) {
                $uploaded = self::ago($t);
            }
        }
        return [
            'id' => $id,
            'title' => Validator::text($title, 255),
            'uploader' => Validator::text($texts[0] ?? '', 150),
            'duration' => $duration,
            'thumbnail' => self::thumb($id),
            'views' => $views,
            'uploaded_at' => $uploaded,
        ];
    }

    /** Gom các chuỗi "content" (văn bản hiển thị) theo thứ tự xuất hiện. */
    private static function contents($node, array &$out, int $depth): void
    {
        if (!is_array($node) || $depth > 20) {
            return;
        }
        foreach ($node as $key => $child) {
            if (($key === 'content' || $key === 'text') && is_string($child) && trim($child) !== '') {
                $out[] = trim($child);
            } else {
                self::contents($child, $out, $depth + 1);
            }
        }
    }

    public static function findContinuation(array $data): ?string
    {
        $stack = [$data];
        $guard = 0;
        while ($stack !== [] && $guard++ < 20000) {
            $node = array_pop($stack);
            foreach ($node as $key => $child) {
                if ($key === 'continuationCommand' && is_array($child) && isset($child['token']) && is_string($child['token']) && $child['token'] !== '') {
                    return strlen($child['token']) <= 4000 ? $child['token'] : null;
                }
                if (is_array($child)) {
                    $stack[] = $child;
                }
            }
        }
        return null;
    }

    /** Văn bản từ {simpleText} hoặc {runs:[{text}]}. */
    private static function text($v): string
    {
        if (is_string($v)) {
            return trim($v);
        }
        if (!is_array($v)) {
            return '';
        }
        if (isset($v['simpleText']) && is_string($v['simpleText'])) {
            return trim($v['simpleText']);
        }
        $out = '';
        foreach ((array) ($v['runs'] ?? []) as $run) {
            if (is_array($run) && isset($run['text']) && is_string($run['text'])) {
                $out .= $run['text'];
            }
        }
        return trim($out);
    }

    /** "4:12" -> 252, "1:02:03" -> 3723; sai dạng -> 0. */
    public static function clock(string $s): int
    {
        if (preg_match('/^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})$/', trim($s), $m) !== 1) {
            return 0;
        }
        return ((int) $m[1]) * 3600 + ((int) $m[2]) * 60 + (int) $m[3];
    }

    /** "1,234,567 views" -> 1234567; "1.2M views" -> 1200000. */
    public static function number(string $s): int
    {
        if (preg_match('/([\d.,]+)\s*([KMB])?/i', $s, $m) !== 1) {
            return 0;
        }
        $mult = ['K' => 1000, 'M' => 1000000, 'B' => 1000000000];
        $unit = strtoupper((string) ($m[2] ?? ''));
        if ($unit !== '' && isset($mult[$unit])) {
            return (int) round((float) str_replace(',', '.', $m[1]) * $mult[$unit]);
        }
        return (int) preg_replace('/\D/', '', $m[1]);
    }

    /** "2 years ago" -> thời điểm ước tính (mili giây); không hiểu -> 0. */
    public static function ago(string $s, ?int $now = null): int
    {
        if (preg_match('/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i', $s, $m) !== 1) {
            return 0;
        }
        $sec = ['second' => 1, 'minute' => 60, 'hour' => 3600, 'day' => 86400, 'week' => 604800, 'month' => 2592000, 'year' => 31536000];
        return ((($now ?? time()) - ((int) $m[1]) * $sec[strtolower($m[2])])) * 1000;
    }

    /** "PT1H2M3S" -> 3723. */
    public static function isoDuration(string $s): int
    {
        if (preg_match('/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/', $s, $m) !== 1 || $s === 'P0D') {
            return 0;
        }
        return ((int) ($m[1] ?? 0)) * 86400 + ((int) ($m[2] ?? 0)) * 3600 + ((int) ($m[3] ?? 0)) * 60 + (int) ($m[4] ?? 0);
    }

    public static function thumb(string $id, string $size = 'mqdefault'): string
    {
        return 'https://i.ytimg.com/vi/' . $id . '/' . $size . '.jpg';
    }

    /** @return array{0:int,1:string} */
    public static function httpRequest(string $method, string $url, array $headers, ?string $body, int $timeout): array
    {
        $ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
        if (!function_exists('curl_init')) {
            $ctx = stream_context_create([
                'http' => ['method' => $method, 'timeout' => $timeout, 'ignore_errors' => true,
                    'header' => implode("\r\n", array_merge($headers, ['User-Agent: ' . $ua])) . "\r\n", 'content' => (string) $body],
            ]);
            $res = @file_get_contents($url, false, $ctx);
            if ($res === false) {
                throw new \RuntimeException('Không mở được địa chỉ (PHP chưa bật curl/openssl?)');
            }
            $status = 0;
            if (isset($http_response_header[0]) && preg_match('#\s(\d{3})(\s|$)#', $http_response_header[0], $m) === 1) {
                $status = (int) $m[1];
            }
            return [$status, $res];
        }
        $ch = curl_init($url);
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => min(5, $timeout),
            CURLOPT_FOLLOWLOCATION => false,   // bị chuyển sang trang đồng ý cookie/đăng nhập = bị chặn
            CURLOPT_USERAGENT => $ua,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_ENCODING => '',
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        ];
        if ($method === 'POST') {
            $opts[CURLOPT_POST] = true;
            $opts[CURLOPT_POSTFIELDS] = (string) $body;
        }
        curl_setopt_array($ch, $opts);
        $res = curl_exec($ch);
        if ($res === false) {
            $err = curl_error($ch);
            curl_close($ch);
            throw new \RuntimeException($err !== '' ? $err : 'curl thất bại');
        }
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return [$status, (string) $res];
    }
}
