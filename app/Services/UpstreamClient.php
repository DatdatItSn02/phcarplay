<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Config;
use App\Core\FileCache;
use App\Core\HttpException;
use App\Core\Logger;

/**
 * Gọi API JSON của một nhóm máy chủ công cộng (Piped hoặc Invidious).
 * - Bắt đầu từ địa chỉ chạy tốt gần nhất, rồi thử lần lượt TẤT CẢ địa chỉ còn lại (hoặc tối đa max_tries nếu đặt > 0).
 * - Địa chỉ không kết nối được / trả trang web thay vì dữ liệu / lỗi 5xx, 403, 429 bị tạm bỏ qua DEAD_SECONDS giây,
 *   để các yêu cầu sau không phải chờ nó. Lỗi riêng của một video (JSON có trường error) không làm địa chỉ bị bỏ qua.
 * - Lưu kết quả vào bộ nhớ đệm khi có $ttl.
 * $transport (dùng khi kiểm thử): function (string $url, int $timeout, bool $verifySsl): array{0:int,1:string} (mã HTTP, nội dung).
 */
abstract class UpstreamClient
{
    public const DEAD_SECONDS = 600;

    private FileCache $cache;
    private ?array $cfg;
    private $transport;
    private string $lastBase = '';

    public function __construct(FileCache $cache, ?array $cfg = null, ?callable $transport = null)
    {
        $this->cache = $cache;
        $this->cfg = $cfg;
        $this->transport = $transport;
    }

    /** Tên nhóm trong config và bộ nhớ đệm: 'piped' hoặc 'invidious'. */
    abstract public function kind(): string;

    /** Tên hiển thị trong thông báo lỗi. */
    abstract public function label(): string;

    /** @return array<int,string> */
    public function instances(): array
    {
        $cfg = $this->config();
        return array_values(array_filter(array_map(static function ($u): string {
            return rtrim(trim((string) $u), '/');
        }, (array) ($cfg['instances'] ?? []))));
    }

    public function configured(): bool
    {
        return $this->instances() !== [];
    }

    /** Địa chỉ vừa trả lời thành công (để đổi đường dẫn tương đối "/..." thành đầy đủ). */
    public function lastBase(): string
    {
        return $this->lastBase;
    }

    public function get(string $path, array $query = [], int $ttl = 0): array
    {
        $cfg = $this->config();
        $instances = $this->instances();
        if ($instances === []) {
            $upper = strtoupper($this->kind());
            throw new HttpException(503, $upper . '_NOT_CONFIGURED', 'Chưa cấu hình địa chỉ ' . $this->label() . ' (' . $upper . '_API_URLS trong .env).');
        }

        $qs = $query ? '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986) : '';
        $cacheKey = $this->kind() . ':' . $path . $qs;
        if ($ttl > 0) {
            $hit = $this->cache->get($cacheKey);
            if (is_array($hit) && isset($hit['base'], $hit['data']) && is_array($hit['data'])) {
                $this->lastBase = (string) $hit['base'];
                return $hit['data'];
            }
        }

        $timeout = max(1, (int) ($cfg['timeout'] ?? 6));
        $verify = (bool) ($cfg['verify_ssl'] ?? true);
        $count = count($instances);
        $maxTries = (int) ($cfg['max_tries'] ?? 0);
        $tries = $maxTries > 0 ? min($count, $maxTries) : $count;
        $start = (int) $this->cache->get($this->kind() . ':last_ok') % $count;
        $errors = [];
        $tried = 0;

        for ($i = 0; $i < $count && $tried < $tries; $i++) {
            $idx = ($start + $i) % $count;
            $base = $instances[$idx];
            if ($this->isDead($base)) {
                $errors[] = $base . ' -> đang tạm bỏ qua (lỗi gần đây)';
                continue;
            }
            $tried++;
            try {
                $result = $this->transport !== null
                    ? ($this->transport)($base . $path . $qs, $timeout, $verify)
                    : $this->defaultTransport($base . $path . $qs, $timeout, $verify);
                $status = (int) $result[0];
                $data = json_decode((string) $result[1], true);
                if ($status >= 200 && $status < 300 && is_array($data) && !isset($data['error'])) {
                    $this->cache->set($this->kind() . ':last_ok', $idx, 86400);
                    $this->lastBase = $base;
                    if ($ttl > 0) {
                        $this->cache->set($cacheKey, ['base' => $base, 'data' => $data], $ttl);
                    }
                    return $data;
                }
                if (!is_array($data)) {
                    $errors[] = $base . ' -> HTTP ' . $status . ' nhưng trả về trang web, không phải dữ liệu';
                    $this->markDead($base);
                    continue;
                }
                $msg = $data['message'] ?? ($data['error'] ?? '');
                $errors[] = $base . ' -> HTTP ' . $status . (is_string($msg) && $msg !== '' ? ' ' . mb_substr($msg, 0, 120) : '');
                // Lỗi của cả máy chủ (chặn, quá tải, Cloudflare 52x) thì tạm bỏ qua; lỗi riêng một video (có trường error) thì không.
                if (in_array($status, [401, 403, 429], true) || $status >= 520 || (!isset($data['error']) && ($status < 200 || $status >= 300))) {
                    $this->markDead($base);
                }
            } catch (\Throwable $e) {
                $errors[] = $base . ' -> ' . $e->getMessage();
                $this->markDead($base);
            }
        }

        Logger::error($this->label() . ' không phản hồi hợp lệ: ' . $path, ['errors' => $errors]);
        throw new HttpException(502, 'UPSTREAM_FAILED', 'Không kết nối được máy chủ ' . $this->label() . '. Vui lòng thử lại sau ít phút.');
    }

