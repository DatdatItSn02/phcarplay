<?php
declare(strict_types=1);

namespace App\Controllers\Admin;

use App\Core\HttpException;
use App\Core\Request;
use App\Core\Validator;

/** Đọc id trên đường dẫn và bộ lọc trên địa chỉ cho các Controller quản trị. */
trait ReadsParams
{
    /** id phải là số nguyên dương, nếu không coi như không tìm thấy (404). */
    protected function idParam(Request $request, string $name = 'id', string $notFound = 'Không tìm thấy.'): int
    {
        $raw = (string) $request->param($name);
        if ($raw === '' || !ctype_digit($raw) || (int) $raw < 1) {
            throw HttpException::notFound($notFound);
        }
        return (int) $raw;
    }

    /**
     * Lấy các bộ lọc chữ từ ?khóa=giá trị (bỏ khóa không có, cắt độ dài, bỏ ký tự điều khiển).
     * @param array<int,string> $keys
     * @return array<string,string>
     */
    protected function filters(Request $request, array $keys): array
    {
        $out = [];
        foreach ($keys as $key) {
            $value = $request->query[$key] ?? null;
            if (is_string($value)) {
                $clean = Validator::text($value, 100);
                if ($clean !== '') {
                    $out[$key] = $clean;
                }
            }
        }
        return $out;
    }
}
