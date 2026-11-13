<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Config;
use App\Core\HttpException;
use App\Core\Validator;

/**
 * Tìm kiếm và lấy luồng phát video qua Piped, dự phòng bằng Invidious, rồi YouTube (tìm kiếm trực tiếp hoặc Data API);
 * chuẩn hóa dữ liệu về một dạng gọn cho giao diện.
 * Thứ tự nguồn: config piped.sources (VIDEO_SOURCES, mặc định piped,invidious,youtube). Nguồn nào lỗi thì chuyển nguồn kế tiếp.
 * Phát video: không lấy được luồng trực tiếp từ Piped/Invidious thì trả {embed: true} để giao diện phát bằng
 * trình phát nhúng chính thức của YouTube (YOUTUBE_EMBED, mặc định bật).
 * Một video trong danh sách: {id, title, uploader, duration (giây), thumbnail, views, uploaded_at (mili giây, 0 nếu không rõ)}.
 * Mã trang kế tiếp của tìm kiếm có tiền tố nguồn: "p:" Piped, "i:" Invidious, "y:" YouTube trực tiếp, "a:" YouTube Data API.
 */
final class YoutubeService
{
    /** Lỗi cho phép chuyển sang nguồn kế tiếp. */
    private const FALLBACK = ['UPSTREAM_FAILED', 'PIPED_NOT_CONFIGURED', 'INVIDIOUS_NOT_CONFIGURED', 'STREAM_UNAVAILABLE', 'YOUTUBE_UNAVAILABLE'];
    private const NAMES = ['piped' => 'Piped', 'invidious' => 'Invidious', 'youtube' => 'YouTube'];

    private PipedClient $piped;
    private ?InvidiousClient $invidious;
    private ?YoutubeDirectClient $direct;
    /** Khóa YouTube API riêng của người đang tìm (giai đoạn 10), do YoutubeController gắn vào; null = không có. */
    private ?string $userKey = null;
    private ?string $keyNotice = null;
    /** Nguồn trả kết quả lần gần nhất: 'own' (khóa riêng), 'piped', 'invidious', 'youtube' (khóa website/đọc trực tiếp). */
    private ?string $lastSource = null;

    public function __construct(PipedClient $piped, ?InvidiousClient $invidious = null, ?YoutubeDirectClient $direct = null)
    {
        $this->piped = $piped;
        $this->invidious = $invidious;
        $this->direct = $direct;
    }

    /**
     * Mã video từ đường dẫn YouTube: youtube.com/watch?v=ID, youtu.be/ID, /shorts/ID, /embed/ID, /live/ID,
     * music.youtube.com, m.youtube.com, hoặc chính mã 11 ký tự. Sai dạng thì null.
     */
    public static function videoIdFromUrl(string $url): ?string
    {
        $url = trim($url);
        if ($url === '') {
            return null;
        }
        if (self::isVideoId($url)) {
            return $url;
        }
        if (preg_match('~^(?:https?://)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)(/[^?#]*)?(?:\?([^#]*))?~i', $url, $m) !== 1) {
            return null;
        }
        $path = (string) ($m[1] ?? '');
        parse_str((string) ($m[2] ?? ''), $q);
        if (isset($q['v']) && is_string($q['v']) && self::isVideoId($q['v'])) {
            return $q['v'];
        }
        if (preg_match('#^/(?:shorts/|embed/|live/|v/)?([A-Za-z0-9_-]{11})(?:/|$)#', $path, $p) === 1) {
            return $p[1];
        }
        return null;
    }

    public static function isVideoId(string $id): bool
    {
        return preg_match('/^[A-Za-z0-9_-]{11}$/', $id) === 1;
    }

    /** Gắn khóa API riêng của người đang dùng (chỉ dùng cho tìm kiếm của chính người đó). */
    public function useUserKey(?string $key): void
    {
        $this->userKey = $key !== null && $key !== '' ? $key : null;
        $this->keyNotice = null;
    }

    /** Thông báo nhẹ về khóa riêng sau lần tìm vừa rồi (hết lượt / không dùng được), null = không có gì. */
    public function keyNotice(): ?string
    {
        return $this->keyNotice;
    }

    public function lastSource(): ?string
    {
        return $this->lastSource;
    }

