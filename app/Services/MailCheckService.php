<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Config;
use App\Core\Logger;

/**
 * Giai đoạn 16: kiểm tra việc gửi email từ trang quản trị (Tổng quan > Gửi email), không cần gõ lệnh trên máy chủ.
 * Chỉ trả về thông tin an toàn: KHÔNG bao giờ trả mật khẩu SMTP (chỉ báo đã điền hay chưa).
 */
final class MailCheckService
{
    private Mailer $mailer;

    public function __construct(Mailer $mailer)
    {
        $this->mailer = $mailer;
    }

    /** Cấu hình gửi mail đang dùng, kèm những chỗ cần sửa (problems). */
    public function describe(): array
    {
        $cfg = (array) Config::get('mail', []);
        $smtp = (array) ($cfg['smtp'] ?? []);
        $driver = $this->mailer->driver();
        $from = (string) ($cfg['from_email'] ?? '');
        $labels = [
            'log' => 'Chế độ thử - thư chỉ ghi vào thư mục storage/mail, không gửi đi',
            'mail' => 'Hàm mail() của PHP',
            'smtp' => 'Máy chủ SMTP',
        ];
        $problems = [];
        if ($driver === 'log') {
            $problems[] = 'Website đang ở chế độ thử nên người dùng không nhận được mã qua email. Hãy đặt MAIL_DRIVER=smtp trong file .env và điền các dòng SMTP_*.';
        }
        if ($driver === 'smtp') {
            if (trim((string) ($smtp['host'] ?? '')) === '') {
                $problems[] = 'Chưa điền SMTP_HOST (địa chỉ máy chủ gửi thư).';
            }
            if (trim((string) ($smtp['username'] ?? '')) === '') {
                $problems[] = 'Chưa điền SMTP_USER (tên đăng nhập hộp thư).';
            }
            if ((string) ($smtp['password'] ?? '') === '') {
                $problems[] = 'Chưa điền SMTP_PASS (mật khẩu hộp thư; với Gmail là "Mật khẩu ứng dụng").';
            }
        }
        if ($driver !== 'log' && ($from === '' || preg_match('/@(example\.(com|org|net)|localhost)$/i', $from) === 1)) {
            $problems[] = 'MAIL_FROM_EMAIL chưa phải địa chỉ thật. Nên đặt trùng với hộp thư dùng để đăng nhập SMTP.';
        }
        return [
            'driver' => $driver,
            'driver_label' => $labels[$driver],
            'test_mode' => $driver === 'log',
            'from_email' => $from,
            'from_name' => (string) ($cfg['from_name'] ?? ''),
            'smtp' => $driver === 'smtp' ? [
                'host' => (string) ($smtp['host'] ?? ''),
                'port' => (int) ($smtp['port'] ?? 0),
                'encryption' => (string) ($smtp['encryption'] ?? ''),
                'username_set' => trim((string) ($smtp['username'] ?? '')) !== '',
                'password_set' => (string) ($smtp['password'] ?? '') !== '',
            ] : null,
            'problems' => $problems,
        ];
    }

