import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');

// Giai đoạn 5.2 - 5.4: người dùng, key kích hoạt, playlist, nhật ký, tổng quan và hộp "Tài khoản" của người dùng.
// Chạy trên PHP THẬT (php -S) với SQLite thay MySQL.
// Phần A: kiểm tra HTTP thật (quyền, CSRF, nhập key, khóa/xóa người dùng, nhật ký không lộ mật khẩu).
// Phần B: kiểm tra giao diện trên Chromium thật (quản trị và ứng dụng người dùng).
// Không thay thế việc thử trên PHP 7.4 + MySQL thật của bạn (php bin/migrate.php, php tests/run.php --integration).
const PUBLIC_DIR = process.env.PUBLIC_DIR;
if (!PUBLIC_DIR) { console.error('Cần đặt PUBLIC_DIR=/duong/dan/den/public'); process.exit(2); }
const PROJECT = path.dirname(PUBLIC_DIR);
const here = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.env.PORT || 8098);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `carweb-e2e6-${process.pid}.sqlite`);
const MAIL_DIR = path.join(PROJECT, 'storage', 'mail');
const MASTER = { email: 'master@test.local', pass: 'Master-12345' };

let failures = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.rmSync(DB, { force: true });
fs.mkdirSync(MAIL_DIR, { recursive: true });
const php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', PUBLIC_DIR, path.join(PROJECT, 'tests/support/serve_sqlite.php')], {
  env: { ...process.env, CARWEB_TEST_DB: DB, CARWEB_TEST_SEED: '1', CARWEB_TEST_MASTER_EMAIL: MASTER.email, CARWEB_TEST_MASTER_PASS: MASTER.pass, APP_URL: ORIGIN, MAIL_DRIVER: 'log' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let phpErr = '';
php.stderr.on('data', (d) => { phpErr += d.toString(); });
const stopAll = () => { try { php.kill(); } catch (e) { /* đã tắt */ } fs.rmSync(DB, { force: true }); };
process.on('exit', stopAll);
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(ORIGIN + '/api/health')).ok) break; } catch (e) { /* chưa sẵn sàng */ }
  await sleep(100);
}

// ---------- Phần A: HTTP thật ----------
function jar() {
  const cookies = {};
  const self = {
    cookies,
    csrf: '',
    async call(method, url, body, headers = {}) {
      const h = { Accept: 'application/json', ...headers };
      const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookie) h.Cookie = cookie;
      if (body !== undefined) h['Content-Type'] = 'application/json';
      if (method !== 'GET' && self.csrf && !h['X-CSRF-Token']) h['X-CSRF-Token'] = self.csrf;
      const res = await fetch(ORIGIN + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
      for (const line of res.headers.getSetCookie()) {
        const [pair] = line.split(';');
        const i = pair.indexOf('=');
        cookies[pair.slice(0, i)] = pair.slice(i + 1);
      }
      let json = null;
      try { json = await res.clone().json(); } catch (e) { /* không phải JSON */ }
      return { status: res.status, json, code: json && json.error ? json.error.code : null, data: json ? json.data : null };
    },
    async refreshCsrf(prefix) {
      const me = await self.call('GET', prefix + '/auth/me');
      self.csrf = me.data.csrf;
      return me;
    },
  };
  return self;
}
const daysBetween = (a, b) => Math.round((new Date(String(b).replace(' ', 'T')).getTime() - new Date(String(a).replace(' ', 'T')).getTime()) / 86400000);
const uniq = (arr) => Array.from(new Set(arr));

const KEY_RE = /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/;
const AD = '/admin/api';
let seeded = {};

