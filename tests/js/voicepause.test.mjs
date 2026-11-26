// Giai đoạn 17: tìm bằng giọng nói tạm dừng nhạc, tìm xong phát tiếp (modules/browser/voicePause.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoicePause } from '../../public/assets/js/modules/browser/voicePause.js';

function fakePlayer(status = 'playing', id = 'a') {
  const listeners = new Set();
  const state = { status, current: id ? { id } : null };
  const calls = [];
  const emit = () => listeners.forEach((fn) => fn({ ...state }));
  return {
    state, calls,
    controller: {
      snapshot: () => ({ ...state }),
      toggle() { calls.push(state.status === 'playing' ? 'pause' : 'play'); state.status = state.status === 'playing' ? 'paused' : 'playing'; emit(); return Promise.resolve(true); },
    },
    onState: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    set(patch) { Object.assign(state, patch); emit(); },
    listenerCount: () => listeners.size,
  };
}
function fakeTimers() {
  const list = new Map();
  let n = 0;
  return { set: (fn, ms) => { n += 1; list.set(n, { fn, ms }); return n; }, clear: (id) => list.delete(id), fire() { const all = [...list.values()]; list.clear(); all.forEach((t) => t.fn()); }, size: () => list.size };
}

test('đang phát: mở micro thì tạm dừng, tìm xong thì phát tiếp đúng bài', () => {
  const p = fakePlayer('playing', 'a');
  const t = fakeTimers();
  const vp = createVoicePause({ controller: p.controller, onState: p.onState, timers: t });
  assert.equal(vp.begin(), true);
  assert.deepEqual(p.calls, ['pause']);
  assert.equal(vp.isHolding(), true);
  p.set({ status: 'paused' });   // sự kiện "pause" của thẻ video tới sau: vẫn giữ
  assert.equal(vp.isHolding(), true);
  assert.equal(vp.end(), true);
  assert.deepEqual(p.calls, ['pause', 'play']);
  assert.equal(vp.isHolding(), false);
  assert.equal(p.listenerCount(), 0, 'thôi theo dõi');
  assert.equal(t.size(), 0, 'hủy hẹn giờ');
  assert.equal(vp.end(), false, 'gọi lại end không làm gì');
  assert.deepEqual(p.calls, ['pause', 'play']);
});

test('không phát (đang dừng, chưa có bài, đang tải): không tạm dừng, xong cũng không tự phát', () => {
  for (const [status, id] of [['paused', 'a'], ['idle', null], ['loading', 'a'], ['error', 'a']]) {
    const p = fakePlayer(status, id);
    const vp = createVoicePause({ controller: p.controller, onState: p.onState, timers: fakeTimers() });
    assert.equal(vp.begin(), false, status);
    assert.equal(vp.end(), false, status);
    assert.deepEqual(p.calls, [], status);
  }
});

test('trong lúc nghe người dùng tự bấm phát / chọn bài khác / bài đang tải: không tự phát lại', () => {
  const cases = [
    (p) => p.set({ status: 'playing' }),
    (p) => p.set({ current: { id: 'b' } }),
    (p) => p.set({ status: 'loading' }),
    (p) => p.set({ current: null }),
  ];
  cases.forEach((act, i) => {
    const p = fakePlayer('playing', 'a');
    const vp = createVoicePause({ controller: p.controller, onState: p.onState, timers: fakeTimers() });
    vp.begin();
    act(p);
    assert.equal(vp.isHolding(), false, 'trường hợp ' + i);
    assert.equal(vp.end(), false, 'trường hợp ' + i);
    assert.deepEqual(p.calls, ['pause'], 'trường hợp ' + i);
  });
});

test('bấm "Thử lại" (begin lần nữa khi đang giữ): không dừng hai lần', () => {
  const p = fakePlayer('playing', 'a');
  const vp = createVoicePause({ controller: p.controller, onState: p.onState, timers: fakeTimers() });
  vp.begin();
  assert.equal(vp.begin(), false);
  assert.deepEqual(p.calls, ['pause']);
  vp.end();
  assert.deepEqual(p.calls, ['pause', 'play']);
});

test('tìm mãi không xong: quá thời gian thì tự phát lại', () => {
  const p = fakePlayer('playing', 'a');
  const t = fakeTimers();
  const vp = createVoicePause({ controller: p.controller, onState: p.onState, timers: t, maxHoldMs: 1000 });
  vp.begin();
  t.fire();
  assert.deepEqual(p.calls, ['pause', 'play']);
  assert.equal(vp.isHolding(), false);
});

test('đóng trang (destroy) khi đang giữ: thôi theo dõi, không tự phát', () => {
  const p = fakePlayer('playing', 'a');
  const t = fakeTimers();
  const vp = createVoicePause({ controller: p.controller, onState: p.onState, timers: t });
  vp.begin();
  vp.destroy();
  assert.equal(p.listenerCount(), 0);
  assert.equal(t.size(), 0);
  assert.equal(vp.end(), false);
  assert.deepEqual(p.calls, ['pause']);
});

test('ứng dụng đang ở nền (canResume = false): tìm xong không tự phát lại', () => {
  const p = fakePlayer('playing', 'a');
  let hidden = false;
  const vp = createVoicePause({ controller: p.controller, onState: p.onState, timers: fakeTimers(), canResume: () => !hidden });
  assert.equal(vp.begin(), true);
  hidden = true;
  assert.equal(vp.end(), false);
  assert.deepEqual(p.calls, ['pause']);
  assert.equal(vp.isHolding(), false, 'không giữ mãi');
  hidden = false;
  assert.equal(vp.begin(), false, 'đang dừng (không phải đang phát) thì lần sau không làm gì');
  assert.deepEqual(p.calls, ['pause']);
});
