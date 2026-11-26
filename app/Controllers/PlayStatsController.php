<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Services\PlayStatsService;
use App\Services\RateLimiter;

/** Lượt nghe của người đang đăng nhập (giai đoạn 11): "bài bạn hay nghe" ở tab "Tất cả". */
final class PlayStatsController
{
    private PlayStatsService $stats;
    private RateLimiter $limiter;

    public function __construct(PlayStatsService $stats, RateLimiter $limiter)
    {
        $this->stats = $stats;
        $this->limiter = $limiter;
    }

    private function uid(Request $request): int
    {
        return (int) $request->attributes['user']['id'];
    }

    public function record(Request $request): Response
    {
        $id = $this->uid($request);
        // mỗi lượt cần nghe ít nhất vài chục giây nên 300 lượt/giờ là quá đủ; chặn gửi dồn
        $this->limiter->enforce('plays:u:' . $id, 300, 3600, 'Có quá nhiều lượt nghe được gửi. Vui lòng thử lại sau.');
        $this->stats->record($id, $request->body);
        return Response::ok(['recorded' => true]);
    }

    public function top(Request $request): Response
    {
        return Response::ok(['items' => $this->stats->top($this->uid($request))]);
    }

    public function hide(Request $request): Response
    {
        $this->stats->hide($this->uid($request), (string) $request->param('id'));
        return Response::ok(['hidden' => true]);
    }

    public function clear(Request $request): Response
    {
        $this->stats->clear($this->uid($request));
        return Response::ok(['cleared' => true]);
    }
}
