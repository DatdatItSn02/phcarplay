<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Config;
use App\Core\FileCache;
use App\Core\Database;
use App\Core\SecurityHeaders;

/**
 * Tự kiểm tra máy chủ (dùng cho lệnh php bin/doctor.php). Mỗi mục trả về [mức, tiêu đề, giải thích]:
 *   ok    - đúng;  note - thông tin cần biết;  warn - nên sửa;  error - phải sửa trước khi mở website.
 * Mọi phép kiểm tra đều tự bắt lỗi, không bao giờ làm dừng lệnh giữa chừng.
 */
final class SystemCheck
{
    public const OK = 'ok';
    public const NOTE = 'note';
    public const WARN = 'warn';
    public const ERROR = 'error';

    private ?Database $db;
    /** @var callable(string): array{0:int,1:array<string,string>,2:string} gọi HTTP GET (thay được khi kiểm thử) */
    private $http;
    private string $base;

    /** @var array<int,array{0:string,1:string,2:string}> */
    private array $items = [];

    public function __construct(?Database $db = null, ?callable $http = null, ?string $basePath = null)
    {
        $this->db = $db;
        $this->http = $http ?? [$this, 'httpGet'];
        $this->base = $basePath ?? BASE_PATH;
    }

    /** @return array<int,array{0:string,1:string,2:string}> */
    public function run(bool $online = true): array
    {
        $this->items = [];
        $this->php();
        $this->extensions();
        $this->env();
        $this->appUrl();
        $this->mail();
        $this->database();
        $this->storage();
        $this->security();
        $this->hls();
        $this->youtubeConfig();
        if ($online) {
            $this->piped();
            $this->liveSite();
        } else {
            $this->add(self::NOTE, 'Bỏ qua kiểm tra qua mạng (--offline)', 'Chạy lại không có --offline để thử kết nối Piped/Invidious và chính website của bạn.');
        }
        return $this->items;
    }

    private function add(string $level, string $title, string $detail = ''): void
    {
        $this->items[] = [$level, $title, $detail];
    }

    private function guard(string $title, callable $fn): void
    {
        try {
            $fn();
        } catch (\Throwable $e) {
            $this->add(self::ERROR, $title, 'Lỗi khi kiểm tra: ' . $e->getMessage());
        }
    }

    private function isLocalUrl(string $url): bool
    {
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        return $host === '' || $host === 'localhost' || $host === '127.0.0.1' || $host === '::1' || substr($host, -6) === '.local' || substr($host, -5) === '.test';
    }

    // ---------- từng mục ----------

    private function php(): void
    {
        $v = PHP_VERSION;
        if (PHP_VERSION_ID < 70400) {
            $this->add(self::ERROR, 'PHP ' . $v, 'Cần PHP 7.4 trở lên.');
        } elseif (PHP_VERSION_ID < 80100) {
            $this->add(self::WARN, 'PHP ' . $v, 'Chạy được, nhưng PHP 7.4/8.0 đã hết bản vá bảo mật. Khi có thể, hãy nâng lên PHP 8.2 trở lên (website đã chạy được trên 8.x).');
        } else {
            $this->add(self::OK, 'PHP ' . $v);
        }
    }

    private function extensions(): void
    {
        foreach (['pdo_mysql' => 'kết nối MySQL', 'mbstring' => 'xử lý tiếng Việt', 'json' => 'API'] as $ext => $why) {
            if (extension_loaded($ext)) {
                $this->add(self::OK, 'Extension ' . $ext);
            } else {
                $this->add(self::ERROR, 'Thiếu extension ' . $ext, 'Cần cho ' . $why . '. Bật trong php.ini hoặc trang quản lý PHP của hosting.');
            }
        }
        if (!extension_loaded('openssl')) {
            $this->add(self::WARN, 'Thiếu extension openssl', 'Cần để gửi thư qua SMTP có mã hóa và gọi Piped qua https.');
        }
        if (extension_loaded('curl')) {
            $this->add(self::OK, 'Extension curl');
        } elseif (filter_var(ini_get('allow_url_fopen'), FILTER_VALIDATE_BOOLEAN)) {
            $this->add(self::WARN, 'Thiếu extension curl', 'Vẫn gọi được Piped bằng allow_url_fopen, nhưng nên bật curl để ổn định hơn.');
        } else {
            $this->add(self::ERROR, 'Thiếu extension curl (và allow_url_fopen tắt)', 'Máy chủ không gọi được Piped nên không tìm/phát được video. Bật extension curl.');
        }
    }

