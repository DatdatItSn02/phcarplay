<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Config;
use App\Core\HttpException;
use App\Repositories\CastRepository;

/**
 * Giai đoạn 15: ghép nối để chiếu màn hình điện thoại lên màn hình xe.
 *  1. Màn hình xe (receiver) tạo phiên -> nhận mã 6 số để hiện lên và một khóa bí mật của riêng nó.
 *  2. Điện thoại (sender) nhập mã -> nhận khóa bí mật của riêng nó. Mã chỉ dùng một lần, hết hạn sau vài phút.
 *  3. Hai máy gửi/nhận tin kết nối WebRTC (offer/answer/ice/bye) qua máy chủ bằng khóa của mình.
 * Hình ảnh màn hình KHÔNG đi qua máy chủ. Máy chủ chỉ lưu bản băm của khóa.
 */
final class CastService
{
    public const KINDS = ['offer', 'answer', 'ice', 'bye'];
    public const MAX_PAYLOAD = 16000;      // byte; SDP của kênh dữ liệu chỉ khoảng 1-2 KB
    public const MAX_SIGNALS = 3000;       // mỗi phiên; chặn máy gửi vô hạn

    private CastRepository $repo;

    public function __construct(CastRepository $repo)
    {
        $this->repo = $repo;
    }

    public static function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    private function assertEnabled(): void
    {
        if (!Config::get('cast.enabled', true)) {
            throw new HttpException(503, 'CAST_DISABLED', 'Chức năng chiếu màn hình đang tắt.');
        }
    }

    private function iceServers(): array
    {
        $urls = (array) Config::get('cast.stun_urls', []);
        return $urls === [] ? [] : [['urls' => array_values($urls)]];
    }

    /** Màn hình xe tạo phiên chờ. */
    public function create(string $ip): array
    {
        $this->assertEnabled();
        $ttl = (int) Config::get('cast.code_ttl_seconds', 300);
        $code = null;
        for ($i = 0; $i < 20; $i++) {
            $try = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            if (!$this->repo->codeInUse($try)) {
                $code = $try;
                break;
            }
        }
        if ($code === null) {
            throw new HttpException(503, 'CAST_BUSY', 'Đang có quá nhiều máy ghép nối. Vui lòng thử lại sau ít phút.');
        }
        $token = bin2hex(random_bytes(24));
        $id = $this->repo->create(
            $code,
            self::hash($token),
            $ip,
            date('Y-m-d H:i:s', time() + $ttl),
            date('Y-m-d H:i:s', time() + 3600 * (int) Config::get('cast.session_hours', 12))
        );
        return ['id' => $id, 'code' => $code, 'token' => $token, 'role' => 'receiver', 'expires_in' => $ttl, 'ice_servers' => $this->iceServers()];
    }

    /** Điện thoại nhập mã đang hiện trên màn hình xe. */
    public function join(string $code, string $deviceName, string $ip): array
    {
        $this->assertEnabled();
        $invalid = new HttpException(404, 'CAST_CODE_INVALID', 'Mã không đúng hoặc đã hết hạn. Hãy xem lại mã trên màn hình xe.');
        if (!preg_match('/^[0-9]{6}$/', $code)) {
            throw $invalid;
        }
        $row = $this->repo->findWaitingByCode($code);
        if ($row === null) {
            throw $invalid;
        }
        $token = bin2hex(random_bytes(24));
        if (!$this->repo->pair((int) $row['id'], self::hash($token), $deviceName, $ip)) {
            throw $invalid;   // vừa có điện thoại khác nhập mã này
        }
        return ['id' => (int) $row['id'], 'token' => $token, 'role' => 'sender', 'ice_servers' => $this->iceServers()];
    }

    /**
     * Kiểm tra khóa của người gọi. Trả về [dòng phiên, vai trò].
     * Phiên đã kết thúc hoặc quá hạn: lỗi 410 CAST_ENDED (kèm ai kết thúc) để máy kia biết mà dừng.
     */
    public function authorize(int $id, string $token): array
    {
        $row = $id > 0 && $token !== '' ? $this->repo->find($id) : null;
        $role = null;
        if ($row !== null) {
            $h = self::hash($token);
            if (hash_equals((string) $row['receiver_hash'], $h)) {
                $role = 'receiver';
            } elseif ($row['sender_hash'] !== null && hash_equals((string) $row['sender_hash'], $h)) {
                $role = 'sender';
            }
        }
        if ($role === null) {
            throw new HttpException(404, 'CAST_NOT_FOUND', 'Không tìm thấy phiên chiếu màn hình.');
        }
        if ($row['status'] !== 'ended') {
            $now = date('Y-m-d H:i:s');
            $codeDead = $row['status'] === 'waiting' && (string) $row['code_expires_at'] <= $now;
            if ($codeDead || (string) $row['expires_at'] <= $now) {
                $this->repo->end($id, 'expired');
                $row['status'] = 'ended';
                $row['ended_by'] = 'expired';
            }
        }
        if ($row['status'] === 'ended') {
            throw new HttpException(410, 'CAST_ENDED', 'Phiên chiếu màn hình đã kết thúc.', ['ended_by' => (string) ($row['ended_by'] ?? '')]);
        }
        return [$row, $role];
    }

    /** Gửi một tin kết nối cho máy bên kia. $payload: mảng (sẽ lưu dạng JSON). */
    public function push(int $id, string $token, string $kind, $payload): int
    {
        [$row, $role] = $this->authorize($id, $token);
        if ($row['status'] !== 'paired') {
            throw new HttpException(409, 'CAST_NOT_PAIRED', 'Chưa có điện thoại nào nhập mã.');
        }
        if (!in_array($kind, self::KINDS, true) || !is_array($payload)) {
            throw HttpException::validation(['kind' => 'Tin kết nối không hợp lệ.']);
        }
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false || strlen($json) > self::MAX_PAYLOAD) {
            throw HttpException::validation(['payload' => 'Tin kết nối quá lớn.']);
        }
        if ($this->repo->countSignals($id) >= self::MAX_SIGNALS) {
            throw new HttpException(429, 'CAST_TOO_MANY', 'Phiên này đã trao đổi quá nhiều lần. Hãy ghép nối lại.');
        }
        return $this->repo->addSignal($id, $role, $kind, $json);
    }

    /** Lấy tin máy bên kia gửi sau tin số $after, kèm trạng thái phiên. */
    public function pull(int $id, string $token, int $after): array
    {
        [$row, $role] = $this->authorize($id, $token);
        $signals = [];
        foreach ($this->repo->signalsFor($id, $role, max(0, $after)) as $s) {
            $data = json_decode((string) $s['payload'], true);
            $signals[] = ['id' => (int) $s['id'], 'kind' => (string) $s['kind'], 'payload' => is_array($data) ? $data : []];
        }
        $out = ['status' => (string) $row['status'], 'role' => $role, 'device_name' => (string) $row['device_name'], 'signals' => $signals];
        if ($row['status'] === 'waiting') {
            $out['code_expires_in'] = max(0, strtotime((string) $row['code_expires_at']) - time());
        }
        return $out;
    }

    public function end(int $id, string $token): void
    {
        try {
            [, $role] = $this->authorize($id, $token);
        } catch (HttpException $e) {
            if ($e->errorCode === 'CAST_ENDED') {
                return;   // đã kết thúc rồi: coi như xong
            }
            throw $e;
        }
        $this->repo->end($id, $role);
    }
}
