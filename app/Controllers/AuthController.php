<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\HttpException;
use App\Core\Request;
use App\Core\Response;
use App\Core\Session;
use App\Core\Validator;
use App\Repositories\UserRepository;
use App\Services\AuthService;
use App\Services\DeviceSessionService;
use App\Services\EntitlementService;
use App\Services\LoginThrottle;
use App\Services\OtpService;
use App\Services\PasswordResetService;
use App\Services\RateLimiter;

/**
 * Đăng ký, đăng nhập (email hoặc số điện thoại), đăng xuất, quên/đổi mật khẩu bằng mã OTP, đổi số điện thoại.
 */
final class AuthController
{
    private AuthService $auth;
    private PasswordResetService $resets;
    private EntitlementService $entitlements;
    private UserRepository $users;
    private DeviceSessionService $devices;
    private LoginThrottle $throttle;
    private RateLimiter $limiter;
    private OtpService $otp;

    public function __construct(
        AuthService $auth,
        PasswordResetService $resets,
        EntitlementService $entitlements,
        UserRepository $users,
        DeviceSessionService $devices,
        LoginThrottle $throttle,
        RateLimiter $limiter,
        OtpService $otp
    ) {
        $this->auth = $auth;
        $this->resets = $resets;
        $this->entitlements = $entitlements;
        $this->users = $users;
        $this->devices = $devices;
        $this->throttle = $throttle;
        $this->limiter = $limiter;
        $this->otp = $otp;
    }

    /**
     * Trạng thái phiên hiện tại. Trình duyệt gọi đầu tiên (và định kỳ) để lấy CSRF token và biết còn đăng nhập không.
     * Nếu tài khoản đã đăng nhập ở thiết bị khác, user = null và có thêm replaced = true.
     */
    public function me(Request $request): Response
    {
        $id = Session::get('user_id');
        $user = $id ? $this->users->find((int) $id) : null;
        $replaced = false;
        if ($user !== null && $user['status'] !== 'active') {
            Session::forget('user_id');
            $user = null;
        } elseif ($user !== null && !$this->devices->isCurrent($user, Session::get('device_token'))) {
            Session::forget('user_id');
            Session::forget('device_token');
            $user = null;
            $replaced = true;
        }
        $payload = $this->sessionPayload($user);
        if ($replaced) {
            $payload['replaced'] = true;
        }
        return Response::ok($payload);
    }

    public function register(Request $request): Response
    {
        $email = Validator::email($request->input('email'));
        $phone = Validator::phone($request->input('phone'));
        $name = Validator::text($request->input('name'), 100);
        $password = $request->input('password');

        $errors = [];
        if ($email === null) {
            $errors['email'] = 'Email không hợp lệ.';
        }
        if ($phone === null) {
            $errors['phone'] = 'Số điện thoại không hợp lệ (số di động 10 số, ví dụ 0912345678).';
        }
        if (!Validator::passwordOk($password)) {
            $errors['password'] = 'Mật khẩu cần từ 6 đến 100 ký tự.';
        }
        if ($errors) {
            throw HttpException::validation($errors);
        }
        // Chống tạo tài khoản hàng loạt từ một máy (mức cao vì nhiều xe có thể dùng chung IP của nhà mạng).
        $this->limiter->enforce('register:i:' . $request->ip, 20, 3600, 'Có quá nhiều tài khoản được tạo từ mạng này.');

        $user = $this->auth->register($email, $name, $password, $phone);
        $this->startSession($user, $request);
        return Response::ok($this->sessionPayload($user), 201);
    }

    public function login(Request $request): Response
    {
        // Ô "Email hoặc số điện thoại" gửi lên là login; bản cũ của giao diện gửi email.
        $raw = $request->input('login') ?? $request->input('email');
        $password = $request->input('password');
        $loginId = Validator::loginId($raw);
        if (!is_string($password) || $password === '' || !is_string($raw) || trim($raw) === '') {
            throw HttpException::validation(['login' => 'Hãy nhập email hoặc số điện thoại và mật khẩu.']);
        }
        if ($loginId === null) {
            throw HttpException::validation(['login' => 'Email hoặc số điện thoại không hợp lệ.']);
        }
        $email = $loginId[1];   // khóa chống dò mật khẩu: email hoặc số điện thoại đã chuẩn hóa
        // Chống dò mật khẩu: mặc định TẮT (quyết định của dự án: không giới hạn số lần đăng nhập sai), bật bằng LOGIN_THROTTLE=true.
        $throttle = $this->throttle->enabled();
        $this->throttle->check('user', $email, $request->ip);
        try {
            $user = $this->auth->attempt($email, $password);
        } catch (HttpException $e) {
            if ($throttle && $e->errorCode === 'INVALID_CREDENTIALS') {
                $this->throttle->failed('user', $email, $request->ip);
            }
            throw $e;
        }
        if ($throttle) {
            $this->throttle->succeeded('user', $email, $request->ip);
        }
        $this->startSession($user, $request);
        return Response::ok($this->sessionPayload($user));
    }

    public function logout(Request $request): Response
    {
        $id = Session::get('user_id');
        $user = $id ? $this->users->find((int) $id) : null;
        if ($user !== null) {
            $this->devices->end($user, Session::get('device_token'));
        }
        Session::reset('user');
        return Response::ok(['csrf' => Session::csrf()]);
    }

