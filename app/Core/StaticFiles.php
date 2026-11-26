<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Phục vụ file tĩnh trong public/assets khi máy chủ của bạn điều hướng MỌI yêu cầu vào index.php.
 * Chỉ cho phép các đuôi file an toàn và chặn mọi đường dẫn thoát ra ngoài thư mục assets.
 */
final class StaticFiles
{
    private const TYPES = [
        'css' => 'text/css; charset=utf-8',
        'js' => 'text/javascript; charset=utf-8',
        'mjs' => 'text/javascript; charset=utf-8',
        'json' => 'application/json; charset=utf-8',
        'svg' => 'image/svg+xml',
        'png' => 'image/png',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'gif' => 'image/gif',
        'webp' => 'image/webp',
        'ico' => 'image/x-icon',
        'woff' => 'font/woff',
        'woff2' => 'font/woff2',
        'txt' => 'text/plain; charset=utf-8',
    ];

    /** Trả về true nếu đã gửi file, false nếu không tìm thấy (đã gửi 404). */
    public static function serve(string $publicDir, string $path): bool
    {
        $file = self::locate($publicDir, $path);
        if ($file === null) {
            self::status(404);
            self::send('Content-Type: text/plain; charset=utf-8');
            echo 'Không tìm thấy.';
            return false;
        }
        $mtime = (int) filemtime($file);
        self::send('Content-Type: ' . self::TYPES[strtolower(pathinfo($file, PATHINFO_EXTENSION))]);
        self::send('X-Content-Type-Options: nosniff');
        self::send('Cache-Control: no-cache');   // luôn hỏi lại máy chủ, trả 304 nếu file chưa đổi
        self::send('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');
        $since = isset($_SERVER['HTTP_IF_MODIFIED_SINCE']) ? strtotime((string) $_SERVER['HTTP_IF_MODIFIED_SINCE']) : false;
        if ($since !== false && $since >= $mtime) {
            self::status(304);
            return true;
        }
        self::send('Content-Length: ' . (string) filesize($file));
        readfile($file);
        return true;
    }

    private static function send(string $header): void
    {
        if (!headers_sent()) {   // khi chạy kiểm thử trên dòng lệnh, header đã gửi nên bỏ qua
            header($header);
        }
    }

    private static function status(int $code): void
    {
        if (!headers_sent()) {
            http_response_code($code);
        }
    }

    /** Đường dẫn thật của file hợp lệ trong assets, hoặc null. */
    public static function locate(string $publicDir, string $path): ?string
    {
        if (strpos($path, "\0") !== false) {
            return null;
        }
        $root = realpath($publicDir . '/assets');
        $file = realpath($publicDir . $path);
        if ($root === false || $file === false) {
            return null;
        }
        if (strncmp($file, $root . DIRECTORY_SEPARATOR, strlen($root) + 1) !== 0 || !is_file($file)) {
            return null;
        }
        $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        return isset(self::TYPES[$ext]) ? $file : null;
    }
}
