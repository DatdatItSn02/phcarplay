// Giai đoạn 17 (đợt 2): ghép đôi một lần, "Chia sẻ" một chạm - phần logic chạy được không cần trình duyệt.
// Thử trên Chromium thật (hai trang, WebRTC thật) ở e2e-harness/e2e-harness/e2e20.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCastDevice, receiverNameFromUa } from '../../public/assets/js/modules/cast/castDevice.js';
import { createCastIncoming } from '../../public/assets/js/modules/cast/castIncoming.js';
import { createCastReceiver } from '../../public/assets/js/modules/cast/castReceiver.js';
import { createCastSender, SHARE_PICK_MS, SHARE_CONNECT_MS, CAPTURE_OPTIONS } from '../../public/assets/js/modules/cast/castSender.js';
import { createCastApi } from '../../public/assets/js/modules/cast/castApi.js';
import { busyText, shortDate } from '../../public/assets/js/modules/cast/castSenderDialog.js';

const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, map: m };
}
function fakeTimers() {
  const q = new Map();
  let n = 0;
  return {
    set(fn, ms) { n += 1; q.set(n, { fn, ms }); return n; },
    clear(id) { q.delete(id); },
    fire(maxMs) { const run = []; q.forEach((v, k) => { if (v.ms <= maxMs) { run.push(v.fn); q.delete(k); } }); run.forEach((fn) => fn()); return run.length; },
    pending: () => Array.from(q.values()).map((v) => v.ms).sort((a, b) => a - b),
  };
}
function fakeLinkFactory() {
  const made = [];
  const makeLink = (opts) => {
    const l = { opts, started: false, stopped: false, byes: 0, start() { l.started = true; }, stop() { l.stopped = true; }, peerSaidBye() { l.byes += 1; }, channel: () => l.ch || null };
    made.push(l);
    return l;
  };
  return { made, makeLink };
}

// ---------- khóa thiết bị ----------

test('khóa thiết bị: 48 ký tự hex, tạo một lần rồi nhớ; dữ liệu hỏng thì tạo lại; không lưu được vẫn dùng được', () => {
  const st = memStorage();
  const d = createCastDevice({ storage: st });
  const k = d.key();
  assert.match(k, /^[a-f0-9]{48}$/);
  assert.equal(d.key(), k);
  assert.equal(createCastDevice({ storage: st }).key(), k, 'mở lại trang: vẫn khóa cũ');
  assert.notEqual(createCastDevice({ storage: memStorage() }).key(), k, 'máy khác: khóa khác');
  const bad = memStorage({ carweb_cast_device: 'ABC' });
  const k2 = createCastDevice({ storage: bad }).key();
  assert.match(k2, /^[a-f0-9]{48}$/);
  assert.equal(bad.getItem('carweb_cast_device'), k2);
  const broken = { getItem() { throw new Error('ẩn danh'); }, setItem() { throw new Error('đầy'); }, removeItem() { throw new Error('x'); } };
  const d3 = createCastDevice({ storage: broken });
  const k3 = d3.key();
  assert.match(k3, /^[a-f0-9]{48}$/);
  assert.equal(d3.key(), k3, 'khóa tạm giữ nguyên trong trang');
  assert.equal(d3.isPaired(), false);
  d3.setPaired(true);   // không ném lỗi
  // dấu "đã ghép đôi" của màn hình xe
  assert.equal(d.isPaired(), false);
  d.setPaired(true);
  assert.equal(d.isPaired(), true);
  assert.equal(st.getItem('carweb_cast_paired'), '1');
  d.setPaired(false);
  assert.equal(st.getItem('carweb_cast_paired'), null);
});

