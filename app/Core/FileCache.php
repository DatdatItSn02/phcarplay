<?php
declare(strict_types=1);

namespace App\Core;

/** Bộ nhớ đệm đơn giản bằng file JSON trong storage/cache, có thời hạn (TTL). */
final class FileCache
{
    private string $dir;

    public function __construct(?string $dir = null)
    {
        $this->dir = $dir ?? (BASE_PATH . '/storage/cache');
    }

    /** Trả về dữ liệu đã lưu, hoặc null nếu chưa có / hết hạn. */
    public function get(string $key)
    {
        $file = $this->path($key);
        if (!is_file($file)) {
            return null;
        }
        $raw = @file_get_contents($file);
        $entry = $raw === false ? null : json_decode($raw, true);
        if (!is_array($entry) || !isset($entry['exp']) || $entry['exp'] < time()) {
            return null;
        }
        return $entry['data'] ?? null;
    }

    public function set(string $key, $value, int $ttl): void
    {
        if (!is_dir($this->dir)) {
            @mkdir($this->dir, 0775, true);
        }
        $file = $this->path($key);
        $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
        $json = json_encode(['exp' => time() + $ttl, 'data' => $value], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false || @file_put_contents($tmp, $json) === false) {
            return;
        }
        if (!@rename($tmp, $file)) {   // Windows có thể không ghi đè được file đang tồn tại
            @unlink($file);
            if (!@rename($tmp, $file)) {
                @unlink($tmp);
            }
        }
    }

    public function forget(string $key): void
    {
        @unlink($this->path($key));
    }

    private function path(string $key): string
    {
        return $this->dir . '/' . sha1($key) . '.json';
    }
}
