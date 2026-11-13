<?php
declare(strict_types=1);

namespace App\Core;

/** Lỗi có mã HTTP, được chuyển thành phản hồi JSON chuẩn của API. */
final class HttpException extends \RuntimeException
{
    public int $status;
    public string $errorCode;
    public array $details;

    public function __construct(int $status, string $errorCode, string $message, array $details = [])
    {
        $this->status = $status;
        $this->errorCode = $errorCode;
        $this->details = $details;
        parent::__construct($message);
    }

    public static function unauthorized(string $message = 'Bạn cần đăng nhập.'): self
    {
        return new self(401, 'UNAUTHORIZED', $message);
    }

    public static function forbidden(string $message = 'Bạn không có quyền thực hiện thao tác này.'): self
    {
        return new self(403, 'FORBIDDEN', $message);
    }

    public static function notFound(string $message = 'Không tìm thấy.'): self
    {
        return new self(404, 'NOT_FOUND', $message);
    }

    public static function validation(array $details, string $message = 'Dữ liệu chưa hợp lệ.'): self
    {
        return new self(422, 'VALIDATION_FAILED', $message, $details);
    }
}
