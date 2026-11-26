<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Config;

/**
 * Trả lời câu hỏi "người này được dùng tính năng nào?". Giao diện và API đều dựa vào đây.
 * Khi app.enforce_license = false (mặc định), ai cũng dùng được các tính năng cơ bản.
 * Khi bật: tài khoản chỉ dùng đủ tính năng khi còn hạn (users.expires_at), nếu không chỉ như khách.
 */
final class EntitlementService
{
    public const GUEST_FEATURES = ['youtube', 'pip', 'layout'];
    public const MEMBER_FEATURES = ['youtube', 'pip', 'layout', 'playlists_cloud'];

    /** @return array{plan:string,features:array<int,string>,expires_at:?string} */
    public function forUser(?array $user): array
    {
        if ($user === null) {
            return ['plan' => 'guest', 'features' => self::GUEST_FEATURES, 'expires_at' => null];
        }
        $expires = $user['expires_at'] ?? null;
        if (!Config::get('app.enforce_license', false)) {
            return ['plan' => 'member', 'features' => self::MEMBER_FEATURES, 'expires_at' => $expires];
        }
        $active = $expires !== null && strtotime((string) $expires) > time();
        return $active
            ? ['plan' => 'member', 'features' => self::MEMBER_FEATURES, 'expires_at' => $expires]
            : ['plan' => 'trial', 'features' => self::GUEST_FEATURES, 'expires_at' => $expires];
    }

    public function can(?array $user, string $feature): bool
    {
        return in_array($feature, $this->forUser($user)['features'], true);
    }
}
