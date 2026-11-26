<?php
declare(strict_types=1);

namespace App\Core;

/** Chuyển mọi ngoại lệ thành phản hồi JSON và ghi log lỗi hệ thống. */
final class ErrorHandler
{
    public static function toResponse(\Throwable $e): Response
    {
        if ($e instanceof HttpException) {
            $response = Response::error($e->status, $e->errorCode, $e->getMessage(), $e->details);
            if ($e->status === 429 && isset($e->details['retry_after'])) {
                $response->headers['Retry-After'] = (string) (int) $e->details['retry_after'];
            }
            return $response;
        }
        Logger::error(get_class($e) . ': ' . $e->getMessage(), ['file' => $e->getFile(), 'line' => $e->getLine()]);
        $message = Config::get('app.debug', false) ? $e->getMessage() : 'Lỗi hệ thống. Vui lòng thử lại sau.';
        return Response::error(500, 'SERVER_ERROR', $message);
    }
}
