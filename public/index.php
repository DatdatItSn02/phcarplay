<?php
declare(strict_types=1);

/**
 * ĐIỂM VÀO DUY NHẤT của website. Chỉ cần điều hướng mọi yêu cầu vào file này
 * (giữ nguyên đường dẫn gốc trong REQUEST_URI). Nó tự phân loại:
 *   /api/...        -> API JSON của người dùng
 *   /admin/api/...  -> API JSON của khu vực quản trị (phiên riêng)
 *   /assets/...     -> file tĩnh (css, js, ảnh) nếu máy chủ chưa tự phục vụ
 *   /admin, /admin/... -> trang quản trị (kể cả /admin/reset-password?token=...)
 *   còn lại         -> trang giao diện người dùng (kể cả /reset-password?token=...)
 * Nếu website nằm trong thư mục con (ví dụ /carweb), đặt APP_BASE_PATH=/carweb trong .env.
 */
require dirname(__DIR__) . '/app/bootstrap.php';

use App\Core\Config;
use App\Core\ErrorHandler;
use App\Core\Request;
use App\Core\Router;
use App\Core\SecurityHeaders;
use App\Core\Session;
use App\Core\StaticFiles;
use App\Middleware\Csrf;

$base = rtrim((string) Config::get('app.base_path', ''), '/');
$path = Request::resolvePath($_SERVER['REQUEST_URI'] ?? '/', $base);

// ---- API ----
if ($path === '/api' || strncmp($path, '/api/', 5) === 0) {
    try {
        Session::start('user');
        $router = new Router();
        $router->setGlobalMiddleware([Csrf::class]);
        (require BASE_PATH . '/routes/api.php')($router);
        $response = $router->dispatch(Request::capture('/api', $path));
    } catch (Throwable $e) {
        $response = ErrorHandler::toResponse($e);
    }
    $response->send();
    return;
}

// ---- API quản trị ----
if ($path === '/admin/api' || strncmp($path, '/admin/api/', 11) === 0) {
    try {
        Session::start('admin');
        $router = new Router();
        $router->setGlobalMiddleware([Csrf::class]);
        (require BASE_PATH . '/routes/admin.php')($router);
        $response = $router->dispatch(Request::capture('/admin/api', $path));
    } catch (Throwable $e) {
        $response = ErrorHandler::toResponse($e);
    }
    $response->send();
    return;
}

// ---- File tĩnh ----
if (strncmp($path, '/assets/', 8) === 0) {
    StaticFiles::serve(__DIR__, $path);
    return;
}
if (preg_match('#\.[A-Za-z0-9]{2,5}$#', $path) === 1) {   // /favicon.ico, /robots.txt... không có thì báo 404
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Không tìm thấy.';
    return;
}

// ---- Trang giao diện (người dùng hoặc quản trị) ----
$isAdmin = $path === '/admin' || strncmp($path, '/admin/', 7) === 0;
$name = (string) Config::get('app.name', 'PH Car Play');
$boot = [
    'appName' => $name,
    'basePath' => $base,
    'apiBase' => $base . ($isAdmin ? '/admin/api' : '/api'),
];
$hls = ['src' => '', 'integrity' => ''];
$ytApi = '';
if (!$isAdmin) {
    $boot['homeChips'] = App\Services\HomeChips::parse((string) Config::get('app.home_chips', App\Services\HomeChips::DEFAULT));
    $hls = SecurityHeaders::hlsSource(__DIR__, $base);
    $boot['hlsJs'] = $hls;
    // Trình phát nhúng của YouTube khi không lấy được luồng trực tiếp (giai đoạn 9)
    $ytEmbed = App\Services\YoutubeService::embedEnabled();
    $ytApi = $ytEmbed ? (string) Config::get('youtube.iframe_api', 'https://www.youtube.com/iframe_api') : '';
    if (SecurityHeaders::embedOrigin($ytApi) === null) {
        $ytApi = '';
    }
    $boot['youtube'] = [
        'embed' => $ytApi !== '',
        'iframeApi' => $ytApi,
        // Video phát đầu tiên khi mở website (DEFAULT_VIDEO_URL trong .env), null nếu không đặt hoặc sai dạng
        'defaultVideo' => App\Services\YoutubeService::videoIdFromUrl((string) Config::get('youtube.default_video', '')),
    ];
}
// Đoạn script nội tuyến duy nhất của trang (đặt theme trước khi vẽ để không nháy màu). CSP chỉ cho chạy đúng nội dung này.
$bootScript = (string) @file_get_contents(__DIR__ . '/assets/js/appearance-boot.js');
$entry = $isAdmin ? 'assets/js/admin/main.js' : 'assets/js/main.js';
$styles = $isAdmin ? ['assets/css/app.css', 'assets/css/admin.css'] : ['assets/css/app.css'];
$ver = 1;
foreach (array_merge([$entry], $styles) as $asset) {
    $ver = max($ver, (int) @filemtime(__DIR__ . '/' . $asset));
}
$ver = (string) $ver;
$title = $isAdmin ? 'Quản trị - ' . $name : $name;
header('Content-Type: text/html; charset=utf-8');
foreach (SecurityHeaders::page($isAdmin, $bootScript, $hls['src'], Session::isHttps(), $ytApi) as $headerName => $headerValue) {
    header($headerName . ': ' . $headerValue);
}
if ($isAdmin) {
    header('X-Robots-Tag: noindex, nofollow');
    header('Cache-Control: no-store');
}
?>
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#0f0f0f">
  <meta name="color-scheme" content="dark light">
<?php if ($isAdmin): ?>
  <meta name="robots" content="noindex, nofollow">
<?php endif; ?>
  <title><?= htmlspecialchars($title, ENT_QUOTES, 'UTF-8') ?></title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='24' fill='%23ff0033'/%3E%3Cpath fill='%23fff' d='M33.8 16.4c-.3-.9-1.2-1.6-2.2-1.6H16.4c-1 0-1.9.7-2.2 1.6L11 25.6v12.2c0 .8.7 1.5 1.5 1.5h1.6c.8 0 1.5-.7 1.5-1.5v-1.5h16.8v1.5c0 .8.7 1.5 1.5 1.5h1.6c.8 0 1.5-.7 1.5-1.5V25.6zM16.6 30.9a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6zm14.8 0a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6zM14.1 24.1l2.3-6.9h15.2l2.3 6.9z'/%3E%3C/svg%3E">
  <script><?= $bootScript ?></script>
<?php foreach ($styles as $css): ?>
  <link rel="stylesheet" href="<?= htmlspecialchars($base . '/' . $css . '?v=' . $ver, ENT_QUOTES, 'UTF-8') ?>">
<?php endforeach; ?>
</head>
<body>
  <div id="app"></div>
  <noscript>Trang này cần bật JavaScript để hoạt động.</noscript>
  <script id="boot" type="application/json"><?= json_encode($boot, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP) ?></script>
  <script type="module" src="<?= htmlspecialchars($base . '/' . $entry . '?v=' . $ver, ENT_QUOTES, 'UTF-8') ?>"></script>
</body>
</html>
