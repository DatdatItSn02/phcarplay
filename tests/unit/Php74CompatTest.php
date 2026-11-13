<?php
declare(strict_types=1);

/**
 * Canh chừng cú pháp/hàm chỉ có từ PHP 8 để code luôn chạy được trên PHP 7.4.
 * Quét bằng token_get_all (bỏ qua chú thích và chuỗi) nên không báo nhầm chữ nằm trong lời giải thích.
 * Đây chỉ là lưới an toàn: kết quả cuối cùng vẫn nên được chạy thử trên PHP 7.4 thật.
 */

/** @return array<int,string> danh sách "đường-dẫn:dòng: lý do" */
function php74Problems(string $code, string $label): array
{
    $problems = [];
    $banned = ['str_contains', 'str_starts_with', 'str_ends_with', 'array_is_list', 'get_debug_type', 'get_resource_id', 'fdiv', 'preg_last_error_msg'];
    $tokens = [];
    foreach (token_get_all($code) as $t) {
        if (is_array($t) && in_array($t[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $tokens[] = $t;
    }
    $text = function ($t): string { return is_array($t) ? $t[1] : $t; };
    $line = function ($t): int { return is_array($t) ? $t[2] : 0; };
    $n = count($tokens);
    for ($i = 0; $i < $n; $i++) {
        $t = $tokens[$i];
        $s = $text($t);
        $prev = $i > 0 ? $text($tokens[$i - 1]) : '';
        $next = $i + 1 < $n ? $text($tokens[$i + 1]) : '';
        $at = $label . ':' . $line($t) . ': ';

        if (is_array($t) && $t[0] === T_STRING) {
            $lower = strtolower($s);
            if (in_array($lower, $banned, true) && $prev !== '->' && $prev !== '::' && $prev !== 'function') {
                $problems[] = $at . 'hàm chỉ có từ PHP 8: ' . $s;
            }
            if ($lower === 'readonly' || $lower === 'mixed' || $lower === 'never') {
                $problems[] = $at . 'từ khóa/kiểu chỉ có từ PHP 8: ' . $s;
            }
            if ($lower === 'match' && $next === '(' && $prev !== '->' && $prev !== '::' && $prev !== 'function') {
                $problems[] = $at . 'biểu thức match (PHP 8)';
            }
        }
        if (defined('T_MATCH') && is_array($t) && $t[0] === constant('T_MATCH')) {
            $problems[] = $at . 'biểu thức match (PHP 8)';
        }
        if (defined('T_NULLSAFE_OBJECT_OPERATOR') && is_array($t) && $t[0] === constant('T_NULLSAFE_OBJECT_OPERATOR')) {
            $problems[] = $at . 'toán tử ?-> (PHP 8)';
        }
        if ($s === '?' && $next === '->') {
            $problems[] = $at . 'toán tử ?-> (PHP 8)';
        }
        if ($s === '|' && is_array($tokens[$i - 1] ?? null) && is_array($tokens[$i + 1] ?? null)
            && $tokens[$i - 1][0] === T_STRING && $tokens[$i + 1][0] === T_STRING
            && is_array($tokens[$i + 2] ?? null) && $tokens[$i + 2][0] === T_VARIABLE) {
            $problems[] = $at . 'kiểu hợp (union type, PHP 8)';
        }
        // Constructor promotion: từ khóa phạm vi nằm trong danh sách tham số của __construct
        if (is_array($t) && $t[0] === T_FUNCTION && $next === '__construct' && ($tokens[$i + 2] ?? null) === '(') {
            $depth = 0;
            for ($j = $i + 2; $j < $n; $j++) {
                $x = $tokens[$j];
                if ($x === '(') {
                    $depth++;
                } elseif ($x === ')') {
                    $depth--;
                    if ($depth === 0) {
                        break;
                    }
                } elseif (is_array($x) && in_array($x[0], [T_PUBLIC, T_PROTECTED, T_PRIVATE], true)) {
                    $problems[] = $label . ':' . $x[2] . ': constructor promotion (PHP 8)';
                }
            }
        }
        // catch (Loi) không có biến (PHP 8.0)
        if (is_array($t) && $t[0] === T_CATCH) {
            $hasVar = false;
            for ($j = $i + 2; $j < $n && $tokens[$j] !== ')'; $j++) {
                if (is_array($tokens[$j]) && $tokens[$j][0] === T_VARIABLE) {
                    $hasVar = true;
                }
            }
            if (!$hasVar) {
                $problems[] = $at . 'catch không có biến (PHP 8.0)';
            }
        }
        // throw dùng như biểu thức (PHP 8.0)
        if (is_array($t) && $t[0] === T_THROW && in_array($prev, ['??', '=>', '?', '&&', '||', ':'], true) && $prev !== ':') {
            $problems[] = $at . 'throw dùng như biểu thức (PHP 8.0)';
        }
        // kiểu trả về static
        if ($s === ':' && $prev === ')' && is_array($tokens[$i + 1] ?? null) && $tokens[$i + 1][0] === T_STATIC) {
            $problems[] = $at . 'kiểu trả về static (PHP 8.0)';
        }
    }
    foreach (preg_split('/\R/', $code) ?: [] as $idx => $rawLine) {
        if (preg_match('/^\s*#\[/', $rawLine) === 1) {
            $problems[] = $label . ':' . ($idx + 1) . ': attribute #[...] (PHP 8)';
        }
    }
    return $problems;
}

function php74Files(): array
{
    $files = [];
    foreach (['app', 'routes', 'config', 'bin', 'tests', 'database'] as $dir) {
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(BASE_PATH . '/' . $dir, FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
            if ($f->isFile() && substr($f->getFilename(), -4) === '.php') {
                $files[] = $f->getPathname();
            }
        }
    }
    $files[] = BASE_PATH . '/public/index.php';
    sort($files);
    return $files;
}

test('PHP 7.4: bộ quét nhận ra các cú pháp PHP 8 (kiểm tra chính bộ quét)', function () {
    $bad = <<<'CODE'
<?php
class A {
    public function __construct(private int $x, public ?string $y = null) {}
    public function m(int|string $v): static { return $this; }
}
$a = str_contains('abc', 'b');
$b = $obj?->name;
$c = match ($x) { 1 => 'a', default => 'b' };
try { f(); } catch (Exception) { }
$d = $v ?? throw new Exception('x');
CODE;
    $found = implode("\n", php74Problems($bad, 'mau'));
    foreach (['constructor promotion', 'union type', 'static', 'str_contains', '?->', 'match', 'catch không có biến', 'throw dùng như biểu thức'] as $needle) {
        assertTrue(contains($found, $needle), 'bộ quét bỏ sót: ' . $needle . "\n" . $found);
    }
    $good = "<?php\n// str_contains trong chú thích thì không sao\n\$s = 'match (x) readonly mixed';\ntry { f(); } catch (\\Exception \$e) { throw \$e; }\n\$v = \$a ?? 'x';\nfunction match_it(\$x) { return \$x; }\n";
    assertSame([], php74Problems($good, 'tot'));
});

test('PHP 7.4: toàn bộ mã PHP của dự án không dùng cú pháp/hàm chỉ có từ PHP 8', function () {
    $problems = [];
    foreach (php74Files() as $file) {
        $label = substr($file, strlen(BASE_PATH) + 1);
        $problems = array_merge($problems, php74Problems((string) file_get_contents($file), $label));
    }
    assertSame([], $problems, "\n" . implode("\n", $problems));
});
