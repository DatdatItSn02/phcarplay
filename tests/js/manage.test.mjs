import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../../public/assets/js/core/api.js';
import { createAdminApi } from '../../public/assets/js/admin/adminApi.js';
import { csvCell, debounce, fmtDate } from '../../public/assets/js/admin/ui.js';
import { actionLabel, targetLabel } from '../../public/assets/js/admin/labels.js';
import { describePlan, formatDate } from '../../public/assets/js/modules/account/accountDialog.js';

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

test('csvCell: bọc dấu ngoặc kép khi cần và chặn công thức Excel', () => {
  assert.equal(csvCell('abc'), 'abc');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('có "trích dẫn"'), '"có ""trích dẫn"""');
  assert.equal(csvCell('dòng 1\ndòng 2'), '"dòng 1\ndòng 2"');
  assert.equal(csvCell('=SUM(A1:A9)'), "'=SUM(A1:A9)");
  assert.equal(csvCell('+84123'), "'+84123");
  assert.equal(csvCell('@lenh'), "'@lenh");
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(30), '30');
});

test('debounce: chỉ gọi một lần với giá trị cuối; cancel hủy lần gọi chờ', async () => {
  const seen = [];
  const d = debounce((v) => seen.push(v), 20);
  d('a'); d('ab'); d('abc');
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(seen, ['abc']);
  d('x');
  d.cancel();
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(seen, ['abc']);
});

test('fmtDate: chỉ lấy ngày; rỗng thì trả chuỗi rỗng', () => {
  assert.equal(fmtDate('2026-05-04 09:30:15'), '04/05/2026');
  assert.equal(fmtDate(null), '');
  assert.equal(fmtDate('lạ'), 'lạ');
});

test('labels: tên tiếng Việt cho hành động đã biết, hành động lạ giữ nguyên mã', () => {
  assert.equal(actionLabel('user.delete'), 'Xóa người dùng');
  assert.equal(actionLabel('key.create'), 'Tạo key');
  assert.equal(actionLabel('hanh.dong.la'), 'hanh.dong.la');
  assert.equal(actionLabel('constructor'), 'constructor', 'không được lấy thuộc tính có sẵn của Object');
  assert.equal(targetLabel('user', '12'), 'Người dùng #12');
  assert.equal(targetLabel('', ''), '');
  assert.equal(targetLabel('khac', ''), 'khac');
});

test('adminApi: bộ lọc được mã hóa đúng, bỏ giá trị rỗng; các lệnh gửi đúng phương thức và đường dẫn', async () => {
  const f = mockFetch([
    ok({ admin: null, csrf: 't' }),
    ok({ items: [], total: 0 }),    // listUsers
    ok({ id: 7 }),                  // getUser
    ok({ id: 7 }),                  // updateUser
    ok({ id: 7 }),                  // extendUser
    ok({ message: 'x' }),           // setUserPassword
    ok({ message: 'x' }),           // sendUserReset
    ok({ message: 'x' }),           // logoutUserDevice
    ok({ deleted: true }),          // deleteUser
    ok({ items: [] }),              // listKeys
    ok({ items: [] }, 201),         // createKeys
    ok({ id: 3 }),                  // revokeKey
    ok({ deleted: true }),          // deleteKey
    ok({ items: [] }),              // listPlaylists
    ok({ id: 4 }),                  // getPlaylist
    ok({ deleted: true }),          // deletePlaylist
    ok({ items: [] }),              // listAudit
    ok({ users: {} }),              // stats
  ]);
  const a = createAdminApi(createApi({ baseUrl: '/admin/api', fetchImpl: f }));
  await a.me();
  await a.listUsers({ q: 'an&nguyen %_', status: '', license: 'valid', page: 2, per_page: 20 });
  await a.getUser(7);
  await a.updateUser(7, { expires_at: null });
  await a.extendUser(7, 30);
  await a.setUserPassword(7, 'abcdef');
  await a.sendUserReset(7);
  await a.logoutUserDevice(7);
  await a.deleteUser(7);
  await a.listKeys({ status: 'unused', q: '' });
  await a.createKeys({ count: 5, days: 30, note: 'n' });
  await a.revokeKey(3);
  await a.deleteKey(3);
  await a.listPlaylists({});
  await a.getPlaylist(4);
  await a.deletePlaylist(4);
  await a.listAudit({ action: 'user.delete', from: '2026-01-01', to: '' });
  await a.stats();

  const c = f.calls.slice(1).map((x) => `${x.init.method} ${x.url}`);
  assert.deepEqual(c, [
    'GET /admin/api/users?q=an%26nguyen%20%25_&license=valid&page=2&per_page=20',
    'GET /admin/api/users/7',
    'PATCH /admin/api/users/7',
    'POST /admin/api/users/7/extend',
    'POST /admin/api/users/7/password',
    'POST /admin/api/users/7/send-reset',
    'POST /admin/api/users/7/logout-device',
    'DELETE /admin/api/users/7',
    'GET /admin/api/keys?status=unused',
    'POST /admin/api/keys',
    'POST /admin/api/keys/3/revoke',
    'DELETE /admin/api/keys/3',
    'GET /admin/api/playlists',
    'GET /admin/api/playlists/4',
    'DELETE /admin/api/playlists/4',
    'GET /admin/api/audit?action=user.delete&from=2026-01-01',
    'GET /admin/api/stats',
  ]);
  assert.deepEqual(JSON.parse(f.calls[3].init.body), { expires_at: null }, 'null được gửi đi để xóa hạn');
  assert.deepEqual(JSON.parse(f.calls[4].init.body), { days: 30 });
  assert.equal(f.calls[3].init.headers['X-CSRF-Token'], 't', 'lệnh ghi có CSRF');
});

test('adminApi: lỗi UNAUTHORIZED ở lệnh mới gọi onUnauthorized (phiên hết hạn)', async () => {
  let hit = 0;
  const f = mockFetch([
    ok({ admin: null, csrf: 't' }),
    { status: 401, body: { ok: false, error: { code: 'UNAUTHORIZED', message: 'Bạn cần đăng nhập.' } } },
  ]);
  const a = createAdminApi(createApi({ baseUrl: '/admin/api', fetchImpl: f }), { onUnauthorized: () => { hit += 1; } });
  await a.me();
  await assert.rejects(a.listUsers({}), (e) => e.code === 'UNAUTHORIZED');
  assert.equal(hit, 1);
});

test('accountDialog: định dạng ngày và mô tả tình trạng dùng', () => {
  assert.equal(formatDate('2026-12-31 23:59:59'), '31/12/2026');
  assert.equal(formatDate(null), '');
  assert.match(describePlan({ plan: 'member', expires_at: '2999-01-02 03:04:05' }), /Thành viên, hạn dùng đến 02\/01\/2999/);
  assert.match(describePlan({ plan: 'trial', expires_at: '2001-01-02 03:04:05' }), /Đã hết hạn dùng từ 02\/01\/2001/);
  assert.match(describePlan({ plan: 'trial', expires_at: null }), /Đang dùng thử/);
  assert.match(describePlan({ plan: 'member', expires_at: null }), /Chưa có hạn dùng/);
});