test('tên màn hình xe lấy từ User-Agent của đầu xe Android, không có thì "Màn hình xe"', () => {
  assert.equal(receiverNameFromUa('Mozilla/5.0 (Linux; Android 10; TS10 Build/QP1A.190711.020; wv) AppleWebKit/537.36'), 'TS10');
  assert.equal(receiverNameFromUa('Mozilla/5.0 (Linux; Android 12; UIS7862S) AppleWebKit/537.36 Chrome/120 Safari/537.36'), 'UIS7862S');
  assert.equal(receiverNameFromUa('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36'), 'Màn hình xe');
  assert.equal(receiverNameFromUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130'), 'Màn hình xe');
  assert.equal(receiverNameFromUa(''), 'Màn hình xe');
});

test('castApi: các lệnh ghép đôi gửi khóa thiết bị trong header X-Cast-Device; máy có khóa gửi kèm lúc tạo/nhập mã', async () => {
  const calls = [];
  const api = { get: async (p, hd) => { calls.push(['GET', p, null, hd]); return {}; }, post: async (p, b, hd) => { calls.push(['POST', p, b, hd || null]); return {}; } };
  const c = createCastApi(api);
  const k = 'a'.repeat(48);
  await c.create(k, 'TS10');
  await c.create();
  await c.join('482913', 'Pixel', k);
  await c.join('482913', 'Pixel');
  await c.pairs(k);
  await c.share(7, k, 'Pixel');
  await c.incoming(k);
  await c.forget('7', k);
  assert.deepEqual(calls, [
    ['POST', '/cast/sessions', { device_key: k, device_name: 'TS10' }, null],
    ['POST', '/cast/sessions', {}, null],
    ['POST', '/cast/join', { code: '482913', device_name: 'Pixel', device_key: k }, null],
    ['POST', '/cast/join', { code: '482913', device_name: 'Pixel' }, null],
    ['GET', '/cast/pairs', null, { 'X-Cast-Device': k }],
    ['POST', '/cast/pairs/7/share', { device_name: 'Pixel' }, { 'X-Cast-Device': k }],
    ['GET', '/cast/incoming', null, { 'X-Cast-Device': k }],
    ['POST', '/cast/pairs/7/forget', {}, { 'X-Cast-Device': k }],
  ]);
});

// ---------- màn hình xe hỏi lời mời ----------

function incomingRig({ paired = true, answers = [] } = {}) {
  const st = memStorage(paired ? { carweb_cast_paired: '1' } : {});
  const device = createCastDevice({ storage: st });
  const timers = fakeTimers();
  const calls = [];
  const got = [];
  const queue = answers.slice();
  const castApi = { incoming: async (k) => { calls.push(k); const a = queue.length ? queue.shift() : { pairs: 1, incoming: null, poll_seconds: 3 }; if (a instanceof Error) throw a; return a; } };
  let busy = false;
  let hidden = false;
  const inc = createCastIncoming({ castApi, device, timers, isBusy: () => busy, isHidden: () => hidden, onIncoming: (s, ice) => got.push([s, ice]) });
  return { st, device, timers, calls, got, queue, inc, setBusy: (v) => { busy = v; }, setHidden: (v) => { hidden = v; } };
}

test('màn hình xe chưa ghép đôi: KHÔNG hỏi gì; ghép đôi xong thì bắt đầu hỏi', async () => {
  const r = incomingRig({ paired: false });
  r.inc.start();
  assert.deepEqual(r.timers.pending(), []);
  r.timers.fire(100000);
  await settle();
  assert.equal(r.calls.length, 0);
  r.inc.paired();
  assert.equal(r.device.isPaired(), true);
  assert.deepEqual(r.timers.pending(), [3000]);
  r.timers.fire(3000);
  await settle();
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0], r.device.key(), 'hỏi bằng khóa thiết bị');
});

