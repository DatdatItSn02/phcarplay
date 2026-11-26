<?php
declare(strict_types=1);

namespace App\Controllers\Admin;

use App\Core\HttpException;
use App\Core\Request;
use App\Core\Response;
use App\Core\Validator;
use App\Services\AuditService;
use App\Services\MailCheckService;
use App\Services\RateLimiter;

/** Giai đoạn 16 (chỉ master): xem cấu hình gửi email đang dùng và gửi thư thử. */
final class AdminMailController
{
    private MailCheckService $mail;
    private RateLimiter $limiter;
    private AuditService $audit;

    public function __construct(MailCheckService $mail, RateLimiter $limiter, AuditService $audit)
    {
        $this->mail = $mail;
        $this->limiter = $limiter;
        $this->audit = $audit;
    }

    public function status(Request $request): Response
    {
        return Response::ok($this->mail->describe());
    }

    public function test(Request $request): Response
    {
        $admin = $request->attributes['admin'];
        $to = Validator::email($request->input('email'));
        if ($to === null) {
            throw HttpException::validation(['email' => 'Email nhận thư thử không hợp lệ.']);
        }
        $this->limiter->enforce('mail-test:a:' . $admin['id'], 10, 3600, 'Bạn đã gửi thư thử quá nhiều lần. Hãy chờ rồi thử lại.');
        $result = $this->mail->sendTest($to);
        $outcome = !$result['ok'] ? 'thất bại' : ($result['test_mode'] ? 'chế độ thử, không gửi thật' : 'thành công');
        $this->audit->record($admin, 'mail.test', 'mail', '', 'tới: ' . $to . ' - ' . $outcome, $request->ip);
        if (!$result['ok']) {
            throw new HttpException(502, 'MAIL_TEST_FAILED', $result['message'], ['error' => $result['error'], 'hint' => $result['hint']]);
        }
        return Response::ok($result + ['status' => $this->mail->describe()]);
    }
}
