<?php
declare(strict_types=1);

namespace App\Controllers\Admin;

use App\Core\HttpException;
use App\Core\Request;
use App\Core\Response;
use App\Core\Session;
use App\Core\Validator;
use App\Repositories\AdminRepository;
use App\Services\AdminAuthService;
use App\Services\AdminPasswordResetService;
use App\Services\AuditService;
use App\Services\LoginThrottle;
use App\Services\RateLimiter;

/** Đăng nhập, đăng xuất, quên/đặt lại mật khẩu và đổi mật khẩu của quản trị viên (API /admin/api). */
final class AdminAuthController
{
    private AdminAuthService $auth;
    private AdminPasswordResetService $resets;
    private AuditService $audit;
    private LoginThrottle $throttle;
    private RateLimiter $limiter;

    public function __construct(
        AdminAuthService $auth,
        AdminPasswordResetService $resets,
        AuditService $audit,
        LoginThrottle $throttle,
        RateLimiter $limiter
    ) {
        $this->auth = $auth;
        $this->resets = $resets;
        $this->audit = $audit;
        $this->throttle = $throttle;
        $this->limiter = $limiter;
    }

    /** Trạng thái phiên: giao diện gọi đầu tiên để lấy CSRF token và biết còn đăng nhập không. */
    public function me(Request $request): Response
    {
        $admin = $this->auth->resolve(Session::get('admin_id'), Session::get('admin_fp'));
        if ($admin === null) {
            Session::forget('admin_id');
            Session::forget('admin_fp');
        }
        return Response::ok($this->payload($admin));
    }

    public function login(Request $request): Response
    {
        $email = Validator::email($request->input('email'));
        $password = $request->input('password');
        if ($email === null || !is_string($password) || $password === '') {
            throw HttpException::validation(['email' => 'Hãy nhập email và mật khẩu.']);
        }
        // Chống dò mật khẩu: mặc định TẮT (không giới hạn số lần đăng nhập sai), bật bằng LOGIN_THROTTLE=true.
        $this->throttle->check('admin', $email, $request->ip);
        try {
            $admin = $this->auth->attempt($email, $password);
        } catch (HttpException $e) {
            if ($e->errorCode === 'INVALID_CREDENTIALS') {
                // Ghi nhật ký để master thấy có người đang dò mật khẩu (không bao giờ ghi mật khẩu đã gõ).
                // Chỉ ghi vài lần đầu của mỗi máy trong 15 phút, rồi một dòng tóm tắt, để bảng nhật ký không phình to khi bị dò.
                $r = $this->throttle->failed('admin', $email, $request->ip);
                if ($r['log']) {
                    $this->audit->record(null, 'admin.login_failed', 'admin', '', 'email: ' . $email, $request->ip);
                }
                if ($r['reached']) {
                    $locked = $this->throttle->enabled();
                    $this->audit->record(null, $locked ? 'admin.login_locked' : 'admin.login_failed_many', 'admin', '',
                        'email: ' . $email . ($locked ? '; tạm chặn ' . (LoginThrottle::WINDOW / 60) . ' phút' : '; sai nhiều lần liên tiếp'), $request->ip);
                }
            }
            throw $e;
        }
        $this->throttle->succeeded('admin', $email, $request->ip);
        $this->openSession($admin);
        $this->audit->record($admin, 'admin.login', 'admin', $admin['id'], '', $request->ip);
        return Response::ok($this->payload($admin));
    }

    public function logout(Request $request): Response
    {
        Session::reset('admin');
        return Response::ok(['csrf' => Session::csrf()]);
    }

    public function forgot(Request $request): Response
    {
        $email = Validator::email($request->input('email'));
        if ($email === null) {
            throw HttpException::validation(['email' => 'Email không hợp lệ.']);
        }
        $this->limiter->enforce('admin-forgot:e:' . $email, 5, 3600, 'Bạn đã yêu cầu đặt lại mật khẩu quá nhiều lần.');
        $this->limiter->enforce('admin-forgot:i:' . $request->ip, 20, 3600, 'Bạn đã yêu cầu đặt lại mật khẩu quá nhiều lần.');
        $this->resets->request($email, $request->ip);
        return Response::ok(['message' => 'Nếu email thuộc một quản trị viên, chúng tôi đã gửi liên kết đặt lại mật khẩu. Hãy kiểm tra hộp thư.']);
    }

    public function reset(Request $request): Response
    {
        $token = $request->input('token');
        $password = $request->input('password');
        if (!is_string($token) || $token === '') {
            throw new HttpException(400, 'TOKEN_INVALID', 'Liên kết không hợp lệ hoặc đã hết hạn. Hãy yêu cầu liên kết mới.');
        }
        if (!Validator::passwordOk($password, AdminAuthService::PASSWORD_MIN)) {
            throw HttpException::validation(['password' => $this->passwordRule()]);
        }
        $this->resets->reset($token, $password, $request->ip);
        return Response::ok(['message' => 'Đã đặt mật khẩu mới. Bạn có thể đăng nhập.']);
    }

    /** Tự đổi mật khẩu (kể cả khi bị buộc đổi). Giữ phiên hiện tại, các phiên khác của tài khoản bị đăng xuất. */
    public function changePassword(Request $request): Response
    {
        $current = $request->input('current_password');
        $new = $request->input('new_password');
        $errors = [];
        if (!is_string($current) || $current === '') {
            $errors['current_password'] = 'Hãy nhập mật khẩu hiện tại.';
        }
        if (!Validator::passwordOk($new, AdminAuthService::PASSWORD_MIN)) {
            $errors['new_password'] = $this->passwordRule();
        }
        if ($errors) {
            throw HttpException::validation($errors);
        }
        // Khi bật LOGIN_THROTTLE: phiên bị chiếm cũng không dò được mật khẩu hiện tại (sai 5 lần thì tạm chặn 15 phút).
        $throttle = $this->throttle->enabled();
        $pwKey = 'admin-pw:' . (int) $request->attributes['admin']['id'];
        if ($throttle) {
            $this->limiter->guard([[$pwKey, 5, LoginThrottle::WINDOW]], 'Bạn đã nhập sai mật khẩu hiện tại quá nhiều lần.');
        }
        try {
            $admin = $this->auth->changeOwnPassword($request->attributes['admin'], $current, $new);
        } catch (HttpException $e) {
            if ($throttle && isset($e->details['current_password'])) {
                $this->limiter->hit($pwKey, LoginThrottle::WINDOW);
            }
            throw $e;
        }
        if ($throttle) {
            $this->limiter->clear($pwKey);
        }
        $this->openSession($admin);
        $this->audit->record($admin, 'admin.password_change', 'admin', $admin['id'], '', $request->ip);
        return Response::ok($this->payload($admin));
    }

    /** Mở (hoặc làm mới) phiên cho admin: đổi ID phiên chống session fixation và ghi dấu vân tay mật khẩu. */
    private function openSession(array $admin): void
    {
        Session::regenerate();
        Session::set('admin_id', (int) $admin['id']);
        Session::set('admin_fp', $this->auth->fingerprint($admin));
    }

    private function payload(?array $admin): array
    {
        return [
            'admin' => $admin ? AdminRepository::publicView($admin) : null,
            'csrf' => Session::csrf(),
        ];
    }

    private function passwordRule(): string
    {
        return 'Mật khẩu cần từ ' . AdminAuthService::PASSWORD_MIN . ' đến 100 ký tự.';
    }
}
