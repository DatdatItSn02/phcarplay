// Giai đoạn 13: cầu nối với ứng dụng điện thoại (core/nativeApp.js), phím nhạc (mediaKeys.js), tắt cửa sổ nổi trong ứng dụng.
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectApp, createNativeBridge, createAppLifecycle, MEDIA_KEYS, versionAtLeast, createBackgroundPref, BACKGROUND_KEY } from '../../public/assets/js/core/nativeApp.js';
import { handleMediaKey, SEEK_STEP } from '../../public/assets/js/modules/youtube/mediaKeys.js';
import { createPip } from '../../public/assets/js/modules/pip/pipController.js';

const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 PHCarPlayApp/1.2.0 (Android)';
const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 PHCarPlayApp/1.0.3 (iOS)';
const UA_CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

function fakeWin({ android = true, ios = false } = {}) {
  const sent = [];
  const attrs = {};
  const w = { document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } } };
  if (android) w.PHCarPlayNative = { postMessage: (s) => sent.push(JSON.parse(s)) };
  if (ios) w.webkit = { messageHandlers: { PHCarPlayNative: { postMessage: (s) => sent.push(JSON.parse(s)) } } };
  return { w, sent, attrs };
}
function fakeTimers() {
  const list = [];
  return { list, set: (fn, ms) => { list.push({ fn, ms, on: true }); return list.length - 1; }, clear: (t) => { if (list[t]) list[t].on = false; }, fire() { list.forEach((t) => { if (t.on) { t.on = false; t.fn(); } }); } };
}
function recorder() {
  const log = [];
  return { log, cb: { onPartial: (t) => log.push('partial:' + t), onResult: (t) => log.push('result:' + t), onError: (c) => log.push('error:' + c), onEnd: () => log.push('end') } };
}

test('detectApp: nhận ra ứng dụng Android/iOS qua User-Agent, trình duyệt thường thì null', () => {
  assert.deepEqual(detectApp(UA_ANDROID), { platform: 'android', version: '1.2.0' });
  assert.deepEqual(detectApp(UA_IOS), { platform: 'ios', version: '1.0.3' });
  assert.equal(detectApp(UA_CHROME), null);
  assert.equal(detectApp(''), null);
  assert.equal(detectApp(undefined), null);
  assert.equal(detectApp('PHCarPlayApp/x (Android)'), null, 'phiên bản phải bắt đầu bằng số');
  assert.equal(detectApp('PHCarPlayApp/1.0 (Windows)'), null);
});

test('trình duyệt thường: không cài window.__phApp, không có giọng nói của máy, không gửi gì', () => {
  const { w, sent, attrs } = fakeWin();
  const b = createNativeBridge({ win: w, ua: UA_CHROME });
  assert.equal(b.inApp, false);
  assert.equal(b.install(), false);
  assert.equal(w.__phApp, undefined);
  assert.equal(attrs['data-app'], undefined);
  assert.equal(b.canVoice(), false);
  assert.equal(b.reportState({ playing: true, title: 'a' }), false);
  assert.equal(sent.length, 0);
});

test('Android: cài window.__phApp + data-app, giọng nói của máy (một phần -> kết quả), bỏ tin của lần nghe khác', () => {
  const { w, sent, attrs } = fakeWin();
  const timers = fakeTimers();
  const b = createNativeBridge({ win: w, ua: UA_ANDROID, timers });
  assert.equal(b.install(), true);
  assert.equal(attrs['data-app'], 'android');
  assert.equal(typeof w.__phApp.back, 'function');
  assert.equal(b.canVoice(), true);
  const r = recorder();
  b.listen(r.cb);
  assert.deepEqual(sent[0], { type: 'voice.start', id: 1, lang: 'vi-VN' });
  assert.equal(w.__phApp.voice({ id: 99, kind: 'result', text: 'khác' }), false, 'id lạ thì bỏ qua');
  assert.equal(w.__phApp.voice({ id: 1, kind: 'partial', text: 'sơn' }), true);
  assert.equal(w.__phApp.voice('{"id":1,"kind":"result","text":"  sơn tùng  "}'), true, 'nhận cả chuỗi JSON');
  assert.deepEqual(r.log, ['partial:sơn', 'result:sơn tùng', 'end']);
  assert.equal(w.__phApp.voice({ id: 1, kind: 'result', text: 'lặp' }), false, 'đã xong thì không nhận nữa');
  timers.fire();
  assert.deepEqual(r.log, ['partial:sơn', 'result:sơn tùng', 'end'], 'hẹn giờ đã hủy khi có kết quả');
});

