<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Logger;
use App\Repositories\AuditLogRepository;

/**
 * Ghi nhật ký thao tác quản trị. Không bao giờ ghi mật khẩu hay token vào đây.
 * Nếu ghi nhật ký lỗi thì chỉ ghi vào log hệ thống, không làm hỏng thao tác chính (đã thực hiện xong).
 */
final class AuditService
{
    private AuditLogRepository $logs;

    public function __construct(AuditLogRepository $logs)
    {
        $this->logs = $logs;
    }

    /** @param array|null $admin bản ghi admin thực hiện (null nếu hệ thống tự làm) */
    public function record(?array $admin, string $action, string $targetType = '', $targetId = '', string $detail = '', string $ip = ''): void
    {
        try {
            $this->logs->insert(
                $admin === null ? null : (int) $admin['id'],
                $admin === null ? '' : (string) $admin['email'],
                mb_substr($action, 0, 60),
                mb_substr($targetType, 0, 30),
                mb_substr((string) $targetId, 0, 64),
                mb_substr($detail, 0, 1000),
                mb_substr($ip, 0, 45)
            );
        } catch (\Throwable $e) {
            Logger::error('Ghi nhật ký quản trị thất bại: ' . $e->getMessage(), ['action' => $action]);
        }
    }
}