    private function env(): void
    {
        if (!is_file($this->base . '/.env')) {
            $this->add(self::ERROR, 'Chưa có file .env', 'Sao chép .env.example thành .env rồi điền thông tin thật (database, địa chỉ website, gửi thư).');
            return;
        }
        $this->add(self::OK, 'Có file .env');
        $debug = (bool) Config::get('app.debug', false);
        $local = $this->isLocalUrl((string) Config::get('app.url', ''));
        if ($debug && !$local) {
            $this->add(self::ERROR, 'APP_DEBUG=true trên website thật', 'Người ngoài sẽ thấy chi tiết lỗi (đường dẫn, câu SQL). Đặt APP_DEBUG=false.');
        } elseif ($debug) {
            $this->add(self::WARN, 'APP_DEBUG=true', 'Chỉ dùng khi phát triển trên máy mình. Website thật phải để APP_DEBUG=false.');
        } else {
            $this->add(self::OK, 'APP_DEBUG=false');
        }
    }

    private function appUrl(): void
    {
        $url = (string) Config::get('app.url', '');
        if ($url === '' || $this->isLocalUrl($url)) {
            $this->add(self::WARN, 'APP_URL = ' . ($url === '' ? '(trống)' : $url), 'Liên kết trong thư đặt lại mật khẩu sẽ trỏ về địa chỉ này. Website thật hãy đặt đúng tên miền, ví dụ https://carplay.tenmien.vn');
        } elseif (stripos($url, 'https://') !== 0) {
            $this->add(self::WARN, 'APP_URL chưa dùng https', 'Nên bật HTTPS (hosting thường có Let\'s Encrypt miễn phí) để mật khẩu không bị đọc trộm trên đường truyền, rồi sửa APP_URL thành https://...');
        } else {
            $this->add(self::OK, 'APP_URL = ' . $url);
        }
    }

    private function mail(): void
    {
        $driver = (string) Config::get('mail.driver', 'log');
        if ($driver === 'smtp') {
            $host = (string) Config::get('mail.smtp.host', '');
            if ($host === '') {
                $this->add(self::ERROR, 'MAIL_DRIVER=smtp nhưng chưa có SMTP_HOST', 'Điền SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS rồi thử: php bin/send-test-mail.php email@cua-ban.com');
            } else {
                $this->add(self::OK, 'Gửi thư qua SMTP ' . $host, 'Thử gửi một thư: php bin/send-test-mail.php email@cua-ban.com');
            }
        } elseif ($driver === 'mail') {
            $this->add(self::NOTE, 'Gửi thư bằng hàm mail() của PHP', 'Nhiều hosting chặn hoặc thư dễ vào hộp spam. Nếu người dùng không nhận được thư, chuyển sang smtp.');
        } else {
            $this->add(self::WARN, 'MAIL_DRIVER=log: không gửi thư thật', 'Thư quên mật khẩu chỉ được ghi vào storage/mail. Website thật hãy dùng smtp.');
        }
    }