test('giọng nói: lỗi của máy, kết quả rỗng, hủy, nghe lần mới hủy lần cũ, ứng dụng không trả lời', () => {
  const { w, sent } = fakeWin();
  const timers = fakeTimers();
  const b = createNativeBridge({ win: w, ua: UA_ANDROID, timers });
  b.install();
  const r1 = recorder();
  b.listen(r1.cb);
  w.__phApp.voice({ id: 1, kind: 'error', code: 'app-denied' });
  assert.deepEqual(r1.log, ['error:app-denied', 'end']);
  const r2 = recorder();
  b.listen(r2.cb);
  w.__phApp.voice({ id: 2, kind: 'result', text: '   ' });
  assert.deepEqual(r2.log, ['error:no-speech', 'end'], 'kết quả rỗng = không nghe thấy');
  const r3 = recorder();
  const s3 = b.listen(r3.cb);
  s3.stop();
  assert.deepEqual(sent[sent.length - 1], { type: 'voice.stop', id: 3 });
  assert.deepEqual(r3.log, [], 'tự hủy thì không gọi lại');
  const r4 = recorder();
  b.listen(r4.cb);
  const r5 = recorder();
  b.listen(r5.cb);
  assert.deepEqual(sent.slice(-2), [{ type: 'voice.stop', id: 4 }, { type: 'voice.start', id: 5, lang: 'vi-VN' }]);
  timers.fire();
  assert.deepEqual(r5.log, ['error:no-speech', 'end'], 'ứng dụng không trả lời thì hết giờ = không nghe thấy');
  assert.deepEqual(r4.log, []);
});

test('giọng nói: gửi không được (kênh lỗi) thì báo "not-available" ngay; iOS dùng webkit.messageHandlers', () => {
  const w = { PHCarPlayNative: { postMessage() { throw new Error('hỏng'); } } };
  const b = createNativeBridge({ win: w, ua: UA_ANDROID, timers: fakeTimers() });
  const r = recorder();
  b.listen(r.cb);
  assert.deepEqual(r.log, ['error:not-available', 'end']);

  const ios = fakeWin({ android: false, ios: true });
  const bi = createNativeBridge({ win: ios.w, ua: UA_IOS, timers: fakeTimers() });
  bi.install();
  assert.equal(ios.attrs['data-app'], 'ios');
  bi.listen(Object.assign(recorder().cb, { lang: 'vi-VN' }));
  assert.deepEqual(ios.sent[0], { type: 'voice.start', id: 1, lang: 'vi-VN' });
  // ứng dụng iOS nhưng kênh Android (sai nền tảng) thì không dùng
  const wrong = fakeWin({ android: true, ios: false });
  assert.equal(createNativeBridge({ win: wrong.w, ua: UA_IOS }).canVoice(), false);
});

test('UA ứng dụng nhưng không có kênh: vẫn cài __phApp (Quay lại, phím nhạc chạy được), không dùng giọng nói của máy', () => {
  const w = { document: { documentElement: { setAttribute() {} } } };
  const b = createNativeBridge({ win: w, ua: UA_ANDROID });
  assert.equal(b.install(), true);
  assert.equal(b.canVoice(), false);
  let got = '';
  b.onMediaKey((k) => { got = k; return true; });
  assert.equal(w.__phApp.mediaKey('next'), true);
  assert.equal(got, 'next');
});

