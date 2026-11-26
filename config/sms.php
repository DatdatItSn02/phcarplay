<?php
declare(strict_types=1);

use App\Core\Env;

// Giai đoạn 14: gửi mã OTP qua SMS. Hiện CHƯA tích hợp nhà cung cấp SMS nào.
//   none - tắt (mặc định): mã OTP chỉ gửi qua email
//   log  - ghi tin nhắn ra storage/logs/sms.log (để thử khi phát triển)
// Khi có nhà cung cấp SMS: thêm driver trong app/Services/SmsSender.php và các khóa cấu hình ở đây.
return [
    'driver' => Env::get('SMS_DRIVER', 'none'),
];
