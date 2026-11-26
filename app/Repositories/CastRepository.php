<?php
declare(strict_types=1);

namespace App\Repositories;

use App\Core\Database;

/**
 * Bảng cast_sessions và cast_signals (giai đoạn 15: ghép nối chiếu màn hình).
 * Không xóa dòng: phiên kết thúc thì ghi ended_at/ended_by và xóa trắng nội dung tin trao đổi.
 */
final class CastRepository
{
    private Database $db;

    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    private function now(): string
    {
        return date('Y-m-d H:i:s');
    }

    /** Mã này có đang được một màn hình xe khác dùng để chờ không? */
    public function codeInUse(string $code): bool
    {
        return $this->db->value(
            "SELECT id FROM cast_sessions WHERE code = ? AND status = 'waiting' AND code_expires_at > ? LIMIT 1",
            [$code, $this->now()]
        ) !== null;
    }

    public function create(string $code, string $receiverHash, string $ip, string $codeExpiresAt, string $expiresAt): int
    {
        return $this->db->insert(
            "INSERT INTO cast_sessions (code, status, receiver_hash, created_ip, code_expires_at, expires_at, created_at) VALUES (?, 'waiting', ?, ?, ?, ?, ?)",
            [$code, $receiverHash, $ip, $codeExpiresAt, $expiresAt, $this->now()]
        );
    }

    public function find(int $id): ?array
    {
        return $this->db->one('SELECT * FROM cast_sessions WHERE id = ?', [$id]);
    }

    public function findWaitingByCode(string $code): ?array
    {
        return $this->db->one(
            "SELECT * FROM cast_sessions WHERE code = ? AND status = 'waiting' AND code_expires_at > ? ORDER BY id DESC LIMIT 1",
            [$code, $this->now()]
        );
    }

    /** Điện thoại nhận phiên. Chỉ MỘT điện thoại thắng: trả về false nếu phiên vừa bị máy khác nhận hoặc đã kết thúc. */
    public function pair(int $id, string $senderHash, string $deviceName, string $ip): bool
    {
        return $this->db->execute(
            "UPDATE cast_sessions SET status = 'paired', sender_hash = ?, device_name = ?, joined_ip = ?, paired_at = ? WHERE id = ? AND status = 'waiting'",
            [$senderHash, $deviceName, $ip, $this->now(), $id]
        ) === 1;
    }

    /** Kết thúc phiên (không xóa): ghi ai kết thúc và xóa trắng nội dung tin trao đổi (có địa chỉ mạng nội bộ của hai máy). */
    public function end(int $id, string $by): void
    {
        $changed = $this->db->execute(
            "UPDATE cast_sessions SET status = 'ended', ended_at = ?, ended_by = ? WHERE id = ? AND status <> 'ended'",
            [$this->now(), $by, $id]
        );
        if ($changed > 0) {
            $this->db->execute("UPDATE cast_signals SET payload = '' WHERE session_id = ?", [$id]);
        }
    }

    public function addSignal(int $sessionId, string $role, string $kind, string $payload): int
    {
        return $this->db->insert(
            'INSERT INTO cast_signals (session_id, from_role, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)',
            [$sessionId, $role, $kind, $payload, $this->now()]
        );
    }

    public function countSignals(int $sessionId): int
    {
        return (int) $this->db->value('SELECT COUNT(*) FROM cast_signals WHERE session_id = ?', [$sessionId]);
    }

    /** Tin của máy BÊN KIA gửi sau tin số $after. */
    public function signalsFor(int $sessionId, string $myRole, int $after, int $limit = 100): array
    {
        return $this->db->all(
            'SELECT id, kind, payload FROM cast_signals WHERE session_id = ? AND from_role <> ? AND id > ? ORDER BY id ASC LIMIT ' . max(1, min(200, $limit)),
            [$sessionId, $myRole, $after]
        );
    }
}