    public function forgot(Request $request): Response
    {
        $loginId = Validator::loginId($request->input('login') ?? $request->input('email'));
        if ($loginId === null) {
            throw HttpException::validation(['login' => 'Hãy nhập đúng email hoặc số điện thoại đã đăng ký.']);
        }
        // Chống dùng chức năng này để gửi thư dồn dập vào hộp thư của người khác.
        $this->limiter->enforce('forgot:e:' . $loginId[1], 5, 3600, 'Bạn đã yêu cầu đặt lại mật khẩu quá nhiều lần.');
        $this->limiter->enforce('forgot:i:' . $request->ip, 20, 3600, 'Bạn đã yêu cầu đặt lại mật khẩu quá nhiều lần.');
        $this->resets->request($loginId[1]);
        return Response::ok([
            'message' => 'Nếu tài khoản tồn tại, mã 6 số đã được gửi tới email đã đăng ký. Hãy kiểm tra hộp thư (cả mục Thư rác).',
            'resend_after' => OtpService::RESEND_SECONDS,
            'expires_in' => OtpService::ttlMinutes() * 60,
        ]);
    }

    public function reset(Request $request): Response
    {
        $token = $request->input('token');
        $password = $request->input('password');
        $code = $request->input('code');
        if (is_string($code) && $code !== '') {
            // Giai đoạn 14: mã OTP + email/số điện thoại
            $loginId = Validator::loginId($request->input('login'));
            if ($loginId === null) {
                throw HttpException::validation(['login' => 'Hãy nhập đúng email hoặc số điện thoại đã đăng ký.']);
            }
            if (!Validator::passwordOk($password)) {
                throw HttpException::validation(['password' => 'Mật khẩu cần từ 6 đến 100 ký tự.']);
            }
            // chống đoán mã trên nhiều tài khoản từ một máy (mỗi mã đã tự hủy sau 5 lần sai)
            $this->limiter->enforce('otp:i:' . $request->ip, 60, 3600, 'Bạn đã nhập mã quá nhiều lần.');
            $this->resets->resetWithCode($loginId[1], $code, $password);
            return Response::ok(['message' => 'Đã đặt mật khẩu mới. Bạn có thể đăng nhập.']);
        }
        if (!is_string($token) || $token === '') {
            throw new HttpException(400, 'TOKEN_INVALID', 'Liên kết không hợp lệ hoặc đã hết hạn. Hãy yêu cầu liên kết mới.');
        }
        if (!Validator::passwordOk($password)) {
            throw HttpException::validation(['password' => 'Mật khẩu cần từ 6 đến 100 ký tự.']);
        }
        $this->resets->reset($token, $password);
        return Response::ok(['message' => 'Đã đặt mật khẩu mới. Bạn có thể đăng nhập.']);
    }

    /** Giai đoạn 14 (đang đăng nhập): gửi mã OTP đổi mật khẩu tới email (và SMS khi đã bật). */
    public function passwordCode(Request $request): Response
    {
        $user = $request->attributes['user'];
        $wait = $this->otp->waitSeconds($user, 'change');
        if ($wait > 0) {
            throw new HttpException(429, 'OTP_TOO_SOON', 'Hãy chờ ' . $wait . ' giây rồi gửi lại mã.', ['retry_after' => $wait]);
        }
        $this->limiter->enforce('otp-change:u:' . $user['id'], 10, 3600, 'Bạn đã xin mã quá nhiều lần.');
        $sent = $this->otp->issue($user, 'change');
        return Response::ok($sent + [
            'resend_after' => OtpService::RESEND_SECONDS,
            'message' => 'Đã gửi mã 6 số tới email ' . $sent['email'] . '.',
        ]);
    }

    /** Đổi mật khẩu bằng mã OTP. Máy đang dùng vẫn đăng nhập, các máy khác bị đăng xuất. */
    public function changePassword(Request $request): Response
    {
        $user = $request->attributes['user'];
        $code = $request->input('code');
        $password = $request->input('password');
        if (!is_string($code) || trim($code) === '') {
            throw HttpException::validation(['code' => 'Hãy nhập mã 6 số đã gửi tới email.']);
        }
        if (!Validator::passwordOk($password)) {
            throw HttpException::validation(['password' => 'Mật khẩu cần từ 6 đến 100 ký tự.']);
        }
        $this->resets->changeWithCode($user, $code, $password);
        $this->startSession($user, $request);
        return Response::ok(['message' => 'Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.'] + $this->sessionPayload($this->users->find((int) $user['id'])));
    }

    /** Thêm / đổi số điện thoại đăng nhập. */
    public function updatePhone(Request $request): Response
    {
        $user = $request->attributes['user'];
        $phone = Validator::phone($request->input('phone'));
        if ($phone === null) {
            throw HttpException::validation(['phone' => 'Số điện thoại không hợp lệ (số di động 10 số, ví dụ 0912345678).']);
        }
        if ($phone !== ($user['phone'] ?? null)) {
            $other = $this->users->findByPhone($phone);
            if ($other !== null && (int) $other['id'] !== (int) $user['id']) {
                throw AuthService::phoneTaken();
            }
            try {
                $this->users->updatePhone((int) $user['id'], $phone);
            } catch (\PDOException $e) {
                throw AuthService::phoneTaken();
            }
        }
        return Response::ok($this->sessionPayload($this->users->find((int) $user['id'])));
    }

    /** Mở phiên cho thiết bị này và đăng xuất các thiết bị khác của cùng tài khoản. */
    private function startSession(array $user, Request $request): void
    {
        $token = $this->devices->begin($user, (string) $request->header('user-agent'), $request->ip);
        Session::regenerate();
        Session::set('user_id', (int) $user['id']);
        Session::set('device_token', $token);
    }

    private function sessionPayload(?array $user): array
    {
        return array_merge(
            [
                'user' => $user ? UserRepository::publicView($user) : null,
                'guest' => $user === null,
                'csrf' => Session::csrf(),
            ],
            $this->entitlements->forUser($user)
        );
    }
}
