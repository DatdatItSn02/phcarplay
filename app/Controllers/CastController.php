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
 * Giai đoạn 17: máy có khóa thiết bị (device_key) dùng nó cho mọi phiên; các API ghép đôi nhận khóa trong header X-Cast-Device.
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

    private function device(Request $request): string
    {
        return CastService::deviceKey($request->header('x-cast-device'));
    }

    /** Màn hình xe: tạo phiên chờ và lấy mã 6 số (gửi kèm khóa thiết bị + tên máy thì ghép đôi được). */
    public function create(Request $request): Response
    {
        $this->limiter->enforce('cast:new:' . $request->ip, 40, 3600, 'Bạn lấy mã quá nhiều lần. Vui lòng thử lại sau.');
        $key = CastService::deviceKey($request->input('device_key'));
        $name = Validator::text($request->input('device_name'), 60);
        return Response::ok($this->cast->create($request->ip, $key, $name), 201);
    }

    /** Điện thoại: nhập mã. Giới hạn số lần thử để không dò được mã. */
    public function join(Request $request): Response
    {
        $this->limiter->enforce('cast:join:' . $request->ip, 12, 600, 'Bạn nhập mã quá nhiều lần. Vui lòng thử lại sau.');
        $code = preg_replace('/[^0-9]/', '', (string) (is_scalar($request->input('code')) ? $request->input('code') : ''));
        $name = Validator::text($request->input('device_name'), 60);
        $key = CastService::deviceKey($request->input('device_key'));
        return Response::ok($this->cast->join((string) $code, $name, $request->ip, $key));
    }

    /** Giai đoạn 17: danh sách máy đã ghép đôi với máy này. */
    public function pairs(Request $request): Response
    {
        $this->limiter->enforce('cast:pairs:' . $request->ip, 120, 600, 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.');
        return Response::ok($this->cast->pairs($this->device($request)));
    }

    /** Giai đoạn 17: màn hình xe đã ghép đôi hỏi định kỳ có điện thoại nào bấm "Chia sẻ" không. */
    public function incoming(Request $request): Response
    {
        $key = $this->device($request);
        $this->limiter->enforce('cast:inip:' . $request->ip, 1200, 600, 'Quá nhiều yêu cầu. Vui lòng thử lại sau.');
        if ($key !== '') {
            $this->limiter->enforce('cast:in:' . substr(CastService::hash($key), 0, 24), 60, 60, 'Hỏi quá nhanh. Vui lòng thử lại sau.');
        }
        return Response::ok($this->cast->incoming($key));
    }

    /** Giai đoạn 17: điện thoại bấm "Chia sẻ màn hình" tới một màn hình xe đã ghép đôi. */
    public function share(Request $request): Response
    {
        $this->limiter->enforce('cast:share:' . $request->ip, 30, 600, 'Bạn bấm chia sẻ quá nhiều lần. Vui lòng thử lại sau ít phút.');
        $name = Validator::text($request->input('device_name'), 60);
        return Response::ok($this->cast->share($this->id($request), $this->device($request), $name, $request->ip), 201);
    }

    /** Giai đoạn 17: "Quên thiết bị" (xóa mềm cặp ghép đôi), làm được ở cả hai máy. */
    public function forget(Request $request): Response
    {
        $this->limiter->enforce('cast:forget:' . $request->ip, 30, 600, 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.');
        $this->cast->forget($this->id($request), $this->device($request));
        return Response::ok(['forgotten' => true]);
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
