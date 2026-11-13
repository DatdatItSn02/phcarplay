<?php
declare(strict_types=1);

namespace App\Services;

/**
 * Gọi API của Invidious (config/invidious.php, INVIDIOUS_API_URLS) - nguồn dự phòng khi Piped không trả lời.
 * Cách thử địa chỉ, tạm bỏ qua địa chỉ hỏng và bộ nhớ đệm: xem UpstreamClient.
 */
final class InvidiousClient extends UpstreamClient
{
    public function kind(): string
    {
        return 'invidious';
    }

    public function label(): string
    {
        return 'Invidious';
    }
}