    private function database(): void
    {
        $this->guard('Database', function () {
            $db = $this->db ?? new Database();
            try {
                $db->value('SELECT 1');
            } catch (\Throwable $e) {
                $this->add(self::ERROR, 'Không kết nối được database', $e->getMessage() . ' — kiểm tra DB_HOST, DB_NAME, DB_USER, DB_PASS trong .env.');
                return;
            }
            $this->add(self::OK, 'Kết nối database');
            $files = array_map('basename', glob($this->base . '/database/migrations/*.sql') ?: []);
            try {
                $done = array_column($db->all('SELECT name FROM migrations'), 'name');
            } catch (\Throwable $e) {
                $done = [];
            }
            $missing = array_values(array_diff($files, $done));
            if ($missing !== []) {
                $this->add(self::ERROR, 'Còn migration chưa chạy: ' . implode(', ', $missing), 'Chạy: php bin/migrate.php');
            } else {
                $this->add(self::OK, 'Database đã cập nhật đủ ' . count($files) . ' migration');
            }
            try {
                $masters = (int) $db->value("SELECT COUNT(*) FROM admins WHERE role = 'master'");
            } catch (\Throwable $e) {
                $masters = 0;
            }
            if ($masters < 1) {
                $this->add(self::ERROR, 'Chưa có tài khoản quản trị master', 'Chạy: php bin/install.php');
            } else {
                $this->add(self::OK, 'Có tài khoản quản trị master');
            }
        });
    }

    private function storage(): void
    {
        // Không tự tạo thư mục ở đây: lệnh có thể đang chạy bằng tài khoản khác với tài khoản chạy website (ví dụ root),
        // thư mục tạo ra sẽ thuộc tài khoản đó và website lại không ghi được.
        foreach (['storage/cache', 'storage/logs', 'storage/mail', 'storage/sessions'] as $rel) {
            $dir = $this->base . '/' . $rel;
            if (!is_dir($dir)) {
                $this->add(self::ERROR, 'Thiếu thư mục ' . $rel, 'Tạo thư mục này (có trong bản đóng gói) và cấp quyền ghi cho tài khoản chạy PHP.');
            } elseif (is_writable($dir)) {
                $this->add(self::OK, 'Ghi được ' . $rel);
            } else {
                $this->add(self::ERROR, 'Không ghi được ' . $rel, 'Cấp quyền ghi cho thư mục này cho tài khoản chạy PHP (ví dụ chmod 775, hoặc trong trình quản lý file của hosting).');
            }
        }
        if (DIRECTORY_SEPARATOR === '/') {
            foreach (['user', 'admin'] as $scope) {
                $dir = $this->base . '/storage/sessions/' . $scope;
                if (is_dir($dir) && ((fileperms($dir) & 0007) !== 0)) {
                    $this->add(self::WARN, 'storage/sessions/' . $scope . ' cho mọi tài khoản trên máy đọc được (' . decoct(fileperms($dir) & 0777) . ')',
                        'Nên chmod 700 thư mục này để website khác trên cùng máy chủ không đọc được phiên đăng nhập.');
                }
            }
        }
    }

    private function security(): void
    {
        if ((bool) Config::get('app.security.rate_limit', true)) {
            $this->add(self::OK, 'Giới hạn gửi thư/đăng ký/nhập key/API đang bật (RATE_LIMIT)');
        } else {
            $this->add(self::WARN, 'RATE_LIMIT=false', 'Không còn chặn spam thư quên mật khẩu, đăng ký hàng loạt, gọi API dồn dập. Chỉ tắt khi cần dò lỗi.');
        }
        if ((bool) Config::get('app.security.login_throttle', false)) {
            $this->add(self::OK, 'Chặn tạm khi đăng nhập sai nhiều lần (LOGIN_THROTTLE) đang bật');
        } else {
            $this->add(self::NOTE, 'LOGIN_THROTTLE=false: không giới hạn số lần đăng nhập sai', 'Đúng như quyết định của dự án. Mật khẩu kiểu md5 nên dò mật khẩu qua mạng là rủi ro; muốn chặn thì đặt LOGIN_THROTTLE=true. Lần đăng nhập quản trị sai vẫn được ghi Nhật ký.');
        }
        if ((bool) Config::get('app.security.csp', true)) {
            $this->add(self::OK, 'Content-Security-Policy đang bật');
        } else {
            $this->add(self::WARN, 'CSP_ENABLED=false', 'Mất lớp chặn script lạ. Bật lại sau khi dò lỗi xong.');
        }
        $ipHeader = trim((string) Config::get('app.security.client_ip_header', ''));
        if ($ipHeader !== '') {
            $this->add(self::NOTE, 'Lấy IP người dùng từ header ' . $ipHeader, 'Chỉ đúng khi website thật sự chạy sau Cloudflare/proxy. Không có proxy thì để trống CLIENT_IP_HEADER.');
        }
        if ((bool) Config::get('app.enforce_license', false)) {
            $this->add(self::NOTE, 'ENFORCE_LICENSE=true', 'Người dùng hết hạn sẽ bị giới hạn tính năng.');
        } else {
            $this->add(self::NOTE, 'ENFORCE_LICENSE=false', 'Chưa giới hạn tính năng theo key/hạn dùng (đúng như đang chọn).');
        }
        foreach (['/.htaccess' => 'chuyển yêu cầu vào public/ nếu lỡ trỏ thư mục web sai', '/public/.htaccess' => 'chuyển mọi đường dẫn vào index.php (Apache/LiteSpeed)'] as $file => $why) {
            if (!is_file($this->base . $file)) {
                $this->add(self::WARN, 'Thiếu file ' . ltrim($file, '/'), 'Dùng để ' . $why . '. Hãy tải lại từ bản đóng gói.');
            }
        }
    }

