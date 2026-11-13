<?php
declare(strict_types=1);

use App\Core\Env;

/**
 * Nguồn dự phòng thứ ba (giai đoạn 9): khi Piped và Invidious đều hỏng.
 * - Tìm kiếm: nếu có YOUTUBE_API_KEY thì dùng YouTube Data API chính thức; không có khóa thì máy chủ đọc trực tiếp
 *   kết quả tìm kiếm của YouTube (giống công cụ yt-dlp). Đọc trực tiếp có giới hạn số lần mỗi giờ, kết quả được lưu đệm,
 *   và tự nghỉ một thời gian nếu YouTube báo chặn, để không làm YouTube chặn địa chỉ IP của máy chủ.
 * - Phát video: khi không lấy được luồng trực tiếp thì phát bằng trình phát nhúng chính thức của YouTube (YOUTUBE_EMBED).
 */
return [
    'direct' => Env::bool('YOUTUBE_DIRECT', true),                     // cho phép đọc trực tiếp tìm kiếm của YouTube khi không có khóa API
    'api_key' => trim((string) Env::get('YOUTUBE_API_KEY', '')),        // khóa YouTube Data API v3 (không bắt buộc)
    'per_hour' => Env::int('YOUTUBE_DIRECT_PER_HOUR', 300),             // tối đa số lần máy chủ hỏi YouTube mỗi giờ (cả website)
    'block_cooldown' => Env::int('YOUTUBE_BLOCK_COOLDOWN', 1800),       // YouTube báo chặn thì nghỉ bấy nhiêu giây
    'search_ttl' => Env::int('YOUTUBE_SEARCH_TTL', 1800),               // lưu đệm kết quả tìm kiếm (giây)
    'embed' => Env::bool('YOUTUBE_EMBED', true),                        // phát bằng trình phát YouTube khi không có luồng trực tiếp
    'region' => strtoupper((string) Env::get('YOUTUBE_REGION', 'VN')),
    'language' => (string) Env::get('YOUTUBE_LANGUAGE', 'vi'),
    'timeout' => Env::int('YOUTUBE_TIMEOUT', 8),
    'client_version' => (string) Env::get('YOUTUBE_CLIENT_VERSION', '2.20251101.01.00'),
    // Địa chỉ gốc: chỉ đổi khi kiểm thử với máy chủ YouTube giả.
    'web_base' => rtrim((string) Env::get('YOUTUBE_WEB_BASE', 'https://www.youtube.com'), '/'),
    'api_base' => rtrim((string) Env::get('YOUTUBE_API_BASE', 'https://www.googleapis.com/youtube/v3'), '/'),
    'suggest_url' => (string) Env::get('YOUTUBE_SUGGEST_URL', 'https://suggestqueries.google.com/complete/search'),
    'iframe_api' => (string) Env::get('YOUTUBE_IFRAME_API_URL', 'https://www.youtube.com/iframe_api'),
    // Giai đoạn 10: người dùng có tài khoản được nhập khóa YouTube Data API riêng trong Cài đặt (cần APP_KEY để mã hóa).
    // Có khóa riêng thì tìm kiếm của người đó đi thẳng bằng khóa ấy, không tốn lượt của website và không cần đọc trực tiếp YouTube.
    'user_keys' => Env::bool('YOUTUBE_USER_KEYS', true),
    // Nhắc nhẹ người chưa có khóa riêng khi tìm kiếm phải dùng cách dự phòng hoặc lỗi (tối đa 1 lần/ngày, "Để sau" = 7 ngày).
    'key_hint' => Env::bool('YOUTUBE_KEY_HINT', true),
    // Video phát đầu tiên khi mở website: đường dẫn YouTube (youtube.com/watch?v=..., youtu.be/..., /shorts/...) hoặc mã 11 ký tự.
    'default_video' => (string) Env::get('DEFAULT_VIDEO_URL', ''),
];
