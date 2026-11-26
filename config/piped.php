<?php
declare(strict_types=1);

use App\Core\Env;

/**
 * Nguồn video. Website thử lần lượt các nguồn trong VIDEO_SOURCES (mặc định Piped, Invidious, rồi YouTube - xem config/youtube.php);
 * trong mỗi nguồn lại thử lần lượt các địa chỉ, địa chỉ hỏng bị tạm bỏ qua 10 phút.
 * PIPED_API_URLS là danh sách địa chỉ API Piped, cách nhau bằng dấu phẩy. Invidious: config/invidious.php.
 * Danh sách instance công khai: https://github.com/TeamPiped/documentation/blob/main/content/docs/public-instances/index.md
 * Thử nhanh các địa chỉ: php bin/video-scan.php
 */
$urls = array_values(array_filter(array_map('trim', explode(',', (string) Env::get(
    'PIPED_API_URLS',
    'https://pipedapi.kavin.rocks,https://pipedapi.projectsegfau.lt'
)))));
$sources = array_values(array_filter(array_map(static function ($s) {
    return strtolower(trim($s));
}, explode(',', (string) Env::get('VIDEO_SOURCES', 'piped,invidious,youtube'))), static function ($s) {
    return in_array($s, ['piped', 'invidious', 'youtube'], true);
}));

return [
    'instances' => $urls,
    'sources' => $sources !== [] ? array_values(array_unique($sources)) : ['piped', 'invidious', 'youtube'],
    'timeout' => Env::int('PIPED_TIMEOUT', 6),          // giây cho mỗi địa chỉ
    'max_tries' => Env::int('PIPED_MAX_TRIES', 0),      // 0 = thử tất cả địa chỉ; > 0 = thử tối đa bấy nhiêu địa chỉ mỗi yêu cầu
    'verify_ssl' => Env::bool('PIPED_VERIFY_SSL', true), // chỉ đặt false khi phát triển nếu máy báo lỗi chứng chỉ SSL
    'music_query' => Env::get('MUSIC_QUERY', 'nhạc trẻ hay nhất hiện nay'),  // từ khóa tìm nhạc thịnh hành khi mở web
    'music_min_seconds' => 90,
    'music_max_seconds' => 600,
];
