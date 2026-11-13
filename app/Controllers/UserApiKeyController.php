<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Validator;
use App\Services\RateLimiter;
use App\Services\UserApiKeyService;

/** Khóa YouTube API riêng của người đang đăng nhập (giai đoạn 10). Không bao giờ trả khóa đầy đủ. */
final class UserApiKeyController
{
    private UserApiKeyService $keys;
    private RateLimiter $limiter;

    public function __construct(UserApiKeyService $keys, RateLimiter $limiter)
    {
        $this->keys = $keys;
        $this->limiter = $limiter;
    }

    public function show(Request $request): Response
    {
        return Response::ok($this->keys->status((int) $request->attributes['user']['id']));
    }

    public function update(Request $request): Response
    {
        $id = (int) $request->attributes['user']['id'];
        // mỗi lần lưu là một lần thử khóa với Google: giới hạn để không bị dùng làm công cụ dò khóa
        $this->limiter->enforce('ykey:u:' . $id, 10, 3600, 'Bạn đã thử lưu khóa quá nhiều lần. Vui lòng thử lại sau.');
        $key = Validator::text((string) ($request->body['key'] ?? ''), 200);
        return Response::ok($this->keys->save($id, $key));
    }

    public function destroy(Request $request): Response
    {
        return Response::ok($this->keys->remove((int) $request->attributes['user']['id']));
    }
}