    private function hls(): void
    {
        $src = SecurityHeaders::hlsSource($this->base . '/public', '');
        if ($src['src'] === SecurityHeaders::VENDOR_HLS) {
            $this->add(self::OK, 'hls.js dùng file trên máy chủ (public/assets/vendor/hls.min.js)');
        } else {
            $this->add(self::NOTE, 'hls.js nạp từ ' . $src['src'] . ($src['integrity'] !== '' ? ' (có kiểm tra SRI)' : ''),
                'Muốn không phụ thuộc CDN: xem public/assets/vendor/README.txt.');
        }
    }

    /** Thử từng địa chỉ Piped và Invidious. Chỉ báo LỖI khi không nguồn nào trả lời (website không tìm/phát được video). */
    private function piped(): void
    {
        $this->guard('Kết nối nguồn video (Piped/Invidious)', function () {
            $groups = [
                'piped' => ['Piped', 'PIPED_API_URLS', '/suggestions?query=test', static function ($j): bool {
                    return is_array($j) && !isset($j['error']);
                }],
                'invidious' => ['Invidious', 'INVIDIOUS_API_URLS', '/api/v1/search/suggestions?q=test', static function ($j): bool {
                    return is_array($j) && isset($j['suggestions']) && !isset($j['error']);
                }],
            ];
            $sources = (array) Config::get('piped.sources', ['piped', 'invidious']);
            $working = 0;
            $results = [];
            foreach ($sources as $kind) {
                if (!isset($groups[$kind])) {
                    continue;
                }
                [$label, $envName, $probe, $valid] = $groups[$kind];
                $cfg = (array) Config::get($kind, []);
                $instances = array_values(array_filter(array_map('trim', (array) ($cfg['instances'] ?? []))));
                if ($instances === []) {
                    $results[] = [self::NOTE, 'Chưa cấu hình ' . $envName, 'Nguồn ' . $label . ' bị bỏ qua.'];
                    continue;
                }
                $okList = [];
                $bad = [];
                foreach ($instances as $base) {
                    try {
                        [$status, , $body] = ($this->http)(rtrim((string) $base, '/') . $probe, (int) ($cfg['timeout'] ?? 6));
                    } catch (\Throwable $e) {
                        $status = 0;
                        $body = '';
                    }
                    $json = json_decode((string) $body, true);
                    if ($status === 200 && $valid($json)) {
                        $okList[] = $base;
                    } elseif ($status === 0) {
                        $bad[] = $base . ' (không kết nối được)';
                    } elseif ($status === 200 && !is_array($json)) {
                        $bad[] = $base . ' (HTTP 200 nhưng trả về trang web, không phải dữ liệu ' . $label . ')';
                    } else {
                        $bad[] = $base . ' (HTTP ' . $status . ')';
                    }
                }
                if ($okList !== []) {
                    $working++;
                }
                if ($okList === []) {
                    $results[] = [self::WARN, 'Không địa chỉ ' . $label . ' nào trả lời', implode('; ', $bad) . '. Chạy php bin/video-scan.php để tìm địa chỉ đang chạy rồi sửa ' . $envName . '.'];
                } elseif ($bad !== []) {
                    $results[] = [self::WARN, count($okList) . '/' . count($instances) . ' địa chỉ ' . $label . ' trả lời', 'Không trả lời: ' . implode('; ', $bad) . '. Website tự bỏ qua địa chỉ hỏng, nhưng nên bỏ chúng khỏi ' . $envName . '.'];
                } else {
                    $results[] = [self::OK, 'Tất cả ' . count($okList) . ' địa chỉ ' . $label . ' trả lời'];
                }
            }
            foreach ($results as $r) {
                $this->add($r[0], $r[1], $r[2] ?? '');
            }
            $youtube = $this->youtubeOnline();
            $embed = YoutubeService::embedEnabled();
            if ($working === 0 && !$youtube) {
                $this->add(self::ERROR, 'Không nguồn video nào trả lời', 'Website sẽ không tìm được video (Piped, Invidious và YouTube đều lỗi). Chạy php bin/video-scan.php để tìm địa chỉ Piped/Invidious đang chạy.');
            } elseif ($working === 0) {
                $this->add(self::WARN, 'Piped và Invidious đều hỏng: website đang dùng YouTube dự phòng',
                    'Tìm kiếm qua YouTube' . ($embed ? ', phát bằng trình phát YouTube (có quảng cáo, không có cửa sổ nổi).' : '; YOUTUBE_EMBED=false nên sẽ KHÔNG phát được video.')
                    . ' Chạy php bin/video-scan.php khi muốn tìm lại địa chỉ Piped/Invidious.');
            } else {
                $this->add(self::NOTE, 'Gợi ý thử phát video thật', 'Máy chủ trả lời gợi ý tìm kiếm chưa chắc phát được video. php bin/video-scan.php thử cả tìm kiếm và phát.');
            }
        });
    }

