<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Config;
use App\Core\Env;
use App\Core\HttpException;
use App\Core\Logger;

/**
 * Đếm số lần thử trong một khoảng thời gian (cửa sổ cố định) để chặn dò mật khẩu, spam thư, gọi API dồn dập.
 * Lưu bằng file nhỏ trong storage/cache/ratelimit (không cần database, không cần migration).
 * Lỗi ghi file thì cho qua (không chặn người dùng thật chỉ vì máy chủ hết chỗ hay sai quyền thư mục).
 * Tắt toàn bộ bằng RATE_LIMIT=false trong .env.
 */
final class RateLimiter
{
    private string $dir;
    /** @var callable(): int */
    private $now;
    private ?bool $enabled;

    public function __construct(?string $dir = null, ?callable $now = null, ?bool $enabled = null)
    {
        $fromEnv = (string) Env::get('RATE_LIMIT_DIR', '');   // dùng khi kiểm thử để mỗi lần chạy có thư mục riêng
        $this->dir = $dir ?? ($fromEnv !== '' ? $fromEnv : BASE_PATH . '/storage/cache/ratelimit');
        $this->now = $now ?? static function (): int {
            return time();
        };
        $this->enabled = $enabled;
    }

    public function enabled(): bool
    {
        return $this->enabled ?? (bool) Config::get('app.security.rate_limit', true);
    }

    /** Số giây còn phải chờ nếu khóa đã đạt giới hạn $max trong cửa sổ $window giây (0 = được phép). */
    public function blockedFor(string $key, int $max, int $window): int
    {
        if (!$this->enabled() || $max <= 0) {
            return 0;
        }
        $entry = $this->read($this->file($key));
        $now = ($this->now)();
        if ($entry === null || $entry['start'] + $window <= $now || $entry['count'] < $max) {
            return 0;
        }
        return max(1, $entry['start'] + $window - $now);
    }

    /** Ghi thêm một lần cho khóa. Trả về số lần trong cửa sổ hiện tại (0 nếu đang tắt hoặc không ghi được). */
    public function hit(string $key, int $window): int
    {
        if (!$this->enabled()) {
            return 0;
        }
        if (!is_dir($this->dir) && !@mkdir($this->dir, 0775, true) && !is_dir($this->dir)) {
            return 0;
        }
        $file = $this->file($key);
        $fh = @fopen($file, 'c+');
        if ($fh === false) {
            return 0;
        }
        $count = 0;
        try {
            if (!flock($fh, LOCK_EX)) {
                return 0;
            }
            $now = ($this->now)();
            $entry = self::decode((string) stream_get_contents($fh));
            if ($entry === null || $entry['start'] + $window <= $now) {
                $entry = ['start' => $now, 'count' => 0];
            }
            $entry['count']++;
            $count = $entry['count'];
            ftruncate($fh, 0);
            rewind($fh);
            fwrite($fh, (string) json_encode($entry));
            fflush($fh);
            flock($fh, LOCK_UN);
        } finally {
            fclose($fh);
        }
        if (mt_rand(1, 200) === 1) {
            $this->collectGarbage();
        }
        return $count;
    }

    /** Đếm một lượt rồi kiểm tra: trả số giây phải chờ nếu lượt này vượt $max (0 = được phép). */
    public function consume(string $key, int $max, int $window): int
    {
        if (!$this->enabled() || $max <= 0) {
            return 0;
        }
        $count = $this->hit($key, $window);
        if ($count <= $max) {
            return 0;
        }
        return max(1, $this->blockedFor($key, $max, $window));
    }

    /** Đếm một lượt; vượt giới hạn thì ném lỗi 429. Dùng cho thao tác tính MỌI lượt (gửi thư, đăng ký, gọi API). */
    public function enforce(string $key, int $max, int $window, string $message = ''): void
    {
        $wait = $this->consume($key, $max, $window);
        if ($wait > 0) {
            throw self::tooMany($wait, $message);
        }
    }

    public function clear(string $key): void
    {
        @unlink($this->file($key));
    }

    /**
     * Ném lỗi 429 nếu một trong các luật đang bị chặn. $rules: [[khóa, số lần tối đa, cửa sổ giây], ...].
     * @param array<int,array{0:string,1:int,2:int}> $rules
     */
    public function guard(array $rules, string $message = ''): void
    {
        $wait = 0;
        foreach ($rules as $rule) {
            $wait = max($wait, $this->blockedFor($rule[0], (int) $rule[1], (int) $rule[2]));
        }
        if ($wait > 0) {
            throw self::tooMany($wait, $message);
        }
    }

    /** Lỗi 429 với thời gian chờ (giây) để giao diện hiện "thử lại sau N phút" và trình duyệt nhận header Retry-After. */
    public static function tooMany(int $seconds, string $message = ''): HttpException
    {
        $minutes = (int) max(1, (int) ceil($seconds / 60));
        $text = $message !== '' ? $message : 'Bạn đã thử quá nhiều lần.';
        return new HttpException(429, 'TOO_MANY_ATTEMPTS', $text . ' Vui lòng thử lại sau ' . $minutes . ' phút.', ['retry_after' => $seconds]);
    }

    private function file(string $key): string
    {
        return $this->dir . '/' . sha1($key) . '.json';
    }

    /** @return array{start:int,count:int}|null */
    private function read(string $file): ?array
    {
        if (!is_file($file)) {
            return null;
        }
        $raw = @file_get_contents($file);
        return $raw === false ? null : self::decode($raw);
    }

    /** @return array{start:int,count:int}|null */
    private static function decode(string $raw): ?array
    {
        $data = json_decode($raw, true);
        if (!is_array($data) || !isset($data['start'], $data['count']) || !is_int($data['start']) || !is_int($data['count'])) {
            return null;
        }
        return ['start' => $data['start'], 'count' => $data['count']];
    }

    /** Thỉnh thoảng xóa các file cũ hơn một ngày để thư mục không phình ra. */
    private function collectGarbage(): void
    {
        $limit = ($this->now)() - 86400;
        foreach (glob($this->dir . '/*.json') ?: [] as $file) {
            $mtime = @filemtime($file);
            if ($mtime !== false && $mtime < $limit) {
                @unlink($file);
            }
        }
    }

    /** Ghi lại lúc bị chặn để quản trị biết có người đang dò (không ghi khóa gốc vì có thể chứa email). */
    public static function logBlocked(string $what, string $ip): void
    {
        Logger::info('Chặn tạm vì thử quá nhiều lần: ' . $what, ['ip' => $ip]);
    }
}
