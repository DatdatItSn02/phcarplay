<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\HttpException;
use App\Repositories\LicenseKeyRepository;
use App\Repositories\UserRepository;
use App\Repositories\SoftDelete;

/**
 * Key kích hoạt. Key dạng XXXX-XXXX-XXXX-XXXX (16 ký tự, 80 bit ngẫu nhiên, bỏ các chữ dễ nhầm 0/O, 1/I/L), lưu nguyên văn
 * để quản trị xem và gửi lại cho khách được. Mỗi key chỉ dùng một lần, cộng thêm `days` ngày vào hạn dùng của tài khoản nhập nó.
 */
final class LicenseKeyService
{
    public const MAX_BATCH = 100;
    public const MAX_DAYS = 3650;
    private const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // 31 ký tự

    private LicenseKeyRepository $keys;
    private UserRepository $users;
    private AuditService $audit;

    public function __construct(LicenseKeyRepository $keys, UserRepository $users, AuditService $audit)
    {
        $this->keys = $keys;
        $this->users = $users;
        $this->audit = $audit;
    }

    // ---------- quản trị ----------

    public function search(array $filters, int $page, int $perPage, int $offset): array
    {
        return [
            'items' => array_map([self::class, 'view'], $this->keys->search($filters, $perPage, $offset)),
            'total' => $this->keys->countSearch($filters),
            'page' => $page,
            'per_page' => $perPage,
            'counts' => $this->keys->counts(),
        ];
    }

    /** @return array<int,array> các key vừa tạo */
    public function generate(array $actor, int $count, int $days, string $note, string $ip): array
    {
        $out = [];
        for ($i = 0; $i < $count; $i++) {
            $id = $this->insertUnique($days, $note, (int) $actor['id']);
            $out[] = self::view((array) $this->keys->find($id));
        }
        $this->audit->record($actor, 'key.create', 'key', $out[0]['id'] ?? '', $count . ' key × ' . $days . ' ngày' . ($note !== '' ? '; ghi chú: ' . $note : ''), $ip);
        return $out;
    }

    public function revoke(array $actor, int $id, string $ip): array
    {
        $key = $this->mustFind($id);
        if ($key['status'] === 'used') {
            throw new HttpException(409, 'KEY_USED', 'Key này đã được dùng nên không thu hồi được.');
        }
        if ($key['status'] === 'unused') {
            $this->keys->revoke($id, (int) $actor['id']);
            $this->audit->record($actor, 'key.revoke', 'key', $id, $key['days'] . ' ngày' . ($key['note'] !== '' ? '; ghi chú: ' . $key['note'] : ''), $ip);
        }
        return self::view((array) $this->keys->find($id));
    }

    public function delete(array $actor, int $id, string $ip): void
    {
        $key = $this->mustFind($id);
        if ($key['status'] === 'used') {
            throw new HttpException(409, 'KEY_USED', 'Key đã dùng được giữ lại làm lịch sử, không xóa được.');
        }
        $this->keys->softDeleteUnlessUsed($id, SoftDelete::byAdmin($actor));
        $this->audit->record($actor, 'key.delete', 'key', $id, $key['days'] . ' ngày, trạng thái ' . $key['status'], $ip);
    }

    /**
     * Thao tác hàng loạt trên các key đang chọn: 'revoke' (thu hồi key chưa dùng) hoặc 'delete' (xóa = đánh dấu, trừ key đã dùng).
     * Key không làm được (đã dùng, đã thu hồi, không còn) được bỏ qua kèm lý do. Ghi MỘT dòng nhật ký cho cả lô.
     * @param array<int,int> $ids
     * @return array{done: array<int,int>, skipped: array<int,array{id:int,reason:string}>}
     */
    public function bulk(array $actor, string $action, array $ids, string $ip): array
    {
        $done = [];
        $skipped = [];
        $by = SoftDelete::byAdmin($actor);
        foreach (array_values(array_unique($ids)) as $id) {
            $key = $this->keys->find($id);
            if ($key === null) {
                $skipped[] = ['id' => $id, 'reason' => 'Không tìm thấy (có thể đã bị xóa).'];
            } elseif ($key['status'] === 'used') {
                $skipped[] = ['id' => $id, 'reason' => $action === 'revoke' ? 'Đã được dùng nên không thu hồi được.' : 'Đã được dùng, giữ lại làm lịch sử.'];
            } elseif ($action === 'revoke' && $key['status'] === 'revoked') {
                $skipped[] = ['id' => $id, 'reason' => 'Đã thu hồi từ trước.'];
            } elseif ($action === 'revoke' ? $this->keys->revoke($id, (int) $actor['id']) : $this->keys->softDeleteUnlessUsed($id, $by)) {
                $done[] = $id;
            } else {
                $skipped[] = ['id' => $id, 'reason' => 'Trạng thái key vừa thay đổi, hãy tải lại danh sách.'];
            }
        }
        if ($done !== []) {
            $detail = count($done) . ' key: #' . implode(', #', $done);
            $this->audit->record($actor, $action === 'revoke' ? 'key.bulk_revoke' : 'key.bulk_delete', 'key', (string) $done[0], mb_substr($detail, 0, 900), $ip);
        }
        return ['done' => $done, 'skipped' => $skipped];
    }