test('màn hình xe đã ghép đôi: hỏi theo nhịp máy chủ báo, có lời mời thì nhận; đang chiếu / trang ẩn thì không hỏi', async () => {
  const sess = { id: 41, device_name: 'SM-A546E', pair_id: 3 };
  const r = incomingRig({ answers: [{ pairs: 1, incoming: null, poll_seconds: 5 }, { pairs: 1, incoming: sess, ice_servers: [{ urls: ['stun:x'] }], poll_seconds: 5 }] });
  r.inc.start();
  assert.deepEqual(r.timers.pending(), [0], 'hỏi ngay khi mở');
  r.timers.fire(0);
  await settle();
  assert.deepEqual(r.timers.pending(), [5000], 'theo poll_seconds của máy chủ');
  r.timers.fire(5000);
  await settle();
  assert.deepEqual(r.got, [[sess, [{ urls: ['stun:x'] }]]]);
  // đang chiếu: không gọi máy chủ
  r.setBusy(true);
  r.timers.fire(5000);
  await settle();
  assert.equal(r.calls.length, 2);
  assert.deepEqual(r.timers.pending(), [5000], 'vẫn hẹn lần sau');
  r.setBusy(false);
  r.setHidden(true);
  r.timers.fire(5000);
  await settle();
  assert.equal(r.calls.length, 2, 'trang ẩn: không hỏi');
  r.setHidden(false);
  r.inc.poke();
  assert.deepEqual(r.timers.pending(), [0], 'hiện lại: hỏi ngay');
  r.timers.fire(0);
  await settle();
  assert.equal(r.calls.length, 3);
  r.inc.stop();
  assert.deepEqual(r.timers.pending(), []);
  assert.equal(r.inc.isRunning(), false);
});

test('màn hình xe: bên kia "Quên" hết thì thôi hỏi hẳn; lỗi mạng thì chờ lâu dần (tối đa 60 giây) rồi hỏi lại', async () => {
  const r = incomingRig({ answers: [new Error('mạng'), new Error('mạng'), { pairs: 1, incoming: null, poll_seconds: 3 }, { pairs: 0, incoming: null, poll_seconds: 3 }] });
  r.inc.start();
  r.timers.fire(0);
  await settle();
  assert.deepEqual(r.timers.pending(), [6000], 'lỗi lần 1: 6 giây');
  r.timers.fire(6000);
  await settle();
  assert.deepEqual(r.timers.pending(), [12000], 'lỗi lần 2: 12 giây');
  r.timers.fire(12000);
  await settle();
  assert.deepEqual(r.timers.pending(), [3000], 'được rồi: về nhịp thường');
  r.timers.fire(3000);
  await settle();
  assert.deepEqual(r.timers.pending(), [], 'không còn cặp nào: thôi hỏi');
  assert.equal(r.device.isPaired(), false);
  assert.equal(r.st.getItem('carweb_cast_paired'), null);
  // lỗi liên tục: không quá 60 giây
  const r2 = incomingRig({ answers: Array.from({ length: 8 }, () => new Error('x')) });
  r2.inc.start();
  r2.timers.fire(0);
  for (let i = 0; i < 7; i++) { await settle(); r2.timers.fire(100000); }
  await settle();
  assert.deepEqual(r2.timers.pending(), [60000]);
});

// ---------- màn hình xe nhận lời mời ----------

test('màn hình xe: điện thoại nhập mã kèm khóa thiết bị -> báo đã ghép đôi (một lần); khóa thiết bị là khóa của phiên', async () => {
  const f = fakeLinkFactory();
  const device = createCastDevice({ storage: memStorage() });
  const paired = [];
  const created = [];
  const castApi = { create: async (k, n) => { created.push([k, n]); return { id: 9, code: '482913', expires_in: 300, ice_servers: [] }; }, end: async () => {} };
  const r = createCastReceiver({ castApi, makeLink: f.makeLink, device, name: 'TS10', onPaired: (id) => paired.push(id) });
  r.open();
  await settle();
  assert.deepEqual(created, [[device.key(), 'TS10']]);
  assert.deepEqual(f.made[0].opts.session, { id: 9, token: device.key() }, 'máy chủ không cấp khóa mới: dùng khóa thiết bị');
  f.made[0].opts.onInfo({ deviceName: '', pairId: 0 });
  f.made[0].opts.onInfo({ deviceName: 'SM-A546E', pairId: 3 });
  f.made[0].opts.onInfo({ deviceName: 'SM-A546E', pairId: 3 });
  assert.deepEqual(paired, [3]);
  assert.equal(r.snapshot().via, 'code');
});

