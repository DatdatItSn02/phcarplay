<?php
declare(strict_types=1);

/**
 * Kiểm thử các chức năng quản trị của giai đoạn 5.2-5.4 (người dùng, key kích hoạt, playlist, nhật ký, tổng quan)
 * không cần MySQL: chạy mã thật trên SQLite trong bộ nhớ (cần PHP bật pdo_sqlite).
 * Phần tương tự chạy trên MySQL thật nằm ở tests/integration/ManageFlowTest.php.
 */

use App\Core\Container;

require_once dirname(__DIR__) . '/support/manage_scenarios.php';

test('Quản trị: Pagination và Sql::like', function () {
    [$page, $per, $off] = App\Core\Pagination::fromQuery([]);
    assertSame([1, 20, 0], [$page, $per, $off]);
    assertSame([3, 10, 20], App\Core\Pagination::fromQuery(['page' => '3', 'per_page' => '10']));
    assertSame([1, 100, 0], App\Core\Pagination::fromQuery(['page' => '-4', 'per_page' => '5000']));
    assertSame([1, 20, 0], App\Core\Pagination::fromQuery(['page' => 'abc', 'per_page' => ['x']]));
    assertSame('%a!%b!_c!!%', App\Core\Sql::like('a%b_c!'));
});

if (adminSqliteDatabase() === null) {
    test('Quản trị 5.2-5.4 (SQLite): BỎ QUA - PHP này chưa bật pdo_sqlite nên không chạy được các kịch bản trên SQLite (hãy dùng --integration với MySQL)', function () {
    });
} else {
    registerManageScenarios(
        'Quản trị (SQLite)',
        function () {
            Container::set(App\Core\Database::class, adminSqliteDatabase());
        },
        function (string $tag) {
        }
    );
}

if (adminSqliteDatabase() !== null) {
    test('Máy chủ thử SQLite: "INSERT IGNORE" của MySQL được đổi sang cú pháp SQLite nên thêm bài vào playlist chạy được, bài trùng bị bỏ qua', function () {
        $db = adminSqliteDatabase();
        $repo = new App\Repositories\PlaylistRepository($db);
        $id = $repo->create(1, 'Thử');
        $item = ['id' => 'dQw4w9WgXcQ', 'title' => 'Bài', 'uploader' => 'K', 'duration' => 10, 'thumbnail' => ''];
        assertSame(true, $repo->addItem($id, $item, 1), 'thêm lần đầu');
        assertSame(false, $repo->addItem($id, $item, 2), 'trùng thì bỏ qua, không lỗi');
        assertSame(1, $repo->countItems($id));
    });
}

if (adminSqliteDatabase() !== null) {
    test('Xóa bằng đánh dấu (giai đoạn 8): người dùng bỏ bài, thêm lại bài cũ, xóa playlist; key đã xóa không nhập được', function () {
        $db = adminSqliteDatabase();
        Container::set(App\Core\Database::class, $db);
        $users = new App\Repositories\UserRepository($db);
        $uid = $users->create('xoa-mem@test.local', 'A', str_repeat('a', 32), str_repeat('b', 16));
        $svc = new App\Services\PlaylistService(new App\Repositories\PlaylistRepository($db));
        $p = $svc->create($uid, 'Đi làm');
        $item = function (string $id) { return ['id' => $id, 'title' => 'Bài ' . $id, 'uploader' => 'K', 'duration' => 100, 'thumbnail' => '']; };
        $svc->addItems($uid, $p['id'], [$item('aaaaaaaaaaa'), $item('bbbbbbbbbbb')]);
        $firstRowId = (int) $db->value('SELECT id FROM playlist_items WHERE video_id = ?', ['aaaaaaaaaaa']);

        $svc->removeItem($uid, $p['id'], 'aaaaaaaaaaa');
        $row = $db->one('SELECT * FROM playlist_items WHERE id = ?', [$firstRowId]);
        assertTrue($row['deleted_at'] !== null && $row['deleted_by_type'] === 'user' && (int) $row['deleted_by_id'] === $uid, 'bỏ bài: đánh dấu do chính người dùng xóa');
        assertSame(['bbbbbbbbbbb'], array_column($svc->get($uid, $p['id'])['items'], 'id'));

        $r = $svc->addItems($uid, $p['id'], [$item('aaaaaaaaaaa')]);
        assertSame(1, $r['added'], 'thêm lại bài đã bỏ');
        assertSame(['bbbbbbbbbbb', 'aaaaaaaaaaa'], array_column($svc->get($uid, $p['id'])['items'], 'id'), 'bài thêm lại xếp cuối');
        assertSame(1, (int) $db->value('SELECT COUNT(*) FROM playlist_items WHERE video_id = ?', ['aaaaaaaaaaa']), 'dùng lại dòng cũ, không tạo dòng trùng');
        assertSame(null, $db->value('SELECT deleted_at FROM playlist_items WHERE id = ?', [$firstRowId]));

        $svc->delete($uid, $p['id']);
        assertSame([], $svc->listFor($uid));
        assertThrows(function () use ($svc, $uid, $p) { $svc->get($uid, $p['id']); }, 'NOT_FOUND');
        assertSame(2, (int) $db->value('SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ? AND deleted_by_type = ?', [$p['id'], 'user']));
        assertSame('user', $db->value('SELECT deleted_by_type FROM playlists WHERE id = ?', [$p['id']]));
        $svc->create($uid, 'Đi làm');   // tên cũ dùng lại được, số playlist đã xóa không tính vào giới hạn
        assertSame(1, count($svc->listFor($uid)));

        $keys = new App\Repositories\LicenseKeyRepository($db);
        $kid = $keys->create('ABCD-EFGH-JKMN-PQRS', 30, '', 1);
        assertTrue($keys->softDeleteUnlessUsed($kid, App\Repositories\SoftDelete::byAdmin(['id' => 1, 'email' => 'm@x.vn'])));
        assertSame(null, $keys->findByCode('ABCD-EFGH-JKMN-PQRS'), 'key đã xóa coi như không có');
        assertSame(false, $keys->softDeleteUnlessUsed($kid, App\Repositories\SoftDelete::byAdmin(['id' => 1, 'email' => 'm@x.vn'])), 'xóa lần hai không đổi người/thời điểm xóa');
        assertSame(1, $keys->countSearch(['deleted' => '1']));
        assertSame(0, $keys->countSearch([]));
    });
}

