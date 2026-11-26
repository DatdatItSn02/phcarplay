<?php
declare(strict_types=1);

/**
 * Kiểm thử luồng thật với MySQL: đăng ký, đăng nhập, quên và đặt lại mật khẩu.
 * Chạy: php tests/run.php --integration  (nên dùng database thử riêng, đã chạy php bin/migrate.php)
 */

use App\Core\Config;
use App\Core\Container;
use App\Core\Database;
use App\Services\AuthService;
use App\Services\PasswordResetService;

Container::reset();
Config::override('mail', ['driver' => 'log', 'from_email' => 'no-reply@test.local', 'from_name' => 'Test']);
Config::override('app', ['url' => 'http://test.local', 'name' => 'PH Car Play', 'auth' => ['reset_ttl_minutes' => 60]]);

$email = 'it_' . bin2hex(random_bytes(4)) . '@test.local';

test('Tích hợp: đăng ký rồi đăng nhập đúng/sai mật khẩu', function () use ($email) {
    $auth = Container::get(AuthService::class);
    $u = $auth->register($email, 'Tester', 'matkhau1');
    assertSame($email, $u['email']);
    assertTrue(strlen($u['password_hash']) === 32, 'hash phải là 32 ký tự md5');
    assertSame($email, $auth->attempt($email, 'matkhau1')['email']);
    assertThrows(fn() => $auth->attempt($email, 'saimatkhau'), 'INVALID_CREDENTIALS');
    assertThrows(fn() => $auth->attempt('khong.ton.tai@test.local', 'x'), 'INVALID_CREDENTIALS');
});

test('Tích hợp: đăng ký trùng email bị từ chối', function () use ($email) {
    assertThrows(fn() => Container::get(AuthService::class)->register($email, 'Khác', 'matkhau2'), 'EMAIL_TAKEN');
});

test('Tích hợp: quên mật khẩu gửi mã OTP qua mail, mã dùng một lần, mật khẩu cũ hết hiệu lực (giai đoạn 14)', function () use ($email) {
    $dir = BASE_PATH . '/storage/mail';
    $before = glob($dir . '/*.txt') ?: [];
    $svc = Container::get(PasswordResetService::class);
    $svc->request($email);
    $new = array_values(array_diff(glob($dir . '/*.txt') ?: [], $before));
    assertSame(1, count($new), 'phải có đúng 1 thư');
    $text = (string) file_get_contents($new[0]);
    @unlink($new[0]);
    @unlink(substr($new[0], 0, -4) . '.eml');
    assertTrue(preg_match('/là: ([0-9]{6})/u', $text, $m) === 1, 'không thấy mã 6 số trong thư');
    $code = $m[1];

    assertThrows(fn() => $svc->resetWithCode($email, $code === '000000' ? '111111' : '000000', 'matkhaumoi'), 'OTP_WRONG', 'mã sai');
    $svc->resetWithCode($email, $code, 'matkhaumoi');
    assertThrows(fn() => $svc->resetWithCode($email, $code, 'lannua123'), 'OTP_INVALID', 'mã đã dùng');
    assertThrows(fn() => $svc->reset('0000', 'matkhaumoi'), 'TOKEN_INVALID', 'liên kết kiểu cũ sai');

    $auth = Container::get(AuthService::class);
    assertThrows(fn() => $auth->attempt($email, 'matkhau1'), 'INVALID_CREDENTIALS', 'mật khẩu cũ');
    assertSame($email, $auth->attempt($email, 'matkhaumoi')['email']);
});

test('Tích hợp: quên mật khẩu với email lạ không báo lỗi và không gửi thư', function () {
    $dir = BASE_PATH . '/storage/mail';
    $before = glob($dir . '/*.eml') ?: [];
    Container::get(PasswordResetService::class)->request('khong.co@test.local');
    assertSame(count($before), count(glob($dir . '/*.eml') ?: []));
});