test('màn hình xe: nhận lời mời "Chia sẻ" -> nối luôn không cần mã; điện thoại hủy trước khi có hình thì thôi (không hiện mã)', async () => {
  const f = fakeLinkFactory();
  const device = createCastDevice({ storage: memStorage() });
  const phases = [];
  const ended = [];
  let creates = 0;
  const castApi = { create: async () => { creates += 1; return { id: 1, code: '111111', expires_in: 300 }; }, end: async () => {} };
  const r = createCastReceiver({ castApi, makeLink: f.makeLink, device, onChange: (s) => phases.push(s.phase), onEnded: (by, wasLive) => ended.push([by, wasLive]) });
  assert.equal(r.accept(null), false);
  assert.equal(r.accept({ id: 0 }), false);
  assert.equal(r.accept({ id: 41, device_name: 'SM-A546E', pair_id: 3 }, [{ urls: ['stun:x'] }]), true);
  const link = f.made[0];
  assert.deepEqual([link.opts.role, link.opts.session, link.opts.iceServers], ['receiver', { id: 41, token: device.key() }, [{ urls: ['stun:x'] }]]);
  assert.deepEqual([r.snapshot().phase, r.snapshot().via, r.snapshot().deviceName, r.snapshot().code], ['connecting', 'share', 'SM-A546E', '']);
  link.opts.onState('waiting');
  assert.equal(r.snapshot().phase, 'connecting', 'không có mã để hiện');
  link.opts.onEnded('sender');
  assert.deepEqual(ended, [['sender', false]]);
  assert.equal(r.snapshot().phase, 'off');
  assert.equal(creates, 0, 'không tự lấy mã mới');
  // lần sau: nối được, đang chiếu thì không nhận lời mời khác
  r.accept({ id: 42, device_name: 'SM-A546E' });
  f.made[1].opts.onState('connected');
  assert.equal(r.isLive(), true);
  assert.equal(r.accept({ id: 43, device_name: 'Máy khác' }), false);
  assert.equal(f.made.length, 2);
  f.made[1].opts.onEnded('sender');
  assert.deepEqual(ended[1], ['sender', true]);
  // đang hiện mã mà điện thoại đã ghép đôi bấm "Chia sẻ": bỏ mã, nối luôn
  r.open();
  await settle();
  assert.equal(r.snapshot().phase, 'loading');
  f.made[2].opts.onState('waiting');
  assert.equal(r.snapshot().phase, 'code');
  assert.equal(r.accept({ id: 44, device_name: 'SM-A546E' }), true);
  assert.equal(f.made[2].stopped, true, 'phiên mã bị hủy');
  assert.equal(r.snapshot().phase, 'connecting');
  // máy không có khóa thiết bị: không nhận lời mời
  const r2 = createCastReceiver({ castApi, makeLink: f.makeLink });
  assert.equal(r2.accept({ id: 45 }), false);
});

// ---------- điện thoại bấm "Chia sẻ" ----------

function fakeNative() {
  const sent = [];
  const subs = new Set();
  return { sent, castStart: (o) => { sent.push(['start', o]); return true; }, castStop: () => { sent.push(['stop']); return true; }, onCast: (fn) => { subs.add(fn); return () => subs.delete(fn); }, emit: (e, d) => subs.forEach((fn) => fn(e, d || {})) };
}
function shareRig({ share } = {}) {
  const f = fakeLinkFactory();
  const native = fakeNative();
  const timers = fakeTimers();
  const device = createCastDevice({ storage: memStorage() });
  const phases = [];
  const ends = [];
  const shares = [];
  const joins = [];
  const paired = [];
  const castApi = {
    share: share || (async (id, k, n) => { shares.push([id, k, n]); return { id: 77, role: 'sender', ice_servers: [{ urls: ['stun:z'] }], pair: { id, name: 'TS10' } }; }),
    join: async (c, n, k) => { joins.push([c, n, k]); return { id: 5, ice_servers: [], pair: { id: 3, name: 'TS10' } }; },
    end: async (s) => { ends.push(s); },
  };
  let paused = 0;
  const sender = createCastSender({ castApi, nativeApp: native, makeLink: f.makeLink, device, timers, deviceName: () => 'SM-A546E',
    fetchImpl: async () => ({ status: 204, headers: { get: () => null } }), frameUrl: () => 'https://xe.test/__cast/frame',
    onChange: (s) => phases.push(s.phase), onBeforeLive: () => { paused += 1; }, onPaired: (p) => paired.push(p) });
  return { f, native, timers, device, phases, ends, shares, joins, paired, sender, paused: () => paused };
}

