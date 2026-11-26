<?php
declare(strict_types=1);

namespace App\Middleware;

use App\Core\HttpException;
use App\Core\Request;
use App\Core\Response;
use App\Core\Session;
use App\Services\AdminAuthService;

/**
 * Chỉ cho quản trị viên đã đăng nhập, chưa bị khóa và chưa đổi mật khẩu kể từ lúc đăng nhập.
 * Gắn admin vào $request->attributes['admin'].
 */
final class RequireAdmin implements MiddlewareInterface
{
    private AdminAuthService $auth;

    public function __construct(AdminAuthService $auth)
    {
        $this->auth = $auth;
    }

    public function handle(Request $request, callable $next): Response
    {
        $admin = $this->auth->resolve(Session::get('admin_id'), Session::get('admin_fp'));
        if ($admin === null) {
            Session::forget('admin_id');
            Session::forget('admin_fp');
            throw HttpException::unauthorized('Phiên đăng nhập quản trị đã hết hạn. Hãy đăng nhập lại.');
        }
        $request->attributes['admin'] = $admin;
        return $next($request);
    }
}
