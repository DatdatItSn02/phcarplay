<?php
declare(strict_types=1);

/**
 * Giai đoạn 6 (giao diện cho màn hình xe): danh mục ở Trang chủ (HOME_CHIPS) và phần đầu trang chống nháy màu.
 */

use App\Services\HomeChips;

test('HomeChips: danh mục mặc định có 7 mục, mỗi mục có nhãn và từ khóa', function () {
    $chips = HomeChips::parse(HomeChips::DEFAULT);
    assertSame(7, count($chips));
    assertSame(['label' => 'Nhạc Việt', 'q' => 'nhạc Việt mới nhất'], $chips[0]);
    assertSame(['label' => 'Podcast', 'q' => 'podcast tiếng Việt'], $chips[6]);
});

test('HomeChips: thiếu từ khóa thì tìm theo nhãn, bỏ khoảng trắng thừa, bỏ mục rỗng và trùng (không phân biệt hoa thường)', function () {
    $chips = HomeChips::parse("  Podcast , Bolero =  nhạc   bolero ,,=chỉ có từ khóa, BOLERO=khác, Nhạc  Trẻ ");
    assertSame([
        ['label' => 'Podcast', 'q' => 'Podcast'],
        ['label' => 'Bolero', 'q' => 'nhạc bolero'],
        ['label' => 'Nhạc Trẻ', 'q' => 'Nhạc Trẻ'],
    ], $chips);
});

test('HomeChips: tối đa 12 mục, nhãn tối đa 30 ký tự, từ khóa tối đa 100 ký tự (tính theo ký tự tiếng Việt)', function () {
    $many = implode(',', array_map(function ($i) { return 'Mục ' . $i; }, range(1, 20)));
    assertSame(HomeChips::MAX, count(HomeChips::parse($many)));
    $chips = HomeChips::parse(str_repeat('ữ', 50) . '=' . str_repeat('ệ', 150));
    assertSame(30, mb_strlen($chips[0]['label'], 'UTF-8'));
    assertSame(100, mb_strlen($chips[0]['q'], 'UTF-8'));
    assertSame([], HomeChips::parse(''));
    assertSame([], HomeChips::parse(' , ,'));
});

test('Trang web: chèn appearance-boot.js vào <head> (chống nháy màu), có theme-color, không tải font từ Google', function () {
    $index = (string) file_get_contents(BASE_PATH . '/public/index.php');
    assertTrue(strpos($index, "assets/js/appearance-boot.js") !== false, 'index.php phải chèn appearance-boot.js');
    assertTrue(strpos($index, 'name="theme-color"') !== false, 'thiếu thẻ theme-color');
    assertTrue(strpos($index, 'fonts.googleapis.com') === false, 'không phụ thuộc font ngoài (xe có thể mất mạng)');
    assertTrue(strpos($index, 'HomeChips::parse') !== false, 'trang chính phải gửi danh mục cho giao diện');
    $boot = (string) file_get_contents(BASE_PATH . '/public/assets/js/appearance-boot.js');
    assertTrue(strpos($boot, '</script') === false, 'appearance-boot.js không được chứa </script vì được chèn nguyên văn');
});