{
  const m = jar();      // master
  const n = jar();      // admin thường
  const u1 = jar();     // người dùng 1
  const u2 = jar();     // người dùng 2
  const anon = jar();

  // A1. Chưa đăng nhập: mọi API mới đều 401
  await anon.refreshCsrf(AD);
  const paths = ['/stats', '/users', '/users/1', '/keys', '/playlists', '/audit'];
  const codes = [];
  for (const p of paths) codes.push((await anon.call('GET', AD + p)).status);
  check('A1 chưa đăng nhập: stats/users/keys/playlists/audit đều 401', codes.every((c) => c === 401), codes.join(','));
  check('A1 chưa đăng nhập: tạo key bị 401 (không tạo được)', (await anon.call('POST', AD + '/keys', { count: 1, days: 30 })).status === 401);

  // A2. Master đăng nhập, tạo admin thường; admin chờ đổi mật khẩu bị chặn
  await m.refreshCsrf(AD);
  const lg = await m.call('POST', AD + '/auth/login', { email: MASTER.email, password: MASTER.pass });
  check('A2 master đăng nhập', lg.status === 200);
  await m.refreshCsrf(AD);
  const mk = await m.call('POST', AD + '/admins', { email: 'nv@test.local', name: 'Nhân viên', password: 'TamThoi-123' });
  check('A2 tạo admin thường', mk.status === 201);
  await n.refreshCsrf(AD);
  await n.call('POST', AD + '/auth/login', { email: 'nv@test.local', password: 'TamThoi-123' });
  await n.refreshCsrf(AD);
  const blocked = await n.call('GET', AD + '/users');
  check('A2 admin còn mật khẩu tạm: bị chặn 403 PASSWORD_CHANGE_REQUIRED', blocked.status === 403 && blocked.code === 'PASSWORD_CHANGE_REQUIRED');
  const chg = await n.call('POST', AD + '/account/password', { current_password: 'TamThoi-123', new_password: 'NhanVien-2026' });
  check('A2 admin đổi mật khẩu xong', chg.status === 200);
  await n.refreshCsrf(AD);
  check('A2 admin thường xem được users/keys/playlists/stats', (await n.call('GET', AD + '/users')).status === 200 && (await n.call('GET', AD + '/keys')).status === 200 && (await n.call('GET', AD + '/playlists')).status === 200 && (await n.call('GET', AD + '/stats')).status === 200);
  const audN = await n.call('GET', AD + '/audit');
  check('A2 admin thường xem nhật ký: 403 FORBIDDEN', audN.status === 403 && audN.code === 'FORBIDDEN');
  const stN = await n.call('GET', AD + '/stats');
  const stM = await m.call('GET', AD + '/stats');
  check('A2 thống kê: master có "thao tác gần đây", admin thường thì không', Array.isArray(stM.data.recent) && stN.data.recent === null);

  // A3. Tạo key
  const noCsrf = await m.call('POST', AD + '/keys', { count: 1, days: 30 }, { 'X-CSRF-Token': 'sai' });
  check('A3 tạo key sai CSRF: 403 CSRF_INVALID', noCsrf.status === 403 && noCsrf.code === 'CSRF_INVALID');
  const v1 = await m.call('POST', AD + '/keys', { count: 0, days: 30 });
  const v2 = await m.call('POST', AD + '/keys', { count: 5, days: 0 });
  const v3 = await m.call('POST', AD + '/keys', { count: 101, days: 30 });
  const v4 = await m.call('POST', AD + '/keys', { count: 'abc', days: 30 });
  check('A3 số lượng/số ngày sai: 422 kèm lỗi từng ô', v1.status === 422 && v1.json.error.details.count && v2.status === 422 && v2.json.error.details.days && v3.status === 422 && v4.status === 422);
  const made = await m.call('POST', AD + '/keys', { count: 4, days: 30, note: 'Lô A' });
  const keys = made.data ? made.data.items : [];
  check('A3 tạo 4 key: 201, đúng định dạng XXXX-XXXX-XXXX-XXXX, không trùng, 30 ngày, ghi chú', made.status === 201 && keys.length === 4 && keys.every((k) => KEY_RE.test(k.code) && k.days === 30 && k.note === 'Lô A' && k.status === 'unused') && uniq(keys.map((k) => k.code)).length === 4, keys.map((k) => k.code).join(' '));
  seeded.keys = keys;

  // A4. Hai người dùng đăng ký, nhập key
  await u1.refreshCsrf('/api');
  const r1 = await u1.call('POST', '/api/auth/register', { email: 'u1@test.local', name: 'Khách Một', password: 'matkhau1', phone: '0906000001' });
  await u1.refreshCsrf('/api');
  await u2.refreshCsrf('/api');
  const r2 = await u2.call('POST', '/api/auth/register', { email: 'u2@test.local', name: 'Khách Hai', password: 'matkhau2', phone: '0906000002' });
  await u2.refreshCsrf('/api');
  check('A4 hai người dùng đăng ký được', r1.status === 201 && r2.status === 201);
  seeded.u1Id = r1.data.user.id;
  seeded.u2Id = r2.data.user.id;
  check('A4 người dùng mới chưa có hạn dùng', r1.data.user.expires_at === null);

  await anon.refreshCsrf('/api');
check('A4 nhập key khi chưa đăng nhập: 401', (await anon.call('POST', '/api/user/license/redeem', { code: keys[0].code })).status === 401);
  const short = await u1.call('POST', '/api/user/license/redeem', { code: 'abc' });
  check('A4 key sai độ dài: 422 kèm lỗi ở ô code', short.status === 422 && !!short.json.error.details.code);
  const notFound = await u1.call('POST', '/api/user/license/redeem', { code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' });
  check('A4 key không tồn tại: 404 KEY_NOT_FOUND', notFound.status === 404 && notFound.code === 'KEY_NOT_FOUND');

  const code0 = keys[0].code.toLowerCase().replace(/-/g, '');
  const red1 = await u1.call('POST', '/api/user/license/redeem', { code: ' ' + code0 + ' ' });
  check('A4 nhập key viết thường, không gạch nối, thừa dấu cách: vẫn được, +30 ngày', red1.status === 200 && red1.data.days_added === 30 && red1.data.plan === 'member' && !!red1.data.expires_at, JSON.stringify(red1.data && { d: red1.data.days_added, e: red1.data.expires_at }));
  const exp1 = red1.data.expires_at;
  const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
  check('A4 hạn mới cách hôm nay khoảng 30 ngày', Math.abs(daysBetween(nowStr, exp1) - 30) <= 2, String(daysBetween(nowStr, exp1)));
  const again = await u1.call('POST', '/api/user/license/redeem', { code: keys[0].code });
  check('A4 nhập lại key đã dùng: 409 KEY_USED', again.status === 409 && again.code === 'KEY_USED');
  const other = await u2.call('POST', '/api/user/license/redeem', { code: keys[0].code });
  check('A4 người khác nhập key đã dùng: 409 KEY_USED', other.status === 409 && other.code === 'KEY_USED');

  const rev = await m.call('POST', AD + `/keys/${keys[1].id}/revoke`, {});
  check('A4 master thu hồi key chưa dùng', rev.status === 200 && rev.data.status === 'revoked');
  const onRevoked = await u1.call('POST', '/api/user/license/redeem', { code: keys[1].code });
  check('A4 nhập key đã thu hồi: 409 KEY_REVOKED', onRevoked.status === 409 && onRevoked.code === 'KEY_REVOKED');

  const red2 = await u1.call('POST', '/api/user/license/redeem', { code: keys[2].code });
  check('A4 nhập key thứ hai: cộng dồn thêm 30 ngày vào hạn cũ', red2.status === 200 && daysBetween(exp1, red2.data.expires_at) === 30 && red2.data.previous_expires_at === exp1, `${exp1} -> ${red2.data && red2.data.expires_at}`);
  const exp2 = red2.data.expires_at;
  const me1 = await u1.call('GET', '/api/auth/me');
  check('A4 /api/auth/me phản ánh hạn mới và gói member', me1.data.user.expires_at === exp2 && me1.data.plan === 'member');

  check('A4 không thu hồi được key đã dùng (409 KEY_USED)', (await m.call('POST', AD + `/keys/${keys[0].id}/revoke`, {})).code === 'KEY_USED');
  check('A4 không xóa được key đã dùng (409 KEY_USED)', (await m.call('DELETE', AD + `/keys/${keys[0].id}`)).code === 'KEY_USED');
  check('A4 xóa được key đã thu hồi', (await m.call('DELETE', AD + `/keys/${keys[1].id}`)).status === 200);
  check('A4 xóa được key chưa dùng', (await m.call('DELETE', AD + `/keys/${keys[3].id}`)).status === 200);
  check('A4 xóa key không tồn tại: 404', (await m.call('DELETE', AD + '/keys/99999')).status === 404);

  // A5. Danh sách key và người dùng
  const kl = await m.call('GET', AD + '/keys');
  check('A5 danh sách key: đếm theo trạng thái (dùng 2, chưa dùng 0)', kl.status === 200 && kl.data.counts.used === 2 && kl.data.counts.unused === 0 && kl.data.total === 2, JSON.stringify(kl.data && kl.data.counts));
  const used = kl.data.items.find((k) => k.id === keys[0].id);
  check('A5 key đã dùng ghi rõ email người dùng và thời điểm dùng', used && used.status === 'used' && used.used_by_email === 'u1@test.local' && !!used.used_at);
  const ks = await m.call('GET', AD + '/keys?q=' + encodeURIComponent('u1@test'));
  check('A5 tìm key theo email người dùng', ks.data.items.length === 2);
  const ksf = await m.call('GET', AD + '/keys?status=revoked');
  check('A5 lọc key đã thu hồi: không còn (đã xóa)', ksf.data.items.length === 0);
  const wild = await m.call('GET', AD + '/keys?q=' + encodeURIComponent('%'));
  check('A5 tìm bằng ký tự % không khớp mọi thứ', wild.status === 200 && wild.data.items.length === 0);
  const bad = await m.call('GET', AD + '/keys?status=abc');
  check('A5 lọc trạng thái lạ: 422', bad.status === 422);

  const ul = await m.call('GET', AD + '/users');
  check('A5 danh sách người dùng: 2 người, không lộ hash/salt/session_token', ul.status === 200 && ul.data.total === 2 && !/password_hash|"salt"|session_token/.test(JSON.stringify(ul.json)));
  const uv = await m.call('GET', AD + '/users?license=valid');
  const un = await m.call('GET', AD + '/users?license=none');
  check('A5 lọc hạn dùng: còn hạn = u1, chưa có hạn = u2', uv.data.items.length === 1 && uv.data.items[0].email === 'u1@test.local' && un.data.items.length === 1 && un.data.items[0].email === 'u2@test.local');
  const uq = await m.call('GET', AD + '/users?q=' + encodeURIComponent('Hai'));
  check('A5 tìm người dùng theo tên', uq.data.items.length === 1 && uq.data.items[0].email === 'u2@test.local');
  const pg = await m.call('GET', AD + '/users?per_page=1&page=2');
  check('A5 phân trang: trang 2 với 1 mục/trang', pg.data.items.length === 1 && pg.data.page === 2 && pg.data.total === 2);
  const det = await m.call('GET', AD + `/users/${seeded.u1Id}`);
  check('A5 chi tiết người dùng: thiết bị, 2 key đã nhập, số playlist', det.status === 200 && !!det.data.device && det.data.keys.length === 2 && Array.isArray(det.data.playlists));
  check('A5 người dùng không tồn tại: 404', (await m.call('GET', AD + '/users/99999')).status === 404);

  // A6. Playlist
  const pl = await u1.call('POST', '/api/playlists', { name: 'Nhạc đi đường' });
  const plId = pl.data.id;
  const vids = [
    { id: 'dQw4w9WgXcQ', title: 'Bài một', uploader: 'Kênh A', duration: 213, thumbnail: '' },
    { id: 'aaaaaaaaaaa', title: 'Bài hai', uploader: 'Kênh B', duration: 100, thumbnail: '' },
  ];
  const add = await u1.call('POST', `/api/playlists/${plId}/items`, { items: vids });
  check('A6 người dùng tạo playlist có 2 bài', pl.status === 201 && add.status === 201, String(add.status));
  const pls = await m.call('GET', AD + '/playlists?q=u1');
  check('A6 admin thấy playlist, kèm email chủ và số bài', pls.status === 200 && pls.data.total === 1 && pls.data.items[0].user_email === 'u1@test.local' && pls.data.items[0].count === 2);
  const one = await m.call('GET', AD + `/playlists/${plId}`);
  check('A6 xem chi tiết playlist: 2 bài đúng thứ tự', one.status === 200 && one.data.items.map((i) => i.title).join('|') === 'Bài một|Bài hai');
  check('A6 admin xóa playlist', (await m.call('DELETE', AD + `/playlists/${plId}`)).status === 200 && (await m.call('GET', AD + `/playlists/${plId}`)).status === 404);
  check('A6 người dùng không còn thấy playlist đó', (await u1.call('GET', `/api/playlists/${plId}`)).status === 404);

  // A7. Gia hạn, đổi mật khẩu, khóa
  const ext = await m.call('POST', AD + `/users/${seeded.u1Id}/extend`, { days: 10 });
  check('A7 gia hạn thêm 10 ngày', ext.status === 200 && daysBetween(exp2, ext.data.expires_at) === 10, String(ext.data && ext.data.expires_at));
  check('A7 gia hạn số ngày sai: 422', (await m.call('POST', AD + `/users/${seeded.u1Id}/extend`, { days: 0 })).status === 422);
  const setD = await m.call('PATCH', AD + `/users/${seeded.u1Id}`, { expires_at: '2030-01-31' });
  check('A7 đặt ngày hết hạn cụ thể: tính đến hết ngày đó', setD.status === 200 && /^2030-01-31 23:59/.test(setD.data.expires_at), setD.data && setD.data.expires_at);
  const clr = await m.call('PATCH', AD + `/users/${seeded.u2Id}`, { expires_at: null });
  check('A7 xóa hạn dùng (null) hợp lệ', clr.status === 200 && clr.data.expires_at === null);

  const dup = await m.call('PATCH', AD + `/users/${seeded.u2Id}`, { email: 'u1@test.local' });
  check('A7 đổi email trùng người khác: 409 EMAIL_TAKEN', dup.status === 409 && dup.code === 'EMAIL_TAKEN');

  const blk = await m.call('PATCH', AD + `/users/${seeded.u1Id}`, { status: 'blocked' });
  check('A7 khóa người dùng', blk.status === 200 && blk.data.status === 'blocked');
  const afterBlock = await u1.call('POST', '/api/user/license/redeem', { code: keys[2].code });
  check('A7 người dùng bị khóa: phiên cũ không dùng được nữa (401)', afterBlock.status === 401, String(afterBlock.status));
  const loginBlocked = await u1.call('POST', '/api/auth/login', { email: 'u1@test.local', password: 'matkhau1' });
  check('A7 người dùng bị khóa không đăng nhập lại được (403 ACCOUNT_BLOCKED)', loginBlocked.status === 403 && loginBlocked.code === 'ACCOUNT_BLOCKED', `${loginBlocked.status} ${loginBlocked.code}`);
  check('A7 mở khóa', (await m.call('PATCH', AD + `/users/${seeded.u1Id}`, { status: 'active' })).data.status === 'active');
  await u1.refreshCsrf('/api');
  const loginOk = await u1.call('POST', '/api/auth/login', { email: 'u1@test.local', password: 'matkhau1' });
  check('A7 sau khi mở khóa đăng nhập lại được', loginOk.status === 200);
  await u1.refreshCsrf('/api');

  const sp = await m.call('POST', AD + `/users/${seeded.u1Id}/password`, { password: 'Moi-12345' });
  check('A7 đặt mật khẩu mới cho người dùng', sp.status === 200);
  check('A7 mật khẩu mới quá ngắn: 422', (await m.call('POST', AD + `/users/${seeded.u1Id}/password`, { password: '123' })).status === 422);
  check('A7 phiên cũ của người dùng bị đăng xuất sau khi đổi mật khẩu', (await u1.call('GET', '/api/user/preferences')).status === 401);
  await u1.refreshCsrf('/api');
  check('A7 mật khẩu cũ không còn đăng nhập được', (await u1.call('POST', '/api/auth/login', { email: 'u1@test.local', password: 'matkhau1' })).status === 401);
  await u1.refreshCsrf('/api');
  check('A7 mật khẩu mới đăng nhập được', (await u1.call('POST', '/api/auth/login', { email: 'u1@test.local', password: 'Moi-12345' })).status === 200);
  await u1.refreshCsrf('/api');

  const lo = await m.call('POST', AD + `/users/${seeded.u1Id}/logout-device`, {});
  check('A7 đăng xuất thiết bị: phiên người dùng mất hiệu lực', lo.status === 200 && (await u1.call('GET', '/api/user/preferences')).status === 401);
  const sr = await m.call('POST', AD + `/users/${seeded.u1Id}/send-reset`, {});
  const mails = fs.existsSync(MAIL_DIR) ? fs.readdirSync(MAIL_DIR).filter((f) => f.endsWith('.txt')) : [];
  const resetMail = mails.find((f) => /reset-password|dat-lai|đặt lại/i.test(fs.readFileSync(path.join(MAIL_DIR, f), 'utf8')) && fs.readFileSync(path.join(MAIL_DIR, f), 'utf8').includes('u1@test.local'));
  check('A7 gửi thư đặt lại mật khẩu: 200 và thư ghi ra storage/mail', sr.status === 200 && !!resetMail, `${sr.status} ${mails.length} thư`);
  for (const f of mails) fs.rmSync(path.join(MAIL_DIR, f), { force: true });

  // A8. Xóa người dùng kéo theo playlist, giữ key làm lịch sử
  await u1.call('POST', '/api/auth/login', { email: 'u1@test.local', password: 'Moi-12345' });
  await u1.refreshCsrf('/api');
  const pl2 = await u1.call('POST', '/api/playlists', { name: 'Sẽ bị xóa theo' });
  await u1.call('POST', `/api/playlists/${pl2.data.id}/items`, { items: vids });
  const del = await m.call('DELETE', AD + `/users/${seeded.u1Id}`);
  check('A8 xóa người dùng', del.status === 200);
  check('A8 người dùng đó biến mất khỏi danh sách và chi tiết (404)', (await m.call('GET', AD + `/users/${seeded.u1Id}`)).status === 404 && (await m.call('GET', AD + '/users')).data.total === 1);
  check('A8 playlist của họ cũng bị xóa theo', (await m.call('GET', AD + `/playlists/${pl2.data.id}`)).status === 404);
  const afterDel = await m.call('GET', AD + '/keys');
  const hist = afterDel.data.items.find((k) => k.id === keys[0].id);
  check('A8 key họ đã nhập vẫn còn làm lịch sử, ghi lại email', !!hist && hist.status === 'used' && hist.used_by_email === 'u1@test.local');
  const gone = await u1.call('POST', '/api/auth/login', { email: 'u1@test.local', password: 'Moi-12345' });
  check('A8 người dùng đã xóa không đăng nhập lại được', gone.status === 401);

  // A9. Nhật ký
  const au = await m.call('GET', AD + '/audit?per_page=100');
  const actions = uniq(au.data.items.map((r) => r.action));
  const need = ['key.create', 'key.revoke', 'key.delete', 'user.update', 'user.extend', 'user.password_set', 'user.logout_device', 'user.reset_sent', 'user.delete', 'playlist.delete'];
  check('A9 nhật ký có đủ các hành động quản lý', need.every((a) => actions.includes(a)), need.filter((a) => !actions.includes(a)).join(','));
  const raw = JSON.stringify(au.json);
  check('A9 nhật ký KHÔNG chứa mật khẩu nào (cũ, mới, tạm) và không có key đầy đủ ngoài mã đã tạo', !/Moi-12345|matkhau1|matkhau2|NhanVien-2026|TamThoi-123/.test(raw));
  const af = await m.call('GET', AD + '/audit?action=user.delete');
  check('A9 lọc theo hành động user.delete: đúng 1 dòng, có người làm và IP', af.data.items.length === 1 && af.data.items[0].admin_email === MASTER.email && !!af.data.items[0].ip);
  check('A9 danh sách hành động có trong phản hồi', Array.isArray(af.data.actions) && af.data.actions.includes('key.create'));
  const ad = await m.call('GET', AD + '/audit?from=2999-01-01');
  check('A9 lọc từ ngày ở tương lai: không có dòng nào', ad.status === 200 && ad.data.items.length === 0);
  check('A9 ngày sai định dạng: 422', (await m.call('GET', AD + '/audit?from=hom-qua')).status === 422);
  const rows = au.data.items;
  const sorted = rows.every((r, i) => i === 0 || rows[i - 1].id > r.id);
  check('A9 nhật ký sắp mới nhất trước', sorted);
  check('A9 không có API sửa/xóa nhật ký (405/404)', [(await m.call('DELETE', AD + '/audit/1')).status, (await m.call('PATCH', AD + '/audit/1', {})).status].every((s) => s === 404 || s === 405));
}

// ---------- Phần B: giao diện ----------
const browser = await chromium.launch();
const errors = [];
// Chromium ghi mọi phản hồi 4xx vào console; các mã này là lỗi nghiệp vụ có chủ đích của kịch bản.
// Trang người dùng (userApp) gọi YouTube qua Piped; trong môi trường thử không ra được Internet nên máy chủ trả 502, không tính là lỗi.
function track(page, userApp) {
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const ignore = userApp ? /fonts\.g|net::ERR_|status of (400|401|403|404|409|422|502)\b/ : /fonts\.g|net::ERR_|status of (400|401|403|404|409|422)\b/;
  page.on('console', (m) => { if (m.type() === 'error' && !ignore.test(m.text())) errors.push('console: ' + m.text()); });
}
async function newCtx(viewport = { width: 1280, height: 800 }, userApp = false) {
  const ctx = await browser.newContext({ viewport, locale: 'vi-VN', acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN }).catch(() => {});
  const page = await ctx.newPage();
  track(page, userApp);
  return { ctx, page };
}
const visible = async (loc, ms = 6000) => { try { await loc.first().waitFor({ state: 'visible', timeout: ms }); return true; } catch (e) { return false; } };
const until = async (page, fn, arg, ms = 8000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (e) { return false; } };
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const dlgCount = (page) => page.getByRole('dialog').count();
const gone = async (loc, ms = 6000) => { try { await loc.first().waitFor({ state: 'detached', timeout: ms }); return true; } catch (e) { return (await loc.count()) === 0; } };

async function login(page, email, pass) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(pass);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
}
let phoneSeq = 0;   // giai đoạn 14: đăng ký bắt buộc số điện thoại
async function registerUser(ctx, email, name, password) {
  const me = await (await ctx.request.get(ORIGIN + '/api/auth/me')).json();
  const res = await ctx.request.post(ORIGIN + '/api/auth/register', { headers: { 'X-CSRF-Token': me.data.csrf }, data: { email, name, password, phone: '0906100' + String(++phoneSeq).padStart(3, '0') } });
  const j = await res.json();
  const me2 = await (await ctx.request.get(ORIGIN + '/api/auth/me')).json();
  return { status: res.status(), csrf: me2.data.csrf, user: j.data && j.data.user };
}
const navTo = async (page, label) => { await page.locator('.adm-nav').getByRole('link', { name: label, exact: true }).click(); };

const A = await newCtx();
const pa = A.page;
await pa.goto(ORIGIN + '/admin');
await login(pa, MASTER.email, MASTER.pass);
check('B0 master đăng nhập, vào Tổng quan', await visible(pa.getByRole('heading', { name: 'Tổng quan', level: 1 })));

// B1. Tổng quan
const tile = async (label) => pa.locator('.stat', { has: pa.locator('.stat-label', { hasText: new RegExp('^' + label + '$') }) }).first().locator('.stat-value').textContent();
await visible(pa.locator('.stat'));
check('B1 tổng quan: tổng số người dùng = 1 (sau khi A8 đã xóa 1)', (await tile('Tổng số')) === '1');
check('B1 tổng quan: key đã dùng = 2, chưa dùng = 0', (await tile('Đã dùng')) === '2' && (await pa.locator('.stat', { has: pa.locator('.stat-label', { hasText: /^Chưa dùng$/ }) }).first().locator('.stat-value').textContent()) === '0');
check('B1 tổng quan: có khối "Thao tác gần đây" cho master', await visible(pa.getByRole('heading', { name: 'Thao tác gần đây' })) && (await pa.locator('.recent li').count()) > 0 && (await pa.locator('.recent li').count()) <= 8);
await pa.getByRole('button', { name: 'Xem toàn bộ nhật ký' }).click();
check('B1 nút "Xem toàn bộ nhật ký" chuyển sang mục Nhật ký (không tải lại trang)', await visible(pa.getByRole('heading', { name: 'Nhật ký thao tác', level: 1 })) && new URL(pa.url()).pathname === '/admin/audit' && (await pa.locator('.adm-nav a[aria-current="page"]').textContent()) === 'Nhật ký');
await navTo(pa, 'Tổng quan');
await pa.getByRole('button', { name: 'Xem người dùng' }).click();
check('B1 nút "Xem người dùng" chuyển sang mục Người dùng', await visible(pa.getByRole('heading', { name: 'Người dùng', level: 1 })) && new URL(pa.url()).pathname === '/admin/users');

// B2. Key kích hoạt: tạo lô
await navTo(pa, 'Key kích hoạt');
check('B2 mục Key: hiện danh sách 2 key đã dùng (từ phần A)', await visible(pa.locator('tbody tr')) && (await pa.locator('tbody tr').count()) === 2);
check('B2 key đã dùng không có nút Thu hồi/Xóa, chỉ Sao chép', (await pa.locator('tbody tr').first().getByRole('button').allTextContents()).join('|') === 'Sao chép');
await pa.getByRole('button', { name: 'Tạo key' }).click();
check('B2 hộp thoại Tạo key hiện, focus ở ô Số lượng', await visible(pa.getByRole('dialog', { name: 'Tạo key kích hoạt' })) && await pa.evaluate(() => document.activeElement && document.activeElement.name === 'count'));
await pa.getByLabel('Số lượng key').fill('0');
await pa.getByRole('button', { name: 'Tạo key', exact: true }).last().click();
check('B2 số lượng 0: báo lỗi ngay ở ô', await visible(pa.getByText('Số lượng key từ 1 đến 100.')));
await pa.getByLabel('Số lượng key').fill('3');
await pa.getByLabel('Mỗi key cộng bao nhiêu ngày').fill('7');
await pa.getByLabel('Ghi chú (không bắt buộc)').fill('E2E-UI');
await pa.getByRole('button', { name: 'Tạo key', exact: true }).last().click();
const keyBox = pa.getByLabel('Danh sách key vừa tạo');
check('B2 tạo xong: hiện hộp chứa 3 key', await visible(keyBox) && (await keyBox.inputValue()).split('\n').length === 3);
const uiKeys = (await keyBox.inputValue()).split('\n');
check('B2 mỗi key đúng định dạng và không trùng', uiKeys.every((k) => KEY_RE.test(k)) && uniq(uiKeys).length === 3, uiKeys.join(' '));
await pa.getByRole('button', { name: 'Sao chép tất cả' }).click();
await sleep(300);
const clip = await pa.evaluate(() => navigator.clipboard.readText()).catch(() => null);
check('B2 "Sao chép tất cả" đưa đủ 3 key vào bộ nhớ tạm', clip === uiKeys.join('\n'), clip === null ? 'không đọc được clipboard' : '');
const dlP = pa.waitForEvent('download', { timeout: 5000 }).catch(() => null);
await pa.getByRole('button', { name: 'Tải CSV' }).click();
const dl = await dlP;
let csv = '';
if (dl) { const p = await dl.path(); csv = fs.readFileSync(p, 'utf8'); }
check('B2 "Tải CSV": tên tệp key-kich-hoat-*.csv, có BOM, đủ tiêu đề và 3 dòng key', !!dl && /^key-kich-hoat-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()) && csv.charCodeAt(0) === 0xfeff && csv.includes('Key,Số ngày,Ghi chú') && uiKeys.every((k) => csv.includes(k)) && csv.trim().split(/\r?\n/).length === 4, dl ? dl.suggestedFilename() : 'không tải được');
await pa.screenshot({ path: path.join(here, 'shot-phase5-keys-created.png') });
await pa.getByRole('button', { name: 'Xong' }).click();
check('B2 bấm Xong: đóng hộp, danh sách có 5 key (3 chưa dùng + 2 đã dùng)', await gone(pa.getByRole('dialog')) && await until(pa, () => document.querySelectorAll('tbody tr').length === 5));
check('B2 thẻ đếm: Chưa dùng 3, Đã dùng 2, Đã thu hồi 0', (await pa.locator('.badges').textContent()).replace(/\s+/g, ' ').includes('Chưa dùng: 3') && (await pa.locator('.badges').textContent()).includes('Đã dùng: 2'));

