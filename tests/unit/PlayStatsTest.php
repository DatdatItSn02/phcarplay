<?php
declare(strict_types=1);

use App\Repositories\PlayStatsRepository;
use App\Services\PlayStatsService;

// Giai đoạn 11: "bài bạn hay nghe" ở đầu tab "Tất cả".

function psSetup(int &$clock): array
{
    $db = adminSqliteDatabase();
    if ($db === null) {
        return [null, null];
    }
    $svc = new PlayStatsService(new PlayStatsRepository($db), function () use (&$clock): int { return $clock; });
    return [$svc, $db];
}

function psItem(string $id, string $title = ''): array
{
    return ['id' => $id, 'title' => $title !== '' ? $title : 'Bài ' . $id, 'uploader' => 'Kênh', 'duration' => 200, 'thumbnail' => 'javascript:alert(1)'];
}

test('Hay nghe: chỉ bài nghe từ 2 lượt mới hiện, nhiều lượt trước, bằng nhau thì nghe gần đây trước; ảnh bìa tạo lại từ mã video', function () {
    $clock = 1790000000;
    [$svc, $db] = psSetup($clock);
    if ($svc === null) { return; }
    $svc->record(1, psItem('aaaaaaaaaaa'));               // 1 lượt: chưa đủ
    foreach (['bbbbbbbbbbb', 'bbbbbbbbbbb', 'ccccccccccc', 'ccccccccccc', 'ccccccccccc', 'ddddddddddd'] as $id) {
        $clock += 60;
        $svc->record(1, psItem($id));
    }
    $clock += 60;
    $svc->record(1, psItem('ddddddddddd', 'Tên mới'));    // d: 2 lượt, nghe sau b nên đứng trước b
    $top = $svc->top(1);
    assertSame(['ccccccccccc', 'ddddddddddd', 'bbbbbbbbbbb'], array_column($top, 'id'));
    assertSame([3, 2, 2], array_column($top, 'plays'));
    assertSame('Tên mới', $top[1]['title'], 'cập nhật tên bài mới nhất');
    assertSame('https://i.ytimg.com/vi/ccccccccccc/mqdefault.jpg', $top[0]['thumbnail'], 'không dùng đường dẫn ảnh do trình duyệt gửi');
    assertSame([], $svc->top(2), 'người khác không thấy bài của người này');
});

test('Hay nghe: tối đa 20 bài; bài không nghe trong 60 ngày thì rơi khỏi danh sách; mã video sai thì từ chối', function () {
    $clock = 1790000000;
    [$svc, $db] = psSetup($clock);
    if ($svc === null) { return; }
    for ($i = 0; $i < 25; $i++) {
        $id = substr('vid' . str_pad((string) $i, 8, '0', STR_PAD_LEFT), 0, 11);
        $svc->record(1, psItem($id));
        $svc->record(1, psItem($id));
    }
    assertSame(20, count($svc->top(1)));
    assertSame(5, count($svc->top(1, 5)));
    $clock += 61 * 86400;
    assertSame([], $svc->top(1), 'quá 60 ngày không nghe');
    assertThrows(fn() => $svc->record(1, psItem('ngan')), 'VALIDATION_FAILED');
    assertThrows(fn() => $svc->hide(1, '../../x'), 'VALIDATION_FAILED');
});

test('Hay nghe: ẩn một bài / xóa danh sách chỉ đưa lượt về 0 (không DELETE); nghe lại đủ 2 lượt thì hiện lại', function () {
    $clock = 1790000000;
    [$svc, $db] = psSetup($clock);
    if ($svc === null) { return; }
    foreach (['aaaaaaaaaaa', 'aaaaaaaaaaa', 'bbbbbbbbbbb', 'bbbbbbbbbbb'] as $id) {
        $svc->record(1, psItem($id));
    }
    $svc->hide(1, 'aaaaaaaaaaa');
    assertSame(['bbbbbbbbbbb'], array_column($svc->top(1), 'id'));
    $row = $db->one("SELECT play_count, hidden_at FROM user_play_stats WHERE user_id = 1 AND video_id = 'aaaaaaaaaaa'");
    assertSame(0, (int) $row['play_count']);
    assertTrue($row['hidden_at'] !== null, 'ghi thời điểm ẩn');
    $svc->record(1, psItem('aaaaaaaaaaa'));
    assertSame(['bbbbbbbbbbb'], array_column($svc->top(1), 'id'), 'mới nghe lại 1 lượt: chưa hiện');
    $svc->record(1, psItem('aaaaaaaaaaa'));
    assertSame(['aaaaaaaaaaa', 'bbbbbbbbbbb'], array_column($svc->top(1), 'id'), 'nghe lại đủ 2 lượt: hiện lại');
    $svc->clear(1);
    assertSame([], $svc->top(1));
    assertSame(2, (int) $db->value('SELECT COUNT(*) FROM user_play_stats WHERE user_id = 1'), 'không xóa dòng nào');
});

test('Hay nghe: migration 009 khớp schema.sql và SQLite, không khóa ngoại, không DELETE; code không dùng DELETE', function () {
    $schema = BASE_PATH . '/database/schema.sql';
    $mig = (string) file_get_contents(BASE_PATH . '/database/migrations/009_play_stats.sql');
    $tmp = tempnam(sys_get_temp_dir(), 'm9');
    file_put_contents($tmp, str_replace('CREATE TABLE user_play_stats', 'CREATE TABLE IF NOT EXISTS user_play_stats', $mig));
    $cols = ['user_id', 'video_id', 'title', 'uploader', 'duration', 'play_count', 'last_played_at', 'hidden_at'];
    assertSame($cols, adminSqlColumns($schema, 'user_play_stats'));
    assertSame($cols, adminSqlColumns($tmp, 'user_play_stats'));
    @unlink($tmp);
    $noComments = (string) preg_replace('/^\s*--.*$/m', '', $mig);
    assertTrue(stripos($noComments, 'FOREIGN KEY') === false && stripos($noComments, 'DELETE') === false);
    assertTrue(strpos((string) file_get_contents($schema), "'009_play_stats.sql'") !== false);
    assertTrue(strpos(implode("\n", adminSqliteDdl()), 'user_play_stats') !== false);
    foreach (['/app/Repositories/PlayStatsRepository.php', '/app/Services/PlayStatsService.php'] as $f) {
        assertTrue(stripos((string) file_get_contents(BASE_PATH . $f), 'DELETE') === false, $f);
    }
});