test('Quay lại: đóng hộp thoại trước, rồi tới bộ xử lý đăng ký sau cùng; không ai xử lý thì false', () => {
  let dialogs = 1;
  const order = [];
  const b = createNativeBridge({ win: {}, ua: UA_ANDROID, closeDialog: () => { if (dialogs > 0) { dialogs -= 1; return true; } return false; } });
  const off1 = b.onBack(() => { order.push('shell'); return false; });
  b.onBack(() => { throw new Error('lỗi không làm hỏng'); });
  const off3 = b.onBack(() => { order.push('top'); return true; });
  assert.equal(b.handlers.back(), true, 'có hộp thoại -> đóng hộp');
  assert.deepEqual(order, []);
  assert.equal(b.handlers.back(), true);
  assert.deepEqual(order, ['top']);
  off3();
  assert.equal(b.handlers.back(), false, 'không ai xử lý -> ứng dụng tự lo (bấm 2 lần để thoát)');
  assert.deepEqual(order, ['top', 'shell']);
  off1();
  assert.equal(b.handlers.back(), false);
});

test('phím nhạc và ra nền/hiện lại: chỉ nhận tên hợp lệ, true khi có bộ xử lý nhận', () => {
  const b = createNativeBridge({ win: {}, ua: UA_ANDROID });
  assert.equal(b.handlers.mediaKey('play'), false, 'chưa có ai nghe');
  const keys = [];
  const off = b.onMediaKey((k) => { keys.push(k); return k !== 'pause'; });
  MEDIA_KEYS.forEach((k) => b.handlers.mediaKey(k));
  assert.deepEqual(keys, MEDIA_KEYS);
  assert.equal(b.handlers.mediaKey('pause'), false);
  assert.equal(b.handlers.mediaKey('eject'), false);
  off();
  const states = [];
  b.onLifecycle((s) => states.push(s));
  b.handlers.lifecycle('hidden');
  b.handlers.lifecycle('visible');
  b.handlers.lifecycle('lạ');
  assert.deepEqual(states, ['hidden', 'visible', 'visible']);
});

test('báo trạng thái phát: chỉ gửi khi đổi (trừ khi ép), làm tròn số, cắt chữ quá dài', () => {
  const { w, sent } = fakeWin();
  const b = createNativeBridge({ win: w, ua: UA_ANDROID });
  assert.equal(b.reportState({ playing: true, title: 'Bài A', artist: 'Ca sĩ', duration: 200.4, position: 3.14159 }), true);
  assert.deepEqual(sent[0], { type: 'state', playing: true, title: 'Bài A', artist: 'Ca sĩ', duration: 200, position: 3.1 });
  assert.equal(b.reportState({ playing: true, title: 'Bài A', artist: 'Ca sĩ', duration: 200, position: 50 }), false, 'không đổi');
  assert.equal(b.reportState({ playing: true, title: 'Bài A', artist: 'Ca sĩ', duration: 200, position: 50 }, true), true, 'ép gửi (vừa tua)');
  assert.equal(b.reportState({ playing: false, title: 'Bài A', artist: 'Ca sĩ', duration: NaN, position: NaN }), true);
  assert.deepEqual(sent[2], { type: 'state', playing: false, title: 'Bài A', artist: 'Ca sĩ', duration: 0, position: 0 });
  b.reportState({ playing: true, title: 'x'.repeat(500) });
  assert.equal(sent[3].title.length, 200);
});

function fakePlayer({ current = { id: 'a' }, paused = false } = {}) {
  const calls = [];
  const surface = { paused, currentTime: 50, duration: 100 };
  let userPaused = false;
  const controller = {
    snapshot: () => ({ current, userPaused }),
    toggle: () => { calls.push('toggle'); surface.paused = !surface.paused; userPaused = surface.paused; return Promise.resolve(true); },
    next: () => { calls.push('next'); return Promise.resolve(true); },
    prev: () => { calls.push('prev'); return Promise.reject(new Error('lỗi được nuốt')); },
  };
  return { calls, surface, controller };
}