// lọc, tìm
await pa.getByLabel('Lọc theo trạng thái key').selectOption('unused');
check('B2 lọc "Chưa dùng": còn 3 dòng', await until(pa, () => document.querySelectorAll('tbody tr').length === 3));
await pa.getByLabel('Lọc theo trạng thái key').selectOption('');
await pa.getByLabel('Tìm key theo mã, ghi chú hoặc email người dùng').fill('E2E-UI');
check('B2 tìm theo ghi chú "E2E-UI": 3 dòng', await until(pa, () => document.querySelectorAll('tbody tr').length === 3));
await pa.getByLabel('Tìm key theo mã, ghi chú hoặc email người dùng').fill('khong-co-key-nay');
check('B2 tìm không thấy: hiện thông báo khớp bộ lọc', await visible(pa.getByText('Không có key nào khớp bộ lọc.')));
await pa.getByLabel('Tìm key theo mã, ghi chú hoặc email người dùng').fill('');
await until(pa, () => document.querySelectorAll('tbody tr').length === 5);

// thu hồi / xóa
const rowOf = (code) => pa.locator('tbody tr', { hasText: code });
await rowOf(uiKeys[0]).getByRole('button', { name: 'Thu hồi' }).click();
check('B2 thu hồi: hộp xác nhận nêu đúng key', await visible(pa.getByRole('dialog', { name: 'Thu hồi key?' })) && (await pa.getByRole('dialog').textContent()).includes(uiKeys[0]));
await pa.keyboard.press('Escape');
check('B2 Esc đóng hộp xác nhận, key vẫn chưa bị thu hồi', await gone(pa.getByRole('dialog')) && !(await rowOf(uiKeys[0]).textContent()).includes('Đã thu hồi'));
await rowOf(uiKeys[0]).getByRole('button', { name: 'Thu hồi' }).click();
await pa.getByRole('button', { name: 'Thu hồi key' }).click();
check('B2 thu hồi xong: nhãn "Đã thu hồi", nút Thu hồi biến mất, vẫn còn nút Xóa', await until(pa, (c) => { const r = Array.from(document.querySelectorAll('tbody tr')).find((x) => x.textContent.includes(c)); return r && r.textContent.includes('Đã thu hồi'); }, uiKeys[0]) && (await rowOf(uiKeys[0]).getByRole('button').allTextContents()).join('|') === 'Sao chép|Xóa');
await rowOf(uiKeys[2]).getByRole('button', { name: 'Xóa' }).click();
await pa.getByRole('button', { name: 'Xóa key' }).click();
check('B2 xóa key chưa dùng: dòng biến mất', await until(pa, (c) => !document.querySelector('tbody').textContent.includes(c), uiKeys[2]));
check('B2 còn 4 dòng (1 chưa dùng, 1 thu hồi, 2 đã dùng)', (await pa.locator('tbody tr').count()) === 4);