    /** Nguồn YouTube dự phòng (giai đoạn 9): đang dùng cách nào, có đang bị YouTube tạm chặn không. Không gọi mạng. */
    private function youtubeConfig(): void
    {
        $this->guard('Nguồn YouTube dự phòng', function () {
            $client = new YoutubeDirectClient(new FileCache($this->base . '/storage/cache'));
            $mode = $client->mode();
            $perHour = (int) Config::get('youtube.per_hour', 300);
            if ($mode === 'api') {
                $this->add(self::OK, 'Tìm kiếm dự phòng bằng YouTube Data API (có YOUTUBE_API_KEY)', 'Đúng điều khoản YouTube. Mỗi lần tìm tốn khoảng 101 đơn vị trong hạn mức 10.000 đơn vị/ngày (khoảng 99 lần tìm/ngày).');
            } elseif ($mode === 'direct') {
                $this->add(self::NOTE, 'Tìm kiếm dự phòng: đọc trực tiếp từ YouTube',
                    'Chỉ dùng khi Piped/Invidious hỏng; tối đa ' . ($perHour > 0 ? $perHour . ' lần/giờ' : 'không giới hạn (YOUTUBE_DIRECT_PER_HOUR=0)')
                    . ', kết quả lưu đệm, bị chặn thì tự nghỉ. Muốn đúng điều khoản YouTube thì đặt YOUTUBE_API_KEY.');
            } else {
                $this->add(self::NOTE, 'Tìm kiếm dự phòng bằng YouTube đang tắt (YOUTUBE_DIRECT=false, không có khóa API)', 'Piped/Invidious hỏng thì website không tìm được video.');
            }
            if ((bool) Config::get('youtube.user_keys', true)) {
                if (\App\Core\SecretBox::available((string) Config::get('app.key', ''))) {
                    $this->add(self::OK, 'Người dùng nhập được khóa YouTube API riêng trong Cài đặt (YOUTUBE_USER_KEYS)', 'Khóa được mã hóa bằng APP_KEY. Đừng đổi APP_KEY, nếu đổi thì người dùng phải nhập lại khóa.');
                } else {
                    $this->add(self::WARN, 'Chưa có APP_KEY nên người dùng chưa nhập được khóa YouTube API riêng',
                        'Thêm dòng sau vào .env (giữ bí mật, không đổi về sau): APP_KEY=' . \App\Core\SecretBox::generateKey() . ' — hoặc đặt YOUTUBE_USER_KEYS=false nếu không dùng tính năng này.');
                }
            }
            $left = $client->cooldownLeft();
            if ($left > 0) {
                $this->add(self::WARN, 'YouTube đang tạm chặn máy chủ, còn khoảng ' . (int) ceil($left / 60) . ' phút',
                    'Trong lúc này website không hỏi YouTube nữa. Thường do gọi quá nhiều hoặc hosting dùng chung IP với nhiều website khác. Xem storage/logs/app.log.');
            }
            if (YoutubeService::embedEnabled()) {
                $this->add(self::OK, 'Không lấy được luồng trực tiếp thì phát bằng trình phát YouTube (YOUTUBE_EMBED)', 'Khi đó có quảng cáo của YouTube và không có cửa sổ nổi.');
            } else {
                $this->add(self::NOTE, 'YOUTUBE_EMBED=false: không phát bằng trình phát YouTube', 'Piped/Invidious hỏng thì không phát được video.');
            }
        });
    }

