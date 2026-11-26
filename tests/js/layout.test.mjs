import test from 'node:test';
import assert from 'node:assert/strict';
import { GAP, DEFAULT_LAYOUT, clampRatio, pickOrientation, ratioFromOffset, sanitizeLayout, snapRatio } from '../../public/assets/js/core/layoutMath.js';
import { createSplitController } from '../../public/assets/js/core/splitController.js';
import { createLayoutPrefs } from '../../public/assets/js/modules/layout/layoutPrefs.js';
import { registerPanel, getPanel } from '../../public/assets/js/core/panels.js';

const near = (a, b, eps = 0.002) => assert.ok(Math.abs(a - b) <= eps, `${a} không gần ${b}`);

test('pickOrientation: màn hình ngang chia trái/phải, màn hình dọc chia trên/dưới', () => {
  assert.equal(pickOrientation(1280, 480), 'horizontal');
  assert.equal(pickOrientation(480, 900), 'vertical');
  assert.equal(pickOrientation(800, 800), 'horizontal');
});

test('clampRatio: mỗi khung giữ tối thiểu minPx, không vượt 10%-90%', () => {
  const minR = 240 / (1000 - GAP);
  near(clampRatio(0.05, 1000), minR);
  near(clampRatio(0.99, 1000), 1 - minR);
  assert.equal(clampRatio(0.5, 1000), 0.5);
  assert.equal(clampRatio(Number.NaN, 1000), 0.5);
  near(clampRatio(0.1, 300), 0.45);          // màn hình rất nhỏ: chỉ còn nhích quanh giữa
  assert.ok(clampRatio(0.9, 100000) <= 0.9 && clampRatio(0.01, 100000) >= 0.1);
});

test('ratioFromOffset: tâm thanh kéo nằm tại con trỏ', () => {
  near(ratioFromOffset(500, 1000), (500 - GAP / 2) / (1000 - GAP));
  near(ratioFromOffset(0, 1000), 240 / (1000 - GAP));   // kéo hết cỡ vẫn bị chặn ở mức tối thiểu
});

test('snapRatio: hít về 30/50/70 khi lại gần', () => {
  assert.equal(snapRatio(0.51), 0.5);
  assert.equal(snapRatio(0.29), 0.3);
  assert.equal(snapRatio(0.4), 0.4);
});

test('sanitizeLayout: dữ liệu thiếu hoặc sai dùng mặc định, vượt giới hạn thì kẹp lại', () => {
  assert.deepEqual(sanitizeLayout(null), DEFAULT_LAYOUT);
  assert.deepEqual(sanitizeLayout({ h: 2, v: -1 }), { h: 0.9, v: 0.1 });
  assert.deepEqual(sanitizeLayout({ h: 'x', v: 0.4 }), { h: DEFAULT_LAYOUT.h, v: 0.4 });
});

function makeController(layout) {
  const updates = [];
  const commits = [];
  const c = createSplitController({ layout, onUpdate: (s) => updates.push(s), onCommit: (l) => commits.push(l) });
  return { c, updates, commits };
}

test('controller: kéo thay đổi tỉ lệ nhưng chỉ lưu khi chốt (commit)', () => {
  const { c, commits } = makeController({ h: 0.62, v: 0.5 });
  c.setSize(1000, 500);
  assert.equal(c.snapshot().orientation, 'horizontal');
  c.dragTo(300);
  near(c.snapshot().ratio, 0.3);
  assert.equal(commits.length, 0, 'đang kéo chưa được lưu');
  c.commit();
  assert.equal(commits.length, 1);
  near(commits[0].h, 0.3);
});

test('controller: không kéo vượt giới hạn tối thiểu của mỗi khung', () => {
  const { c } = makeController();
  c.setSize(1000, 500);
  c.dragTo(5);
  near(c.snapshot().ratio, 240 / 986);
  c.dragTo(5000);
  near(c.snapshot().ratio, 1 - 240 / 986);
});

test('controller: đổi sang màn hình dọc thì dùng tỉ lệ riêng của chiều dọc', () => {
  const { c } = makeController({ h: 0.7, v: 0.4 });
  c.setSize(1000, 500);
  near(c.snapshot().ratio, 0.7);
  c.setSize(500, 1000);
  assert.equal(c.snapshot().orientation, 'vertical');
  near(c.snapshot().ratio, 0.4);
});

test('controller: kéo ở chiều dọc không làm đổi tỉ lệ chiều ngang đã lưu', () => {
  const { c } = makeController({ h: 0.7, v: 0.5 });
  c.setSize(500, 1000);
  c.dragTo(300);
  c.commit();
  c.setSize(1000, 500);
  near(c.snapshot().ratio, 0.7);
});

