<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Config;
use App\Core\HttpException;
use App\Core\Request;
use App\Core\Response;
use App\Core\Validator;
use App\Services\RateLimiter;
use App\Services\UserApiKeyService;
use App\Services\YoutubeService;

/** Tìm kiếm và phát video YouTube qua Piped (khách dùng thử cũng gọi được). */
final class YoutubeController
{
    private YoutubeService $youtube;
    private RateLimiter $limiter;
    private UserApiKeyService $keys;

    public function __construct(YoutubeService $youtube, RateLimiter $limiter, UserApiKeyService $keys)
    {
        $this->youtube = $youtube;
        $this->limiter = $limiter;
        $this->keys = $keys;
    }

    /**
     * Giới hạn số lần gọi trong 10 phút cho mỗi địa chỉ IP (RATE_LIMIT_YOUTUBE, mặc định 1200, 0 = không giới hạn),
     * để máy chủ không bị người ngoài dùng làm proxy Piped miễn phí. Mức mặc định rất cao so với một người dùng thật.
     */
    private function throttle(Request $request): void
    {
        $max = (int) Config::get('app.security.youtube_per_10min', 1200);
        $this->limiter->enforce('yt:i:' . $request->ip, $max, 600, 'Có quá nhiều yêu cầu từ mạng của bạn.');
    }

    public function search(Request $request): Response
    {
        $this->throttle($request);
        $q = Validator::text($request->query['q'] ?? '', 100);
        if ($q === '') {
            throw HttpException::validation(['q' => 'Hãy nhập từ khóa tìm kiếm.']);
        }
        $page = $request->query['page'] ?? null;
        $page = is_string($page) && strlen($page) <= 8000 ? $page : null;
        // Người đã đăng nhập có khóa YouTube API riêng: tìm bằng khóa đó trước (giai đoạn 10).
        $userKey = $this->keys->currentUserKey();
        $this->youtube->useUserKey($userKey);
        // Nhắc nhẹ thêm khóa riêng (giai đoạn 10.2): chỉ khi chưa có khóa và tìm kiếm phải dùng cách dự phòng hoặc lỗi.
        // Giao diện tự giới hạn số lần hiện (1 lần/ngày, "Để sau" = 7 ngày).
        $hintable = $userKey === null && (bool) Config::get('youtube.key_hint', true) && $this->keys->disabledReason() === null;
        try {
            $result = $this->youtube->search($q, $page);
        } catch (HttpException $e) {
            if ($hintable && in_array($e->errorCode, ['UPSTREAM_FAILED', 'YOUTUBE_UNAVAILABLE'], true)) {
                $e->details['key_hint'] = true;
            }
            throw $e;
        }
        if ($hintable && $this->youtube->lastSource() === 'youtube') {
            $result['key_hint'] = true;
        }
        $notice = $this->youtube->keyNotice();
        if ($notice !== null) {
            $result['notice'] = $notice;
        }
        return Response::ok($result);
    }

    public function suggest(Request $request): Response
    {
        $this->throttle($request);
        $q = Validator::text($request->query['q'] ?? '', 100);
        return Response::ok(['suggestions' => $q === '' ? [] : $this->youtube->suggest($q)]);
    }

    public function stream(Request $request): Response
    {
        $this->throttle($request);
        return Response::ok($this->youtube->stream((string) $request->param('id')));
    }

    public function trending(Request $request): Response
    {
        $this->throttle($request);
        return Response::ok(['items' => $this->youtube->trending()]);
    }
}
