import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../../public/assets/js/core/api.js';
import { createAdminApi } from '../../public/assets/js/admin/adminApi.js';
import { fmtDateTime, randomPassword } from '../../public/assets/js/admin/ui.js';

// Giả lập fetch: nhận danh sách phản hồi theo thứ tự và ghi lại các yêu cầu đã gửi.
function mockFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}
const ok = (data, status = 200) => ({ status, body: { ok: true, data } });
const fail = (status, code, message, details) => ({ status, body: { ok: false, error: { code, message, details } } });

test('fmtDateTime: định dạng ngày giờ của máy chủ, rỗng thì trả chuỗi rỗng', () => {
  assert.equal(fmtDateTime('2026-05-04 09:30:15'), '04/05/2026 09:30');
  assert.equal(fmtDateTime('2026-05-04T09:30:15'), '04/05/2026 09:30');
  assert.equal(fmtDateTime(null), '');
  assert.equal(fmtDateTime(''), '');
  assert.equal(fmtDateTime('không phải ngày'), 'không phải ngày');
});

test('randomPassword: đúng độ dài, chỉ ký tự dễ đọc, mỗi lần khác nhau', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const p = randomPassword(12);
    assert.match(p, /^[a-zA-Z2-9]{12}$/);
    assert.doesNotMatch(p, /[0OIl1]/);
    seen.add(p);
  }
  assert.ok(seen.size > 190, 'các mật khẩu phải khác nhau');
  assert.equal(randomPassword(20).length, 20);
});

test('adminApi: đăng nhập lưu CSRF mới; các lệnh ghi gửi đúng đường dẫn, phương thức và token', async () => {
  const f = mockFetch([
    ok({ admin: null, csrf: 'tok1' }),                                // init
    ok({ admin: { id: 1, role: 'master' }, csrf: 'tok2' }),           // login
    ok({ items: [] }),                                                // listAdmins
    ok({ id: 5 }, 201),                                               // createAdmin
    ok({ id: 5, status: 'blocked' }),                                 // updateAdmin
    ok({ message: 'ok' }),                                            // setAdminPassword
    ok({ deleted: true }),                                            // deleteAdmin
  ]);
  const admin = createAdminApi(createApi({ baseUrl: '/admin/api', fetchImpl: f }));
  await admin.me();
  await admin.login('a@b.c', 'matkhau123');
  await admin.listAdmins();
  await admin.createAdmin({ email: 'x@y.z', name: 'X', password: 'abcdefgh1' });
  await admin.updateAdmin(5, { status: 'blocked' });
  await admin.setAdminPassword(5, 'TamThoi-123');
  await admin.deleteAdmin(5);

  const [me, login, list, create, update, pw, del] = f.calls;
  assert.equal(me.url, '/admin/api/auth/me');
  assert.equal(login.url, '/admin/api/auth/login');
  assert.equal(login.init.headers['X-CSRF-Token'], 'tok1');
  assert.deepEqual(JSON.parse(login.init.body), { email: 'a@b.c', password: 'matkhau123' });
  assert.equal(list.url, '/admin/api/admins');
  assert.equal(create.init.method, 'POST');
  assert.equal(create.init.headers['X-CSRF-Token'], 'tok2', 'token mới sau khi đăng nhập');
  assert.equal(update.url, '/admin/api/admins/5');
  assert.equal(update.init.method, 'PATCH');
  assert.equal(pw.url, '/admin/api/admins/5/password');
  assert.deepEqual(JSON.parse(pw.init.body), { password: 'TamThoi-123' });
  assert.equal(del.init.method, 'DELETE');
});

test('adminApi: đổi mật khẩu gửi đúng tên trường và cập nhật CSRF', async () => {
  const f = mockFetch([ok({ admin: null, csrf: 't1' }), ok({ admin: { id: 2 }, csrf: 't2' }), ok({ items: [] })]);
  const admin = createAdminApi(createApi({ baseUrl: '/admin/api', fetchImpl: f }));
  await admin.me();
  const data = await admin.changePassword('cu-12345', 'moi-12345');
  assert.deepEqual(JSON.parse(f.calls[1].init.body), { current_password: 'cu-12345', new_password: 'moi-12345' });
  assert.equal(f.calls[1].url, '/admin/api/account/password');
  assert.equal(data.admin.id, 2);
  await admin.listAdmins();
});

test('adminApi: UNAUTHORIZED gọi onUnauthorized, PASSWORD_CHANGE_REQUIRED gọi onPasswordChangeRequired, lỗi vẫn được ném ra', async () => {
  const f = mockFetch([
    ok({ admin: null, csrf: 't' }),
    fail(401, 'UNAUTHORIZED', 'Hết phiên'),
    fail(403, 'PASSWORD_CHANGE_REQUIRED', 'Cần đổi mật khẩu'),
    fail(403, 'FORBIDDEN', 'Không có quyền'),
  ]);
  const seen = [];
  const admin = createAdminApi(createApi({ baseUrl: '/admin/api', fetchImpl: f }), {
    onUnauthorized: () => seen.push('unauthorized'),
    onPasswordChangeRequired: () => seen.push('change'),
  });
  await admin.me();
  await assert.rejects(admin.listAdmins(), (e) => e.code === 'UNAUTHORIZED');
  await assert.rejects(admin.listAdmins(), (e) => e.code === 'PASSWORD_CHANGE_REQUIRED');
  await assert.rejects(admin.listAdmins(), (e) => e.code === 'FORBIDDEN');
  assert.deepEqual(seen, ['unauthorized', 'change']);
});

test('adminApi: sai mật khẩu đăng nhập (INVALID_CREDENTIALS) không bị coi là hết phiên', async () => {
  const f = mockFetch([ok({ admin: null, csrf: 't' }), fail(401, 'INVALID_CREDENTIALS', 'Sai')]);
  let called = 0;
  const admin = createAdminApi(createApi({ baseUrl: '/admin/api', fetchImpl: f }), { onUnauthorized: () => { called++; } });
  await admin.me();
  await assert.rejects(admin.login('a@b.c', 'x'), (e) => e.code === 'INVALID_CREDENTIALS');
  assert.equal(called, 0);
});