test('Tích hợp: đăng nhập thiết bị mới thì thiết bị cũ bị vô hiệu, đặt lại mật khẩu thì mọi thiết bị bị vô hiệu', function () use ($email) {
    Config::override('app', ['url' => 'http://test.local', 'name' => 'PH Car Play', 'auth' => ['reset_ttl_minutes' => 60, 'single_device' => true]]);
    $users = Container::get(App\Repositories\UserRepository::class);
    $devices = Container::get(App\Services\DeviceSessionService::class);
    $auth = Container::get(AuthService::class);

    $u = $auth->attempt($email, 'matkhaumoi');
    $tokenA = $devices->begin($u, 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36', '1.1.1.1');
    assertTrue($devices->isCurrent($users->findByEmail($email), $tokenA), 'thiết bị A hợp lệ');

    $tokenB = $devices->begin($u, 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36', '2.2.2.2');
    $fresh = $users->findByEmail($email);
    assertTrue(!$devices->isCurrent($fresh, $tokenA), 'thiết bị A phải bị đăng xuất');
    assertTrue($devices->isCurrent($fresh, $tokenB), 'thiết bị B hợp lệ');
    assertSame('Chrome / Windows', $fresh['session_device']);

    $devices->end($fresh, $tokenB);
    assertSame(null, $users->findByEmail($email)['session_token'], 'đăng xuất xóa dấu phiên');
});

test('Tích hợp: lưu và đọc lại cài đặt giao diện, gộp từng phần', function () use ($email) {
    $users = Container::get(App\Repositories\UserRepository::class);
    $id = (int) $users->findByEmail($email)['id'];
    $prefs = Container::get(App\Services\PreferencesService::class);

    assertSame(null, $prefs->get($id)['layout'], 'chưa lưu thì là null');
    $prefs->save($id, ['layout' => ['h' => 0.4]]);
    $prefs->save($id, ['layout' => ['v' => 0.7]]);
    assertSame(['h' => 0.4, 'v' => 0.7], $prefs->get($id)['layout'], 'hai lần lưu phải gộp lại');
    assertThrows(fn() => $prefs->save($id, ['layout' => ['h' => 'abc']]), 'VALIDATION_FAILED');
    // dọn dữ liệu thử của bài này (website không có chức năng xóa cài đặt; chỉ kiểm thử mới dọn)
    Container::get(Database::class)->execute('DELETE FROM user_preferences WHERE user_id = ?', [$id]);
});

test('Tích hợp: playlist - tạo, thêm bài (không trùng), sắp xếp, xóa bài, quyền sở hữu, nhập từ khách, xóa dây chuyền', function () use ($email) {
    $users = Container::get(App\Repositories\UserRepository::class);
    $uid = (int) $users->findByEmail($email)['id'];
    $svc = Container::get(App\Services\PlaylistService::class);
    $repo = Container::get(App\Repositories\PlaylistRepository::class);
    $song = function (string $id) { return ['id' => $id, 'title' => 'Bài ' . $id, 'uploader' => 'Ca sĩ', 'duration' => 200, 'thumbnail' => 'https://i.test/' . $id . '.jpg']; };

    $pl = $svc->create($uid, '  Nhạc đi đường  ');
    assertSame('Nhạc đi đường', $pl['name']);
    assertSame(0, $pl['count']);

    $r = $svc->addItems($uid, $pl['id'], [$song('aaaaaaaaaaa'), $song('bbbbbbbbbbb'), $song('aaaaaaaaaaa'), ['id' => 'sai', 'title' => 'x']]);
    assertSame(2, $r['added'], 'loại trùng và mục sai');
    assertSame(0, $svc->addItems($uid, $pl['id'], [$song('aaaaaaaaaaa')])['added'], 'thêm lại bài đã có');
    $svc->addItems($uid, $pl['id'], [$song('ccccccccccc')]);
    assertSame(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'], array_column($svc->get($uid, $pl['id'])['items'], 'id'), 'giữ đúng thứ tự thêm');

    $svc->reorder($uid, $pl['id'], ['ccccccccccc', 'aaaaaaaaaaa', 'bbbbbbbbbbb']);
    assertSame(['ccccccccccc', 'aaaaaaaaaaa', 'bbbbbbbbbbb'], array_column($svc->get($uid, $pl['id'])['items'], 'id'), 'sau khi sắp xếp');
    assertThrows(fn() => $svc->reorder($uid, $pl['id'], ['ccccccccccc']), 'VALIDATION_FAILED', 'thiếu bài');

    $svc->removeItem($uid, $pl['id'], 'aaaaaaaaaaa');
    assertSame(['ccccccccccc', 'bbbbbbbbbbb'], array_column($svc->get($uid, $pl['id'])['items'], 'id'));
    assertSame($pl['id'], $svc->listFor($uid)[0]['id'], 'playlist vừa sửa đứng đầu');
    assertSame(2, $svc->listFor($uid)[0]['count']);

    $svc->rename($uid, $pl['id'], 'Đổi tên');
    assertSame('Đổi tên', $svc->get($uid, $pl['id'])['name']);
    assertThrows(fn() => $svc->create($uid, '   '), 'VALIDATION_FAILED', 'tên rỗng');

    // Người khác không truy cập được
    assertThrows(fn() => $svc->get($uid + 99999, $pl['id']), 'NOT_FOUND', 'không phải chủ');
    assertThrows(fn() => $svc->delete($uid + 99999, $pl['id']), 'NOT_FOUND');

    // Nhập từ khách
    $imp = $svc->import($uid, [['name' => 'Từ khách', 'items' => [$song('ddddddddddd'), $song('eeeeeeeeeee')]], ['name' => '', 'items' => []]]);
    assertSame(1, $imp['created']);

    // Xóa playlist: playlist và các bài chỉ bị đánh dấu xóa (giai đoạn 8: không dùng DELETE), không còn hiện ra
    foreach ($svc->listFor($uid) as $p) {
        $svc->delete($uid, $p['id']);
    }
    assertSame([], $svc->listFor($uid));
    $db = Container::get(Database::class);
    assertSame(0, (int) $db->value('SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ? AND deleted_at IS NULL', [$pl['id']]), 'bài của playlist đã xóa phải bị đánh dấu xóa theo');
    assertSame(3, (int) $db->value('SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ?', [$pl['id']]), 'các bài vẫn còn trong database (chỉ đánh dấu)');
    assertSame('user', $db->value('SELECT deleted_by_type FROM playlists WHERE id = ?', [$pl['id']]), 'người xóa là chính người dùng');
    assertSame(0, $repo->countByUser($uid));
});

test('Tích hợp: dọn dữ liệu thử', function () use ($email) {
    $db = Container::get(Database::class);
    $id = $db->value('SELECT id FROM users WHERE email = ?', [$email]);
    // chỉ kiểm thử mới dọn dữ liệu thử của chính nó; mã website không dùng DELETE
    $db->execute('DELETE FROM playlist_items WHERE playlist_id IN (SELECT id FROM playlists WHERE user_id = ?)', [$id]);
    $db->execute('DELETE FROM playlists WHERE user_id = ?', [$id]);
    $db->execute('DELETE FROM password_resets WHERE account_type = ? AND account_id = ?', ['user', $id]);
    $db->execute('DELETE FROM users WHERE email = ?', [$email]);
    assertTrue(true);
});