test('phím nhạc -> trình phát: phát/dừng, bài sau/trước, tua 10 giây (không quá đầu/cuối bài), chưa có bài thì bỏ qua', () => {
  const p = fakePlayer({ paused: false });
  const k = (key) => handleMediaKey(key, p);
  assert.equal(k('play'), true);
  assert.deepEqual(p.calls, [], 'đang phát thì "play" không làm gì');
  k('pause');
  assert.deepEqual(p.calls, ['toggle']);
  k('pause');
  assert.deepEqual(p.calls, ['toggle'], 'đã dừng thì "pause" không làm gì');
  k('toggle');
  k('next');
  k('prev');
  assert.deepEqual(p.calls, ['toggle', 'toggle', 'next', 'prev']);
  k('forward');
  assert.equal(p.surface.currentTime, 50 + SEEK_STEP);
  p.surface.currentTime = 95;
  k('forward');
  assert.equal(p.surface.currentTime, 99, 'không tua quá cuối bài');
  p.surface.currentTime = 4;
  k('rewind');
  assert.equal(p.surface.currentTime, 0);
  assert.equal(k('eject'), false);
  const none = fakePlayer({ current: null });
  assert.equal(handleMediaKey('toggle', none), false);
  assert.deepEqual(none.calls, []);
});

test('ra nền: đang phát thì dừng, hiện lại thì phát tiếp; đã dừng sẵn thì giữ dừng; máy tự dừng ngay trước đó vẫn phát tiếp', () => {
  let t = 1000;
  const p = fakePlayer({ paused: false });
  const life = createAppLifecycle({ controller: p.controller, surface: p.surface, now: () => t });
  life.tick();
  assert.equal(life.set('hidden'), true);
  assert.equal(p.surface.paused, true);
  assert.equal(life.set('hidden'), false, 'báo hai lần (ứng dụng + visibilitychange) chỉ xử lý một lần');
  life.set('visible');
  assert.equal(p.surface.paused, false);
  assert.deepEqual(p.calls, ['toggle', 'toggle']);

  const q = fakePlayer({ paused: true });
  const life2 = createAppLifecycle({ controller: q.controller, surface: q.surface, now: () => t });
  life2.set('hidden');
  life2.set('visible');
  assert.deepEqual(q.calls, [], 'người dùng đã dừng thì không tự phát');

  const r = fakePlayer({ paused: false });
  const life3 = createAppLifecycle({ controller: r.controller, surface: r.surface, now: () => t });
  life3.tick();
  r.surface.paused = true;   // iPhone tự dừng video trước khi website kịp nghe tin ra nền
  t += 800;
  life3.set('hidden');
  life3.set('visible');
  assert.deepEqual(r.calls, ['toggle'], 'vừa phát trong 2 giây trước đó -> hiện lại thì phát tiếp');
  life3.tick();
  r.surface.paused = true;
  t += 5000;
  r.calls.length = 0;
  life3.set('hidden');
  life3.set('visible');
  assert.deepEqual(r.calls, [], 'dừng đã lâu thì không tự phát');

  const u = fakePlayer({ paused: false });
  const life4 = createAppLifecycle({ controller: u.controller, surface: u.surface, now: () => t });
  life4.tick();
  u.controller.toggle();   // người dùng bấm dừng
  t += 300;                // rồi ra nền ngay sau đó
  u.calls.length = 0;
  life4.set('hidden');
  life4.set('visible');
  assert.deepEqual(u.calls, [], 'người dùng vừa bấm dừng (dù mới 0,3 giây) thì hiện lại vẫn dừng');
});

