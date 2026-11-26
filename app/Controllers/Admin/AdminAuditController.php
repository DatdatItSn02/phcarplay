<?php
declare(strict_types=1);

namespace App\Controllers\Admin;

use App\Core\HttpException;
use App\Core\Pagination;
use App\Core\Request;
use App\Core\Response;
use App\Services\AuditViewService;

/** Xem nhật ký thao tác (chỉ master). */
final class AdminAuditController
{
    use ReadsParams;

    private AuditViewService $audit;

    public function __construct(AuditViewService $audit)
    {
        $this->audit = $audit;
    }

    public function index(Request $request): Response
    {
        [$page, $per, $offset] = Pagination::fromQuery($request->query, 30, 100);
        $filters = $this->filters($request, ['q', 'action', 'from', 'to']);
        foreach (['from', 'to'] as $k) {
            if (isset($filters[$k]) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $filters[$k]) !== 1) {
                throw HttpException::validation([$k => 'Ngày không hợp lệ (dạng 2026-12-31).']);
            }
        }
        return Response::ok($this->audit->search($filters, $page, $per, $offset));
    }
}