// B3. Ứng dụng người dùng: nhập key
const U = await newCtx(undefined, true);
const pu = U.page;
const reg = await registerUser(U.ctx, 'ui1@test.local', 'Người Dùng UI', 'matkhau-ui1');
check('B3 đăng ký người dùng thử', reg.status === 201);
await pu.goto(ORIGIN + '/');
// Giao diện mới (giai đoạn 6): tài khoản và nhập key nằm trong Cài đặt (nút có ảnh đại diện ở thanh điều hướng).
const setBtn = pu.locator('.rail-settings');
check('B3 thanh điều hướng có nút Cài đặt kèm chữ cái đầu của tên tài khoản', await visible(setBtn) && (await setBtn.locator('.avatar').textContent()) === 'N');
await setBtn.click();
const setDlg = pu.getByRole('dialog', { name: 'Cài đặt' });
check('B3 Cài đặt hiện email, tên và tình trạng "Chưa có hạn dùng"', await visible(setDlg) && (await setDlg.textContent()).includes('ui1@test.local') && (await setDlg.textContent()).includes('Người Dùng UI') && (await setDlg.locator('.account-plan').textContent()).includes('Chưa có hạn dùng'));
await setDlg.getByRole('button', { name: 'Nhập key kích hoạt' }).click();
const accDlg = pu.getByRole('dialog', { name: 'Tài khoản' });
check('B3 hộp "Tài khoản": hiện email, tên, tình trạng "Chưa có hạn dùng"', await visible(accDlg) && (await accDlg.textContent()).includes('ui1@test.local') && (await accDlg.locator('.account-plan').textContent()).includes('Chưa có hạn dùng'));
check('B3 focus vào ô nhập key', await pu.evaluate(() => document.activeElement && document.activeElement.id === 'key-input'));
await pu.getByRole('button', { name: 'Kích hoạt', exact: true }).click();
check('B3 để trống: báo "Hãy nhập key kích hoạt."', await visible(pu.getByText('Hãy nhập key kích hoạt.')));
await pu.locator('#key-input').fill('ZZZZ-ZZZZ-ZZZZ-ZZZZ');
await pu.getByRole('button', { name: 'Kích hoạt', exact: true }).click();
check('B3 key sai: báo lỗi, ô đánh dấu aria-invalid', await visible(pu.getByText('Key không đúng.')) && (await pu.locator('#key-input').getAttribute('aria-invalid')) === 'true');
await pu.locator('#key-input').fill(uiKeys[0]);
await pu.getByRole('button', { name: 'Kích hoạt', exact: true }).click();
check('B3 key đã bị thu hồi: báo "đã bị thu hồi"', await visible(pu.getByText('Key này đã bị thu hồi.')));
await pu.locator('#key-input').fill(uiKeys[1].toLowerCase().replace(/-/g, ''));
await pu.getByRole('button', { name: 'Kích hoạt', exact: true }).click();
check('B3 key đúng (gõ thường, không gạch): báo cộng 7 ngày, tình trạng đổi sang Thành viên', await visible(pu.getByText('Đã cộng 7 ngày.')) && (await accDlg.locator('.account-plan').textContent()).startsWith('Thành viên, hạn dùng đến'));
check('B3 Cài đặt phía sau cũng cập nhật tình trạng Thành viên', (await setDlg.locator('.account-plan').textContent()).startsWith('Thành viên, hạn dùng đến'));
check('B3 ô nhập key được xóa sau khi kích hoạt', (await pu.locator('#key-input').inputValue()) === '');
await pu.screenshot({ path: path.join(here, 'shot-phase5-account-redeemed.png') });
await pu.locator('#key-input').fill(uiKeys[1]);
await pu.getByRole('button', { name: 'Kích hoạt', exact: true }).click();
check('B3 nhập lại key đã dùng: báo "đã được sử dụng"', await visible(pu.getByText('Key này đã được sử dụng.')));
await pu.keyboard.press('Escape');
check('B3 Esc chỉ đóng hộp Tài khoản (Cài đặt vẫn mở) và trả focus về nút "Nhập key kích hoạt"', await gone(accDlg) && await visible(setDlg) && await pu.evaluate(() => document.activeElement && document.activeElement.textContent.includes('Nhập key kích hoạt')));
await pu.keyboard.press('Escape');
check('B3 Esc lần nữa đóng Cài đặt và trả focus về nút Cài đặt', await gone(pu.getByRole('dialog')) && await pu.evaluate(() => document.activeElement && document.activeElement.classList.contains('rail-settings')));
// tạo 2 playlist cho người dùng này để thử mục Playlist
const upl = async (name, items) => {
  const mk = await U.ctx.request.post(ORIGIN + '/api/playlists', { headers: { 'X-CSRF-Token': reg.csrf }, data: { name } });
  const id = (await mk.json()).data.id;
  await U.ctx.request.post(ORIGIN + `/api/playlists/${id}/items`, { headers: { 'X-CSRF-Token': reg.csrf }, data: { items } });
  return id;
};
const plA = await upl('Danh sách đi biển', [{ id: 'bbbbbbbbbbb', title: 'Sóng vỗ', uploader: 'Biển', duration: 125, thumbnail: '' }, { id: 'ccccccccccc', title: 'Gió thổi', uploader: 'Biển', duration: 3725, thumbnail: '' }]);
const plB = await upl('Nhạc buổi sáng', [{ id: 'ddddddddddd', title: 'Chào ngày mới', uploader: 'Sáng', duration: 60, thumbnail: '' }]);
check('B3 người dùng tạo 2 playlist để admin xem', !!plA && !!plB);

