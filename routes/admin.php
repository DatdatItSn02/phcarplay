<?php
declare(strict_types=1);

use App\Controllers\Admin\AdminAccountsController;
use App\Controllers\Admin\AdminAuditController;
use App\Controllers\Admin\AdminAuthController;
use App\Controllers\Admin\AdminKeysController;
use App\Controllers\Admin\AdminPlaylistsController;
use App\Controllers\Admin\AdminStatsController;
use App\Controllers\Admin\AdminUsersController;
use App\Core\Router;
use App\Middleware\RequireAdmin;
use App\Middleware\RequireMaster;
use App\Middleware\RequirePasswordChanged;

/**
 * API khu vực quản trị (tiền tố /admin/api), dùng phiên riêng (cookie carweb_admin) tách khỏi người dùng.
 * Thứ tự middleware trong nhóm: RequireAdmin (đăng nhập) -> RequirePasswordChanged (đã đổi mật khẩu tạm) -> RequireMaster.
 */
return function (Router $router): void {
    $router->get('/auth/me', [AdminAuthController::class, 'me']);
    $router->post('/auth/login', [AdminAuthController::class, 'login']);
    $router->post('/auth/logout', [AdminAuthController::class, 'logout']);
    $router->post('/auth/forgot', [AdminAuthController::class, 'forgot']);
    $router->post('/auth/reset', [AdminAuthController::class, 'reset']);

    // Đã đăng nhập; vẫn dùng được khi đang bị buộc đổi mật khẩu
    $router->group([RequireAdmin::class], function (Router $r) {
        $r->post('/account/password', [AdminAuthController::class, 'changePassword']);
    });

    // Mọi admin đang hoạt động (đã đổi mật khẩu tạm)
    $router->group([RequireAdmin::class, RequirePasswordChanged::class], function (Router $r) {
        $r->get('/stats', [AdminStatsController::class, 'overview']);

        $r->get('/users', [AdminUsersController::class, 'index']);
        $r->get('/users/{id}', [AdminUsersController::class, 'show']);
        $r->patch('/users/{id}', [AdminUsersController::class, 'update']);
        $r->post('/users/{id}/extend', [AdminUsersController::class, 'extend']);
        $r->post('/users/{id}/password', [AdminUsersController::class, 'setPassword']);
        $r->post('/users/{id}/send-reset', [AdminUsersController::class, 'sendReset']);
        $r->post('/users/{id}/logout-device', [AdminUsersController::class, 'logoutDevice']);
        $r->delete('/users/{id}', [AdminUsersController::class, 'destroy']);

        $r->get('/keys', [AdminKeysController::class, 'index']);
        $r->post('/keys', [AdminKeysController::class, 'store']);
        $r->post('/keys/bulk', [AdminKeysController::class, 'bulk']);
        $r->post('/keys/{id}/revoke', [AdminKeysController::class, 'revoke']);
        $r->delete('/keys/{id}', [AdminKeysController::class, 'destroy']);

        $r->get('/playlists', [AdminPlaylistsController::class, 'index']);
        $r->get('/playlists/{id}', [AdminPlaylistsController::class, 'show']);
        $r->delete('/playlists/{id}', [AdminPlaylistsController::class, 'destroy']);
    });

    // Chỉ master
    $router->group([RequireAdmin::class, RequirePasswordChanged::class, RequireMaster::class], function (Router $r) {
        $r->get('/admins', [AdminAccountsController::class, 'index']);
        $r->post('/admins', [AdminAccountsController::class, 'store']);
        $r->get('/admins/{id}', [AdminAccountsController::class, 'show']);
        $r->patch('/admins/{id}', [AdminAccountsController::class, 'update']);
        $r->delete('/admins/{id}', [AdminAccountsController::class, 'destroy']);
        $r->post('/admins/{id}/password', [AdminAccountsController::class, 'setPassword']);

        $r->get('/audit', [AdminAuditController::class, 'index']);
    });
};
