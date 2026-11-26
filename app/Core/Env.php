<?php
declare(strict_types=1);

namespace App\Core;

/** Đọc file .env (KEY=VALUE) và biến môi trường của hệ thống. */
final class Env
{
    /** @var array<string,string> */
    private static array $vars = [];

    public static function load(string $file): void
    {
        if (!is_file($file)) {
            return;
        }
        $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#') {
                continue;
            }
            $pos = strpos($line, '=');
            if ($pos === false) {
                continue;
            }
            $key = trim(substr($line, 0, $pos));
            $val = trim((string) substr($line, $pos + 1));   // PHP 7.4: substr có thể trả false khi giá trị rỗng
            $len = strlen($val);
            if ($len >= 2) {
                $first = $val[0];
                $last = $val[$len - 1];
                if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
                    $val = (string) substr($val, 1, -1);   // PHP 7.4: trả false nếu chuỗi trong ngoặc rỗng
                }
            }
            self::$vars[$key] = $val;
        }
    }

    public static function set(string $key, string $value): void
    {
        self::$vars[$key] = $value;
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        if (array_key_exists($key, self::$vars)) {
            return self::$vars[$key];
        }
        $v = getenv($key);
        return $v === false ? $default : $v;
    }

    public static function bool(string $key, bool $default = false): bool
    {
        $v = self::get($key);
        if ($v === null || $v === '') {
            return $default;
        }
        return in_array(strtolower($v), ['1', 'true', 'yes', 'on'], true);
    }

    public static function int(string $key, int $default = 0): int
    {
        $v = self::get($key);
        return ($v === null || $v === '' || !is_numeric($v)) ? $default : (int) $v;
    }
}