    /** @return array{items: array<int,array>, next: ?string} */
    public function search(string $q, ?string $page = null): array
    {
        $page = $page === null ? '' : $page;
        $this->lastSource = null;
        if ($this->userKey !== null && $this->direct !== null) {
            $own = $this->userKeySearch($q, $page);
            if ($own !== null) {
                return $own;
            }
        }
        if (strncmp($page, 'u:', 2) === 0) {
            $page = 'a:' . substr($page, 2);   // mã trang của Data API dùng được với mọi khóa
        }
        if (strncmp($page, 'y:', 2) === 0 || strncmp($page, 'a:', 2) === 0) {
            $kind = $page[0] === 'a' ? 'api' : 'direct';
            return $this->run(['youtube' => function () use ($q, $page, $kind): array {
                // khóa API vừa được thêm/bỏ giữa chừng thì mã trang cũ không dùng được: bắt đầu lại từ trang đầu
                return $this->youtubeSearch($q, $this->direct->mode() === $kind ? substr($page, 2) : null);
            }]);
        }
        if (strncmp($page, 'i:', 2) === 0) {
            return $this->run(['invidious' => function () use ($q, $page): array {
                return $this->invidiousSearch($q, max(2, (int) substr($page, 2)));
            }]);
        }
        if ($page !== '') {
            $token = strncmp($page, 'p:', 2) === 0 ? substr($page, 2) : $page;   // mã cũ không có tiền tố là của Piped
            return $this->run(['piped' => function () use ($q, $token): array {
                return $this->pipedSearch($q, $token);
            }]);
        }
        return $this->run([
            'piped' => function () use ($q): array {
                return $this->pipedSearch($q, null);
            },
            'invidious' => function () use ($q): array {
                return $this->invidiousSearch($q, 1);
            },
            'youtube' => function () use ($q): array {
                return $this->youtubeSearch($q, null);
            },
        ]);
    }

    /** @return array<int,string> */
    public function suggest(string $q): array
    {
        $raw = $this->run([
            'piped' => function () use ($q): array {
                return $this->piped->get('/suggestions', ['query' => $q], 3600);
            },
            'invidious' => function () use ($q): array {
                $d = $this->invidious->get('/api/v1/search/suggestions', ['q' => $q], 3600);
                return array_map(static function ($s) {
                    return is_string($s) ? html_entity_decode($s, ENT_QUOTES | ENT_HTML5, 'UTF-8') : $s;
                }, (array) ($d['suggestions'] ?? []));
            },
            'youtube' => function () use ($q): array {
                return $this->direct->suggest($q);
            },
        ]);
        $out = [];
        foreach ($raw as $s) {
            if (is_string($s) && $s !== '') {
                $out[] = Validator::text($s, 100);
            }
            if (count($out) >= 8) {
                break;
            }
        }
        return $out;
    }

    /** Thông tin phát một video: luồng HLS, các luồng mp4 có cả hình và tiếng, luồng âm thanh và danh sách liên quan (cho Mix). */
    public function stream(string $id): array
    {
        if (!self::isVideoId($id)) {
            throw HttpException::validation(['id' => 'Mã video không hợp lệ.']);
        }
        $calls = [
            'piped' => function () use ($id): array {
                return self::normalizeStream($this->piped->get('/streams/' . rawurlencode($id), [], 90), $id) + ['source' => 'piped'];
            },
            'invidious' => function () use ($id): array {
                $d = $this->invidious->get('/api/v1/videos/' . rawurlencode($id), ['local' => 'true'], 90);
                return self::normalizeInvidiousStream($d, $id, $this->invidious->lastBase()) + ['source' => 'invidious'];
            },
        ];
        if (!self::embedEnabled()) {
            return $this->run($calls);
        }
        try {
            return $this->run($calls);
        } catch (HttpException $e) {
            if (!in_array($e->errorCode, self::FALLBACK, true)) {
                throw $e;
            }
            return $this->embedInfo($id);
        }
    }

    public static function embedEnabled(): bool
    {
        return (bool) Config::get('youtube.embed', true);
    }

