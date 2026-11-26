<?php
declare(strict_types=1);

/** Bộ chạy kiểm thử rất nhỏ (không cần PHPUnit). */
define('BASE_PATH', dirname(__DIR__));
require BASE_PATH . '/app/bootstrap.php';

// Bộ đếm chống dò mật khẩu (RateLimiter) ghi vào thư mục tạm riêng của lần chạy này, không đụng storage/ của website.
App\Core\Env::set('RATE_LIMIT_DIR', sys_get_temp_dir() . '/carweb-test-ratelimit-' . getmypid() . '-' . bin2hex(random_bytes(3)));

$GLOBALS['__tests'] = [];
$GLOBALS['__fail'] = 0;

function test(string $name, callable $fn): void
{
    $GLOBALS['__tests'][] = [$name, $fn];
}

function assertSame($expected, $actual, string $msg = ''): void
{
    if ($expected !== $actual) {
        throw new RuntimeException(($msg !== '' ? $msg . ': ' : '') . 'mong đợi ' . var_export($expected, true) . ', nhận ' . var_export($actual, true));
    }
}

function assertTrue($cond, string $msg = 'điều kiện sai'): void
{
    if ($cond !== true) {
        throw new RuntimeException($msg);
    }
}

/** Tương đương str_contains (PHP 8) để chạy được trên PHP 7.4. */
function contains(string $haystack, string $needle): bool
{
    return strpos($haystack, $needle) !== false;
}

function assertThrows(callable $fn, string $errorCode, string $msg = ''): void
{
    try {
        $fn();
    } catch (App\Core\HttpException $e) {
        assertSame($errorCode, $e->errorCode, $msg);
        return;
    }
    throw new RuntimeException(($msg !== '' ? $msg . ': ' : '') . 'đáng lẽ phải ném lỗi ' . $errorCode);
}

function runAll(): int
{
    foreach ($GLOBALS['__tests'] as [$name, $fn]) {
        try {
            $fn();
            echo "  ok    {$name}\n";
        } catch (Throwable $e) {
            $GLOBALS['__fail']++;
            echo "  FAIL  {$name}\n        " . $e->getMessage() . "\n";
        }
    }
    $total = count($GLOBALS['__tests']);
    echo "\n" . ($total - $GLOBALS['__fail']) . "/{$total} đạt\n";
    return $GLOBALS['__fail'] === 0 ? 0 : 1;
}
