<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Đọc cấu hình từ thư mục config/. Cú pháp: Config::get('mail.smtp.host').
 * Phần đầu là tên file (config/mail.php), phần sau là khóa lồng nhau.
 */
final class Config
{
    /** @var array<string,array> */
    private static array $cache = [];

    public static function get(string $key, $default = null)
    {
        $parts = explode('.', $key);
        $file = array_shift($parts);
        if (!isset(self::$cache[$file])) {
            $path = BASE_PATH . '/config/' . $file . '.php';
            self::$cache[$file] = is_file($path) ? (require $path) : [];
        }
        $value = self::$cache[$file];
        foreach ($parts as $part) {
            if (!is_array($value) || !array_key_exists($part, $value)) {
                return $default;
            }
            $value = $value[$part];
        }
        return $value;
    }

    /** Dùng trong kiểm thử: thay toàn bộ cấu hình của một file. */
    public static function override(string $file, array $values): void
    {
        self::$cache[$file] = $values;
    }

    public static function reset(): void
    {
        self::$cache = [];
    }
}