test('điện thoại nhập mã kèm khóa thiết bị: ghép đôi luôn (báo tên màn hình xe), khóa thiết bị là khóa của phiên', async () => {
  const rig = shareRig();
  assert.equal(await rig.sender.start('482 913'), true);
  assert.deepEqual(rig.joins, [['482913', 'SM-A546E', rig.device.key()]]);
  assert.deepEqual(rig.paired, [{ id: 3, name: 'TS10' }]);
  assert.deepEqual(rig.sender.snapshot().target, { id: 3, name: 'TS10' });
  rig.native.emit('started', { width: 540, height: 1170 });
  assert.deepEqual(rig.f.made[0].opts.session, { id: 5, token: rig.device.key(), ice: [] });
  rig.sender.stop();
});

test('"Chia sẻ" một chạm: hỏi quyền trước, cho phép rồi mới gửi lời mời; màn hình xe nhận -> đang chiếu', async () => {
  const rig = shareRig();
  assert.equal(rig.sender.share(null), false);
  assert.equal(rig.sender.share({ id: 0 }), false);
  assert.equal(rig.sender.share({ id: 3, name: 'TS10' }), true);
  assert.deepEqual(rig.native.sent, [['start', CAPTURE_OPTIONS]]);
  assert.equal(rig.sender.snapshot().phase, 'permission');
  assert.deepEqual(rig.shares, [], 'chưa cho phép thì chưa gửi lời mời (màn hình xe chưa đổi)');
  assert.equal(rig.sender.share({ id: 3 }), false, 'đang làm: bấm lần nữa không làm gì');
  rig.native.emit('started', { width: 540, height: 1170 });
  assert.equal(rig.sender.snapshot().phase, 'sharing');
  await settle();
  assert.deepEqual(rig.shares, [[3, rig.device.key(), 'SM-A546E']]);
  assert.equal(rig.paused(), 1, 'điện thoại dừng nhạc của mình');
  const link = rig.f.made[0];
  assert.deepEqual([link.opts.role, link.opts.session], ['sender', { id: 77, token: rig.device.key(), ice: [{ urls: ['stun:z'] }] }]);
  const s1 = rig.sender.snapshot();
  assert.deepEqual([s1.phase, s1.via, s1.picked, s1.target], ['connecting', 'share', false, { id: 3, name: 'TS10' }]);
  assert.match(busyText(s1), /Đang chờ "TS10" nhận/);
  link.opts.onInfo({ picked: true });
  assert.equal(rig.sender.snapshot().picked, true);
  assert.match(busyText(rig.sender.snapshot()), /Đang nối với "TS10"/);
  link.opts.onState('connected');
  assert.equal(rig.sender.snapshot().phase, 'live');
  assert.deepEqual(rig.timers.pending().filter((ms) => ms >= SHARE_PICK_MS), [], 'đã chiếu: không còn hẹn giờ báo lỗi');
  rig.sender.stop();
  assert.equal(link.stopped, true);
  assert.deepEqual(rig.native.sent.slice(-1), [['stop']]);
});

