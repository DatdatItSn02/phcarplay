<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Config;

/**
 * Chống dò mật khẩu khi đăng nhập.
 *
 * MẶC ĐỊNH TẮT, theo quyết định của chủ dự án: không giới hạn số lần đăng nhập sai.
 * Bật bằng LOGIN_THROTTLE=true trong .env. Khi bật, chỉ đếm lần SAI, theo ba khóa:
 *   - email + IP: chặn một máy thử liên tục một tài khoản (mức thấp nhất);
 *   - email: chặn dò một tài khoản từ nhiều máy (mức cao hơn để kẻ xấu khó khóa tài khoản của người khác);
 *   - IP: chặn một máy thử nhiều tài khoản (mức cao để nhiều xe dùng chung IP của nhà mạng không bị ảnh hưởng).
 * Đăng nhập đúng thì xóa bộ đếm email + IP của máy đó.
 *
 * Kể cả khi tắt, bộ đếm vẫn chạy cho trang quản trị để ghi nhật ký có giới hạn (không làm bảng nhật ký phình to khi bị dò).
 */
final class LoginThrottle
{
    /** Cửa sổ đếm: 15 phút. */
    public const WINDOW = 900;
    /** [email+IP, email, IP] lần sai tối đa trong cửa sổ. */
    public const LIMITS = [
        'user' => [10, 30, 60],
        'admin' => [5, 20, 30],
    ];

    private RateLimiter $limiter;
    private ?bool $enabled;

    public function __construct(RateLimiter $limiter, ?bool $enabled = null)
    {
        $this->limiter = $limiter;
        $this->enabled = $enabled;
    }

    public function enabled(): bool
    {
        return $this->enabled ?? (bool) Config::get('app.security.login_throttle', false);
    }

    /** Ném lỗi 429 nếu đang bị tạm chặn (gọi TRƯỚC khi kiểm tra mật khẩu). Không làm gì khi đang tắt. */
    public function check(string $scope, string $email, string $ip): void
    {
        if (!$this->enabled()) {
            return;
        }
        $this->limiter->guard($this->rules($scope, $email, $ip), 'Bạn đã nhập sai quá nhiều lần.');
    }

    /**
     * Ghi một lần sai.
     *  log:     nên ghi nhật ký lần này (chỉ vài lần đầu của mỗi email+IP và mỗi IP trong cửa sổ, chống phình nhật ký);
     *  reached: lần này vừa chạm một ngưỡng (để ghi một dòng "sai nhiều lần"/"tạm chặn").
     * @return array{log:bool,reached:bool}
     */
    public function failed(string $scope, string $email, string $ip): array
    {
        $rules = $this->rules($scope, $email, $ip);
        $counts = [];
        $reached = false;
        foreach ($rules as [$key, $max, $window]) {
            $n = $this->limiter->hit($key, $window);
            $counts[] = $n;
            if ($n === $max) {
                $reached = true;
            }
        }
        if ($reached && $this->enabled()) {
            RateLimiter::logBlocked('đăng nhập ' . $scope, $ip);
        }
        return [
            'log' => $counts[0] <= $rules[0][1] && $counts[2] <= $rules[2][1],
            'reached' => $reached,
        ];
    }

    public function succeeded(string $scope, string $email, string $ip): void
    {
        $this->limiter->clear($this->key($scope, 'ei', $email . '|' . $ip));
    }

    /** @return array<int,array{0:string,1:int,2:int}> */
    private function rules(string $scope, string $email, string $ip): array
    {
        $l = self::LIMITS[$scope] ?? self::LIMITS['user'];
        return [
            [$this->key($scope, 'ei', $email . '|' . $ip), $l[0], self::WINDOW],
            [$this->key($scope, 'e', $email), $l[1], self::WINDOW],
            [$this->key($scope, 'i', $ip), $l[2], self::WINDOW],
        ];
    }

    private function key(string $scope, string $kind, string $value): string
    {
        return 'login:' . $scope . ':' . $kind . ':' . strtolower($value);
    }
}
