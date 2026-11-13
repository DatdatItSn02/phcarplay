// Giai đoạn 14: phần dùng chung của form nhập mã OTP (lọc mã, nút "Gửi lại mã" đếm ngược).
import test from 'node:test';
import assert from 'node:assert/strict';

// DOM tối giản đủ cho core/dom.js
class FakeNode {}
class FakeEl extends FakeNode {
  constructor(tag) { super(); this.tag = tag; this.attrs = {}; this.children = []; this.listeners = {}; this.disabled = false; this.isConnected = true; this._text = ''; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  append(...c) { this.children.push(...c); this._text = c.map((x) => x.text || '').join(''); }
  set textContent(v) { this._text = v; this.children = []; }
  get textContent() { return this._text; }
  click() { if (this.listeners.click) this.listeners.click(); }
}
globalThis.Node = FakeNode;
globalThis.document = {
  createElement: (tag) => new FakeEl(tag),
  createTextNode: (text) => Object.assign(new FakeNode(), { text }),
};

const { CODE_INPUT, cleanCode, countdownButton } = await import('../../public/assets/js/modules/auth/otpParts.js');

function fakeTimers() {
  const t = { fn: null, cleared: 0, set: (fn) => { t.fn = fn; return 1; }, clear: () => { t.cleared += 1; t.fn = null; } };
  return t;
}

test('cleanCode: chỉ giữ chữ số, tối đa 6', () => {
  assert.equal(cleanCode('123 456'), '123456');
  assert.equal(cleanCode(' 12-34-56-78 '), '123456');
  assert.equal(cleanCode('abc'), '');
  assert.equal(cleanCode(null), '');
  assert.equal(cleanCode(987654), '987654');
});

test('CODE_INPUT: bàn phím số và tự điền mã', () => {
  assert.equal(CODE_INPUT.inputmode, 'numeric');
  assert.equal(CODE_INPUT.autocomplete, 'one-time-code');
  assert.equal(CODE_INPUT.maxlength, '6');
});

test('countdownButton: khóa nút trong lúc đếm, hết giờ thì bấm lại được', () => {
  const timers = fakeTimers();
  let clicks = 0;
  const b = countdownButton({ label: 'Gửi lại mã', onClick: () => { clicks += 1; }, timers });
  assert.equal(b.el.textContent, 'Gửi lại mã');
  b.start(3);
  assert.equal(b.el.disabled, true);
  assert.equal(b.el.textContent, 'Gửi lại mã (3 giây)');
  b.el.click();
  assert.equal(clicks, 0, 'đang đếm thì bấm không gửi');
  timers.fn(); timers.fn();
  assert.equal(b.el.textContent, 'Gửi lại mã (1 giây)');
  timers.fn();
  assert.equal(b.el.disabled, false);
  assert.equal(b.el.textContent, 'Gửi lại mã');
  assert.equal(timers.cleared, 1);
  b.el.click();
  assert.equal(clicks, 1);
});

test('countdownButton: start(0) không khóa; gọi lại start thì đặt lại bộ đếm', () => {
  const timers = fakeTimers();
  const b = countdownButton({ onClick: () => {}, timers });
  b.start(0);
  assert.equal(b.el.disabled, false);
  assert.equal(timers.fn, null);
  b.start(60);
  b.start(10);
  assert.equal(timers.cleared, 1);
  assert.equal(b.el.textContent, 'Gửi lại mã (10 giây)');
});

test('countdownButton: nút đã bị gỡ khỏi trang thì dừng đếm', () => {
  const timers = fakeTimers();
  const b = countdownButton({ onClick: () => {}, timers });
  b.start(5);
  b.el.isConnected = false;
  timers.fn();
  assert.equal(timers.cleared, 1);
});