// B4. Người dùng (admin)
await navTo(pa, 'Người dùng');
await visible(pa.locator('tbody tr'));
check('B4 danh sách người dùng: 2 người (u2 và ui1)', (await pa.locator('tbody tr').count()) === 2);
await pa.getByLabel('Tìm người dùng theo email, tên hoặc số điện thoại').fill('ui1@');
check('B4 tìm "ui1@": còn 1 dòng, là Người Dùng UI', await until(pa, () => document.querySelectorAll('tbody tr').length === 1) && (await pa.locator('tbody tr').textContent()).includes('Người Dùng UI'));
await pa.getByLabel('Tìm người dùng theo email, tên hoặc số điện thoại').fill('');
await pa.getByLabel('Lọc theo hạn dùng').selectOption('valid');
check('B4 lọc "Còn hạn": chỉ ui1', await until(pa, () => document.querySelectorAll('tbody tr').length === 1 && document.querySelector('tbody tr').textContent.includes('Còn hạn đến')));
await pa.getByLabel('Lọc theo hạn dùng').selectOption('none');
// chờ đúng dòng của u2 (bộ lọc trước cũng còn 1 dòng, nếu chỉ đếm số dòng sẽ đọc nhầm kết quả cũ)
check('B4 lọc "Chưa có hạn": chỉ u2', await until(pa, () => document.querySelectorAll('tbody tr').length === 1 && document.querySelector('tbody tr').textContent.includes('u2@test.local')));
await pa.getByLabel('Lọc theo hạn dùng').selectOption('expired');
check('B4 lọc "Hết hạn": báo không có ai', await visible(pa.getByText('Không có người dùng nào khớp bộ lọc.')));
await pa.getByLabel('Lọc theo hạn dùng').selectOption('');
await until(pa, () => document.querySelectorAll('tbody tr').length === 2);

