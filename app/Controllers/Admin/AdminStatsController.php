<?php
declare(strict_types=1);

namespace App\Controllers\Admin;

use App\Core\Request;
use App\Core\Response;
use App\Services\AdminStatsService;

/** Số liệu trang Tổng quan. */
final class AdminStatsController
{
    private AdminStatsService $stats;

    public function __construct(AdminStatsService $stats)
    {
        $this->stats = $stats;
    }

    public function overview(Request $request): Response
    {
        $isMaster = ($request->attributes['admin']['role'] ?? '') === 'master';
        return Response::ok($this->stats->overview($isMaster));
    }
}
