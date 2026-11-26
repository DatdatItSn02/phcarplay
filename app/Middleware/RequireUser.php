<?php
declare(strict_types=1);

namespace App\Middleware;

use App\Core\HttpException;
use App\Core\Request;
use App\Core\Response;
use App\Core\Session;
use App\Repositories\UserRepository;
use App\Services\DeviceSessionService;

/**
 * Chỉ cho người dùng đã đăng nhập, chưa bị khóa và đúng thiết bị đang hợp lệ.
 * Gắn user vào $request->attributes['user'].
 */
final class RequireUser implements MiddlewareInterface
{
    private UserRepository $users;
    private DeviceSessionService $devices;

    public function __construct(UserRepository $users, DeviceSessionService $devices)
    {
        $this->users = $users;
        $this->devices = $devices;
    }

    public function handle(Request $request, callable $next): Response
    {
        $id = Session::get('user_id');
        $user = $id ? $this->users->find((int) $id) : null;
        if ($user === null || $user['status'] !== 'active') {
            Session::forget('user_id');
            throw HttpException::unauthorized();
        }
        if (!$this->devices->isCurrent($user, Session::get('device_token'))) {
            Session::forget('user_id');
            Session::forget('device_token');
            throw new HttpException(401, 'SESSION_REPLACED', 'Tài khoản vừa đăng nhập trên thiết bị khác nên thiết bị này đã đăng xuất.');
        }
        $request->attributes['user'] = $user;
        return $next($request);
    }
}
