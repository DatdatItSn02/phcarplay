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
 *
 * Giai đoạn 17 (đợt 2) - GHÉP ĐÔI MỘT LẦN: mỗi máy có một khóa thiết bị bí mật (48 ký tự hex, lưu trên chính máy đó) và
 * dùng nó làm khóa cho mọi phiên. Lần đầu điện thoại nhập mã của một màn hình xe gửi khóa thiết bị -> thành một cặp
 * (cast_pairs). Lần sau điện thoại bấm "Chia sẻ" -> share() tạo phiên không mã cho cặp đó; màn hình xe đã ghép đôi hỏi
 * incoming() vài giây một lần, thấy thì tự nhận và nối như cũ. "Quên thiết bị" ở một trong hai máy: forget() (xóa mềm).
 * Máy cũ không gửi khóa thiết bị vẫn chạy như giai đoạn 15 (khóa ngẫu nhiên từng phiên, không ghép đôi).
 */
final class CastService
{
    public const KINDS = ['offer', 'answer', 'ice', 'bye'];
    public const MAX_PAYLOAD = 16000;      // byte; SDP của kênh dữ liệu chỉ khoảng 1-2 KB
    public const MAX_SIGNALS = 3000;       // mỗi phiên; chặn máy gửi vô hạn
    public const MAX_PAIRS = 20;           // mỗi máy; quá thì vẫn chiếu được nhưng không ghép đôi thêm
    public const REQUEST_TTL = 120;        // giây: lời mời "Chia sẻ" chờ màn hình xe nhận tối đa bao lâu
    public const RECEIVER_FALLBACK = 'Màn hình xe';
    public const SENDER_FALLBACK = 'Điện thoại';

    private CastRepository $repo;

    public function __construct(CastRepository $repo)
    {
        $this->repo = $repo;
    }

    public static function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    /** Khóa thiết bị hợp lệ (48 ký tự hex) thì trả về chính nó, ngược lại ''. */
    public static function deviceKey($value): string
    {
        return is_string($value) && preg_match('/^[a-f0-9]{48}$/', $value) === 1 ? $value : '';
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

    /**
     * Màn hình xe tạo phiên chờ. Có khóa thiết bị ($deviceKey) thì phiên này ghép đôi được và máy dùng chính khóa đó
     * (không trả khóa mới); $deviceName là tên màn hình xe để hiện bên điện thoại.
     */
    public function create(string $ip, string $deviceKey = '', string $deviceName = ''): array
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
        $token = $deviceKey !== '' ? null : bin2hex(random_bytes(24));
        $id = $this->repo->create(
            $code,
            self::hash($deviceKey !== '' ? $deviceKey : (string) $token),
            $ip,
            date('Y-m-d H:i:s', time() + $ttl),
            $this->sessionExpiry(),
            $deviceKey !== '' ? 0 : null,
            $deviceKey !== '' ? $deviceName : ''
        );
        $out = ['id' => $id, 'code' => $code, 'role' => 'receiver', 'expires_in' => $ttl, 'ice_servers' => $this->iceServers()];
        if ($token !== null) {
            $out['token'] = $token;
        }
        return $out;
    }

    private function sessionExpiry(): string
    {
        return date('Y-m-d H:i:s', time() + 3600 * (int) Config::get('cast.session_hours', 12));
    }