    // ---------- người dùng ----------

    /**
     * Người dùng nhập key. Trả về {days_added, previous_expires_at, expires_at, user (bản ghi mới)}.
     * Lỗi: 422 sai định dạng, 404 không có key này, 409 key đã dùng hoặc đã thu hồi.
     */
    public function redeem(array $user, string $rawCode): array
    {
        $code = self::normalize($rawCode);
        if ($code === null) {
            throw HttpException::validation(['code' => 'Key gồm 16 ký tự chữ và số, ví dụ ABCD-EFGH-JKMN-PQRS.']);
        }
        $key = $this->keys->findByCode($code);
        if ($key === null) {
            throw new HttpException(404, 'KEY_NOT_FOUND', 'Key không đúng. Hãy kiểm tra lại từng ký tự.', ['code' => 'Key không đúng.']);
        }
        $this->assertUsable($key);
        $days = (int) $key['days'];
        $result = $this->keys->redeem((int) $key['id'], (int) $user['id'], (string) $user['email'], static function (?string $current) use ($days): string {
            return LicensePeriod::extend($current, $days);
        });
        if ($result === null) {
            // Người khác vừa dùng key này trước một nhịp.
            $this->assertUsable((array) $this->keys->find((int) $key['id']));
            throw new HttpException(409, 'KEY_USED', 'Key này đã được sử dụng.', ['code' => 'Key này đã được sử dụng.']);
        }
        return [
            'days_added' => $days,
            'previous_expires_at' => $result['previous'],
            'expires_at' => $result['expires_at'],
            'user' => (array) $this->users->find((int) $user['id']),
        ];
    }

    // ---------- dùng chung ----------

    /** Chuẩn hóa key người dùng gõ (chữ thường, thiếu hoặc thừa dấu gạch, khoảng trắng) về dạng XXXX-XXXX-XXXX-XXXX; null nếu sai. */
    public static function normalize(string $raw): ?string
    {
        $clean = strtoupper((string) preg_replace('/[^A-Za-z0-9]/', '', $raw));
        if (strlen($clean) !== 16 || strspn($clean, self::ALPHABET . '01OIL') !== 16) {
            return null;
        }
        return implode('-', str_split($clean, 4));
    }

    public static function generateCode(): string
    {
        $n = strlen(self::ALPHABET);
        $limit = 256 - (256 % $n);
        $out = '';
        while (strlen($out) < 16) {
            foreach (str_split(random_bytes(32)) as $byte) {
                $v = ord($byte);
                if ($v < $limit && strlen($out) < 16) {
                    $out .= self::ALPHABET[$v % $n];
                }
            }
        }
        return implode('-', str_split($out, 4));
    }

    /** Dữ liệu một key trả cho quản trị. */
    public static function view(array $k): array
    {
        return [
            'id' => (int) $k['id'],
            'code' => $k['code'],
            'days' => (int) $k['days'],
            'note' => $k['note'],
            'status' => $k['status'],
            'created_at' => $k['created_at'],
            'created_by_email' => $k['created_by_email'] ?? null,
            'used_by' => isset($k['used_by']) ? (int) $k['used_by'] : null,
            'used_by_email' => $k['used_by_email'] ?? null,
            'used_at' => $k['used_at'] ?? null,
            'revoked_at' => $k['revoked_at'] ?? null,
            'deleted' => SoftDelete::view($k),
        ];
    }

    private function assertUsable(array $key): void
    {
        if ($key['status'] === 'used') {
            throw new HttpException(409, 'KEY_USED', 'Key này đã được sử dụng.', ['code' => 'Key này đã được sử dụng.']);
        }
        if ($key['status'] === 'revoked') {
            throw new HttpException(409, 'KEY_REVOKED', 'Key này đã bị thu hồi. Hãy liên hệ người bán.', ['code' => 'Key này đã bị thu hồi.']);
        }
    }

    private function insertUnique(int $days, string $note, int $adminId): int
    {
        for ($try = 0; $try < 5; $try++) {
            try {
                return $this->keys->create(self::generateCode(), $days, $note, $adminId);
            } catch (\PDOException $e) {
                $message = strtolower($e->getMessage());
                $duplicate = (isset($e->errorInfo[1]) && (int) $e->errorInfo[1] === 1062) || strpos($message, 'duplicate') !== false || strpos($message, 'unique') !== false;
                if (!$duplicate) {
                    throw $e;
                }
            }
        }
        throw new \RuntimeException('Không tạo được key duy nhất sau nhiều lần thử.');
    }

    private function mustFind(int $id): array
    {
        $key = $this->keys->find($id);
        if ($key === null) {
            throw HttpException::notFound('Không tìm thấy key.');
        }
        return $key;
    }
}
