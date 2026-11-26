<?php
declare(strict_types=1);

use App\Controllers\AuthController;
use App\Controllers\CastController;
use App\Controllers\HealthController;
use App\Controllers\LicenseController;
use App\Controllers\PlayStatsController;
use App\Controllers\PlaylistController;
use App\Controllers\PreferencesController;
use App\Controllers\UserApiKeyController;
use App\Controllers\YoutubeController;
use App\Core\Router;
use App\Middleware\RequireUser;

/**
 * Danh sách đường dẫn của API người dùng (tiền tố /api).
 * Thêm chức năng mới: khai báo route ở đây, viết Controller trong app/Controllers.
 * Route cần đăng nhập: bọc trong $router->group([RequireUser::class], function (Router $r) { ... }).
 */
return function (Router $router): void {
    $router->get('/health', [HealthController::class, 'index']);

    $router->get('/auth/me', [AuthController::class, 'me']);
    $router->post('/auth/register', [AuthController::class, 'register']);
    $router->post('/auth/login', [AuthController::class, 'login']);
    $router->post('/auth/logout', [AuthController::class, 'logout']);
    $router->post('/auth/forgot', [AuthController::class, 'forgot']);
    $router->post('/auth/reset', [AuthController::class, 'reset']);

    // YouTube qua Piped (khách dùng thử cũng gọi được)
    $router->get('/youtube/search', [YoutubeController::class, 'search']);
    $router->get('/youtube/suggest', [YoutubeController::class, 'suggest']);
    $router->get('/youtube/trending', [YoutubeController::class, 'trending']);
    $router->get('/youtube/stream/{id}', [YoutubeController::class, 'stream']);

    // Giai đoạn 15: ghép nối chiếu màn hình điện thoại lên màn hình xe (không cần đăng nhập; mỗi máy dùng khóa X-Cast-Token)
    $router->post('/cast/sessions', [CastController::class, 'create']);
    $router->post('/cast/join', [CastController::class, 'join']);
    $router->get('/cast/sessions/{id}/signals', [CastController::class, 'signals']);
    $router->post('/cast/sessions/{id}/signals', [CastController::class, 'send']);
    $router->post('/cast/sessions/{id}/end', [CastController::class, 'end']);
    // Giai đoạn 17: ghép đôi một lần, lần sau bấm "Chia sẻ" là chiếu (khóa thiết bị trong header X-Cast-Device)
    $router->get('/cast/pairs', [CastController::class, 'pairs']);
    $router->get('/cast/incoming', [CastController::class, 'incoming']);
    $router->post('/cast/pairs/{id}/share', [CastController::class, 'share']);
    $router->post('/cast/pairs/{id}/forget', [CastController::class, 'forget']);

    // Cần đăng nhập (đúng thiết bị đang hợp lệ)
    $router->group([RequireUser::class], function (Router $r) {
        $r->get('/user/preferences', [PreferencesController::class, 'show']);
        $r->put('/user/preferences', [PreferencesController::class, 'update']);
        $r->get('/user/youtube-key', [UserApiKeyController::class, 'show']);
        $r->put('/user/youtube-key', [UserApiKeyController::class, 'update']);
        $r->delete('/user/youtube-key', [UserApiKeyController::class, 'destroy']);
        $r->post('/user/plays', [PlayStatsController::class, 'record']);
        $r->get('/user/plays/top', [PlayStatsController::class, 'top']);
        $r->post('/user/plays/clear', [PlayStatsController::class, 'clear']);
        $r->post('/user/plays/{id}/hide', [PlayStatsController::class, 'hide']);
        $r->post('/user/license/redeem', [LicenseController::class, 'redeem']);
        $r->put('/user/phone', [AuthController::class, 'updatePhone']);
        $r->post('/user/password/code', [AuthController::class, 'passwordCode']);
        $r->post('/user/password', [AuthController::class, 'changePassword']);

        $r->get('/playlists', [PlaylistController::class, 'index']);
        $r->post('/playlists', [PlaylistController::class, 'store']);
        $r->post('/playlists/import', [PlaylistController::class, 'import']);
        $r->get('/playlists/{id}', [PlaylistController::class, 'show']);
        $r->patch('/playlists/{id}', [PlaylistController::class, 'update']);
        $r->delete('/playlists/{id}', [PlaylistController::class, 'destroy']);
        $r->post('/playlists/{id}/items', [PlaylistController::class, 'addItems']);
        $r->delete('/playlists/{id}/items/{video_id}', [PlaylistController::class, 'removeItem']);
        $r->put('/playlists/{id}/order', [PlaylistController::class, 'reorder']);
    });
};
