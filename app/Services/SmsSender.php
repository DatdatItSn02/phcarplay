<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Config;

/**
 * Gửi tin nhắn SMS (mã OTP). Driver chọn trong config/sms.php (SMS_DRIVER trong .env):
 *   none - tắt (mặc định, chưa tích hợp nhà cung cấp SMS)
 *   log  - ghi ra storage/logs/sms.log
 * Thêm nhà cung cấp thật: thêm một nhánh trong send() (gọi API của nhà cung cấp) và cho enabled() trả true.
 */
final class SmsSender
{
    private ?string $driver;

    public function __construct(?string $driver = null)
    {
        $this->driver = $driver;
    }

    private function driver(): string
    {
        return $this->driver ?? (string) Config::get('sms.driver', 'none');
    }

    public function enabled(): bool
    {
        return in_array($this->driver(), ['log'], true);
    }

    public function send(string $phone, string $text): void
    {
        switch ($this->driver()) {
            case 'log':
                $dir = BASE_PATH . '/storage/logs';
                if (!is_dir($dir)) {
                    @mkdir($dir, 0775, true);
                }
                file_put_contents($dir . '/sms.log', date('Y-m-d H:i:s') . ' tới ' . $phone . ': ' . $text . "\n", FILE_APPEND);
                break;
            default:
                throw new \RuntimeException('Chưa bật gửi SMS (SMS_DRIVER=none).');
        }
    }
}