    /**
     * Không có luồng trực tiếp: giao diện phát bằng trình phát nhúng của YouTube (trình duyệt người xem tự tải từ YouTube,
     * máy chủ không tải video). Kèm video liên quan cho chế độ Mix nếu lấy được (không bắt buộc).
     */
    private function embedInfo(string $id): array
    {
        $related = [];
        if ($this->direct !== null) {
            try {
                $related = $this->direct->related($id);
            } catch (HttpException $e) {
                $related = [];
            }
        }
        return [
            'id' => $id, 'title' => '', 'uploader' => '', 'duration' => 0,
            'thumbnail' => YoutubeDirectClient::thumb($id, 'hqdefault'),
            'live' => false, 'hls' => null, 'sources' => [], 'audio' => [],
            'related' => $related, 'embed' => true, 'source' => 'youtube',
        ];
    }

    /** Danh sách nhạc mặc định khi mở web (khách hoặc chưa có playlist). */
    public function trending(): array
    {
        $cfg = (array) Config::get('piped', []);
        $query = (string) ($cfg['music_query'] ?? 'nhạc trẻ hay nhất hiện nay');
        $min = (int) ($cfg['music_min_seconds'] ?? 90);
        $max = (int) ($cfg['music_max_seconds'] ?? 600);
        $list = $this->run([
            'piped' => function () use ($query): array {
                return self::normalizeList($this->piped->get('/search', ['q' => $query, 'filter' => 'videos'], 1800)['items'] ?? []);
            },
            'invidious' => function () use ($query): array {
                return self::normalizeInvidiousList($this->invidious->get('/api/v1/search', ['q' => $query, 'type' => 'video', 'page' => 1], 1800));
            },
            'youtube' => function () use ($query): array {
                return $this->direct->search($query, null)['items'];
            },
        ]);
        $items = array_values(array_filter($list, static function (array $it) use ($min, $max): bool {
            return $it['duration'] >= $min && $it['duration'] <= $max;
        }));
        // Kết quả YouTube thật hay là tuyển tập dài cả tiếng: quá ít bài vừa độ dài thì lấy cả danh sách (bài vừa độ dài đứng trước)
        if (count($items) < 8) {
            $short = array_column($items, 'id');
            foreach ($list as $it) {
                if (!in_array($it['id'], $short, true) && $it['duration'] > 0) {
                    $items[] = $it;
                }
            }
        }
        return array_slice($items, 0, 25);
    }

    private function pipedSearch(string $q, ?string $token): array
    {
        $data = $token === null
            ? $this->piped->get('/search', ['q' => $q, 'filter' => 'videos'], 600)
            : $this->piped->get('/nextpage/search', ['nextpage' => $token, 'q' => $q, 'filter' => 'videos'], 600);
        $next = isset($data['nextpage']) && is_string($data['nextpage']) && $data['nextpage'] !== '' ? 'p:' . $data['nextpage'] : null;
        return ['items' => self::normalizeList($data['items'] ?? []), 'next' => $next];
    }

    private function invidiousSearch(string $q, int $page): array
    {
        $data = $this->invidious->get('/api/v1/search', ['q' => $q, 'type' => 'video', 'page' => $page], 600);
        $items = self::normalizeInvidiousList($data);
        // Invidious không báo hết trang: trang có kết quả thì cho xem tiếp, tối đa 20 trang.
        return ['items' => $items, 'next' => ($data !== [] && $page < 20) ? 'i:' . ($page + 1) : null];
    }

    /**
     * Tìm bằng khóa riêng của người dùng (đi trước Piped/Invidious vì là cách chính thức, không làm YouTube chặn IP máy chủ).
     * Khóa hết lượt / sai / YouTube lỗi: trả null để tìm theo đường thường, kèm thông báo nhẹ (keyNotice) nếu do khóa.
     */
    private function userKeySearch(string $q, string $page): ?array
    {
        $token = null;
        if ($page !== '') {
            if (strncmp($page, 'u:', 2) !== 0 && strncmp($page, 'a:', 2) !== 0) {
                return null;   // mã trang của nguồn khác: đi tiếp nguồn đó
            }
            $token = substr($page, 2);
        }
        try {
            $r = $this->direct->searchWithKey((string) $this->userKey, $q, $token);
            $this->lastSource = 'own';
            return ['items' => $r['items'], 'next' => $r['next'] !== null ? 'u:' . $r['next'] : null];
        } catch (HttpException $e) {
            if ($e->errorCode === 'YOUTUBE_KEY_QUOTA') {
                $this->keyNotice = 'Khóa YouTube API của bạn đã hết lượt hôm nay. Website đang tìm bằng cách khác.';
            } elseif ($e->errorCode === 'YOUTUBE_KEY_INVALID') {
                $this->keyNotice = 'Khóa YouTube API của bạn không dùng được nữa. Hãy kiểm tra lại trong Cài đặt.';
            }
            return null;
        }
    }

