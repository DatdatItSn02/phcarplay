<?php
declare(strict_types=1);

namespace App\Middleware;

use App\Core\HttpException;
use App\Core\Request;
use App\Core\Response;

/** Chỉ cho admin có vai trò master. Phải đứng sau RequireAdmin. */
final class RequireMaster implements MiddlewareInterface
{
    public function handle(Request $request, callable $next): Response
    {
        $admin = $request->attributes['admin'] ?? null;
        if (!is_array($admin) || $admin['role'] !== 'master') {
            throw HttpException::forbidden('Chỉ quản trị viên master mới dùng được chức năng này.');
        }
        return $next($request);
    }
}
