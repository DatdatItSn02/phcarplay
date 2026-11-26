<?php
declare(strict_types=1);

/**
 * Tự kiểm tra máy chủ: chạy trước khi mở website cho người dùng và sau mỗi lần cập nhật.
 *   php bin/doctor.php             kiểm tra đầy đủ (kể cả gọi thử Piped và chính website qua APP_URL)
 *   php bin/doctor.php --offline   bỏ qua phần gọi qua mạng
 * Mỗi dòng: [OK] đúng, [GHI CHU] thông tin, [CHU Y] nên sửa, [LOI] phải sửa. Có [LOI] thì thoát với mã 1.
 */
require dirname(__DIR__) . '/app/bootstrap.php';

use App\Services\SystemCheck;

if (PHP_SAPI !== 'cli') {
    exit('Chỉ chạy bằng dòng lệnh.');
}

$online = !in_array('--offline', $argv, true);
$labels = [
    SystemCheck::OK => '[OK]      ',
    SystemCheck::NOTE => '[GHI CHU] ',
    SystemCheck::WARN => '[CHU Y]   ',
    SystemCheck::ERROR => '[LOI]     ',
];
echo 'PH Car Play - kiểm tra máy chủ' . PHP_EOL . str_repeat('-', 60) . PHP_EOL;
$items = (new SystemCheck())->run($online);
$count = [SystemCheck::OK => 0, SystemCheck::NOTE => 0, SystemCheck::WARN => 0, SystemCheck::ERROR => 0];
foreach ($items as [$level, $title, $detail]) {
    $count[$level]++;
    echo $labels[$level] . $title . PHP_EOL;
    if ($detail !== '' && $level !== SystemCheck::OK) {
        echo '          ' . $detail . PHP_EOL;
    }
}
echo str_repeat('-', 60) . PHP_EOL;
echo sprintf('Kết quả: %d OK, %d ghi chú, %d chú ý, %d lỗi.', $count['ok'], $count['note'], $count['warn'], $count['error']) . PHP_EOL;
if ($count['error'] > 0) {
    echo 'Hãy sửa các mục [LOI] rồi chạy lại lệnh này.' . PHP_EOL;
    exit(1);
}
echo $count['warn'] > 0 ? 'Website chạy được. Nên xem lại các mục [CHU Y].' . PHP_EOL : 'Mọi thứ đã sẵn sàng.' . PHP_EOL;
exit(0);