test('"Chia sẻ": màn hình xe không nhận / nối không được thì báo rõ lý do; từ chối quyền; lỗi gửi lời mời; hủy giữa chừng', async () => {
  // 1. màn hình xe không nhận lời mời sau 30 giây
  const a = shareRig();
  a.sender.share({ id: 3, name: 'TS10' });
  a.native.emit('started', {});
  await settle();
  assert.deepEqual(a.timers.pending().filter((ms) => ms >= SHARE_PICK_MS), [SHARE_PICK_MS, SHARE_CONNECT_MS]);
  a.timers.fire(SHARE_PICK_MS);
  assert.equal(a.sender.snapshot().phase, 'error');
  assert.match(a.sender.snapshot().message, /"TS10" chưa nhận lời mời.*mở PH Car Play.*"Quên" rồi ghép đôi lại/);
  assert.equal(a.f.made[0].stopped, true, 'kết thúc phiên (máy chủ biết điện thoại đã thôi)');
  assert.deepEqual(a.native.sent.slice(-1), [['stop']], 'ngừng chụp màn hình');
  // 2. đã nhận nhưng không nối được (khác mạng) sau 50 giây
  const b = shareRig();
  b.sender.share({ id: 3, name: 'TS10' });
  b.native.emit('started', {});
  await settle();
  b.f.made[0].opts.onInfo({ picked: true });
  b.timers.fire(SHARE_PICK_MS);
  assert.equal(b.sender.snapshot().phase, 'connecting', 'đã nhận: chờ tiếp');
  b.timers.fire(SHARE_CONNECT_MS);
  assert.match(b.sender.snapshot().message, /Chưa nối được với "TS10".*chung mạng/);
  // 3. từ chối quyền ghi màn hình
  const c = shareRig();
  c.sender.share({ id: 3, name: 'TS10' });
  c.native.emit('denied');
  assert.match(c.sender.snapshot().message, /Bấm "Chia sẻ" để thử lại/);
  assert.deepEqual(c.shares, [], 'không gửi lời mời');
  // 4. máy chủ báo lỗi khi gửi lời mời (màn hình xe đã bấm "Quên")
  const err = new Error('Không tìm thấy máy đã ghép đôi (có thể máy bên kia đã bấm "Quên").');
  const d = shareRig({ share: async () => { throw err; } });
  d.sender.share({ id: 3, name: 'TS10' });
  d.native.emit('started', {});
  await settle();
  assert.equal(d.sender.snapshot().phase, 'error');
  assert.equal(d.sender.snapshot().message, err.message);
  assert.deepEqual(d.native.sent.slice(-1), [['stop']]);
  // 5. bấm Hủy lúc lời mời đang gửi: phiên vừa tạo được kết thúc luôn
  let release;
  const e = shareRig({ share: () => new Promise((res) => { release = res; }) });
  e.sender.share({ id: 3, name: 'TS10' });
  e.native.emit('started', {});
  e.sender.stop();
  release({ id: 88, ice_servers: [] });
  await settle();
  assert.deepEqual(e.ends.map((s) => s.id), [88]);
  assert.equal(e.f.made.length, 0);
  assert.equal(e.sender.snapshot().phase, 'idle');
  // 6. máy không có khóa thiết bị: không chia sẻ một chạm được
  const n2 = fakeNative();
  const noKey = createCastSender({ castApi: {}, nativeApp: n2, makeLink: fakeLinkFactory().makeLink, timers: fakeTimers() });
  assert.equal(noKey.share({ id: 3 }), false);
  assert.deepEqual(n2.sent, []);
});

test('chữ trong hộp "Chia sẻ": trạng thái từng bước, ngày ghép đôi', () => {
  assert.equal(busyText({ phase: 'joining' }), 'Đang kiểm tra mã...');
  assert.match(busyText({ phase: 'permission' }), /"Bắt đầu"/);
  assert.equal(busyText({ phase: 'sharing', target: { name: 'TS10' } }), 'Đang gửi lời mời tới "TS10"...');
  assert.equal(busyText({ phase: 'connecting', via: 'code', target: null }), 'Đang nối với màn hình xe...');
  assert.equal(busyText({ phase: 'idle' }), '');
  assert.equal(shortDate('2026-11-27 08:30:00'), '27/11/2026');
  assert.equal(shortDate(''), '');
  assert.equal(shortDate(null), '');
});