    private function youtubeSearch(string $q, ?string $token): array
    {
        $r = $this->direct->search($q, $token);
        $prefix = $this->direct->mode() === 'api' ? 'a:' : 'y:';
        return ['items' => $r['items'], 'next' => $r['next'] !== null ? $prefix . $r['next'] : null];
    }

    /**
     * Chạy lần lượt theo thứ tự nguồn; nguồn lỗi kết nối (hoặc không có luồng phát) thì thử nguồn kế tiếp.
     * @param array<string,callable> $calls nguồn => hàm gọi
     */
    private function run(array $calls)
    {
        $order = (array) Config::get('piped.sources', ['piped', 'invidious', 'youtube']);
        if (!in_array('youtube', $order, true)) {
            $order[] = 'youtube';   // YouTube luôn là nguồn dự phòng cuối (tắt bằng YOUTUBE_DIRECT=false khi không có khóa API)
        }
        $errors = [];
        foreach ($order as $src) {
            if (!isset($calls[$src]) || ($src === 'invidious' && $this->invidious === null)
                || ($src === 'youtube' && ($this->direct === null || $this->direct->mode() === 'off'))) {
                continue;
            }
            try {
                $out = $calls[$src]();
                $this->lastSource = $src;
                return $out;
            } catch (HttpException $e) {
                if (!in_array($e->errorCode, self::FALLBACK, true)) {
                    throw $e;
                }
                $errors[$src] = $e;
            }
        }
        foreach ($errors as $e) {
            if ($e->errorCode === 'STREAM_UNAVAILABLE') {
                throw $e;   // có nguồn đã trả lời nhưng video không phát được: báo đúng lý do
            }
        }
        $reached = array_filter($errors, static function (HttpException $e): bool {
            return $e->errorCode === 'UPSTREAM_FAILED' || $e->errorCode === 'YOUTUBE_UNAVAILABLE';
        });
        if ($reached === [] && $errors !== []) {
            throw reset($errors);   // không nguồn nào được cấu hình
        }
        $names = implode(', ', array_map(static function (string $k): string {
            return self::NAMES[$k] ?? ucfirst($k);
        }, array_keys($errors)));
        throw new HttpException(502, 'UPSTREAM_FAILED', 'Không kết nối được máy chủ video (' . ($names !== '' ? $names : 'Piped') . '). Vui lòng thử lại sau ít phút.');
    }

    // ---------- Chuẩn hóa dữ liệu ----------

    public static function normalizeList($raw): array
    {
        $out = [];
        if (is_array($raw)) {
            foreach ($raw as $item) {
                $n = self::normalizeItem($item);
                if ($n !== null) {
                    $out[] = $n;
                }
            }
        }
        return $out;
    }

    public static function normalizeItem($raw): ?array
    {
        if (!is_array($raw) || (($raw['type'] ?? 'stream') !== 'stream')) {
            return null;
        }
        $id = self::idFromUrl((string) ($raw['url'] ?? ''));
        $duration = isset($raw['duration']) && is_numeric($raw['duration']) ? (int) $raw['duration'] : 0;
        $title = Validator::text($raw['title'] ?? '', 255);
        if ($id === null || $duration <= 0 || $title === '') {   // bỏ phát trực tiếp (thời lượng <= 0) và mục lỗi
            return null;
        }
        return [
            'id' => $id,
            'title' => $title,
            'uploader' => Validator::text($raw['uploaderName'] ?? '', 150),
            'duration' => $duration,
            'thumbnail' => self::url($raw['thumbnail'] ?? ''),
            'views' => max(0, (int) ($raw['views'] ?? 0)),
            'uploaded_at' => max(0, (int) ($raw['uploaded'] ?? 0)),
        ];
    }

