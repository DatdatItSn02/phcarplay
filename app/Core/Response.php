<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Phản hồi JSON chuẩn của API:
 *   thành công: {"ok":true,"data":...}
 *   lỗi:        {"ok":false,"error":{"code":"...","message":"...","details":{...}}}
 */
final class Response
{
    public int $status;
    public array $payload;
    public array $headers;

    public function __construct(int $status = 200, array $payload = [], array $headers = [])
    {
        $this->status = $status;
        $this->payload = $payload;
        $this->headers = $headers;
    }

    public static function ok($data = null, int $status = 200): self
    {
        return new self($status, ['ok' => true, 'data' => $data]);
    }

    public static function error(int $status, string $code, string $message, array $details = []): self
    {
        $error = ['code' => $code, 'message' => $message];
        if ($details) {
            $error['details'] = $details;
        }
        return new self($status, ['ok' => false, 'error' => $error]);
    }

    public function toJson(): string
    {
        $json = json_encode(
            $this->payload,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
        );
        return $json === false ? '{"ok":false,"error":{"code":"ENCODE_FAILED","message":"Không mã hóa được dữ liệu."}}' : $json;
    }

    public function send(): void
    {
        http_response_code($this->status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        foreach (SecurityHeaders::api(Session::isHttps()) as $name => $value) {
            header($name . ': ' . $value);
        }
        foreach ($this->headers as $name => $value) {
            header($name . ': ' . $value);
        }
        echo $this->toJson();
    }
}
