<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Database;
use App\Core\Request;
use App\Core\Response;

final class HealthController
{
    private Database $db;

    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function index(Request $request): Response
    {
        $dbOk = true;
        try {
            $this->db->value('SELECT 1');
        } catch (\Throwable $e) {
            $dbOk = false;
        }
        // Không trả phiên bản PHP: người ngoài không cần biết, kẻ xấu thì dùng để tìm lỗ hổng theo phiên bản.
        $data = ['status' => $dbOk ? 'ok' : 'degraded', 'database' => $dbOk];
        // Giai đoạn 17: bản mã đang chạy (12 ký tự đầu của mã commit), do quy trình tự cập nhật ghi vào app/deploy_revision.php.
        // File là mã PHP (không phải dữ liệu) nên chỉ đổi khi PHP đã nạp mã mới: GitHub dùng nó để biết mã mới đã thật sự chạy.
        $rev = self::revision(BASE_PATH . '/app/deploy_revision.php');
        if ($rev !== '') {
            $data['revision'] = $rev;
        }
        return Response::ok($data);
    }

    /** Mã commit mà file PHP trả về (return '...';); không có file hoặc sai dạng thì trả ''. */
    public static function revision(string $file): string
    {
        if (!is_file($file)) {
            return '';
        }
        $rev = include $file;
        return is_string($rev) && preg_match('/^[0-9a-f]{7,40}$/', $rev) === 1 ? substr($rev, 0, 12) : '';
    }
}