if (adminSqliteDatabase() !== null) {
    test('Key hàng loạt: thu hồi/xóa nhiều key, bỏ qua key đã dùng/đã thu hồi/không còn, một dòng nhật ký cho cả lô', function () {
        $db = adminSqliteDatabase();
        Container::set(App\Core\Database::class, $db);
        $admins = new App\Repositories\AdminRepository($db);
        $aid = $admins->create('bulk@test.local', 'B', str_repeat('a', 32), str_repeat('b', 16), 'admin');
        $actor = $admins->find($aid);
        $svc = Container::get(App\Services\LicenseKeyService::class);
        $made = $svc->generate($actor, 4, 30, 'lô thử', '1.1.1.1');
        $ids = array_column($made, 'id');
        $uid = (new App\Repositories\UserRepository($db))->create('dung@test.local', 'U', str_repeat('a', 32), str_repeat('b', 16));
        $svc->redeem(['id' => $uid, 'email' => 'dung@test.local'], $made[0]['code']);   // key 0 đã dùng

        $r = $svc->bulk($actor, 'revoke', [$ids[0], $ids[1], $ids[2], $ids[2], 999999], '1.1.1.1');
        assertSame([$ids[1], $ids[2]], $r['done'], 'trùng id chỉ xử lý một lần');
        assertSame([$ids[0], 999999], array_column($r['skipped'], 'id'));
        $r = $svc->bulk($actor, 'revoke', [$ids[1]], '1.1.1.1');
        assertSame('Đã thu hồi từ trước.', $r['skipped'][0]['reason']);

        $r = $svc->bulk($actor, 'delete', $ids, '1.1.1.1');
        assertSame([$ids[1], $ids[2], $ids[3]], $r['done']);
        assertSame([$ids[0]], array_column($r['skipped'], 'id'), 'key đã dùng không xóa được');
        assertSame(4, (int) $db->value('SELECT COUNT(*) FROM license_keys'), 'không dùng DELETE');
        assertSame(3, (int) $db->value("SELECT COUNT(*) FROM license_keys WHERE deleted_by_email = 'bulk@test.local' AND deleted_at IS NOT NULL"));
        assertSame(1, (int) $db->value("SELECT COUNT(*) FROM audit_log WHERE action = 'key.bulk_delete'"));
        assertSame(1, (int) $db->value("SELECT COUNT(*) FROM audit_log WHERE action = 'key.bulk_revoke'"));
        $list = $svc->search(['deleted' => '1'], 1, 20, 0);
        assertSame(3, $list['total']);
        assertSame('bulk@test.local', $list['items'][0]['deleted']['by_email']);
        assertSame(['unused' => 0, 'used' => 1, 'revoked' => 0], $list['counts'], 'đếm theo trạng thái không tính key đã xóa');
    });
}

test('Giai đoạn 12: cài đặt chế độ phát (playback) chỉ nhận giá trị hợp lệ', function () {
    assertSame(['playback' => ['repeat' => 'one', 'autoMix' => false]],
        App\Services\PreferencesService::sanitize(['playback' => ['repeat' => 'one', 'shuffle' => true, 'autoMix' => false, 'khac' => 1]]));
    assertSame(['playback' => ['repeat' => 'shuffle']], App\Services\PreferencesService::sanitize(['playback' => ['repeat' => 'shuffle']]));
    assertSame([], App\Services\PreferencesService::sanitize(['playback' => ['repeat' => 'bay', 'shuffle' => 'true', 'autoMix' => 1]]));
    assertSame(['playback' => ['repeat' => 'all']], App\Services\PreferencesService::sanitize(['playback' => ['repeat' => 'all']]));
});
