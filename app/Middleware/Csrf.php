<?php
declare(strict_types=1);

namespace App\Middleware;

use App\Core\HttpException;
use App\Core\Request;
use App\Core\Response;
use App\Core\Session;

/** Mọi yêu cầu ghi dữ liệu (POST/PUT/PATCH/DELETE) phải kèm header X-CSRF-Token khớp với phiên. */
final class Csrf implements MiddlewareInterface
{
    public function handle(Request $request, callable $next): Response
    {
        if (!in_array($request->method, ['GET', 'HEAD', 'OPTIONS'], true)) {
            $sent = $request->header('x-csrf-token');
            $expected = Session::csrf();
            if ($sent === null || $expected === '' || !hash_equals($expected, $sent)) {
                throw new HttpException(403, 'CSRF_INVALID', 'Phiên làm việc đã thay đổi. Vui lòng thử lại.');
            }
        }
        return $next($request);
    }
}