test('controller: nhích bằng bàn phím, preset, reset đều chốt (commit)', () => {
  const { c, commits } = makeController({ h: 0.5, v: 0.5 });
  c.setSize(1000, 500);
  c.nudge(0.02);
  near(c.snapshot().ratio, 0.52);
  c.setRatio(0.3);
  near(c.snapshot().ratio, 0.3);
  c.reset();
  near(c.snapshot().ratio, DEFAULT_LAYOUT.h);
  assert.equal(commits.length, 3);
});

test('controller: phóng to một khung rồi thu nhỏ lại', () => {
  const { c } = makeController();
  c.setSize(1000, 500);
  c.toggleFocus('left');
  assert.equal(c.snapshot().focus, 'left');
  c.toggleFocus('right');
  assert.equal(c.snapshot().focus, 'right');
  c.toggleFocus('right');
  assert.equal(c.snapshot().focus, null);
});

test('controller: setLayout (từ máy chủ) cập nhật mà không kích hoạt lưu lại', () => {
  const { c, commits } = makeController();
  c.setSize(1000, 500);
  c.setLayout({ h: 0.4, v: 0.6 });
  near(c.snapshot().ratio, 0.4);
  assert.equal(commits.length, 0);
});

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
}
function fakeApi({ remote = { layout: null }, failGet = false } = {}) {
  const puts = [];
  return {
    puts,
    get: async () => { if (failGet) throw new Error('offline'); return remote; },
    put: async (path, body) => { puts.push({ path, body }); return body; },
  };
}
function fakeTimers() {
  const t = { fn: null, setTimeout(fn) { t.fn = fn; return 1; }, clearTimeout() { t.fn = null; } };
  return t;
}

test('layoutPrefs: khách chỉ lưu trên thiết bị, không gọi API', () => {
  const storage = fakeStorage();
  const api = fakeApi();
  const p = createLayoutPrefs({ api, hasUser: () => false, storage, timers: fakeTimers() });
  p.save({ h: 0.4, v: 0.5 });
  assert.deepEqual(JSON.parse(storage.data.carweb_layout), { h: 0.4, v: 0.5 });
  assert.deepEqual(p.loadLocal(), { h: 0.4, v: 0.5 });
  assert.equal(api.puts.length, 0);
});

test('layoutPrefs: đã đăng nhập, nhiều lần kéo liên tiếp chỉ gửi một lần với giá trị cuối', async () => {
  const api = fakeApi();
  const timers = fakeTimers();
  const p = createLayoutPrefs({ api, hasUser: () => true, storage: fakeStorage(), timers });
  p.save({ h: 0.4, v: 0.5 });
  p.save({ h: 0.45, v: 0.5 });
  p.save({ h: 0.5, v: 0.5 });
  assert.equal(api.puts.length, 0, 'chưa gửi trước khi hết thời gian chờ');
  timers.fn();
  await Promise.resolve();
  assert.equal(api.puts.length, 1);
  assert.deepEqual(api.puts[0], { path: '/user/preferences', body: { layout: { h: 0.5, v: 0.5 } } });
});

test('layoutPrefs: loadRemote lấy bố cục của tài khoản và nhớ vào thiết bị', async () => {
  const storage = fakeStorage();
  const api = fakeApi({ remote: { layout: { h: 0.35, v: 0.65 } } });
  const p = createLayoutPrefs({ api, hasUser: () => true, storage, timers: fakeTimers() });
  assert.deepEqual(await p.loadRemote(), { h: 0.35, v: 0.65 });
  assert.deepEqual(JSON.parse(storage.data.carweb_layout), { h: 0.35, v: 0.65 });
});

test('layoutPrefs: tài khoản chưa có bố cục thì đẩy bố cục của khách lên; mất mạng thì không lỗi', async () => {
  const storage = fakeStorage({ carweb_layout: JSON.stringify({ h: 0.4, v: 0.5 }) });
  const api = fakeApi();
  const p = createLayoutPrefs({ api, hasUser: () => true, storage, timers: fakeTimers() });
  assert.equal(await p.loadRemote(), null);
  await Promise.resolve();
  assert.deepEqual(api.puts[0].body, { layout: { h: 0.4, v: 0.5 } });

  const offline = createLayoutPrefs({ api: fakeApi({ failGet: true }), hasUser: () => true, storage, timers: fakeTimers() });
  assert.equal(await offline.loadRemote(), null);
  const guest = createLayoutPrefs({ api, hasUser: () => false, storage, timers: fakeTimers() });
  assert.equal(await guest.loadRemote(), null);
});

test('panels: đăng ký và lấy lại panel, báo lỗi khi thiếu', () => {
  registerPanel({ id: 'demo', title: 'Demo', mount() {} });
  assert.equal(getPanel('demo').title, 'Demo');
  assert.throws(() => getPanel('khong-co'));
  assert.throws(() => registerPanel({ id: 'x' }));
});