test('cửa sổ nổi tắt hẳn trong ứng dụng: không nút, không gợi ý "chưa hỗ trợ"', () => {
  const doc = { pictureInPictureEnabled: true, pictureInPictureElement: null };
  const video = { readyState: 4, videoWidth: 640, requestPictureInPicture: async () => {}, addEventListener() {}, removeEventListener() {} };
  const on = createPip({ video, doc, allowed: true }).snapshot();
  assert.equal(on.supported, true);
  const off = createPip({ video, doc, allowed: true, disabled: true }).snapshot();
  assert.equal(off.supported, false);
  assert.equal(off.ready, false);
  assert.equal(off.hint, '');
});

// ---------------------------------------------------------------- giai đoạn 15: phát trong nền
const UA_ANDROID_OLD = UA_ANDROID.replace('PHCarPlayApp/1.2.0', 'PHCarPlayApp/1.0.0');

test('versionAtLeast: so sánh phiên bản ứng dụng', () => {
  assert.equal(versionAtLeast('1.1.0', '1.1.0'), true);
  assert.equal(versionAtLeast('1.2', '1.1.0'), true);
  assert.equal(versionAtLeast('2.0.0', '1.1.0'), true);
  assert.equal(versionAtLeast('1.10.0', '1.9.0'), true, 'so theo số, không theo chữ');
  assert.equal(versionAtLeast('1.0.9', '1.1.0'), false);
  assert.equal(versionAtLeast('1.0.0', '1.1.0'), false);
  assert.equal(versionAtLeast('', '1.1.0'), false);
  assert.equal(versionAtLeast('1.1.0-beta', '1.1.0'), true);
});

test('phát trong nền: chỉ ứng dụng từ 1.1.0 có kênh mới hỗ trợ; setBackground gửi tin cho ứng dụng', () => {
  const a = fakeWin();
  const app = createNativeBridge({ win: a.w, ua: UA_ANDROID });
  assert.equal(app.supportsBackground(), true);
  assert.equal(app.setBackground(true), true);
  assert.equal(app.setBackground(false), true);
  assert.equal(app.setBackground('yes'), true);
  assert.deepEqual(a.sent, [{ type: 'background', enabled: true }, { type: 'background', enabled: false }, { type: 'background', enabled: false }]);

  const b = fakeWin();
  assert.equal(createNativeBridge({ win: b.w, ua: UA_ANDROID_OLD }).supportsBackground(), false, 'ứng dụng bản 1.0.0');
  const c = fakeWin({ android: false });
  assert.equal(createNativeBridge({ win: c.w, ua: UA_ANDROID }).supportsBackground(), false, 'không có kênh');
  const d = fakeWin();
  const web = createNativeBridge({ win: d.w, ua: UA_CHROME });
  assert.equal(web.supportsBackground(), false, 'trình duyệt thường');
  assert.equal(web.setBackground(true), false);
  assert.deepEqual(d.sent, []);
});

