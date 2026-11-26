<?php
declare(strict_types=1);

namespace App\Repositories;

use App\Core\Database;

/**
 * Bảng cast_sessions và cast_signals (giai đoạn 15: ghép nối chiếu màn hình), cast_pairs (giai đoạn 17: ghép đôi một lần).
 * Không xóa dòng: phiên kết thúc thì ghi ended_at/ended_by và xóa trắng nội dung tin trao đổi; "Quên thiết bị" ghi
 * deleted_at/deleted_by.
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

    /**
     * Màn hình xe tạo phiên chờ nhập mã. $pairId: null = phiên kiểu cũ; 0 = ghép đôi được (khóa là khóa thiết bị).
     * $receiverName: tên màn hình xe, tạm giữ trong device_name cho tới khi điện thoại nhập mã.
     */
    public function create(string $code, string $receiverHash, string $ip, string $codeExpiresAt, string $expiresAt, ?int $pairId = null, string $receiverName = ''): int
    {
        return $this->db->insert(
            "INSERT INTO cast_sessions (code, status, receiver_hash, device_name, pair_id, created_ip, code_expires_at, expires_at, created_at) VALUES (?, 'waiting', ?, ?, ?, ?, ?, ?, ?)",
            [$code, $receiverHash, $receiverName, $pairId, $ip, $codeExpiresAt, $expiresAt, $this->now()]
        );
    }

    /** Phiên do điện thoại bấm "Chia sẻ" (không có mã): đã ghép sẵn hai máy của cặp, chờ màn hình xe nhận. */
    public function createPairSession(int $pairId, string $receiverHash, string $senderHash, string $deviceName, string $ip, string $expiresAt): int
    {
        $now = $this->now();
        return $this->db->insert(
            "INSERT INTO cast_sessions (code, status, receiver_hash, sender_hash, device_name, pair_id, created_ip, joined_ip, code_expires_at, expires_at, paired_at, created_at)"
            . " VALUES ('', 'paired', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [$receiverHash, $senderHash, $deviceName, $pairId, $ip, $ip, $now, $expiresAt, $now, $now]
        );
    }

    public function setSessionPair(int $sessionId, int $pairId): void
    {
        $this->db->execute('UPDATE cast_sessions SET pair_id = ? WHERE id = ?', [$pairId, $sessionId]);
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

    // ---------- cặp ghép đôi (giai đoạn 17) ----------

    public function findPair(int $id): ?array
    {
        return $this->db->one('SELECT * FROM cast_pairs WHERE id = ?', [$id]);
    }

    /** Cặp còn dùng của đúng hai máy này (nếu đã ghép đôi trước đó). */
    public function findActivePair(string $receiverHash, string $senderHash): ?array
    {
        return $this->db->one(
            'SELECT * FROM cast_pairs WHERE receiver_hash = ? AND sender_hash = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1',
            [$receiverHash, $senderHash]
        );
    }

    public function countActivePairs(string $hash): int
    {
        return (int) $this->db->value(
            'SELECT COUNT(*) FROM cast_pairs WHERE deleted_at IS NULL AND (receiver_hash = ? OR sender_hash = ?)',
            [$hash, $hash]
        );
    }

    public function createPair(string $receiverHash, string $senderHash, string $receiverName, string $senderName, string $ip): int
    {
        $now = $this->now();
        return $this->db->insert(
            'INSERT INTO cast_pairs (receiver_hash, sender_hash, receiver_name, sender_name, last_used_at, created_ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$receiverHash, $senderHash, $receiverName, $senderName, $now, $ip, $now]
        );
    }

    /** Ghép đôi lại hai máy đã là một cặp: cập nhật tên (nếu có) và lần dùng gần nhất. */
    public function touchPair(int $id, string $receiverName, string $senderName): void
    {
        $this->db->execute(
            "UPDATE cast_pairs SET receiver_name = CASE WHEN ? <> '' THEN ? ELSE receiver_name END,"
            . " sender_name = CASE WHEN ? <> '' THEN ? ELSE sender_name END, last_used_at = ? WHERE id = ?",
            [$receiverName, $receiverName, $senderName, $senderName, $this->now(), $id]
        );
    }

    /** Các cặp còn dùng có máy này (là màn hình xe hoặc điện thoại), dùng gần nhất trước. */
    public function pairsFor(string $hash, int $limit = 50): array
    {
        return $this->db->all(
            'SELECT * FROM cast_pairs WHERE deleted_at IS NULL AND (receiver_hash = ? OR sender_hash = ?)'
            . ' ORDER BY COALESCE(last_used_at, created_at) DESC, id DESC LIMIT ' . max(1, min(100, $limit)),
            [$hash, $hash]
        );
    }

    /** Các cặp của màn hình xe này (chỉ cột cần cho việc hỏi "có ai bấm Chia sẻ không"). */
    public function receiverPairs(string $receiverHash): array
    {
        return $this->db->all(
            'SELECT id, request_session_id, request_at FROM cast_pairs WHERE receiver_hash = ? AND deleted_at IS NULL ORDER BY request_at DESC, id DESC',
            [$receiverHash]
        );
    }

    /** Điện thoại bấm "Chia sẻ": ghi phiên đang chờ màn hình xe nhận. */
    public function setRequest(int $pairId, int $sessionId, string $senderName): void
    {
        $now = $this->now();
        $this->db->execute(
            "UPDATE cast_pairs SET request_session_id = ?, request_at = ?, last_used_at = ?, sender_name = CASE WHEN ? <> '' THEN ? ELSE sender_name END WHERE id = ?",
            [$sessionId, $now, $now, $senderName, $senderName, $pairId]
        );
    }

    /** Màn hình xe nhận lời mời. Chỉ MỘT lần nhận thắng (hai thẻ trình duyệt cùng hỏi): trả về true nếu chính lần này nhận được. */
    public function claimRequest(int $pairId, int $sessionId): bool
    {
        return $this->db->execute(
            'UPDATE cast_pairs SET request_session_id = NULL WHERE id = ? AND request_session_id = ?',
            [$pairId, $sessionId]
        ) === 1;
    }

    /** "Quên thiết bị" (không xóa dòng): trả về true nếu lần này mới đánh dấu. */
    public function forgetPair(int $id, string $by): bool
    {
        return $this->db->execute(
            'UPDATE cast_pairs SET deleted_at = ?, deleted_by = ?, request_session_id = NULL WHERE id = ? AND deleted_at IS NULL',
            [$this->now(), $by, $id]
        ) === 1;
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
