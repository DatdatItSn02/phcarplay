<?php
declare(strict_types=1);

namespace App\Controllers\Admin;

use App\Core\HttpException;
use App\Core\Request;
use App\Core\Response;
use App\Core\Validator;
use App\Services\AdminAccountService;
use App\Services\AdminAuthService;

/** Quản lý tài khoản quản trị (chỉ master). Kiểm tra định dạng ở đây, quy tắc nghiệp vụ ở AdminAccountService. */
final class AdminAccountsController
{
    private AdminAccountService $accounts;

    public function __construct(AdminAccountService $accounts)
    {
        $this->accounts = $accounts;
    }

    public function index(Request $request): Response
    {
        return Response::ok(['items' => $this->accounts->listAll(($request->query['deleted'] ?? '') === '1')]);
    }

    public function show(Request $request): Response
    {
        return Response::ok($this->accounts->get($this->id($request)));
    }

    public function store(Request $request): Response
    {
        $email = Validator::email($request->input('email'));
        $name = Validator::text($request->input('name'), 100);
        $password = $request->input('password');
        $errors = [];
        if ($email === null) {
            $errors['email'] = 'Email không hợp lệ.';
        }
        if ($name === '') {
            $errors['name'] = 'Hãy nhập tên hiển thị.';
        }
        if (!Validator::passwordOk($password, AdminAuthService::PASSWORD_MIN)) {
            $errors['password'] = 'Mật khẩu tạm cần từ ' . AdminAuthService::PASSWORD_MIN . ' đến 100 ký tự.';
        }
        if ($errors) {
            throw HttpException::validation($errors);
        }
        $created = $this->accounts->create($request->attributes['admin'], $email, $name, $password, $request->ip);
        return Response::ok($created, 201);
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
        if (array_key_exists('name', $request->body)) {
            $name = Validator::text($request->input('name'), 100);
            if ($name === '') {
                $errors['name'] = 'Tên hiển thị không được để trống.';
            } else {
                $changes['name'] = $name;
            }
        }
        if (array_key_exists('status', $request->body)) {
            $status = $request->input('status');
            if (!in_array($status, ['active', 'blocked'], true)) {
                $errors['status'] = 'Trạng thái chỉ có thể là active hoặc blocked.';
            } else {
                $changes['status'] = $status;
            }
        }
        if ($errors) {
            throw HttpException::validation($errors);
        }
        if (!$changes) {
            throw HttpException::validation(['body' => 'Không có thông tin nào để cập nhật.']);
        }
        return Response::ok($this->accounts->update($request->attributes['admin'], $this->id($request), $changes, $request->ip));
    }

    public function setPassword(Request $request): Response
    {
        $password = $request->input('password');
        if (!Validator::passwordOk($password, AdminAuthService::PASSWORD_MIN)) {
            throw HttpException::validation(['password' => 'Mật khẩu tạm cần từ ' . AdminAuthService::PASSWORD_MIN . ' đến 100 ký tự.']);
        }
        $this->accounts->setPassword($request->attributes['admin'], $this->id($request), $password, $request->ip);
        return Response::ok(['message' => 'Đã đặt mật khẩu tạm. Người này sẽ phải đổi mật khẩu ở lần đăng nhập tới.']);
    }

    public function destroy(Request $request): Response
    {
        $this->accounts->delete($request->attributes['admin'], $this->id($request), $request->ip);
        return Response::ok(['deleted' => true]);
    }

    private function id(Request $request): int
    {
        $raw = (string) $request->param('id');
        if ($raw === '' || !ctype_digit($raw)) {
            throw HttpException::notFound('Không tìm thấy tài khoản quản trị.');
        }
        return (int) $raw;
    }
}
