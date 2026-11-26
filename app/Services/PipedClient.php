<?php
declare(strict_types=1);

namespace App\Services;

/**
 * Gọi API của Piped (config/piped.php, PIPED_API_URLS). Cách thử địa chỉ, tạm bỏ qua địa chỉ hỏng và bộ nhớ đệm: xem UpstreamClient.
 */
final class PipedClient extends UpstreamClient
{
    public function kind(): string
    {
        return 'piped';
    }

    public function label(): string
    {
        return 'Piped';
    }
}