    /** Thử nguồn YouTube dự phòng (1 lần tìm kiếm, tính vào giới hạn mỗi giờ). Trả true nếu dùng được. */
    private function youtubeOnline(): bool
    {
        $http = $this->http;
        $isDefault = is_array($http) && ($http[0] ?? null) === $this && ($http[1] ?? '') === 'httpGet';
        $client = new YoutubeDirectClient(new FileCache($this->base . '/storage/cache'), null,
            static function (string $method, string $url, array $headers, ?string $body, int $timeout) use ($http, $isDefault): array {
                if ($method === 'POST' && $isDefault) {
                    return YoutubeDirectClient::httpRequest($method, $url, $headers, $body, $timeout);
                }
                $r = $http($url, $timeout);
                return [(int) $r[0], (string) ($r[2] ?? '')];
            });
        if ($client->mode() === 'off') {
            return false;
        }
        try {
            $n = count($client->search('nhạc', null)['items']);
            $this->add($n > 0 ? self::OK : self::WARN, 'Tìm kiếm qua YouTube (' . ($client->mode() === 'api' ? 'Data API' : 'đọc trực tiếp') . ') ' . ($n > 0 ? 'chạy được' : 'không có kết quả'));
            return $n > 0;
        } catch (\Throwable $e) {
            $this->add(self::WARN, 'Tìm kiếm qua YouTube không chạy được', $e->getMessage() . ' Chi tiết trong storage/logs/app.log.');
            return false;
        }
    }

