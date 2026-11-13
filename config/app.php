<?php
declare(strict_types=1);

use App\Core\Env;

return [
    'name' => Env::get('APP_NAME', 'PH Car Play'),
    'url' => Env::get('APP_URL', 'http://localhost:8000'),     // dùng để tạo liên kết trong email
    'base_path' => Env::get('APP_BASE_PATH', ''),               // ví dụ "/carweb" nếu đặt trong thư mục con
    'debug' => Env::bool('APP_DEBUG', false),
    'timezone' => Env::get('APP_TIMEZONE', 'Asia/Ho_Chi_Minh'),

    // Bật để kiểm soát quyền dùng theo key/hạn dùng (xem EntitlementService). Mặc định tắt.
    // Mã bí mật để mã hóa dữ liệu nhạy cảm lưu trong database (khóa YouTube API của người dùng). Tạo bằng: php bin/doctor.php
    'key' => (string) Env::get('APP_KEY', ''),

    'enforce_license' => Env::bool('ENFORCE_LICENSE', false),

    // Danh mục bấm nhanh ở Trang chủ: "Nhãn=từ khóa" cách nhau bằng dấu phẩy (xem App\Services\HomeChips).
    'home_chips' => Env::get('HOME_CHIPS', App\Services\HomeChips::DEFAULT),

    'auth' => [
        'reset_ttl_minutes' => Env::int('RESET_TTL_MINUTES', 60),
        'otp_ttl_minutes' => Env::int('OTP_TTL_MINUTES', 10),   // giai đoạn 14: mã OTP quên/đổi mật khẩu
        // true: mỗi tài khoản chỉ đăng nhập được trên một thiết bị, đăng nhập mới sẽ đăng xuất thiết bị cũ
        'single_device' => Env::bool('SINGLE_DEVICE_LOGIN', true),
    ],

    // Bảo mật (xem docs/DEPLOY.md). Mặc định đã an toàn, chỉ đổi khi biết rõ lý do.
    'security' => [
        'rate_limit' => Env::bool('RATE_LIMIT', true),                     // chặn tạm khi gửi thư/đăng ký/nhập key/gọi API quá nhiều lần
        'login_throttle' => Env::bool('LOGIN_THROTTLE', false),            // chặn tạm khi đăng nhập sai nhiều lần; TẮT theo quyết định dự án
        'youtube_per_10min' => Env::int('RATE_LIMIT_YOUTUBE', 1200),       // số lần gọi API YouTube mỗi IP trong 10 phút, 0 = không giới hạn
        'client_ip_header' => (string) Env::get('CLIENT_IP_HEADER', ''),   // chỉ đặt khi chạy sau Cloudflare/proxy, ví dụ CF-Connecting-IP
        'csp' => Env::bool('CSP_ENABLED', true),                            // tiêu đề Content-Security-Policy
        'hsts_max_age' => Env::int('HSTS_MAX_AGE', 15552000),              // giây; chỉ gửi khi trang chạy HTTPS; 0 = tắt
    ],

    // Thư viện phát HLS cho trình duyệt không tự phát được. Có file public/assets/vendor/hls.min.js thì dùng file đó (không phụ thuộc CDN).
    'hls_js' => [
        'url' => (string) Env::get('HLS_JS_URL', ''),
        'integrity' => (string) Env::get('HLS_JS_INTEGRITY', ''),
    ],

    'playlists' => [
        'max_per_user' => 50,
        'max_items' => 500,
    ],

    'session' => [
        'user_name' => 'carweb_sid',
        'admin_name' => 'carweb_admin',
        'lifetime' => 2592000,        // 30 ngày
        'admin_lifetime' => 28800,    // 8 giờ
        'secure' => null,             // null = tự nhận biết HTTPS
    ],
];
