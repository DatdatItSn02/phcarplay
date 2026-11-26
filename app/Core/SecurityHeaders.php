<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Các tiêu đề HTTP bảo mật cho trang giao diện và API. Chỉ là hàm thuần (trả về mảng) để kiểm thử được;
 * public/index.php và Response::send() gửi chúng đi.
 *
 * Content-Security-Policy (CSP) là lớp chặn thứ hai: kể cả khi có lỗi làm lọt mã lạ vào trang,
 * trình duyệt cũng không chạy script nào ngoài file của website, đoạn khởi tạo theme (khớp mã băm) và hls.js.
 * Ảnh, video, kết nối mạng được phép tới mọi địa chỉ vì luồng video đến từ máy chủ Piped do bạn cấu hình.
 * Nếu một tính năng bị chặn sau khi bật CSP, đặt CSP_ENABLED=false trong .env để kiểm tra (xem docs/DEPLOY.md).
 */
final class SecurityHeaders
{
    public const DEFAULT_HLS = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.17/hls.min.js';
    public const VENDOR_HLS = '/assets/vendor/hls.min.js';

    /**
     * Nguồn hls.js cho giao diện: file public/assets/vendor/hls.min.js nếu bạn đã tải về (không phụ thuộc CDN),
     * nếu không thì HLS_JS_URL (chỉ nhận https:// hoặc đường dẫn bắt đầu bằng /), cuối cùng là CDN mặc định.
     * @return array{src:string,integrity:string}
     */
    public static function hlsSource(string $publicDir, string $base): array
    {
        if (is_file($publicDir . self::VENDOR_HLS)) {
            return ['src' => $base . self::VENDOR_HLS, 'integrity' => ''];
        }
        $url = trim((string) Config::get('app.hls_js.url', ''));
        if ($url === '' || preg_match('#^(https://[^\s"\'<>]+|/[^/\s"\'<>][^\s"\'<>]*)$#', $url) !== 1) {
            $url = self::DEFAULT_HLS;
        }
        $integrity = trim((string) Config::get('app.hls_js.integrity', ''));
        if ($integrity !== '' && preg_match('#^sha(256|384|512)-[A-Za-z0-9+/=]+$#', $integrity) !== 1) {
            $integrity = '';
        }
        return ['src' => $url, 'integrity' => $integrity];
    }

    /**
     * Tiêu đề cho trang HTML.
     * $inlineScript: nội dung đúng từng byte của thẻ <script> nội tuyến duy nhất (appearance-boot.js) để tính mã băm cho CSP.
     * @return array<string,string>
     */
    public static function page(bool $isAdmin, string $inlineScript, string $hlsSrc, bool $https, string $ytApi = ''): array
    {
        $headers = [
            'X-Content-Type-Options' => 'nosniff',
            'Referrer-Policy' => 'strict-origin-when-cross-origin',
            'X-Frame-Options' => $isAdmin ? 'DENY' : 'SAMEORIGIN',
            'Permissions-Policy' => 'camera=(), geolocation=(), payment=(), usb=()',
        ];
        if ((bool) Config::get('app.security.csp', true)) {
            $headers['Content-Security-Policy'] = self::csp($isAdmin, $inlineScript, $hlsSrc, $ytApi);
        }
        $hsts = self::hsts($https);
        if ($hsts !== '') {
            $headers['Strict-Transport-Security'] = $hsts;
        }
        return $headers;
    }

    /** Tiêu đề thêm cho phản hồi JSON của API: không cho hiển thị như trang web hay nhúng vào khung. @return array<string,string> */
    public static function api(bool $https): array
    {
        $headers = [
            'Content-Security-Policy' => "default-src 'none'; frame-ancestors 'none'",
            'Referrer-Policy' => 'no-referrer',
        ];
        $hsts = self::hsts($https);
        if ($hsts !== '') {
            $headers['Strict-Transport-Security'] = $hsts;
        }
        return $headers;
    }

    /**
     * $ytApi: địa chỉ thư viện trình phát YouTube (iframe_api) khi bật phát nhúng (giai đoạn 9), rỗng nếu tắt.
     * Khi bật: cho chạy script từ đúng nguồn đó và cho nhúng khung từ youtube.com / youtube-nocookie.com.
     */
    public static function csp(bool $isAdmin, string $inlineScript, string $hlsSrc, string $ytApi = ''): string
    {
        $scripts = ["'self'", "'sha256-" . base64_encode(hash('sha256', $inlineScript, true)) . "'"];
        $origin = self::origin($hlsSrc);
        if (!$isAdmin && $origin !== null) {
            $scripts[] = $origin;
        }
        $frames = ["'self'"];
        $yt = $isAdmin ? null : self::embedOrigin($ytApi);
        if ($yt !== null) {
            if (!in_array($yt, $scripts, true)) {
                $scripts[] = $yt;
            }
            $frames = array_values(array_unique(array_merge($frames, [$yt, 'https://www.youtube.com', 'https://www.youtube-nocookie.com'])));
        }
        return implode('; ', [
            "default-src 'self'",
            'script-src ' . implode(' ', $scripts),
            "style-src 'self' 'unsafe-inline'",     // giao diện đặt màu/cỡ bằng thuộc tính style
            'img-src * data: blob:',                // ảnh bìa từ máy chủ Piped/YouTube
            'media-src * data: blob:',              // luồng video từ máy chủ Piped (blob: cho hls.js)
            'connect-src *',                        // hls.js tải danh sách đoạn video từ máy chủ Piped
            "worker-src 'self' blob:",              // hls.js chạy trong worker tạo từ blob:
            "child-src 'self' blob:",               // như worker-src, cho trình duyệt cũ
            'frame-src ' . implode(' ', $frames),   // trình phát nhúng của YouTube (khi bật YOUTUBE_EMBED)
            "font-src 'self' data:",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            'frame-ancestors ' . ($isAdmin ? "'none'" : "'self'"),
        ]);
    }

    /** HSTS: bắt trình duyệt luôn dùng HTTPS cho website. Chỉ gửi khi trang đang chạy HTTPS; HSTS_MAX_AGE=0 để tắt. */
    public static function hsts(bool $https): string
    {
        $age = (int) Config::get('app.security.hsts_max_age', 15552000);
        return $https && $age > 0 ? 'max-age=' . $age : '';
    }

    /** Nguồn của thư viện trình phát YouTube: https, hoặc http://localhost / 127.0.0.1 (chỉ dùng khi kiểm thử với YouTube giả). */
    public static function embedOrigin(string $url): ?string
    {
        if (preg_match('#^http://(localhost|127\.0\.0\.1)(:\d{1,5})?(/|$)#', $url, $m) === 1) {
            return 'http://' . $m[1] . ($m[2] ?? '');
        }
        return self::origin($url);
    }

    /** "https://cdn.example.com" từ một địa chỉ đầy đủ; null nếu là đường dẫn trong website. */
    public static function origin(string $url): ?string
    {
        if (preg_match('#^https://([A-Za-z0-9.-]+)(:\d{1,5})?(/|$)#', $url, $m) !== 1) {
            return null;
        }
        return 'https://' . strtolower($m[1]) . ($m[2] ?? '');
    }
}