    public static function normalizeStream(array $d, string $id): array
    {
        $sources = [];
        foreach ((array) ($d['videoStreams'] ?? []) as $s) {
            if (!is_array($s) || !empty($s['videoOnly'])) {
                continue;   // luồng chỉ có hình (không có tiếng) không dùng cho trình phát đơn giản
            }
            $url = self::url($s['url'] ?? '');
            if ($url === '') {
                continue;
            }
            $height = (int) ($s['height'] ?? 0);
            if ($height <= 0) {
                $height = (int) ($s['quality'] ?? 0);
            }
            $sources[] = [
                'url' => $url,
                'quality' => Validator::text($s['quality'] ?? '', 20),
                'mime' => Validator::text($s['mimeType'] ?? '', 60),
                'height' => $height,
                'bitrate' => (int) ($s['bitrate'] ?? 0),
            ];
        }
        usort($sources, static function (array $a, array $b): int {
            return $b['height'] <=> $a['height'];
        });

        $audio = [];
        foreach ((array) ($d['audioStreams'] ?? []) as $s) {
            $url = is_array($s) ? self::url($s['url'] ?? '') : '';
            if ($url !== '') {
                $audio[] = [
                    'url' => $url,
                    'quality' => Validator::text($s['quality'] ?? '', 20),
                    'mime' => Validator::text($s['mimeType'] ?? '', 60),
                    'bitrate' => (int) ($s['bitrate'] ?? 0),
                ];
            }
        }
        usort($audio, static function (array $a, array $b): int {
            return $b['bitrate'] <=> $a['bitrate'];
        });

        $hls = self::url($d['hls'] ?? '');
        if ($hls === '' && $sources === [] && $audio === []) {
            throw new HttpException(404, 'STREAM_UNAVAILABLE', 'Video này không phát được (có thể bị chặn hoặc đã bị xóa).');
        }

        return [
            'id' => $id,
            'title' => Validator::text($d['title'] ?? '', 255),
            'uploader' => Validator::text($d['uploader'] ?? '', 150),
            'duration' => max(0, (int) ($d['duration'] ?? 0)),
            'thumbnail' => self::url($d['thumbnailUrl'] ?? ''),
            'live' => !empty($d['livestream']),
            'hls' => $hls !== '' ? $hls : null,
            'sources' => array_slice($sources, 0, 6),
            'audio' => array_slice($audio, 0, 2),
            'related' => self::normalizeList($d['relatedStreams'] ?? []),
        ];
    }

    // ---------- Chuẩn hóa dữ liệu Invidious ----------

    public static function normalizeInvidiousList($raw): array
    {
        $out = [];
        if (is_array($raw)) {
            foreach ($raw as $item) {
                $n = self::normalizeInvidiousItem($item);
                if ($n !== null) {
                    $out[] = $n;
                }
            }
        }
        return $out;
    }

    public static function normalizeInvidiousItem($raw): ?array
    {
        if (!is_array($raw) || (($raw['type'] ?? 'video') !== 'video')) {
            return null;
        }
        $id = (string) ($raw['videoId'] ?? '');
        $duration = isset($raw['lengthSeconds']) && is_numeric($raw['lengthSeconds']) ? (int) $raw['lengthSeconds'] : 0;
        $title = Validator::text($raw['title'] ?? '', 255);
        if (!self::isVideoId($id) || $duration <= 0 || $title === '' || !empty($raw['liveNow'])) {
            return null;
        }
        $published = isset($raw['published']) && is_numeric($raw['published']) ? (int) $raw['published'] : 0;
        return [
            'id' => $id,
            'title' => $title,
            'uploader' => Validator::text($raw['author'] ?? '', 150),
            'duration' => $duration,
            'thumbnail' => self::ytThumb($id),
            'views' => max(0, (int) ($raw['viewCount'] ?? 0)),
            'uploaded_at' => $published > 0 ? $published * 1000 : 0,
        ];
    }