    /** Gọi chính website qua APP_URL: trang chạy được, các file bí mật không đọc được, có tiêu đề bảo mật. */
    private function liveSite(): void
    {
        $url = rtrim((string) Config::get('app.url', ''), '/');
        if ($url === '' || $this->isLocalUrl($url)) {
            $this->add(self::NOTE, 'Bỏ qua kiểm tra website qua APP_URL', 'APP_URL đang là địa chỉ trên máy mình. Đặt đúng tên miền rồi chạy lại để kiểm tra từ bên ngoài.');
            return;
        }
        $this->guard('Kiểm tra website qua APP_URL', function () use ($url) {
            [$status, , $body] = ($this->http)($url . '/api/health', 8);
            $json = json_decode($body, true);
            if ($status === 0) {
                $this->add(self::WARN, 'Không gọi được ' . $url . ' từ máy chủ', 'Có thể máy chủ không tự gọi được tên miền của chính nó. Hãy mở ' . $url . '/api/health bằng trình duyệt để kiểm tra.');
                return;
            }
            if ($status === 200 && is_array($json) && ($json['ok'] ?? false) === true) {
                $this->add(self::OK, 'Website trả lời ở ' . $url . '/api/health');
            } else {
                $this->add(self::ERROR, $url . '/api/health trả HTTP ' . $status, 'Đường dẫn chưa chạy vào public/index.php. Xem mục "Thư mục web" trong docs/DEPLOY.md.');
            }
            $leaks = [];
            foreach (['/.env', '/storage/logs/app.log', '/app/bootstrap.php', '/composer.json', '/public/index.php', '/bin/migrate.php'] as $p) {
                [$s, , $b] = ($this->http)($url . $p, 8);
                if ($s === 200 && (strpos($b, 'DB_PASS') !== false || strpos($b, '<?php') !== false || strpos($b, 'Lỗi migration') !== false || strpos($b, 'Đã chạy') !== false || strpos($b, 'Không có migration') !== false)) {
                    $leaks[] = $p;
                }
            }
            if ($leaks !== []) {
                $this->add(self::ERROR, 'LỘ FILE NỘI BỘ: ' . implode(', ', $leaks), 'Thư mục web đang trỏ vào thư mục gốc dự án. Trỏ document root vào public/ ngay (xem docs/DEPLOY.md), rồi đổi mật khẩu database/SMTP.');
            } else {
                $this->add(self::OK, 'Không đọc được .env, log, mã nguồn qua web');
            }
            [$s, $headers] = ($this->http)($url . '/', 8);
            $csp = $headers['content-security-policy'] ?? '';
            if ($s === 200 && $csp !== '' && isset($headers['x-frame-options'])) {
                $this->add(self::OK, 'Trang có tiêu đề bảo mật (CSP, chống nhúng khung)');
            } elseif ($s === 200 && (bool) Config::get('app.security.csp', true)) {
                $this->add(self::WARN, 'Trang thiếu tiêu đề bảo mật', 'Có thể máy chủ/CDN đang xóa tiêu đề, hoặc website đang chạy bản cũ.');
            }
            if (stripos($url, 'https://') === 0 && $s === 200 && !isset($headers['strict-transport-security']) && (int) Config::get('app.security.hsts_max_age', 15552000) > 0) {
                $this->add(self::WARN, 'Chưa có HSTS dù chạy https', 'Nếu chạy sau proxy/CDN, cần proxy gửi X-Forwarded-Proto: https.');
            }
        });
    }

    /** @return array{0:int,1:array<string,string>,2:string} [mã HTTP (0 = không kết nối được), header (tên chữ thường), nội dung] */
    public function httpGet(string $url, int $timeout): array
    {
        $headers = [];
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => $timeout,
                CURLOPT_CONNECTTIMEOUT => min(5, $timeout),
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_USERAGENT => 'PHCarPlay-doctor/1.0',
                CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
                CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$headers): int {
                    $pos = strpos($line, ':');
                    if ($pos !== false) {
                        $headers[strtolower(trim(substr($line, 0, $pos)))] = trim((string) substr($line, $pos + 1));
                    }
                    return strlen($line);
                },
            ]);
            $body = curl_exec($ch);
            $status = $body === false ? 0 : (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            curl_close($ch);
            return [$status, $headers, is_string($body) ? $body : ''];
        }
        $ctx = stream_context_create(['http' => ['timeout' => $timeout, 'ignore_errors' => true, 'follow_location' => 0, 'header' => "User-Agent: PHCarPlay-doctor/1.0\r\n"]]);
        $body = @file_get_contents($url, false, $ctx);
        $status = 0;
        foreach ($http_response_header ?? [] as $i => $line) {
            if ($i === 0 && preg_match('#\s(\d{3})(\s|$)#', $line, $m) === 1) {
                $status = (int) $m[1];
            } elseif (($pos = strpos($line, ':')) !== false) {
                $headers[strtolower(trim(substr($line, 0, $pos)))] = trim((string) substr($line, $pos + 1));
            }
        }
        return [$status, $headers, is_string($body) ? $body : ''];
    }
}
