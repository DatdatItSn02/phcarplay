<?php
declare(strict_types=1);

namespace App\Controllers\Admin;

use App\Core\HttpException;
use App\Core\Pagination;
use App\Core\Request;
use App\Core\Response;
use App\Core\Validator;
use App\Services\AdminUserService;
use App\Services\LicenseKeyService;

/** Quản lý người dùng. Kiểm tra định dạng ở đây, quy tắc nghiệp vụ ở AdminUserService. */
final class AdminUsersController
{
    use ReadsParams;

    private AdminUserService $users;

    public function __construct(AdminUserService $users)
    {
        $this->users = $users;
    }

    public function index(Request $request): Response
    {
        [$page, $per, $offset] = Pagination::fromQuery($request->query);
        $filters = $this->filters($request, ['q', 'status', 'license', 'deleted']);
        if (isset($filters['status']) && !in_array($filters['status'], ['active', 'blocked'], true)) {
            throw HttpException::validation(['status' => 'Trạng thái chỉ có thể là active hoặc blocked.']);
        }
        if (isset($filters['license']) && !in_array($filters['license'], ['none', 'valid', 'expired'], true)) {
            throw HttpException::validation(['license' => 'Hạn dùng chỉ có thể là none, valid hoặc expired.']);
        }
        return Response::ok($this->users->search($filters, $page, $per, $offset));
    }

    public function show(Request $request): Response
    {
        return Response::ok($this->users->get($this->id($request)));
    }

    public function update(Request $request): Response
    {
        $changes = [];
        $errors = [];
        if (array_key_exists('email', $request->body)) {
            $email = Validator::email($request->input('email'));
            if ($email === null) {
                $errors['email'] = 'Email không hợp lệ.';
            } else {
                $changes['email'] = $email;
            }
        }
        if (array_key_exists('phone', $request->body)) {
            $raw = $request->input('phone');
            if ($raw === null || (is_string($raw) && trim($raw) === '')) {
                $changes['phone'] = null;   // bỏ số điện thoại
            } else {
                $phone = Validator::phone($raw);
                if ($phone === null) {
                    $errors['phone'] = 'Số điện thoại không hợp lệ (số di động 10 số, ví dụ 0912345678).';
                } else {
                    $changes['phone'] = $phone;
                }
            }
        }
        if (array_key_exists('name', $request->body)) {
            $changes['name'] = Validator::text($request->input('name'), 100);   // người dùng được phép để trống tên
        }
        if (array_key_exists('status', $request->body)) {
            $status = $request->input('status');
            if (!in_array($status, ['active', 'blocked'], true)) {
                $errors['status'] = 'Trạng thái chỉ có thể là active hoặc blocked.';
            } else {
                $changes['status'] = $status;
            }
        }
        if (array_key_exists('expires_at', $request->body)) {
            $raw = $request->input('expires_at');
            if ($raw === null || (is_string($raw) && trim($raw) === '')) {
                $changes['expires_at'] = null;   // xóa hạn dùng
            } else {
                $dt = Validator::dateTime($raw);
                if ($dt === null) {
                    $errors['expires_at'] = 'Ngày hết hạn không hợp lệ (dạng 2026-12-31).';
                } else {
                    $changes['expires_at'] = $dt;
                }
            }
        }
        if ($errors) {
            throw HttpException::validation($errors);
        }
        if (!$changes) {
            throw HttpException::validation(['body' => 'Không có thông tin nào để cập nhật.']);
        }
        return Response::ok($this->users->update($request->attributes['admin'], $this->id($request), $changes, $request->ip));
    }

    public function extend(Request $request): Response
    {
        $days = $request->input('days');
        if (is_string($days) && ctype_digit($days)) {
            $days = (int) $days;
        }
        if (!is_int($days) || $days < 1 || $days > LicenseKeyService::MAX_DAYS) {
            throw HttpException::validation(['days' => 'Số ngày từ 1 đến ' . LicenseKeyService::MAX_DAYS . '.']);
        }
        return Response::ok($this->users->extend($request->attributes['admin'], $this->id($request), $days, $request->ip));
    }

    public function setPassword(Request $request): Response
    {
        $password = $request->input('password');
        if (!Validator::passwordOk($password)) {
            throw HttpException::validation(['password' => 'Mật khẩu cần từ 6 đến 100 ký tự.']);
        }
        $this->users->setPassword($request->attributes['admin'], $this->id($request), $password, $request->ip);
        return Response::ok(['message' => 'Đã đặt mật khẩu mới. Người dùng bị đăng xuất khỏi mọi thiết bị.']);
    }

    public function sendReset(Request $request): Response
    {
        $result = $this->users->sendReset($request->attributes['admin'], $this->id($request), $request->ip);
        $messages = [
            'sent' => 'Đã gửi thư chứa mã đặt lại mật khẩu tới email của người dùng.',
            'none' => 'Vừa gửi mã trong 60 giây trước nên chưa gửi lại. Hãy chờ một chút rồi bấm lại.',
            'test' => 'Website đang ở chế độ thử nên email KHÔNG được gửi thật (thư chứa mã được ghi vào thư mục storage/mail trên máy chủ).',
        ];
        return Response::ok(['message' => $messages[$result], 'result' => $result]);
    }

    public function logoutDevice(Request $request): Response
    {
        $this->users->logoutDevice($request->attributes['admin'], $this->id($request), $request->ip);
        return Response::ok(['message' => 'Đã đăng xuất thiết bị của người dùng.']);
    }

    public function destroy(Request $request): Response
    {
        $this->users->delete($request->attributes['admin'], $this->id($request), $request->ip);
        return Response::ok(['deleted' => true]);
    }

    private function id(Request $request): int
    {
        return $this->idParam($request, 'id', 'Không tìm thấy người dùng.');
    }
}
