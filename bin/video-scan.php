<?php
declare(strict_types=1);

/**
 * Tìm địa chỉ Piped / Invidious đang chạy được: thử tìm kiếm, xin luồng phát và tải thử luồng phát một video.
 *   php bin/video-scan.php                       thử địa chỉ trong .env và danh sách công khai có sẵn
 *   php bin/video-scan.php --only-env            chỉ thử địa chỉ trong .env
 *   php bin/video-scan.php --piped=https://a,https://b --invidious=https://c   thử thêm địa chỉ khác
 * Cuối cùng in dòng PIPED_API_URLS=... / INVIDIOUS_API_URLS=... để dán vào .env.
 * Lưu ý: kết quả đúng cho MÁY ĐANG CHẠY LỆNH. Hãy chạy trên chính máy chủ website (máy chủ bị chặn thì kết quả khác máy bạn).
 */
require dirname(__DIR__) . '/app/bootstrap.php';

use App\Services\VideoSourceScanner;

if (PHP_SAPI !== 'cli') {
    exit('Chỉ chạy bằng dòng lệnh.');
}

$extra = ['piped' => [], 'invidious' => []];
$onlyEnv = false;
foreach (array_slice($argv, 1) as $arg) {
    if ($arg === '--only-env') {
        $onlyEnv = true;
    } elseif (preg_match('/^--(piped|invidious)=(.+)$/', $arg, $m) === 1) {
        $extra[$m[1]] = array_merge($extra[$m[1]], explode(',', $m[2]));
    }
}

$scanner = new VideoSourceScanner();
echo 'PH Car Play - tìm địa chỉ nguồn video đang chạy (mỗi địa chỉ có thể mất tới vài chục giây)' . PHP_EOL;
$lines = [];
foreach (['piped' => 'Piped', 'invidious' => 'Invidious'] as $kind => $label) {
    echo PHP_EOL . $label . PHP_EOL . str_repeat('-', 60) . PHP_EOL;
    $results = $scanner->scan($kind, $extra[$kind], !$onlyEnv);
    foreach ($results as $r) {
        $mark = $r['play'] ? '[PHAT DUOC]' : ($r['search'] ? '[CHI TIM]  ' : '[HONG]     ');
        echo $mark . ' ' . str_pad($r['base'], 42) . ' ' . $r['ms'] . ' ms  ' . $r['note'] . PHP_EOL;
    }
    $line = VideoSourceScanner::envLine($kind, $results);
    $lines[] = $line ?? ('# Không tìm được địa chỉ ' . $label . ' phát được video.');
}
echo PHP_EOL . 'Dán các dòng sau vào .env (thay dòng cũ cùng tên), rồi chạy lại: php bin/doctor.php' . PHP_EOL;
echo implode(PHP_EOL, $lines) . PHP_EOL;
$yt = (string) App\Core\Config::get('youtube.api_key', '') !== '' ? 'YouTube Data API' : ((bool) App\Core\Config::get('youtube.direct', true) ? 'đọc trực tiếp từ YouTube' : '');
echo PHP_EOL . 'Ghi chú: Piped/Invidious hỏng hết thì website vẫn tìm kiếm ' . ($yt !== '' ? 'bằng ' . $yt : '(KHÔNG: YouTube dự phòng đang tắt)')
    . ' và ' . (App\Services\YoutubeService::embedEnabled() ? 'phát bằng trình phát YouTube' : 'KHÔNG phát được (YOUTUBE_EMBED=false)')
    . '. Kiểm tra bằng: php bin/doctor.php' . PHP_EOL;
