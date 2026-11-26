<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Validator;
use App\Services\CastService;
use App\Services\RateLimiter;

/**
 * Giai đoạn 15: ghép nối chiếu màn hình điện thoại lên màn hình xe (xem App\Services\CastService).
 * Không cần đăng nhập (màn hình xe có thể đang "dùng thử", điện thoại không đăng nhập để khỏi đẩy màn hình xe ra):
 * mỗi máy tự chứng minh bằng khóa bí mật nhận lúc tạo/nhập mã, gửi trong header X-Cast-Token.
 */
final class CastController
{
    private CastService $cast;
    private RateLimiter $limiter;

    public function __construct(CastService $cast, RateLimiter $limiter)
    {
        $this->cast = $cast;
        $this->limiter = $limiter;
    }

    private function id(Request $request): int
    {
        return (int) $request->param('id');
    }

    private function token(Request $request): string
    {
        $t = $request->header('x-cast-token');
        return is_string($t) && preg_match('/^[a-f0-9]{48}$/', $t) ? $t : '';
    }

    /** Màn hình xe: tạo phiên chờ và lấy mã 6 số. */
    public function create(Request $request): Response
    {
        $this->limiter->enforce('cast:new:' . $request->ip, 40, 3600, 'Bạn lấy mã quá nhiều lần. Vui lòng thử lại sau.');
        return Response::ok($this->cast->create($request->ip), 201);
    }

    /** Điện thoại: nhập mã. Giới hạn số lần thử để không dò được mã. */
    public function join(Request $request): Response
    {
        $this->limiter->enforce('cast:join:' . $request->ip, 12, 600, 'Bạn nhập mã quá nhiều lần. Vui lòng thử lại sau.');
        $code = preg_replace('/[^0-9]/', '', (string) (is_scalar($request->input('code')) ? $request->input('code') : ''));
        $name = Validator::text($request->input('device_name'), 60);
        return Response::ok($this->cast->join((string) $code, $name, $request->ip));
    }

    public function signals(Request $request): Response
    {
        $after = (int) ($request->query['after'] ?? 0);
        return Response::ok($this->cast->pull($this->id($request), $this->token($request), $after));
    }

    public function send(Request $request): Response
    {
        $id = $this->id($request);
        $this->limiter->enforce('cast:sig:' . $id . ':' . $request->ip, 600, 600, 'Gửi quá nhiều tin kết nối. Vui lòng thử lại sau.');
        $kind = is_string($request->input('kind')) ? $request->input('kind') : '';
        $sid = $this->cast->push($id, $this->token($request), $kind, $request->input('payload', []));
        return Response::ok(['id' => $sid], 201);
    }

    public function end(Request $request): Response
    {
        $this->cast->end($this->id($request), $this->token($request));
        return Response::ok(['ended' => true]);
    }
}