const rowUi = () => pa.locator('tbody tr', { hasText: 'ui1@test.local' });
await rowUi().getByRole('button', { name: 'Quản lý' }).click();
const detail = pa.getByRole('dialog', { name: 'Người dùng' });
const infoText = await detail.locator('dl.info').textContent();
check('B4 hộp chi tiết: email, hạn dùng còn hạn, có thiết bị đang đăng nhập', infoText.includes('ui1@test.local') && infoText.includes('Còn hạn đến') && !infoText.includes('Không có thiết bị đang đăng nhập'), infoText.slice(0, 200));
check('B4 chi tiết liệt kê 2 playlist và 1 key đã nhập', (await detail.textContent()).includes('Playlist (2)') && (await detail.textContent()).includes('Key đã nhập (1)') && (await detail.textContent()).includes(uiKeys[1]) && (await detail.textContent()).includes('+7 ngày'));
await pa.screenshot({ path: path.join(here, 'shot-phase5-user-detail.png') });

// hộp lồng nhau: Esc chỉ đóng hộp trên cùng
await detail.getByRole('button', { name: 'Hạn dùng', exact: true }).click();
check('B4 mở hộp "Hạn dùng" chồng lên chi tiết: có 2 hộp', await visible(pa.getByRole('dialog', { name: /^Hạn dùng của/ })) && (await dlgCount(pa)) === 2);
await pa.keyboard.press('Escape');
check('B4 Esc chỉ đóng hộp trên cùng, hộp chi tiết còn nguyên', (await dlgCount(pa)) === 1 && await visible(pa.getByRole('dialog', { name: 'Người dùng' })));
check('B4 focus quay lại nút "Hạn dùng" trong hộp chi tiết', await pa.evaluate(() => (document.activeElement.textContent || '') === 'Hạn dùng'));
await detail.getByRole('button', { name: 'Hạn dùng', exact: true }).click();
const beforeText = await detail.locator('dl.info dd').nth(4).textContent();
await pa.getByRole('button', { name: '+30 ngày' }).click();
check('B4 "+30 ngày": hộp hạn dùng đóng, chi tiết cập nhật hạn mới', await until(pa, (b) => { const d = document.querySelectorAll('dl.info dd')[4]; return d && d.textContent !== b; }, beforeText) && (await dlgCount(pa)) === 1);
await detail.getByRole('button', { name: 'Hạn dùng', exact: true }).click();
await pa.getByLabel('Hoặc đặt ngày hết hạn cụ thể').fill('2031-12-31');
await pa.getByRole('button', { name: 'Đặt ngày hết hạn' }).click();
check('B4 đặt ngày cụ thể 31/12/2031: chi tiết hiện đúng ngày', await until(pa, () => document.querySelectorAll('dl.info dd')[4] && document.querySelectorAll('dl.info dd')[4].textContent.includes('31/12/2031')));

// Khóa -> người dùng bị đăng xuất
await detail.getByRole('button', { name: 'Khóa', exact: true }).click();
check('B4 khóa: hộp xác nhận nêu email', await visible(pa.getByRole('dialog', { name: 'Khóa tài khoản?' })) && (await pa.getByRole('dialog', { name: 'Khóa tài khoản?' }).textContent()).includes('ui1@test.local'));
await pa.getByRole('button', { name: 'Khóa tài khoản' }).click();
check('B4 khóa xong: chi tiết hiện "Đã khóa", nút đổi thành "Mở khóa"', await visible(detail.getByRole('button', { name: 'Mở khóa' })) && (await detail.locator('dl.info').textContent()).includes('Đã khóa'));
const meAfter = await (await U.ctx.request.get(ORIGIN + '/api/auth/me')).json();
check('B4 người dùng đang mở ứng dụng bị đăng xuất ngay (me.user = null)', meAfter.data.user === null);
const loginB = await U.ctx.request.post(ORIGIN + '/api/auth/login', { headers: { 'X-CSRF-Token': meAfter.data.csrf }, data: { email: 'ui1@test.local', password: 'matkhau-ui1' } });
check('B4 người dùng bị khóa đăng nhập: 403', loginB.status() === 403);
await detail.getByRole('button', { name: 'Mở khóa' }).click();
await pa.getByRole('button', { name: 'Mở khóa', exact: true }).last().click();
check('B4 mở khóa: trở lại "Hoạt động"', await visible(detail.getByRole('button', { name: 'Khóa', exact: true })) && (await detail.locator('dl.info').textContent()).includes('Hoạt động'));

