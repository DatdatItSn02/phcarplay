<?php
declare(strict_types=1);

namespace App\Core;

/** Yêu cầu HTTP đã được chuẩn hóa. */
final class Request
{
    /** Dữ liệu gắn thêm trong quá trình xử lý (params của route, user hiện tại...). */
    public array $attributes = [];

    public string $method;
    public string $path;
    public array $query;
    public array $body;
    public array $headers;
    public string $ip;

    public function __construct(
        string $method,
        string $path,
        array $query = [],
        array $body = [],
        array $headers = [],
        string $ip = '0.0.0.0'
    )
    {
        $this->method = $method;
        $this->path = $path;
        $this->query = $query;
        $this->body = $body;
        $this->headers = $headers;
        $this->ip = $ip;
    }

    /**
     * Chuẩn hóa đường dẫn của yêu cầu: bỏ thư mục con của website (APP_BASE_PATH), bỏ "/index.php" nếu có,
     * giải mã %xx và đảm bảo bắt đầu bằng "/". Ví dụ ("/carweb/api/x", "/carweb") => "/api/x".
     */
    public static function resolvePath(string $uri, string $base = ''): string
    {
        $path = parse_url($uri, PHP_URL_PATH);
        $path = rawurldecode(is_string($path) ? $path : '/');
        $base = rtrim($base, '/');
        if ($base !== '' && ($path === $base || strncmp($path, $base . '/', strlen($base) + 1) === 0)) {
            $path = (string) substr($path, strlen($base));
        }
        if ($path === '/index.php' || strncmp($path, '/index.php/', 11) === 0) {
            $path = (string) substr($path, 10);
        }
        return '/' . trim($path, '/');
    }

    /**
     * Tạo Request từ các biến toàn cục của PHP.
     * $path là đường dẫn đã chuẩn hóa bằng resolvePath(); $prefix là phần đầu cần bỏ thêm, ví dụ "/api".
     */
    public static function capture(string $prefix = '', ?string $path = null): self
    {
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        if ($path === null) {
            $path = self::resolvePath($_SERVER['REQUEST_URI'] ?? '/');
        }
        if ($prefix !== '' && strncmp($path, $prefix, strlen($prefix)) === 0) {
            $path = (string) substr($path, strlen($prefix));
        }
        $path = '/' . trim($path, '/');

        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (strncmp($key, 'HTTP_', 5) === 0) {
                $headers[strtolower(str_replace('_', '-', (string) substr($key, 5)))] = (string) $value;
            }
        }
        if (isset($_SERVER['CONTENT_TYPE'])) {
            $headers['content-type'] = (string) $_SERVER['CONTENT_TYPE'];
        }

        $body = [];
        $raw = file_get_contents('php://input');
        if (is_string($raw) && $raw !== '' && stripos($headers['content-type'] ?? '', 'application/json') !== false) {
            $decoded = json_decode($raw, true);
            if (!is_array($decoded)) {
                throw new HttpException(400, 'INVALID_JSON', 'Dữ liệu gửi lên không phải JSON hợp lệ.');
            }
            $body = $decoded;
        } elseif ($method === 'POST') {
            $body = $_POST;
        }

        $ip = self::clientIp((string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'), $headers, (string) Config::get('app.security.client_ip_header', ''));
        return new self($method, $path, $_GET, $body, $headers, $ip);
    }

    /**
     * Địa chỉ IP của người dùng. Mặc định lấy REMOTE_ADDR (không thể giả mạo).
     * Khi website chạy sau Cloudflare hoặc proxy, REMOTE_ADDR là IP của proxy: đặt CLIENT_IP_HEADER (ví dụ CF-Connecting-IP
     * hoặc X-Real-IP) để lấy IP thật từ header đó. KHÔNG đặt khi không có proxy, vì khi đó ai cũng tự gửi header này được.
     */
    public static function clientIp(string $remoteAddr, array $headers, string $headerName): string
    {
        $name = strtolower(trim($headerName));
        if ($name !== '' && isset($headers[$name])) {
            $first = trim(explode(',', (string) $headers[$name])[0]);
            if (filter_var($first, FILTER_VALIDATE_IP) !== false) {
                return $first;
            }
        }
        return $remoteAddr;
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function input(string $key, $default = null)
    {
        return $this->body[$key] ?? $default;
    }

    public function param(string $name): ?string
    {
        return $this->attributes['params'][$name] ?? null;
    }
}