    public function isDead(string $base): bool
    {
        return $this->cache->get($this->kind() . ':dead:' . md5($base)) !== null;
    }

    private function markDead(string $base): void
    {
        $this->cache->set($this->kind() . ':dead:' . md5($base), 1, self::DEAD_SECONDS);
    }

    private function config(): array
    {
        return $this->cfg ?? (array) Config::get($this->kind(), []);
    }

    /** @return array{0:int,1:string} */
    private function defaultTransport(string $url, int $timeout, bool $verifySsl): array
    {
        return self::fetch($url, $timeout, $verifySsl);
    }

    /**
     * Gọi một địa chỉ http/https, trả [mã HTTP, nội dung]. Dùng chung cho lệnh kiểm tra (bin/doctor.php, bin/video-scan.php).
     * @return array{0:int,1:string}
     */
    public static function fetch(string $url, int $timeout, bool $verifySsl = true): array
    {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => $timeout,
                CURLOPT_CONNECTTIMEOUT => min(4, $timeout),
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_MAXREDIRS => 3,
                CURLOPT_USERAGENT => 'PHCarPlay/1.0',
                CURLOPT_HTTPHEADER => ['Accept: application/json'],
                CURLOPT_ENCODING => '',
                CURLOPT_SSL_VERIFYPEER => $verifySsl,
                CURLOPT_SSL_VERIFYHOST => $verifySsl ? 2 : 0,
                // chỉ cho http/https, kể cả khi bị chuyển hướng (không bao giờ đọc file:// hay giao thức khác)
                CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
                CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            ]);
            $body = curl_exec($ch);
            if ($body === false) {
                $err = curl_error($ch);
                curl_close($ch);
                throw new \RuntimeException($err !== '' ? $err : 'curl thất bại');
            }
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            curl_close($ch);
            return [$status, (string) $body];
        }

        $ctx = stream_context_create([
            'http' => ['timeout' => $timeout, 'ignore_errors' => true, 'header' => "Accept: application/json\r\nUser-Agent: PHCarPlay/1.0\r\n"],
            'ssl' => ['verify_peer' => $verifySsl, 'verify_peer_name' => $verifySsl],
        ]);
        $body = @file_get_contents($url, false, $ctx);
        if ($body === false) {
            throw new \RuntimeException('Không mở được địa chỉ (PHP chưa bật extension curl hoặc openssl?)');
        }
        $status = 0;
        if (isset($http_response_header[0]) && preg_match('#\s(\d{3})(\s|$)#', $http_response_header[0], $m) === 1) {
            $status = (int) $m[1];
        }
        return [$status, $body];
    }
}
