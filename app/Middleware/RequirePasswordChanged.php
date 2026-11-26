<?php
declare(strict_types=1);

namespace App\Middleware;

use App\Core\HttpException;
use App\Core\Request;
use App\Core\Response;

/** Chặn mọi chức năng cho tới khi admin đổi mật khẩu tạm (cờ must_change_password). Phải đứng sau RequireAdmin. */
final class RequirePasswordChanged implements MiddlewareInterface
{
    public function handle(Request $request, callable $next): Response
    {
        $admin = $request->attributes['admin'] ?? null;
        if (is_array($admin) && (int) $admin['must_change_password'] === 1) {
            throw new HttpException(403, 'PASSWORD_CHANGE_REQUIRED', 'Bạn cần đổi mật khẩu trước khi tiếp tục.');
        }
        return $next($request);
    }
}
