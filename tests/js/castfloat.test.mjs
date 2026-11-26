// Giai đoạn 17: cửa sổ nhạc nổi khi màn hình xe "Toàn màn hình" (modules/cast/castFloat.js) - phần tính toán.
// Phần giao diện (kéo, dính góc, chuyển thẻ video, thu nhỏ) thử trên Chromium thật ở e2e19.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestCorner, parseFloatPrefs, clampDrag, floatSize } from '../../public/assets/js/modules/cast/castFloat.js';

test('thả cửa sổ: dính vào góc gần tâm cửa sổ nhất', () => {
  assert.equal(nearestCorner(100, 100, 1000, 500), 'tl');
  assert.equal(nearestCorner(900, 100, 1000, 500), 'tr');
  assert.equal(nearestCorner(100, 400, 1000, 500), 'bl');
  assert.equal(nearestCorner(900, 400, 1000, 500), 'br');
  assert.equal(nearestCorner(500, 250, 1000, 500), 'br', 'đúng giữa: về góc mặc định');
  assert.equal(nearestCorner(499, 249, 1000, 500), 'tl');
});

test('lựa chọn đã lưu: đọc đúng, dữ liệu hỏng thì dùng mặc định (góc dưới phải, không thu nhỏ)', () => {
  assert.deepEqual(parseFloatPrefs(null), { corner: 'br', min: false });
  assert.deepEqual(parseFloatPrefs(''), { corner: 'br', min: false });
  assert.deepEqual(parseFloatPrefs('{"corner":"tl","min":true}'), { corner: 'tl', min: true });
  assert.deepEqual(parseFloatPrefs('{"corner":"bl"}'), { corner: 'bl', min: false });
  assert.deepEqual(parseFloatPrefs('{"corner":"giua","min":"yes"}'), { corner: 'br', min: false });
  assert.deepEqual(parseFloatPrefs('{hỏng'), { corner: 'br', min: false });
  assert.deepEqual(parseFloatPrefs('[1,2]'), { corner: 'br', min: false });
  assert.deepEqual(parseFloatPrefs('"tl"'), { corner: 'br', min: false });
});

test('kéo: cửa sổ không ra ngoài khung chiếu', () => {
  const a = { left: 0, right: 1024, top: 0, bottom: 544 };
  const r = { left: 700, right: 940, top: 300, bottom: 540 };
  assert.deepEqual(clampDrag(50, -20, r, a), { dx: 50, dy: -20 }, 'trong khung: giữ nguyên');
  assert.deepEqual(clampDrag(200, 10, r, a), { dx: 84, dy: 4 }, 'chạm mép phải / dưới');
  assert.deepEqual(clampDrag(-800, -900, r, a), { dx: -700, dy: -300 }, 'chạm mép trái / trên');
  const big = { left: -10, right: 1100, top: 0, bottom: 100 };
  const c = clampDrag(30, 0, big, a);
  assert.ok(Number.isFinite(c.dx) && c.dx === 10, 'cửa sổ to hơn khung: không ra số lạ');
});

test('cỡ thẻ theo màn hình xe: không quá 1/3 bề rộng, không quá 45% chiều cao; màn hình thấp thì bỏ phần hình', () => {
  const rem = 16;
  const below = 110;   // tên bài + thanh tiến độ + hàng nút
  // 1024x600: khung chiếu cao 544 (trừ thanh nút)
  const a = floatSize(1024, 544, below, rem);
  assert.equal(a.compact, false);
  assert.equal(a.width, 240);
  assert.ok(a.width * 9 / 16 + below <= 544 * 0.45 + 1, 'cả thẻ không cao quá 45%');
  // 1280x720
  const b = floatSize(1280, 664, below, rem);
  assert.equal(b.compact, false);
  assert.equal(b.width, 336);
  // 1920x720 (màn hình xe dài): tối đa 22rem
  assert.equal(floatSize(1920, 664, below, rem).width, 336, 'bị giới hạn bởi chiều cao');
  assert.equal(floatSize(1920, 1000, below, rem).width, 352, 'tối đa 22rem');
  // 800x480: hình chỉ còn 144px -> bỏ hình, chỉ còn tên bài + nút
  const c = floatSize(800, 424, below, rem);
  assert.deepEqual(c, { width: 256, compact: true });
  // màn hình xe đặt dọc 600x1024: không hẹp hơn 13rem
  assert.deepEqual(floatSize(600, 968, below, rem), { width: 208, compact: false });
  // "Chữ lớn" (rem 20) trên 1024x600: phần dưới hình cao hơn -> bỏ hình
  assert.equal(floatSize(1024, 544, 130, 20).compact, true);
  // khung rất nhỏ: vẫn đủ chỗ cho 3 nút (tối thiểu 14rem khi bỏ hình)
  assert.deepEqual(floatSize(300, 200, below, rem), { width: 224, compact: true });
});
