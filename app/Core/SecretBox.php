<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Mã hóa chuỗi bí mật (khóa API của người dùng) trước khi lưu vào database: AES-256-GCM, khóa lấy từ APP_KEY trong .env.
 * Lộ file database mà không có .env thì không đọc được khóa. Đổi APP_KEY thì các khóa đã lưu không giải mã được nữa
 * (người dùng chỉ cần nhập lại).
 * Dạng lưu: "v1:" + base64(iv 12 byte | tag 16 byte | dữ liệu mã hóa).
 */
final class SecretBox
{
    private string $key;

    public function __construct(string $appKey)
    {
        $appKey = trim($appKey);
        if (strncmp($appKey, 'base64:', 7) === 0) {
            $raw = base64_decode(substr($appKey, 7), true);
            $appKey = $raw === false ? $appKey : $raw;
        }
        if (strlen($appKey) < 16) {
            throw new \InvalidArgumentException('APP_KEY quá ngắn (cần ít nhất 16 ký tự).');
        }
        $this->key = hash('sha256', 'carweb-secretbox|' . $appKey, true);
    }

    /** Có đủ điều kiện để mã hóa không (APP_KEY đủ dài và PHP có openssl). */
    public static function available(string $appKey): bool
    {
        if (!function_exists('openssl_encrypt')) {
            return false;
        }
        try {
            new self($appKey);
            return true;
        } catch (\InvalidArgumentException $e) {
            return false;
        }
    }

    /** Tạo một APP_KEY ngẫu nhiên (dùng cho bin/doctor.php gợi ý). */
    public static function generateKey(): string
    {
        return 'base64:' . base64_encode(random_bytes(32));
    }

    public function encrypt(string $plain): string
    {
        $iv = random_bytes(12);
        $tag = '';
        $ct = openssl_encrypt($plain, 'aes-256-gcm', $this->key, OPENSSL_RAW_DATA, $iv, $tag, 'v1', 16);
        if ($ct === false) {
            throw new \RuntimeException('Không mã hóa được.');
        }
        return 'v1:' . base64_encode($iv . $tag . $ct);
    }

    /** null nếu dữ liệu hỏng hoặc APP_KEY đã đổi. */
    public function decrypt(string $box): ?string
    {
        if (strncmp($box, 'v1:', 3) !== 0) {
            return null;
        }
        $raw = base64_decode(substr($box, 3), true);
        if ($raw === false || strlen($raw) < 29) {
            return null;
        }
        $plain = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', $this->key, OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16), 'v1');
        return $plain === false ? null : $plain;
    }
}
