<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Config;

/**
 * Gửi email. Driver chọn trong config/mail.php (MAIL_DRIVER trong .env):
 *   log  - ghi thư ra storage/mail/*.eml (dùng khi phát triển)
 *   mail - hàm mail() của PHP
 *   smtp - gửi qua máy chủ SMTP
 */
final class Mailer
{
    private ?array $cfg;

    public function __construct(?array $cfg = null)
    {
        $this->cfg = $cfg;
    }

    /** 'smtp' | 'mail' | 'log' (mọi giá trị khác đều coi là log). */
    public function driver(): string
    {
        $cfg = $this->cfg ?? (array) Config::get('mail', []);
        $driver = strtolower(trim((string) ($cfg['driver'] ?? 'log')));
        return $driver === 'smtp' || $driver === 'mail' ? $driver : 'log';
    }

    /** false = chế độ thử (driver log): thư chỉ ghi ra storage/mail, KHÔNG tới hộp thư của ai. */
    public function sendsForReal(): bool
    {
        return $this->driver() !== 'log';
    }

    public function send(string $to, string $subject, string $html, string $text = ''): void
    {
        $cfg = $this->cfg ?? (array) Config::get('mail', []);
        $driver = $this->driver();
        $fromEmail = (string) ($cfg['from_email'] ?? 'no-reply@localhost');
        $fromName = (string) ($cfg['from_name'] ?? 'PH Car Play');

        switch ($driver) {
            case 'smtp':
                $raw = $this->buildMessage($fromEmail, $fromName, $to, $subject, $html, $text, true);
                (new SmtpTransport((array) ($cfg['smtp'] ?? [])))->send($fromEmail, $to, $raw);
                break;
            case 'mail':
                [$headers, $body] = $this->buildParts($fromEmail, $fromName, $to, $subject, $html, $text, false);
                if (!mail($to, $this->encodeHeader($subject), $body, implode("\r\n", $headers))) {
                    throw new \RuntimeException('Hàm mail() của PHP gửi thất bại.');
                }
                break;
            default:
                $raw = $this->buildMessage($fromEmail, $fromName, $to, $subject, $html, $text, true);
                $dir = BASE_PATH . '/storage/mail';
                if (!is_dir($dir)) {
                    @mkdir($dir, 0775, true);
                }
                $base = $dir . '/' . date('Ymd-His') . '-' . bin2hex(random_bytes(3));
                file_put_contents($base . '.eml', $raw);
                // Bản chữ thường để dễ đọc liên kết khi phát triển (file .eml mã hóa base64).
                file_put_contents($base . '.txt', 'Tới: ' . $to . "\nTiêu đề: " . $subject . "\n\n" . ($text !== '' ? $text : trim(strip_tags($html))));
        }
    }

    public function buildMessage(string $fromEmail, string $fromName, string $to, string $subject, string $html, string $text, bool $withToSubject): string
    {
        [$headers, $body] = $this->buildParts($fromEmail, $fromName, $to, $subject, $html, $text, $withToSubject);
        return implode("\r\n", $headers) . "\r\n\r\n" . $body;
    }

    /** @return array{0:array<int,string>,1:string} [danh sách header, nội dung] */
    public function buildParts(string $fromEmail, string $fromName, string $to, string $subject, string $html, string $text, bool $withToSubject): array
    {
        $boundary = 'b' . bin2hex(random_bytes(8));
        $headers = [
            'From: ' . $this->encodeHeader($fromName) . ' <' . $fromEmail . '>',
            'MIME-Version: 1.0',
            'Date: ' . date('r'),
            'Message-ID: <' . bin2hex(random_bytes(8)) . '@' . ((string) substr(strrchr($fromEmail, '@') ?: '@localhost', 1)) . '>',
            'Content-Type: multipart/alternative; boundary="' . $boundary . '"',
        ];
        if ($withToSubject) {
            array_splice($headers, 1, 0, ['To: <' . $to . '>', 'Subject: ' . $this->encodeHeader($subject)]);
        }
        if ($text === '') {
            $text = trim(html_entity_decode(strip_tags($html), ENT_QUOTES, 'UTF-8'));
        }
        $body = '--' . $boundary . "\r\n"
            . "Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
            . chunk_split(base64_encode($text), 76, "\r\n")
            . '--' . $boundary . "\r\n"
            . "Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
            . chunk_split(base64_encode($html), 76, "\r\n")
            . '--' . $boundary . "--\r\n";
        return [$headers, $body];
    }

    private function encodeHeader(string $value): string
    {
        return preg_match('/^[\x20-\x7E]*$/', $value) ? $value : '=?UTF-8?B?' . base64_encode($value) . '?=';
    }
}
