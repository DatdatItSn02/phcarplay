<?php
declare(strict_types=1);

namespace App\Controllers\Admin;

use App\Core\HttpException;
use App\Core\Pagination;
use App\Core\Request;
use App\Core\Response;
use App\Core\Validator;
use App\Services\LicenseKeyService;

/** Quản lý key kích hoạt: tạo hàng loạt, xem, thu hồi, xóa. */
final class AdminKeysController
{
    use ReadsParams;

    private LicenseKeyService $keys;

    public function __construct(LicenseKeyService $keys)
    {
        $this->keys = $keys;
    }

    public function index(Request $request): Response
    {
        [$page, $per, $offset] = Pagination::fromQuery($request->query);
        $filters = $this->filters($request, ['q', 'status', 'deleted']);
        if (isset($filters['status']) && !in_array($filters['status'], ['unused', 'used', 'revoked'], true)) {
            throw HttpException::validation(['status' => 'Trạng thái chỉ có thể là unused, used hoặc revoked.']);
        }
        return Response::ok($this->keys->search($filters, $page, $per, $offset));
    }

    public function store(Request $request): Response
    {
        $count = $this->wholeNumber($request->input('count'));
        $days = $this->wholeNumber($request->input('days'));
        $note = Validator::text($request->input('note'), 190);
        $errors = [];
        if ($count === null || $count < 1 || $count > LicenseKeyService::MAX_BATCH) {
            $errors['count'] = 'Số lượng key từ 1 đến ' . LicenseKeyService::MAX_BATCH . '.';
        }
        if ($days === null || $days < 1 || $days > LicenseKeyService::MAX_DAYS) {
            $errors['days'] = 'Số ngày từ 1 đến ' . LicenseKeyService::MAX_DAYS . '.';
        }
        if ($errors) {
            throw HttpException::validation($errors);
        }
        $created = $this->keys->generate($request->attributes['admin'], (int) $count, (int) $days, $note, $request->ip);
        return Response::ok(['items' => $created], 201);
    }

    public function revoke(Request $request): Response
    {
        return Response::ok($this->keys->revoke($request->attributes['admin'], $this->idParam($request, 'id', 'Không tìm thấy key.'), $request->ip));
    }

    public function destroy(Request $request): Response
    {
        $this->keys->delete($request->attributes['admin'], $this->idParam($request, 'id', 'Không tìm thấy key.'), $request->ip);
        return Response::ok(['deleted' => true]);
    }

    /** Thu hồi / xóa nhiều key một lần: {action: 'revoke'|'delete', ids: [số, ...]} tối đa MAX_BATCH key. */
    public function bulk(Request $request): Response
    {
        $action = $request->input('action');
        $raw = $request->input('ids');
        $errors = [];
        if (!in_array($action, ['revoke', 'delete'], true)) {
            $errors['action'] = 'Thao tác chỉ có thể là revoke hoặc delete.';
        }
        $ids = [];
        if (is_array($raw)) {
            foreach ($raw as $v) {
                $n = $this->wholeNumber($v);
                if ($n === null || $n < 1) {
                    $ids = null;
                    break;
                }
                $ids[] = $n;
            }
        } else {
            $ids = null;
        }
        if ($ids === null || $ids === [] || count($ids) > LicenseKeyService::MAX_BATCH) {
            $errors['ids'] = 'Chọn từ 1 đến ' . LicenseKeyService::MAX_BATCH . ' key.';
        }
        if ($errors) {
            throw HttpException::validation($errors);
        }
        return Response::ok($this->keys->bulk($request->attributes['admin'], (string) $action, $ids, $request->ip));
    }

    /** Số nguyên không âm từ JSON (số hoặc chuỗi toàn chữ số), nếu không thì null. */
    private function wholeNumber($value): ?int
    {
        if (is_int($value)) {
            return $value;
        }
        return is_string($value) && ctype_digit($value) && strlen($value) < 10 ? (int) $value : null;
    }
}