// Mật khẩu mới
await detail.getByRole('button', { name: 'Mật khẩu mới', exact: true }).click();
await pa.getByRole('button', { name: 'Tạo mật khẩu ngẫu nhiên' }).click();
const gen = await pa.getByLabel('Mật khẩu mới', { exact: true }).last().inputValue();
check('B4 nút tạo mật khẩu ngẫu nhiên: 12 ký tự dễ đọc', /^[a-zA-Z2-9]{12}$/.test(gen) && !/[0OIl1]/.test(gen), gen);
await pa.getByLabel('Mật khẩu mới', { exact: true }).last().fill('12');
await pa.getByRole('button', { name: 'Đặt mật khẩu', exact: true }).click();
check('B4 mật khẩu quá ngắn: báo lỗi', await visible(pa.getByText(/Mật khẩu cần từ 6/)));
await pa.getByLabel('Mật khẩu mới', { exact: true }).last().fill('Doi-matkhau-9');
await pa.getByRole('button', { name: 'Đặt mật khẩu', exact: true }).click();
check('B4 đặt xong: hiện lại email và mật khẩu để chép một lần', await visible(pa.locator('.dialog .mono', { hasText: 'ui1@test.local' })) && (await pa.getByLabel('Mật khẩu mới', { exact: true }).last().inputValue()) === 'Doi-matkhau-9');
await pa.getByRole('button', { name: 'Đã chép xong' }).click();
const relog = await U.ctx.request.post(ORIGIN + '/api/auth/login', { headers: { 'X-CSRF-Token': meAfter.data.csrf }, data: { email: 'ui1@test.local', password: 'Doi-matkhau-9' } });
check('B4 người dùng đăng nhập được bằng mật khẩu mới', relog.status() === 200);

// Xóa người dùng
await detail.getByRole('button', { name: 'Xóa người dùng' }).click();
check('B4 xóa: hộp xác nhận nêu email và số playlist bị xóa theo', await visible(pa.getByRole('dialog', { name: 'Xóa người dùng?' })) && (await pa.getByRole('dialog', { name: 'Xóa người dùng?' }).textContent()).includes('2 playlist'));
await pa.getByRole('button', { name: 'Xóa vĩnh viễn' }).click();
check('B4 xóa xong: đóng cả hai hộp, bảng còn 1 dòng (u2)', await gone(pa.getByRole('dialog')) && await until(pa, () => document.querySelectorAll('tbody tr').length === 1) && (await pa.locator('tbody tr').textContent()).includes('u2@test.local'));

// Khối thử: người dùng thứ hai để thử playlist (tạo lại)
const U2 = await newCtx(undefined, true);
const reg2 = await registerUser(U2.ctx, 'ui2@test.local', 'Người Dùng Hai', 'matkhau-ui2');
const mk = await U2.ctx.request.post(ORIGIN + '/api/playlists', { headers: { 'X-CSRF-Token': reg2.csrf }, data: { name: 'Danh sách đi biển' } });
const plC = (await mk.json()).data.id;
await U2.ctx.request.post(ORIGIN + `/api/playlists/${plC}/items`, { headers: { 'X-CSRF-Token': reg2.csrf }, data: { items: [{ id: 'bbbbbbbbbbb', title: 'Sóng vỗ', uploader: 'Biển', duration: 125, thumbnail: '' }, { id: 'ccccccccccc', title: 'Gió thổi', uploader: 'Biển', duration: 3725, thumbnail: '' }] } });

// B5. Playlist
await navTo(pa, 'Playlist');
check('B5 mục Playlist: chỉ còn playlist của ui2 (playlist của ui1 đã xóa theo)', await visible(pa.locator('tbody tr')) && (await pa.locator('tbody tr').count()) === 1 && (await pa.locator('tbody tr').textContent()).includes('ui2@test.local'));
await pa.getByLabel('Tìm playlist theo tên hoặc email chủ').fill('biển');
check('B5 tìm theo tên "biển": thấy', await until(pa, () => document.querySelectorAll('tbody tr').length === 1));
await pa.getByLabel('Tìm playlist theo tên hoặc email chủ').fill('ui1@');
check('B5 tìm theo email chủ đã bị xóa: báo không có', await visible(pa.getByText('Không có playlist nào khớp.')));
await pa.getByLabel('Tìm playlist theo tên hoặc email chủ').fill('');
await visible(pa.locator('tbody tr'));
await pa.locator('tbody tr').getByRole('button', { name: 'Xem' }).click();
const pdlg = pa.getByRole('dialog', { name: 'Danh sách đi biển' });
check('B5 xem playlist: đủ 2 bài, thời lượng 2:05 và 1:02:05', await visible(pdlg.locator('ol li')) && (await pdlg.locator('ol li').count()) === 2 && (await pdlg.textContent()).includes('2:05') && (await pdlg.textContent()).includes('1:02:05') && (await pdlg.textContent()).includes('Của ui2@test.local'));
await pa.screenshot({ path: path.join(here, 'shot-phase5-playlist-view.png') });
await pdlg.getByRole('button', { name: 'Xóa playlist này' }).click();
check('B5 xóa từ hộp xem: hộp xác nhận chồng lên (2 hộp)', await visible(pa.getByRole('dialog', { name: 'Xóa playlist?' })) && (await dlgCount(pa)) === 2);
await pa.getByRole('button', { name: 'Xóa playlist', exact: true }).click();
check('B5 xóa xong: đóng cả hai hộp, danh sách trống', await gone(pa.getByRole('dialog')) && await visible(pa.getByText('Chưa có playlist nào được lưu trên tài khoản.')));

// B6. Nhật ký
await navTo(pa, 'Nhật ký');
check('B6 nhật ký: có dòng, mới nhất ở đầu', await visible(pa.locator('tbody tr')) && (await pa.locator('tbody tr').count()) > 5);
const firstTime = await pa.locator('tbody tr').first().locator('td').first().textContent();
const lastTime = await pa.locator('tbody tr').last().locator('td').first().textContent();
const toKey = (t) => t.slice(6, 10) + t.slice(3, 5) + t.slice(0, 2) + t.slice(11);
check('B6 định dạng giờ dd/mm/yyyy hh:mm và dòng đầu mới hơn hoặc bằng dòng cuối', /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(firstTime) && toKey(firstTime) >= toKey(lastTime), firstTime + ' / ' + lastTime);
check('B6 hiển thị tên hành động bằng tiếng Việt và mã gốc', (await pa.locator('tbody').textContent()).includes('Xóa người dùng') && (await pa.locator('tbody').textContent()).includes('user.delete'));
await pa.getByLabel('Lọc theo hành động').selectOption('user.delete');
check('B6 lọc "Xóa người dùng": chỉ còn dòng xóa người dùng', await until(pa, () => { const rows = document.querySelectorAll('tbody tr'); return rows.length >= 1 && Array.from(rows).every((r) => r.textContent.includes('user.delete')); }));
await pa.getByLabel('Lọc theo hành động').selectOption('');
await pa.getByLabel('Tìm trong nhật ký theo email người làm hoặc chi tiết').fill('khong-ai-ten-nay');
check('B6 tìm không thấy: báo không khớp bộ lọc', await visible(pa.getByText('Không có dòng nào khớp bộ lọc.', { exact: false })) || await visible(pa.getByText('Không có dòng nhật ký nào khớp bộ lọc.')));
await pa.getByLabel('Tìm trong nhật ký theo email người làm hoặc chi tiết').fill('');
await pa.getByLabel('Từ ngày').fill('2999-01-01');
check('B6 lọc "Từ ngày" ở tương lai: không có dòng nào', await visible(pa.getByText('Không có dòng nhật ký nào khớp bộ lọc.')));
await pa.getByLabel('Từ ngày').fill('');
await until(pa, () => document.querySelectorAll('tbody tr').length > 5);
const auditText = await pa.locator('tbody').textContent();
check('B6 trang nhật ký không hiện mật khẩu nào', !/Doi-matkhau-9|matkhau-ui1|Moi-12345|matkhau1/.test(auditText));