    /** $base: địa chỉ Invidious vừa trả lời, để đổi đường dẫn "/videoplayback?..." (luồng đi qua máy chủ đó) thành đầy đủ. */
    public static function normalizeInvidiousStream(array $d, string $id, string $base): array
    {
        $abs = static function ($u) use ($base): string {
            $u = is_string($u) ? trim($u) : '';
            if ($u !== '' && $u[0] === '/' && substr($u, 0, 2) !== '//' && $base !== '') {
                $u = $base . $u;
            }
            return self::url($u);
        };

        $sources = [];
        foreach ((array) ($d['formatStreams'] ?? []) as $s) {
            $url = is_array($s) ? $abs($s['url'] ?? '') : '';
            if ($url === '') {
                continue;
            }
            $height = 0;
            if (preg_match('/x(\d{3,4})$/', (string) ($s['size'] ?? ''), $m) === 1) {
                $height = (int) $m[1];
            } elseif (preg_match('/(\d{3,4})p/', (string) ($s['resolution'] ?? ($s['qualityLabel'] ?? ($s['quality'] ?? ''))), $m) === 1) {
                $height = (int) $m[1];
            }
            $mime = (string) ($s['type'] ?? '');
            $sources[] = [
                'url' => $url,
                'quality' => Validator::text($s['qualityLabel'] ?? ($s['resolution'] ?? ($height > 0 ? $height . 'p' : '')), 20),
                'mime' => Validator::text(trim(explode(';', $mime)[0]), 60),
                'height' => $height,
                'bitrate' => (int) ($s['bitrate'] ?? 0),
            ];
        }
        usort($sources, static function (array $a, array $b): int {
            return $b['height'] <=> $a['height'];
        });

        $audio = [];
        foreach ((array) ($d['adaptiveFormats'] ?? []) as $s) {
            if (!is_array($s) || strncmp((string) ($s['type'] ?? ''), 'audio/', 6) !== 0) {
                continue;
            }
            $url = $abs($s['url'] ?? '');
            if ($url !== '') {
                $bitrate = (int) ($s['bitrate'] ?? 0);
                $audio[] = [
                    'url' => $url,
                    'quality' => Validator::text($bitrate > 0 ? round($bitrate / 1000) . ' kbps' : (string) ($s['audioQuality'] ?? ''), 20),
                    'mime' => Validator::text(trim(explode(';', (string) $s['type'])[0]), 60),
                    'bitrate' => $bitrate,
                ];
            }
        }
        usort($audio, static function (array $a, array $b): int {
            return $b['bitrate'] <=> $a['bitrate'];
        });

        $hls = $abs($d['hlsUrl'] ?? '');
        if ($hls === '' && $sources === [] && $audio === []) {
            throw new HttpException(404, 'STREAM_UNAVAILABLE', 'Video này không phát được (có thể bị chặn hoặc đã bị xóa).');
        }

        return [
            'id' => $id,
            'title' => Validator::text($d['title'] ?? '', 255),
            'uploader' => Validator::text($d['author'] ?? '', 150),
            'duration' => max(0, (int) ($d['lengthSeconds'] ?? 0)),
            'thumbnail' => self::ytThumb($id, 'hqdefault'),
            'live' => !empty($d['liveNow']),
            'hls' => $hls !== '' ? $hls : null,
            'sources' => array_slice($sources, 0, 6),
            'audio' => array_slice($audio, 0, 2),
            'related' => self::normalizeInvidiousList(array_map(static function ($r) {
                return is_array($r) ? $r + ['type' => 'video'] : $r;
            }, (array) ($d['recommendedVideos'] ?? []))),
        ];
    }

    /** Ảnh thu nhỏ lấy thẳng từ máy chủ ảnh của YouTube (ổn định hơn ảnh qua máy chủ Invidious). */
    private static function ytThumb(string $id, string $size = 'mqdefault'): string
    {
        return 'https://i.ytimg.com/vi/' . $id . '/' . $size . '.jpg';
    }

    private static function idFromUrl(string $url): ?string
    {
        if (self::isVideoId($url)) {
            return $url;
        }
        $query = parse_url($url, PHP_URL_QUERY);
        if (!is_string($query)) {
            return null;
        }
        parse_str($query, $params);
        $v = $params['v'] ?? null;
        return is_string($v) && self::isVideoId($v) ? $v : null;
    }

    /** Chỉ nhận địa chỉ http/https, tối đa 2000 ký tự (luồng phát có thể dài). */
    private static function url($value): string
    {
        $v = is_string($value) ? trim($value) : '';
        return ($v !== '' && strlen($v) <= 2000 && preg_match('#^https?://#i', $v) === 1) ? $v : '';
    }
}
