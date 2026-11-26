<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\HttpException;
use App\Repositories\AdminRepository;
use App\Repositories\PasswordResetRepository;
use App\Repositories\SoftDelete;

/**
 * Quản lý tài khoản quản trị (chỉ master được gọi, đã kiểm tra ở middleware RequireMaster).
 * Quy tắc bảo vệ master: không tạo thêm master, không khóa/xóa master, chỉ chính master mới sửa tên và email của mình.
 * Dữ liệu đã được Controller kiểm tra định dạng; ở đây chỉ kiểm tra nghiệp vụ.
 */
final class AdminAccountService
{
    private AdminRepository $admins;
    private PasswordResetRepository $resets;
    private PasswordHasher $hasher;
    private AuditService $audit;

    public function __construct(AdminRepository $admins, PasswordResetRepository $resets, PasswordHasher $hasher, AuditService $audit)
    {
        $this->admins = $admins;
        $this->resets = $resets;
        $this->hasher = $hasher;
        $this->audit = $audit;
    }

    /** @return array<int,array> $deleted = true: chỉ các tài khoản đã xóa (kèm người xóa, thời điểm) */
    public function listAll(bool $deleted = false): array
    {
        return array_map([AdminRepository::class, 'publicView'], $this->admins->all($deleted));
    }

    public function get(int $id): array
    {
        return AdminRepository::publicView($this->mustFind($id));
    }

    /** Tạo admin thường (không bao giờ tạo master). Người mới phải đổi mật khẩu ở lần đăng nhập đầu. */
    public function create(array $actor, string $email, string $name, string $password, string $ip): array
    {
        if ($this->admins->findByEmail($email) !== null) {
            throw $this->emailTaken();
        }
        $salt = $this->hasher->generateSalt();
        try {
            $id = $this->admins->create($email, $name, $this->hasher->hash($password, $salt), $salt, 'admin', true);
        } catch (\PDOException $e) {
            throw $this->translateDuplicate($e);
        }
        $this->audit->record($actor, 'admin.create', 'admin', $id, 'email: ' . $email, $ip);
        return AdminRepository::publicView($this->mustFind($id));
    }

    /**
     * @param array $changes chỉ gồm các khóa name, email, status (đã kiểm tra định dạng)
     */
    public function update(array $actor, int $id, array $changes, string $ip): array
    {
        $target = $this->mustFind($id);
        if ($target['role'] === 'master') {
            if (array_key_exists('status', $changes)) {
                throw $this->masterProtected('Không thể khóa tài khoản master.');
            }
            if ((int) $actor['id'] !== $id) {
                throw $this->masterProtected('Chỉ master mới sửa được thông tin của chính mình.');
            }
        }

        $diff = [];
        $email = $target['email'];
        $name = $target['name'];
        if (array_key_exists('email', $changes) && $changes['email'] !== $target['email']) {
            $other = $this->admins->findByEmail($changes['email']);
            if ($other !== null && (int) $other['id'] !== $id) {
                throw $this->emailTaken();
            }
            $diff[] = 'email: ' . $target['email'] . ' → ' . $changes['email'];
            $email = $changes['email'];
        }
        if (array_key_exists('name', $changes) && $changes['name'] !== $target['name']) {
            $diff[] = 'tên: ' . $target['name'] . ' → ' . $changes['name'];
            $name = $changes['name'];
        }
        $statusChanged = array_key_exists('status', $changes) && $changes['status'] !== $target['status'];
        if ($statusChanged) {
            $diff[] = 'trạng thái: ' . $target['status'] . ' → ' . $changes['status'];
        }

        if ($diff) {
            try {
                if ($email !== $target['email'] || $name !== $target['name']) {
                    $this->admins->updateProfile($id, $email, $name);
                }
                if ($statusChanged) {
                    $this->admins->setStatus($id, (string) $changes['status']);
                }
            } catch (\PDOException $e) {
                throw $this->translateDuplicate($e);
            }
            $this->audit->record($actor, 'admin.update', 'admin', $id, implode('; ', $diff), $ip);
        }
        return AdminRepository::publicView($this->mustFind($id));
    }

    /** Master đặt mật khẩu tạm cho admin khác; người đó bị buộc đổi ở lần đăng nhập kế tiếp và mọi phiên cũ bị đăng xuất. */
    public function setPassword(array $actor, int $id, string $password, string $ip): void
    {
        $target = $this->mustFind($id);
        if ($target['role'] === 'master') {
            throw $this->masterProtected('Mật khẩu master chỉ tự đổi được ở mục "Tài khoản của tôi".');
        }
        $salt = $this->hasher->generateSalt();
        $this->admins->setPassword($id, $this->hasher->hash($password, $salt), $salt, true);
        $this->resets->invalidateAll('admin', $id);
        $this->audit->record($actor, 'admin.password_set', 'admin', $id, 'email: ' . $target['email'], $ip);
    }

    public function delete(array $actor, int $id, string $ip): void
    {
        $target = $this->mustFind($id);
        if ($target['role'] === 'master') {
            throw $this->masterProtected('Không thể xóa tài khoản master.');
        }
        if ((int) $actor['id'] === $id) {
            throw HttpException::forbidden('Không thể tự xóa tài khoản đang đăng nhập.');
        }
        $this->admins->softDelete($id, SoftDelete::byAdmin($actor));
        $this->audit->record($actor, 'admin.delete', 'admin', $id, 'email: ' . $target['email'], $ip);
    }

    private function mustFind(int $id): array
    {
        $admin = $this->admins->find($id);
        if ($admin === null) {
            throw HttpException::notFound('Không tìm thấy tài khoản quản trị.');
        }
        return $admin;
    }

    private function emailTaken(): HttpException
    {
        return new HttpException(409, 'EMAIL_TAKEN', 'Email này đã được dùng cho một quản trị viên khác.', ['email' => 'Email này đã được dùng.']);
    }

    private function masterProtected(string $message): HttpException
    {
        return new HttpException(403, 'MASTER_PROTECTED', $message);
    }

    /** Hai yêu cầu cùng lúc có thể vượt qua bước kiểm tra trùng; khóa UNIQUE của database là chốt cuối. */
    private function translateDuplicate(\PDOException $e): \Throwable
    {
        $driverCode = isset($e->errorInfo[1]) ? (int) $e->errorInfo[1] : 0;
        $message = strtolower($e->getMessage());
        $duplicate = $driverCode === 1062 || strpos($message, 'duplicate') !== false || strpos($message, 'unique') !== false;
        return $duplicate ? $this->emailTaken() : $e;
    }
}