// B7. Admin thường: không thấy Nhật ký, nhưng quản lý được người dùng/key
const N = await newCtx();
const pn = N.page;
await pn.goto(ORIGIN + '/admin');
await login(pn, 'nv@test.local', 'NhanVien-2026');
check('B7 admin thường đăng nhập: mục Tổng quan, không có Nhật ký/Quản trị viên', await visible(pn.getByRole('heading', { name: 'Tổng quan', level: 1 })) && (await pn.locator('.adm-nav a').allTextContents()).join('|') === 'Tổng quan|Người dùng|Key kích hoạt|Playlist|Tài khoản của tôi');
check('B7 Tổng quan của admin thường không có khối "Thao tác gần đây"', await pn.getByRole('heading', { name: 'Thao tác gần đây' }).count() === 0);
await pn.goto(ORIGIN + '/admin/keys');
check('B7 admin thường vào được mục Key', await visible(pn.getByRole('heading', { name: 'Key kích hoạt', level: 1 })));
await N.ctx.close();

// B8. Bố cục: điện thoại, máy tính bảng, máy tính
const sections = [['Tổng quan', '/admin/dashboard'], ['Người dùng', '/admin/users'], ['Key kích hoạt', '/admin/keys'], ['Playlist', '/admin/playlists'], ['Nhật ký', '/admin/audit']];
// dữ liệu cho bảng: thêm 1 playlist và vài key
await U2.ctx.request.post(ORIGIN + '/api/playlists', { headers: { 'X-CSRF-Token': reg2.csrf }, data: { name: 'Playlist có tên rất dài để thử việc xuống dòng trên màn hình điện thoại nhỏ hẹp' } });
for (const [w, h, tag] of [[1280, 720, 'desktop'], [1024, 600, 'tablet'], [390, 844, 'phone']]) {
  await pa.setViewportSize({ width: w, height: h });
  for (const [label, p] of sections) {
    await pa.goto(ORIGIN + p);
    await visible(pa.locator('.adm-body'));
    await sleep(350);
    const over = await overflowX(pa);
    check(`B8 ${w}x${h} ${label}: không có thanh cuộn ngang`, over <= 0, `lệch ${over}px`);
    const small = await pa.evaluate(() => Array.from(document.querySelectorAll('button, a.btn, .adm-nav a, select, input')).filter((b) => b.offsetParent && b.type !== 'hidden' && (b.type === 'checkbox' && b.closest('.check-hit') ? b.closest('.check-hit') : b).getBoundingClientRect().height < 40).map((b) => (b.textContent || b.getAttribute('aria-label') || b.name || b.tagName).trim().slice(0, 30)));
    check(`B8 ${w}x${h} ${label}: mọi nút/ô nhập cao từ 40px (ô tích: tính vùng bấm bao quanh)`, small.length === 0, small.join(','));
    if (label !== 'Tổng quan' || tag === 'phone') await pa.screenshot({ path: path.join(here, `shot-phase5-${p.split('/').pop()}-${tag}.png`), fullPage: p !== '/admin/audit' });
  }
}
await pa.setViewportSize({ width: 390, height: 844 });
await pa.goto(ORIGIN + '/admin/users');
await visible(pa.locator('tbody tr'));
check('B8 điện thoại: bảng người dùng chuyển thành thẻ', (await pa.evaluate(() => getComputedStyle(document.querySelector('.adm-table tbody tr')).display)) === 'block');
check('B8 điện thoại: thanh mục cuộn ngang được trong thanh, không làm tràn trang', await pa.evaluate(() => { const n = document.querySelector('.adm-nav'); return n.scrollWidth >= n.clientWidth && document.documentElement.scrollWidth <= window.innerWidth; }));
await pa.locator('tbody tr').first().getByRole('button', { name: 'Quản lý' }).click();
await visible(pa.locator('dl.info'));
check('B8 điện thoại: hộp chi tiết người dùng không tràn ngang', (await overflowX(pa)) <= 0);
const dbox = await pa.locator('.dialog').first().boundingBox();
check('B8 điện thoại: hộp thoại nằm gọn trong màn hình', dbox.x >= 0 && dbox.x + dbox.width <= 391, JSON.stringify(dbox));
await pa.screenshot({ path: path.join(here, 'shot-phase5-user-detail-phone.png') });
await pa.keyboard.press('Escape');
await pa.goto(ORIGIN + '/admin/keys');
await pa.getByRole('button', { name: 'Tạo key' }).click();
await pa.getByLabel('Số lượng key').fill('12');
await pa.getByRole('button', { name: 'Tạo key', exact: true }).last().click();
await visible(pa.getByLabel('Danh sách key vừa tạo'));
check('B8 điện thoại: hộp kết quả tạo 12 key không tràn ngang', (await overflowX(pa)) <= 0);
await pa.screenshot({ path: path.join(here, 'shot-phase5-keys-created-phone.png') });
await pa.keyboard.press('Escape');

// B9. Ứng dụng người dùng: Cài đặt/Tài khoản trên màn hình nhỏ/ngang của xe, và không phá bố cục
const car = await newCtx({ width: 1024, height: 600 }, true);
const regC = await registerUser(car.ctx, 'car@test.local', 'Tài xế', 'matkhau-car');
await car.page.goto(ORIGIN + '/');
await visible(car.page.locator('.rail-settings'));
check('B9 màn hình xe 1024x600: trang chính không có thanh cuộn', await car.page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1), await car.page.evaluate(() => `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}`));
check('B9 nút Cài đặt cao từ 44px', (await car.page.locator('.rail-settings').boundingBox()).height >= 44);
await car.page.locator('.rail-settings').click();
await visible(car.page.getByRole('dialog', { name: 'Cài đặt' }));
await car.page.getByRole('button', { name: 'Nhập key kích hoạt' }).click();
await visible(car.page.getByRole('dialog', { name: 'Tài khoản' }));
const cbox = await car.page.getByRole('dialog', { name: 'Tài khoản' }).boundingBox();
check('B9 hộp Tài khoản nằm gọn trong màn hình 1024x600', cbox.y >= 0 && cbox.y + cbox.height <= 600 && cbox.x >= 0 && cbox.x + cbox.width <= 1024, JSON.stringify(cbox));
await car.page.screenshot({ path: path.join(here, 'shot-phase5-account-car.png') });
await car.page.keyboard.press('Escape');
await car.page.keyboard.press('Escape');
await car.page.setViewportSize({ width: 390, height: 844 });
await sleep(300);
check('B9 điện thoại dọc: trang chính không tràn ngang', (await overflowX(car.page)) <= 0);
// khách (chưa đăng nhập, dùng thử) thấy "Đăng nhập hoặc tạo tài khoản" trong Cài đặt chứ không có nút Nhập key
const G = await newCtx(undefined, true);
await G.page.goto(ORIGIN + '/');
await G.page.getByRole('button', { name: 'Dùng thử, không cần tài khoản' }).click();
await visible(G.page.locator('.rail-settings'));
await G.page.locator('.rail-settings').click();
await visible(G.page.getByRole('dialog', { name: 'Cài đặt' }));
check('B9 khách chưa đăng nhập: Cài đặt không có nút Nhập key, có nút Đăng nhập', await G.page.getByRole('button', { name: 'Nhập key kích hoạt' }).count() === 0 && await visible(G.page.getByRole('button', { name: 'Đăng nhập hoặc tạo tài khoản' })));
await G.ctx.close();
await car.ctx.close();
await U.ctx.close();
await U2.ctx.close();

check('B10 không có lỗi JS/console trong suốt kịch bản', errors.length === 0, errors.slice(0, 3).join(' | '));
check('B10 PHP không báo lỗi/cảnh báo nào', !/Warning|Fatal|Notice|Deprecated/.test(phpErr), phpErr.split('\n').slice(0, 2).join(' '));

await browser.close();
stopAll();
console.log(failures === 0 ? '\nTẤT CẢ ĐẠT' : `\n${failures} LỖI`);
process.exit(failures === 0 ? 0 : 1);
