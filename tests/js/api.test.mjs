import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError } from '../../public/assets/js/core/api.js';
import { createStore } from '../../public/assets/js/core/store.js';
import { createAuthApi } from '../../public/assets/js/modules/auth/authApi.js';
import { createSessionWatcher } from '../../public/assets/js/core/sessionWatcher.js';

// Giả lập fetch: nhận danh sách phản hồi theo thứ tự và ghi lại các yêu cầu đã gửi.
function mockFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return { ok: r.status < 400, status: r.status, json: async () => { if (r.raw) throw new Error('not json'); return r.body; } };
  };
  fn.calls = calls;
  return fn;
}
const ok = (data, status = 200) => ({ status, body: { ok: true, data } });
const fail = (status, code, message, details) => ({ status, body: { ok: false, error: { code, message, details } } });

test('GET thành công trả về data', async () => {
  const f = mockFetch([ok({ a: 1 })]);
  const api = createApi({ baseUrl: '/api', fetchImpl: f });
  assert.deepEqual(await api.get('/x'), { a: 1 });
  assert.equal(f.calls[0].url, '/api/x');
  assert.equal(f.calls[0].init.credentials, 'same-origin');
});

test('init lưu CSRF và POST gửi kèm header X-CSRF-Token + body JSON', async () => {
  const f = mockFetch([ok({ csrf: 'tok1', user: null }), ok({ done: true })]);
  const api = createApi({ fetchImpl: f });
  await api.init();
  await api.post('/auth/login', { email: 'a@b.c' });
  const post = f.calls[1].init;
  assert.equal(post.headers['X-CSRF-Token'], 'tok1');
  assert.equal(post.headers['Content-Type'], 'application/json');
  assert.equal(post.body, JSON.stringify({ email: 'a@b.c' }));
});

test('GET không gửi header CSRF', async () => {
  const f = mockFetch([ok({ csrf: 'tok1' }), ok({})]);
  const api = createApi({ fetchImpl: f });
  await api.init();
  await api.get('/y');
  assert.equal(f.calls[1].init.headers['X-CSRF-Token'], undefined);
});

test('lỗi API được chuyển thành ApiError có code, message, details', async () => {
  const f = mockFetch([fail(422, 'VALIDATION_FAILED', 'Dữ liệu chưa hợp lệ.', { email: 'Email không hợp lệ.' })]);
  const api = createApi({ fetchImpl: f });
  await assert.rejects(api.post('/auth/register', {}), (e) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.status, 422);
    assert.equal(e.code, 'VALIDATION_FAILED');
    assert.equal(e.details.email, 'Email không hợp lệ.');
    return true;
  });
});

test('CSRF_INVALID: tự lấy token mới và thử lại đúng một lần', async () => {
  const f = mockFetch([
    ok({ csrf: 'cu' }),
    fail(403, 'CSRF_INVALID', 'Phiên đã đổi.'),
    ok({ csrf: 'moi' }),
    ok({ saved: true }),
  ]);
  const api = createApi({ fetchImpl: f });
  await api.init();
  assert.deepEqual(await api.post('/z', {}), { saved: true });
  assert.equal(f.calls[3].init.headers['X-CSRF-Token'], 'moi');
  assert.equal(f.calls.length, 4);
});

test('CSRF_INVALID lặp lại thì không thử vô hạn', async () => {
  const f = mockFetch([
    ok({ csrf: 'a' }),
    fail(403, 'CSRF_INVALID', 'x'),
    ok({ csrf: 'b' }),
    fail(403, 'CSRF_INVALID', 'x'),
  ]);
  const api = createApi({ fetchImpl: f });
  await api.init();
  await assert.rejects(api.post('/z', {}), (e) => e.code === 'CSRF_INVALID');
});

test('lỗi mạng và phản hồi không phải JSON', async () => {
  const api1 = createApi({ fetchImpl: mockFetch([new Error('offline')]) });
  await assert.rejects(api1.get('/x'), (e) => e.code === 'NETWORK' && e.status === 0);
  const api2 = createApi({ fetchImpl: mockFetch([{ status: 502, raw: true }]) });
  await assert.rejects(api2.get('/x'), (e) => e.code === 'HTTP_502');
});

