<?php
declare(strict_types=1);

namespace App\Services;

/**
 * Băm mật khẩu theo yêu cầu dự án: md5( md5(mật_khẩu) . salt ).
 * Mỗi tài khoản có một salt ngẫu nhiên riêng (16 ký tự hex) lưu cùng bản ghi.
 *
 * Toàn bộ logic băm chỉ nằm trong file này. Muốn nâng cấp thuật toán sau này
 * (ví dụ password_hash) chỉ cần sửa file này.
 */
final class PasswordHasher
{
    public function generateSalt(): string
    {
        return bin2hex(random_bytes(8));
    }

    public function hash(string $password, string $salt): string
    {
        return md5(md5($password) . $salt);
    }

    public function verify(string $password, string $salt, string $hash): bool
    {
        return hash_equals(strtolower($hash), $this->hash($password, $salt));
    }
}