test('cài đặt "Phát trong nền": mặc định bật, nhớ theo thiết bị, không lưu được vẫn chạy', () => {
  const data = {};
  const store = { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
  const pref = createBackgroundPref(store);
  assert.equal(pref.get(), true);
  assert.equal(pref.set(false), false);
  assert.equal(data[BACKGROUND_KEY], '0');
  assert.equal(createBackgroundPref(store).get(), false, 'mở lại vẫn nhớ');
  pref.set(true);
  assert.equal(createBackgroundPref(store).get(), true);
  const broken = { getItem: () => { throw new Error('bị chặn'); }, setItem: () => { throw new Error('bị chặn'); } };
  const p2 = createBackgroundPref(broken);
  assert.equal(p2.get(), true);
  assert.equal(p2.set(false), false);
  assert.equal(createBackgroundPref(null).get(), true);
});

test('ra nền khi đang "Phát trong nền": nhạc chạy tiếp; tắt cài đặt thì dừng như cũ', () => {
  let keep = true;
  const p = fakePlayer({ paused: false });
  const life = createAppLifecycle({ controller: p.controller, surface: p.surface, keepPlaying: () => keep });
  life.tick();
  assert.equal(life.set('hidden'), true);
  assert.equal(p.surface.paused, false, 'không dừng');
  life.set('visible');
  assert.deepEqual(p.calls, [], 'hiện lại cũng không bấm gì');

  keep = false;
  life.set('hidden');
  assert.equal(p.surface.paused, true);
  life.set('visible');
  assert.equal(p.surface.paused, false);
  assert.deepEqual(p.calls, ['toggle', 'toggle']);
});

test('đang ở nền mà bài mới phải phát bằng trình phát YouTube: dừng, hiện lại thì phát tiếp', () => {
  let embed = false;
  const p = fakePlayer({ paused: false });
  const life = createAppLifecycle({ controller: p.controller, surface: p.surface, keepPlaying: () => !embed });
  assert.equal(life.check(), false, 'đang hiện thì không làm gì');
  life.set('hidden');
  assert.equal(life.check(), false, 'bài thường: phát tiếp');
  embed = true;
  assert.equal(life.check(), true);
  assert.equal(p.surface.paused, true);
  assert.equal(life.check(), false, 'đã dừng rồi thì thôi');
  assert.equal(life.set('nudge'), false, 'không bấm phát lại bài YouTube ở nền');
  life.set('visible');
  assert.equal(p.surface.paused, false, 'hiện lại thì phát tiếp');
  assert.deepEqual(p.calls, ['toggle', 'toggle']);
});

test('iPhone tự dừng video lúc ra nền: nudge phát lại; người dùng bấm dừng thì không; không phát lại được thì hiện lại phát tiếp', () => {
  let t = 1000;
  const p = fakePlayer({ paused: false });
  const life = createAppLifecycle({ controller: p.controller, surface: p.surface, now: () => t, keepPlaying: () => true });
  life.tick();
  assert.equal(life.nudge(), false, 'đang hiện: bỏ qua');
  life.set('hidden');
  p.surface.paused = true;                 // iOS tự dừng
  assert.equal(life.set('nudge'), true);
  assert.equal(p.surface.paused, false, 'đã phát lại ở nền');
  assert.equal(life.nudge(), false, 'đang phát thì không bấm nữa');
  p.controller.toggle();                   // người dùng bấm dừng ở màn hình khóa
  p.calls.length = 0;
  assert.equal(life.nudge(), false);
  life.set('visible');
  assert.deepEqual(p.calls, [], 'người dùng đã dừng: hiện lại vẫn dừng');

  // iOS dừng trước khi website nghe tin ra nền, và không cho phát lại ở nền
  const q = fakePlayer({ paused: false });
  const stuck = { snapshot: q.controller.snapshot, toggle: () => { q.calls.push('toggle'); return Promise.resolve(false); } };
  const life2 = createAppLifecycle({ controller: stuck, surface: q.surface, now: () => t, keepPlaying: () => true });
  life2.tick();
  q.surface.paused = true;
  t += 500;
  life2.set('hidden');
  assert.equal(life2.nudge(), true);
  assert.equal(q.surface.paused, true, 'máy không cho phát');
  life2.set('visible');
  assert.deepEqual(q.calls, ['toggle', 'toggle'], 'hiện lại thì thử phát tiếp');

  // Android: không có nudge, bài hết ở nền -> hiện lại không tự phát
  const r = fakePlayer({ paused: false });
  const life3 = createAppLifecycle({ controller: r.controller, surface: r.surface, now: () => t, keepPlaying: () => true });
  life3.tick();
  life3.set('hidden');
  r.surface.paused = true;
  life3.set('visible');
  assert.deepEqual(r.calls, []);
});

test('ứng dụng gọi lifecycle("nudge"): chuyển nguyên cho website, giá trị lạ coi là "visible"', () => {
  const a = fakeWin();
  const app = createNativeBridge({ win: a.w, ua: UA_ANDROID });
  const seen = [];
  app.onLifecycle((s) => seen.push(s));
  app.handlers.lifecycle('hidden');
  app.handlers.lifecycle('nudge');
  app.handlers.lifecycle('whatever');
  assert.deepEqual(seen, ['hidden', 'nudge', 'visible']);
});