test('authApi: login/register/logout cập nhật CSRF theo phản hồi', async () => {
  const f = mockFetch([ok({ csrf: 'c0' }), ok({ csrf: 'c1', user: { id: 1 } }), ok({ csrf: 'c2' }), ok({ message: 'ok' })]);
  const api = createApi({ fetchImpl: f });
  const auth = createAuthApi(api);
  await api.init();
  await auth.login('a@b.c', 'secret1');
  await auth.logout();
  assert.equal(f.calls[2].init.headers['X-CSRF-Token'], 'c1');
  await auth.forgot('a@b.c');
  assert.equal(f.calls[3].init.headers['X-CSRF-Token'], 'c2');
  assert.equal(f.calls[3].url, '/api/auth/forgot');
});

test('store: set gộp trạng thái và báo cho người theo dõi', () => {
  const s = createStore({ a: 1, b: 2 });
  const seen = [];
  const off = s.subscribe((st) => seen.push(st.a));
  s.set({ a: 5 });
  off();
  s.set({ a: 9 });
  assert.deepEqual(s.get(), { a: 9, b: 2 });
  assert.deepEqual(seen, [5]);
});

test('SESSION_REPLACED: gọi onSessionReplaced rồi vẫn ném ApiError', async () => {
  let called = 0;
  const f = mockFetch([fail(401, 'SESSION_REPLACED', 'Đã đăng nhập nơi khác.')]);
  const api = createApi({ fetchImpl: f, onSessionReplaced: () => { called += 1; } });
  await assert.rejects(api.get('/playlists'), (e) => e.code === 'SESSION_REPLACED' && e.status === 401);
  assert.equal(called, 1);
});

function fakeTimers() {
  const t = { fn: null, cleared: false, setInterval(fn) { t.fn = fn; return 1; }, clearInterval() { t.cleared = true; } };
  return t;
}
function fakeDoc() {
  const d = { visibilityState: 'visible', handlers: {}, addEventListener(n, h) { d.handlers[n] = h; }, removeEventListener(n) { delete d.handlers[n]; } };
  return d;
}

test('sessionWatcher: báo đăng xuất khi máy chủ trả user = null', async () => {
  const timers = fakeTimers();
  const out = [];
  const w = createSessionWatcher({
    check: async () => ({ user: null, replaced: true }),
    hasUser: () => true, onLoggedOut: (p) => out.push(p), timers, doc: fakeDoc(),
  });
  w.start();
  await timers.fn();
  assert.equal(out.length, 1);
  assert.equal(out[0].replaced, true);
});

test('sessionWatcher: còn đăng nhập, không có người dùng, hoặc mất mạng thì không báo gì', async () => {
  const out = [];
  let mode = 'ok';
  const w = createSessionWatcher({
    check: async () => { if (mode === 'net') throw new Error('offline'); return { user: { id: 1 } }; },
    hasUser: () => mode !== 'nouser', onLoggedOut: (p) => out.push(p), timers: fakeTimers(), doc: fakeDoc(),
  });
  await w.tick();
  mode = 'net';
  await w.tick();
  mode = 'nouser';
  await w.tick();
  assert.equal(out.length, 0);
});

test('sessionWatcher: kiểm tra lại khi quay lại thiết bị (visibilitychange) và dừng được', async () => {
  const doc = fakeDoc();
  const timers = fakeTimers();
  let checks = 0;
  const w = createSessionWatcher({ check: async () => { checks += 1; return { user: { id: 1 } }; }, hasUser: () => true, onLoggedOut() {}, timers, doc });
  w.start();
  await doc.handlers.visibilitychange();
  assert.equal(checks, 1);
  doc.visibilityState = 'hidden';
  await doc.handlers.visibilitychange();
  assert.equal(checks, 1);
  w.stop();
  assert.equal(timers.cleared, true);
  assert.equal(doc.handlers.visibilitychange, undefined);
});