    /**
     * Gửi một thư thử.
     * @return array{ok:bool,test_mode:bool,message:string,error:string,hint:string}
     */
    public function sendTest(string $to): array
    {
        $appName = (string) Config::get('app.name', 'PH Car Play');
        $when = date('d/m/Y H:i:s');
        try {
            $this->mailer->send(
                $to,
                'Thư thử từ ' . $appName,
                '<p>Nếu bạn đọc được thư này, phần gửi email của ' . htmlspecialchars($appName, ENT_QUOTES, 'UTF-8') . ' đã hoạt động.</p><p>Gửi lúc ' . $when . '.</p>',
                'Nếu bạn đọc được thư này, phần gửi email của ' . $appName . " đã hoạt động.\nGửi lúc " . $when . '.'
            );
        } catch (\Throwable $e) {
            $error = $this->safe($e->getMessage());
            Logger::error('Gửi thư thử thất bại: ' . $error);
            return ['ok' => false, 'test_mode' => false, 'message' => 'Không gửi được thư thử.', 'error' => $error, 'hint' => self::hint($error)];
        }
        if (!$this->mailer->sendsForReal()) {
            return [
                'ok' => true, 'test_mode' => true, 'error' => '', 'hint' => '',
                'message' => 'Website đang ở chế độ thử: thư chỉ được ghi vào thư mục storage/mail trên máy chủ, KHÔNG gửi tới ' . $to . '. Hãy đặt MAIL_DRIVER=smtp trong file .env.',
            ];
        }
        return [
            'ok' => true, 'test_mode' => false, 'error' => '', 'hint' => '',
            'message' => 'Máy chủ thư đã nhận thư gửi tới ' . $to . '. Hãy mở hộp thư đó để kiểm tra (xem cả mục Thư rác).',
        ];
    }

    /** Gợi ý cách sửa bằng tiếng Việt theo lỗi máy chủ thư trả về. */
    public static function hint(string $error): string
    {
        $e = mb_strtolower($error);
        if (strpos($e, 'không kết nối được smtp') !== false) {
            return 'Kiểm tra SMTP_HOST và SMTP_PORT. Nếu đã đúng thì có thể nơi đặt website đang chặn cổng này: thử cổng 587 (SMTP_ENCRYPTION=tls) hoặc 465 (SMTP_ENCRYPTION=ssl).';
        }
        if (preg_match('/\b(535|534)\b/', $e) === 1 || strpos($e, 'username and password') !== false || strpos($e, 'authentication') !== false) {
            return 'Sai SMTP_USER hoặc SMTP_PASS. Với Gmail phải dùng "Mật khẩu ứng dụng" 16 ký tự (bật Xác minh 2 bước trước), không dùng mật khẩu Gmail thường.';
        }
        if (preg_match('/\b530\b/', $e) === 1) {
            return 'Máy chủ thư yêu cầu đăng nhập và mã hóa: kiểm tra SMTP_USER, SMTP_PASS và SMTP_ENCRYPTION (tls cho cổng 587, ssl cho cổng 465).';
        }
        if (strpos($e, 'tls') !== false) {
            return 'Kiểm tra SMTP_ENCRYPTION: cổng 587 dùng tls, cổng 465 dùng ssl.';
        }
        if (strpos($e, 'không trả lời') !== false) {
            return 'Thường do sai cổng hoặc sai kiểu mã hóa: cổng 465 cần SMTP_ENCRYPTION=ssl, cổng 587 cần SMTP_ENCRYPTION=tls.';
        }
        if (preg_match('/\b(550|551|553|554|501)\b/', $e) === 1) {
            return 'Máy chủ thư từ chối địa chỉ gửi hoặc địa chỉ nhận. Đặt MAIL_FROM_EMAIL trùng với hộp thư dùng để đăng nhập SMTP và kiểm tra lại địa chỉ nhận.';
        }
        if (strpos($e, 'mail()') !== false) {
            return 'Máy chủ không gửi được bằng hàm mail() của PHP. Hãy chuyển sang MAIL_DRIVER=smtp và điền các dòng SMTP_*.';
        }
        return 'Kiểm tra lại các dòng MAIL_* và SMTP_* trong file .env trên máy chủ.';
    }

    /** Phòng xa: không để mật khẩu SMTP (hay dạng base64 của nó) lọt vào thông báo lỗi. */
    private function safe(string $message): string
    {
        $password = (string) Config::get('mail.smtp.password', '');
        if ($password !== '') {
            $message = str_replace([$password, base64_encode($password)], '***', $message);
        }
        $message = preg_replace('/[\x00-\x1F\x7F]+/', ' ', $message) ?? $message;
        return mb_substr(trim($message), 0, 400);
    }
}
