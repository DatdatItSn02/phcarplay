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
        return Response::ok(['status' => $dbOk ? 'ok' : 'degraded', 'database' => $dbOk]);
    }
}
