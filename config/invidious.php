<?php
declare(strict_types=1);

use App\Core\Env;

/**
 * Invidious: nguồn video dự phòng khi Piped không trả lời (thứ tự nguồn: VIDEO_SOURCES trong config/piped.php).
 * INVIDIOUS_API_URLS: danh sách địa chỉ, cách nhau bằng dấu phẩy. Website xin luồng phát đi qua máy chủ Invidious (local=true),
 * vì đường dẫn gốc của YouTube chỉ phát được trên đúng máy chủ đã xin nó.
 */
$urls = array_values(array_filter(array_map('trim', explode(',', (string) Env::get(
    'INVIDIOUS_API_URLS',
    'https://invidious.privacyredirect.com,https://vid.priv.au,https://invidious.nerdvpn.de,https://invidious.protokolla.fi'
)))));

return [
    'instances' => $urls,
    'timeout' => Env::int('INVIDIOUS_TIMEOUT', 8),
    'max_tries' => Env::int('INVIDIOUS_MAX_TRIES', 0),
    'verify_ssl' => Env::bool('INVIDIOUS_VERIFY_SSL', true),
];