    /**
     * Điện thoại nhập mã đang hiện trên màn hình xe. Có khóa thiết bị và màn hình xe ghép đôi được thì hai máy thành một
     * cặp (hoặc dùng lại cặp cũ): trả kèm pair = { id, name } (tên màn hình xe).
     */
    public function join(string $code, string $deviceName, string $ip, string $deviceKey = ''): array
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
        $token = $deviceKey !== '' ? null : bin2hex(random_bytes(24));
        $senderHash = self::hash($deviceKey !== '' ? $deviceKey : (string) $token);
        $receiverName = (string) $row['device_name'];   // lúc chờ, device_name giữ tên màn hình xe
        if (!$this->repo->pair((int) $row['id'], $senderHash, $deviceName, $ip)) {
            throw $invalid;   // vừa có điện thoại khác nhập mã này
        }
        $out = ['id' => (int) $row['id'], 'role' => 'sender', 'ice_servers' => $this->iceServers(), 'pair' => null];
        if ($token !== null) {
            $out['token'] = $token;
        }
        $pairable = $row['pair_id'] !== null && (int) $row['pair_id'] === 0;
        if ($deviceKey !== '' && $pairable && !hash_equals((string) $row['receiver_hash'], $senderHash)) {
            $pairId = $this->pairUp((string) $row['receiver_hash'], $senderHash, $receiverName, $deviceName, $ip);
            if ($pairId > 0) {
                $this->repo->setSessionPair((int) $row['id'], $pairId);
                $out['pair'] = ['id' => $pairId, 'name' => $receiverName !== '' ? $receiverName : self::RECEIVER_FALLBACK];
            }
        }
        return $out;
    }

    /** Hai máy thành một cặp (dùng lại cặp cũ nếu đã có). Trả về 0 nếu một trong hai máy đã có quá nhiều cặp. */
    private function pairUp(string $receiverHash, string $senderHash, string $receiverName, string $senderName, string $ip): int
    {
        $old = $this->repo->findActivePair($receiverHash, $senderHash);
        if ($old !== null) {
            $this->repo->touchPair((int) $old['id'], $receiverName, $senderName);
            return (int) $old['id'];
        }
        if ($this->repo->countActivePairs($receiverHash) >= self::MAX_PAIRS || $this->repo->countActivePairs($senderHash) >= self::MAX_PAIRS) {
            return 0;
        }
        return $this->repo->createPair($receiverHash, $senderHash, $receiverName, $senderName, $ip);
    }

    /** Vai trò của khóa thiết bị trong một cặp còn dùng: 'receiver' | 'sender'; không phải của mình thì lỗi 404. */
    private function pairRole(?array $pair, string $deviceKey): string
    {
        if ($pair !== null && $deviceKey !== '' && $pair['deleted_at'] === null) {
            $h = self::hash($deviceKey);
            if (hash_equals((string) $pair['receiver_hash'], $h)) {
                return 'receiver';
            }
            if (hash_equals((string) $pair['sender_hash'], $h)) {
                return 'sender';
            }
        }
        throw new HttpException(404, 'CAST_PAIR_NOT_FOUND', 'Không tìm thấy máy đã ghép đôi (có thể máy bên kia đã bấm "Quên"). Hãy ghép đôi lại bằng mã trên màn hình xe.');
    }

    private static function invalidDevice(): HttpException
    {
        return HttpException::validation(['device' => 'Thiếu hoặc sai khóa thiết bị.']);
    }

    /** Danh sách máy đã ghép đôi với máy này (tên là tên của máy BÊN KIA), dùng gần nhất trước. */
    public function pairs(string $deviceKey): array
    {
        if ($deviceKey === '') {
            throw self::invalidDevice();
        }
        $h = self::hash($deviceKey);
        $list = [];
        foreach ($this->repo->pairsFor($h) as $p) {
            $isReceiver = hash_equals((string) $p['receiver_hash'], $h);
            $name = (string) ($isReceiver ? $p['sender_name'] : $p['receiver_name']);
            $list[] = [
                'id' => (int) $p['id'],
                'role' => $isReceiver ? 'receiver' : 'sender',
                'name' => $name !== '' ? $name : ($isReceiver ? self::SENDER_FALLBACK : self::RECEIVER_FALLBACK),
                'created_at' => (string) $p['created_at'],
                'last_used_at' => (string) ($p['last_used_at'] ?? ''),
            ];
        }
        return ['pairs' => $list, 'poll_seconds' => (int) Config::get('cast.poll_seconds', 3)];
    }

    /**
     * Điện thoại bấm "Chia sẻ" tới một màn hình xe đã ghép đôi: tạo phiên không mã (đã ghép sẵn hai máy) và ghi lời mời
     * để màn hình xe nhận. Lời mời cũ chưa ai nhận của cùng cặp thì kết thúc luôn.
     */
    public function share(int $pairId, string $deviceKey, string $deviceName, string $ip): array
    {
        $this->assertEnabled();
        if ($deviceKey === '') {
            throw self::invalidDevice();
        }
        $pair = $pairId > 0 ? $this->repo->findPair($pairId) : null;
        if ($this->pairRole($pair, $deviceKey) !== 'sender') {
            throw new HttpException(403, 'CAST_NOT_SENDER', 'Chỉ điện thoại mới chia sẻ được màn hình tới màn hình xe.');
        }
        $old = (int) ($pair['request_session_id'] ?? 0);
        if ($old > 0) {
            $this->repo->end($old, 'sender');
        }
        $name = $deviceName !== '' ? $deviceName : (string) $pair['sender_name'];
        $id = $this->repo->createPairSession($pairId, (string) $pair['receiver_hash'], (string) $pair['sender_hash'], $name, $ip, $this->sessionExpiry());
        $this->repo->setRequest($pairId, $id, $deviceName);
        $receiverName = (string) $pair['receiver_name'];
        return ['id' => $id, 'role' => 'sender', 'ice_servers' => $this->iceServers(),
            'pair' => ['id' => $pairId, 'name' => $receiverName !== '' ? $receiverName : self::RECEIVER_FALLBACK]];
    }

    /**
     * Màn hình xe đã ghép đôi hỏi định kỳ: có điện thoại nào vừa bấm "Chia sẻ" không? Có thì nhận luôn (một lần) và trả
     * về phiên để nối. Kèm số cặp còn dùng: 0 thì màn hình xe thôi hỏi.
     */
    public function incoming(string $deviceKey): array
    {
        $this->assertEnabled();
        if ($deviceKey === '') {
            throw self::invalidDevice();
        }
        $h = self::hash($deviceKey);
        $rows = $this->repo->receiverPairs($h);
        $incoming = null;
        $fresh = date('Y-m-d H:i:s', time() - self::REQUEST_TTL);
        $now = date('Y-m-d H:i:s');
        foreach ($rows as $p) {
            $sid = (int) ($p['request_session_id'] ?? 0);
            if ($sid <= 0 || !$this->repo->claimRequest((int) $p['id'], $sid)) {
                continue;
            }
            if ((string) ($p['request_at'] ?? '') < $fresh) {
                continue;   // lời mời quá cũ (điện thoại đã thôi chờ): bỏ
            }
            $s = $this->repo->find($sid);
            if ($s !== null && $s['status'] === 'paired' && hash_equals((string) $s['receiver_hash'], $h) && (string) $s['expires_at'] > $now) {
                $incoming = ['id' => $sid, 'device_name' => (string) $s['device_name'], 'pair_id' => (int) $p['id']];
                break;
            }
        }
        return [
            'pairs' => count($rows),
            'incoming' => $incoming,
            'ice_servers' => $incoming !== null ? $this->iceServers() : [],
            'poll_seconds' => (int) Config::get('cast.poll_seconds', 3),
        ];
    }

    /** "Quên thiết bị" ở một trong hai máy: đánh dấu xóa (không xóa dòng), lời mời đang chờ thì kết thúc. */
    public function forget(int $pairId, string $deviceKey): void
    {
        if ($deviceKey === '') {
            throw self::invalidDevice();
        }
        $pair = $pairId > 0 ? $this->repo->findPair($pairId) : null;
        if ($pair !== null && $pair['deleted_at'] !== null) {
            $h = self::hash($deviceKey);
            if (hash_equals((string) $pair['receiver_hash'], $h) || hash_equals((string) $pair['sender_hash'], $h)) {
                return;   // đã quên rồi: coi như xong
            }
        }
        $role = $this->pairRole($pair, $deviceKey);
        $pending = (int) ($pair['request_session_id'] ?? 0);
        if ($this->repo->forgetPair($pairId, $role) && $pending > 0) {
            $this->repo->end($pending, $role);
        }
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
        // lúc chờ nhập mã, device_name tạm giữ tên màn hình xe: chưa có điện thoại thì không trả
        $out = ['status' => (string) $row['status'], 'role' => $role, 'device_name' => $row['status'] === 'waiting' ? '' : (string) $row['device_name'], 'signals' => $signals];
        if ($row['status'] === 'waiting') {
            $out['code_expires_in'] = max(0, strtotime((string) $row['code_expires_at']) - time());
        }
        $pairId = (int) ($row['pair_id'] ?? 0);
        if ($pairId > 0) {
            $out['pair_id'] = $pairId;
            if ($role === 'sender' && (string) $row['code'] === '') {
                // phiên do bấm "Chia sẻ": màn hình xe đã nhận lời mời chưa (để điện thoại báo đúng lý do nếu chờ lâu)
                $pair = $this->repo->findPair($pairId);
                $out['picked'] = $pair === null || (int) ($pair['request_session_id'] ?? 0) !== $id;
            }
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
