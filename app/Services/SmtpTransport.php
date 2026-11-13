<?php
declare(strict_types=1);

namespace App\Services;

/** Gửi thư qua SMTP (SSL cổng 465 hoặc STARTTLS cổng 587), đăng nhập AUTH LOGIN. */
final class SmtpTransport
{
    /** @var resource|null */
    private $fp = null;

    private array $cfg;

    public function __construct(array $cfg)
    {
        $this->cfg = $cfg;
    }

    public function send(string $from, string $to, string $rawMessage): void
    {
        $enc = (string) ($this->cfg['encryption'] ?? 'tls');   // 'ssl' | 'tls' | ''
        $host = (string) $this->cfg['host'];
        $port = (int) ($this->cfg['port'] ?? 587);
        $timeout = (int) ($this->cfg['timeout'] ?? 15);

        $target = ($enc === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . $port;
        $fp = @stream_socket_client($target, $errno, $errstr, $timeout);
        if ($fp === false) {
            throw new \RuntimeException("Không kết nối được SMTP {$host}:{$port} ({$errstr})");
        }
        $this->fp = $fp;
        stream_set_timeout($fp, $timeout);

        try {
            $this->expect(220);
            $domain = (string) ($this->cfg['helo'] ?? 'localhost');
            $this->command('EHLO ' . $domain, 250);
            if ($enc === 'tls') {
                $this->command('STARTTLS', 220);
                if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                    throw new \RuntimeException('Không bật được mã hóa TLS với máy chủ SMTP.');
                }
                $this->command('EHLO ' . $domain, 250);
            }
            $user = (string) ($this->cfg['username'] ?? '');
            if ($user !== '') {
                $this->command('AUTH LOGIN', 334);
                $this->command(base64_encode($user), 334);
                $this->command(base64_encode((string) ($this->cfg['password'] ?? '')), 235);
            }
            $this->command('MAIL FROM:<' . $from . '>', 250);
            $this->command('RCPT TO:<' . $to . '>', 250, 251);
            $this->command('DATA', 354);
            $body = preg_replace('/^\./m', '..', $rawMessage);
            fwrite($fp, $body . "\r\n.\r\n");
            $this->expect(250);
            $this->command('QUIT', 221);
        } finally {
            if (is_resource($fp)) {
                fclose($fp);
            }
            $this->fp = null;
        }
    }

    private function command(string $line, int ...$codes): void
    {
        fwrite($this->fp, $line . "\r\n");
        $this->expect(...$codes);
    }

    private function expect(int ...$codes): void
    {
        $codes = $codes ?: [250];
        $reply = '';
        while (($line = fgets($this->fp, 1024)) !== false) {
            $reply .= $line;
            if (strlen($line) < 4 || $line[3] === ' ') {
                break;
            }
        }
        $code = (int) substr($reply, 0, 3);
        if (!in_array($code, $codes, true)) {
            throw new \RuntimeException('SMTP trả lỗi: ' . trim($reply));
        }
    }
}
