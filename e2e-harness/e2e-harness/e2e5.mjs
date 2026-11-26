import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');

// Giai đoạn 5.1: khu vực quản trị /admin chạy trên PHP THẬT (php -S) với SQLite thay MySQL.
// Phần A: kiểm tra HTTP thật (cookie, CSRF, đổi ID phiên, tách phiên người dùng/admin).
// Phần B: kiểm tra giao diện trên Chromium thật.
// Không thay thế việc thử trên PHP 7.4 + MySQL thật của bạn (php bin/migrate.php, php tests/run.php --integration).
const PUBLIC_DIR = process.env.PUBLIC_DIR;
if (!PUBLIC_DIR) { console.error('Cần đặt PUBLIC_DIR=/duong/dan/den/public'); process.exit(2); }
const PROJECT = path.dirname(PUBLIC_DIR);
const here = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.env.PORT || 8099);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `carweb-e2e5-${process.pid}.sqlite`);
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
  return {
    cookies,
    async call(method, url, body, headers = {}) {
      const h = { Accept: 'application/json', ...headers };
      const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookie) h.Cookie = cookie;
      if (body !== undefined) { h['Content-Type'] = 'application/json'; }
      const res = await fetch(ORIGIN + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
      const raw = res.headers.getSetCookie();
      for (const line of raw) {
        const [pair] = line.split(';');
        const i = pair.indexOf('=');
        cookies[pair.slice(0, i)] = pair.slice(i + 1);
      }
      let json = null;
      try { json = await res.clone().json(); } catch (e) { /* không phải JSON */ }
      return { status: res.status, json, raw, headers: res.headers, text: async () => res.text() };
    },
  };
}

{
  const c = jar();
  const me1 = await c.call('GET', '/admin/api/auth/me');
  const csrf = me1.json.data.csrf;
  const sid1 = c.cookies.carweb_admin;
  const setCookie = me1.raw.join('\n');
  check('A1 /auth/me: có cookie carweb_admin HttpOnly SameSite=Lax', /carweb_admin=/.test(setCookie) && /HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie), setCookie.split('\n')[0]);
  check('A1 chưa đăng nhập: admin = null, có CSRF', me1.json.data.admin === null && /^[0-9a-f]{64}$/.test(csrf));
  check('A2 danh sách admin khi chưa đăng nhập: 401 UNAUTHORIZED', (await c.call('GET', '/admin/api/admins')).status === 401);

  const noCsrf = await c.call('POST', '/admin/api/auth/login', { email: MASTER.email, password: MASTER.pass });
  check('A3 đăng nhập thiếu CSRF: 403 CSRF_INVALID', noCsrf.status === 403 && noCsrf.json.error.code === 'CSRF_INVALID');
  const bad = await c.call('POST', '/admin/api/auth/login', { email: MASTER.email, password: 'sai-mat-khau' }, { 'X-CSRF-Token': csrf });
  check('A4 sai mật khẩu: 401 INVALID_CREDENTIALS', bad.status === 401 && bad.json.error.code === 'INVALID_CREDENTIALS');

  const ok = await c.call('POST', '/admin/api/auth/login', { email: MASTER.email, password: MASTER.pass }, { 'X-CSRF-Token': csrf });
  const sid2 = c.cookies.carweb_admin;
  check('A5 đăng nhập đúng: 200, role master, không lộ hash/salt', ok.status === 200 && ok.json.data.admin.role === 'master' && !JSON.stringify(ok.json).match(/password_hash|salt/));
  check('A5 ID phiên được đổi sau khi đăng nhập (chống session fixation)', sid1 && sid2 && sid1 !== sid2);
  const old = jar();
  old.cookies.carweb_admin = sid1;
  const oldMe = await old.call('GET', '/admin/api/auth/me');
  check('A5 ID phiên cũ (trước đăng nhập) không dùng lại được', oldMe.json.data.admin === null);

  const list = await c.call('GET', '/admin/api/admins');
  check('A6 master xem được danh sách admin', list.status === 200 && list.json.data.items.length === 1 && list.json.data.items[0].email === MASTER.email);
  const userSide = await c.call('GET', '/api/auth/me');
  check('A7 phiên admin không làm người dùng thường thành đã đăng nhập', userSide.json.data.user === null && userSide.json.data.guest === true);
  check('A7 phiên người dùng dùng cookie khác (carweb_sid)', /carweb_sid=/.test(userSide.raw.join('\n')) && !!c.cookies.carweb_sid);

  const page = await c.call('GET', '/admin/admins');
  const html = await page.text();
  check('A8 trang /admin/admins: HTML, noindex, nạp admin/main.js', page.status === 200 && /text\/html/.test(page.headers.get('content-type')) && /noindex/.test(page.headers.get('x-robots-tag') || '') && html.includes('assets/js/admin/main.js') && html.includes('"apiBase":"\\/admin\\/api"'));
  const userPage = await c.call('GET', '/');
  check('A8 trang người dùng không bị ảnh hưởng', (await userPage.text()).includes('assets/js/main.js'));
  check('A8 /admin/x.php không tồn tại: 404', (await c.call('GET', '/admin/x.php')).status === 404);

  const out = await c.call('POST', '/admin/api/auth/logout', {}, { 'X-CSRF-Token': csrf });
  check('A9 đăng xuất: 200', out.status === 200);
  const reuse = jar();
  reuse.cookies.carweb_admin = sid2;
  check('A9 phiên cũ bị hủy sau đăng xuất', (await reuse.call('GET', '/admin/api/admins')).status === 401);
}

// ---------- Phần B: giao diện ----------
const browser = await chromium.launch();
const errors = [];
async function newAdminPage(viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport, locale: 'vi-VN' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // Chromium ghi mọi phản hồi 4xx vào console; các mã 400/401/403/409/422 là lỗi nghiệp vụ có chủ đích của kịch bản, không phải lỗi trang.
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|net::ERR_|status of (400|401|403|409|422)\b/.test(m.text())) errors.push('console: ' + m.text()); });
  return { ctx, page };
}
const until = async (page, fn, arg, ms = 8000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (e) { return false; } };
const visible = async (loc, ms = 6000) => { try { await loc.first().waitFor({ state: 'visible', timeout: ms }); return true; } catch (e) { return false; } };
async function login(page, email, pass) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(pass);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
}
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const A = await newAdminPage();
const pa = A.page;

// B1. Màn hình đăng nhập
await pa.goto(ORIGIN + '/admin');
check('B1 /admin: hiện màn hình đăng nhập quản trị', await visible(pa.getByRole('heading', { name: 'Đăng nhập quản trị' })));
check('B1 tiêu đề trang có chữ "Quản trị"', (await pa.title()).startsWith('Quản trị'));
await login(pa, MASTER.email, 'sai-mat-khau');
check('B1 sai mật khẩu: báo lỗi, vẫn ở màn hình đăng nhập', await visible(pa.getByText('Email hoặc mật khẩu không đúng.')));
await login(pa, MASTER.email, MASTER.pass);
check('B2 đăng nhập master: vào khung quản trị, mục mặc định là Tổng quan (/admin/dashboard)', await visible(pa.getByRole('heading', { name: 'Tổng quan', level: 1 })) && new URL(pa.url()).pathname === '/admin/dashboard');
check('B2 thanh mục của master có 7 mục', (await pa.locator('.adm-nav a').allTextContents()).join('|') === 'Tổng quan|Người dùng|Key kích hoạt|Playlist|Nhật ký|Quản trị viên|Tài khoản của tôi');
await pa.getByRole('link', { name: 'Quản trị viên' }).click();
check('B2 bấm mục Quản trị viên: URL /admin/admins', await visible(pa.getByRole('heading', { name: 'Quản trị viên', level: 1 })) && new URL(pa.url()).pathname === '/admin/admins');
check('B2 mục đang chọn có aria-current', (await pa.locator('.adm-nav a[aria-current="page"]').textContent()) === 'Quản trị viên');
check('B2 bảng có dòng master, nhãn Master, ghi chú được bảo vệ', await visible(pa.locator('tbody tr', { hasText: MASTER.email })) && (await pa.locator('tbody tr').first().textContent()).includes('Master') && (await pa.locator('tbody tr').first().textContent()).includes('được bảo vệ'));
check('B2 dòng master không có nút Khóa/Xóa/Mật khẩu tạm', (await pa.locator('tbody tr').first().getByRole('button').allTextContents()).join('|') === 'Sửa');
await pa.screenshot({ path: path.join(here, 'shot-phase5-admins-desktop.png') });

// B3. Tạo admin
await pa.getByRole('button', { name: 'Thêm quản trị viên' }).click();
check('B3 hộp thoại thêm admin hiện, focus ở ô đầu tiên', await visible(pa.getByRole('dialog', { name: 'Thêm quản trị viên' })) && await pa.evaluate(() => document.activeElement && document.activeElement.name === 'name'));
await pa.getByRole('button', { name: 'Tạo tài khoản' }).click();
check('B3 để trống: báo lỗi từng ô (email, tên, mật khẩu)', await visible(pa.getByText('Email không hợp lệ.')) && await visible(pa.getByText('Hãy nhập tên hiển thị.')) && await visible(pa.locator('.field-error', { hasText: 'Mật khẩu tạm cần từ 8' })));
await pa.keyboard.press('Escape');
check('B3 phím Esc đóng hộp thoại và trả focus về nút Thêm', await pa.getByRole('dialog').count() === 0 && await pa.evaluate(() => (document.activeElement.textContent || '').includes('Thêm quản trị viên')));

await pa.getByRole('button', { name: 'Thêm quản trị viên' }).click();
await pa.getByLabel('Tên hiển thị').fill('Nhân viên Một');
await pa.getByLabel('Email đăng nhập').fill('NV1@Test.local');
await pa.getByRole('button', { name: 'Tạo mật khẩu ngẫu nhiên' }).click();
const temp1 = await pa.getByLabel('Mật khẩu tạm').inputValue();
check('B3 nút "Tạo mật khẩu ngẫu nhiên" tạo mật khẩu 12 ký tự dễ đọc', /^[a-zA-Z2-9]{12}$/.test(temp1) && !/[0OIl1]/.test(temp1), temp1);
await pa.getByRole('button', { name: 'Tạo tài khoản' }).click();
check('B3 tạo xong: hiện email (chữ thường) và mật khẩu tạm đúng giá trị đã nhập', await visible(pa.locator('.dialog .mono', { hasText: 'nv1@test.local' })) && (await pa.getByLabel('Mật khẩu tạm').inputValue()) === temp1);
await pa.getByRole('button', { name: 'Đã chép xong' }).click();
check('B3 danh sách có dòng mới, nhãn "Chờ đổi mật khẩu", đủ 4 nút thao tác', await visible(pa.locator('tbody tr', { hasText: 'nv1@test.local' })) && (await pa.locator('tbody tr', { hasText: 'nv1@test.local' }).textContent()).includes('Chờ đổi mật khẩu') && (await pa.locator('tbody tr', { hasText: 'nv1@test.local' }).getByRole('button').allTextContents()).join('|') === 'Sửa|Khóa|Mật khẩu tạm|Xóa');
await pa.getByRole('button', { name: 'Thêm quản trị viên' }).click();
await pa.getByLabel('Tên hiển thị').fill('Trùng');
await pa.getByLabel('Email đăng nhập').fill('nv1@test.local');
await pa.getByLabel('Mật khẩu tạm').fill('MatKhau-tam-9');
await pa.getByRole('button', { name: 'Tạo tài khoản' }).click();
check('B3 email trùng: báo lỗi trong hộp thoại', await visible(pa.getByText('Email này đã được dùng')));
await pa.keyboard.press('Escape');

// B4. Admin mới đăng nhập (phiên khác): bắt buộc đổi mật khẩu
const B = await newAdminPage();
const pb = B.page;
await pb.goto(ORIGIN + '/admin/admins');
check('B4 chưa đăng nhập vào /admin/admins: hiện màn hình đăng nhập', await visible(pb.getByRole('heading', { name: 'Đăng nhập quản trị' })));
await login(pb, 'nv1@test.local', temp1);
check('B4 đăng nhập bằng mật khẩu tạm: bị buộc đổi mật khẩu', await visible(pb.getByRole('heading', { name: 'Đặt mật khẩu mới' })) && await visible(pb.getByText('Bạn đang dùng mật khẩu tạm')));
check('B4 chưa thấy khung quản trị/thanh mục', await pb.locator('.adm-nav').count() === 0);
await pb.getByLabel('Mật khẩu tạm hiện tại').fill('sai-mat-khau');
await pb.getByLabel('Mật khẩu mới', { exact: true }).fill('MatKhau-moi-1');
await pb.getByLabel('Nhập lại mật khẩu mới').fill('MatKhau-moi-1');
await pb.getByRole('button', { name: 'Lưu mật khẩu mới' }).click();
check('B4 sai mật khẩu tạm: báo lỗi ở ô tương ứng', await visible(pb.getByText('Mật khẩu hiện tại không đúng.')));
await pb.getByLabel('Mật khẩu tạm hiện tại').fill(temp1);
await pb.getByLabel('Nhập lại mật khẩu mới').fill('khac-nhau-123');
await pb.getByRole('button', { name: 'Lưu mật khẩu mới' }).click();
check('B4 nhập lại không khớp: báo lỗi', await visible(pb.getByText('Hai mật khẩu chưa giống nhau.')));
await pb.getByLabel('Mật khẩu mới', { exact: true }).fill('ngan');
await pb.getByLabel('Nhập lại mật khẩu mới').fill('ngan');
await pb.getByRole('button', { name: 'Lưu mật khẩu mới' }).click();
check('B4 mật khẩu mới quá ngắn: máy chủ báo lỗi', await visible(pb.getByText('Mật khẩu cần từ 8 đến 100 ký tự.')));
await pb.getByLabel('Mật khẩu mới', { exact: true }).fill('MatKhau-moi-1');
await pb.getByLabel('Nhập lại mật khẩu mới').fill('MatKhau-moi-1');
await pb.getByRole('button', { name: 'Lưu mật khẩu mới' }).click();
check('B4 đổi thành công: vào khung quản trị', await visible(pb.locator('.adm-nav')));
check('B4 admin thường thấy 5 mục (không có Nhật ký, Quản trị viên), URL tự về /admin/dashboard', (await pb.locator('.adm-nav a').allTextContents()).join('|') === 'Tổng quan|Người dùng|Key kích hoạt|Playlist|Tài khoản của tôi' && new URL(pb.url()).pathname === '/admin/dashboard');
await pb.goto(ORIGIN + '/admin/admins');
check('B4 gõ thẳng /admin/admins: không vào được, tự chuyển về /admin/dashboard', await visible(pb.getByRole('heading', { name: 'Tổng quan', level: 1 })) && new URL(pb.url()).pathname === '/admin/dashboard');
await pb.goto(ORIGIN + '/admin/audit');
check('B4 gõ thẳng /admin/audit: cũng bị chuyển về /admin/dashboard', await visible(pb.getByRole('heading', { name: 'Tổng quan', level: 1 })) && new URL(pb.url()).pathname === '/admin/dashboard');

// B5. Master xem trạng thái đã đổi, rồi khóa; phiên của admin kia bị đăng xuất
await pa.reload();
const rowNv1 = () => pa.locator('tbody tr', { hasText: 'nv1@test.local' });
check('B5 sau khi admin đổi mật khẩu, nhãn "Chờ đổi mật khẩu" biến mất và có giờ đăng nhập', await visible(rowNv1()) && !(await rowNv1().textContent()).includes('Chờ đổi mật khẩu') && /\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(await rowNv1().textContent()));
await rowNv1().getByRole('button', { name: 'Khóa', exact: true }).click();
check('B5 khóa: hộp xác nhận hiện đúng người', await visible(pa.getByRole('dialog', { name: 'Khóa tài khoản?' })));
await pa.getByRole('button', { name: 'Hủy' }).click();
check('B5 bấm Hủy: không khóa', !(await rowNv1().textContent()).includes('Đã khóa'));
await rowNv1().getByRole('button', { name: 'Khóa', exact: true }).click();
await pa.getByRole('button', { name: 'Khóa tài khoản' }).click();
check('B5 khóa xong: nhãn "Đã khóa", nút đổi thành "Mở khóa"', await visible(rowNv1().getByRole('button', { name: 'Mở khóa' })) && (await rowNv1().textContent()).includes('Đã khóa'));
await pb.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));   // kích hoạt bộ theo dõi phiên như khi quay lại thẻ
check('B5 admin bị khóa: trang đang mở tự về màn hình đăng nhập kèm thông báo', await visible(pb.getByRole('heading', { name: 'Đăng nhập quản trị' })) && await visible(pb.getByText('Phiên đăng nhập quản trị đã kết thúc')));
await login(pb, 'nv1@test.local', 'MatKhau-moi-1');
check('B5 admin bị khóa đăng nhập lại: báo tài khoản bị khóa', await visible(pb.getByText('Tài khoản đã bị khóa')));
await rowNv1().getByRole('button', { name: 'Mở khóa' }).click();
check('B5 mở khóa: nhãn "Hoạt động"', await visible(rowNv1().getByRole('button', { name: 'Khóa', exact: true })) && (await rowNv1().textContent()).includes('Hoạt động'));
await login(pb, 'nv1@test.local', 'MatKhau-moi-1');
check('B5 đăng nhập lại được sau khi mở khóa', await visible(pb.locator('.adm-nav')));

// B6. Master đặt mật khẩu tạm: phiên cũ của admin kia mất hiệu lực
await rowNv1().getByRole('button', { name: 'Mật khẩu tạm' }).click();
await pa.getByLabel('Mật khẩu tạm mới').fill('ngan');
await pa.getByRole('button', { name: 'Đặt mật khẩu tạm' }).click();
check('B6 mật khẩu tạm quá ngắn: báo lỗi', await visible(pa.getByText('Mật khẩu tạm cần từ 8')));
await pa.getByLabel('Mật khẩu tạm mới').fill('TamThoi-2026');
await pa.getByRole('button', { name: 'Đặt mật khẩu tạm' }).click();
check('B6 đặt xong: hiện lại mật khẩu để chép', await visible(pa.getByRole('button', { name: 'Đã chép xong' })) && (await pa.locator('input[aria-label="Mật khẩu tạm"]').inputValue()) === 'TamThoi-2026');
await pa.getByRole('button', { name: 'Đã chép xong' }).click();
check('B6 nhãn "Chờ đổi mật khẩu" quay lại', await until(pa, () => Array.from(document.querySelectorAll('tbody tr')).some((r) => r.textContent.includes('nv1@test.local') && r.textContent.includes('Chờ đổi mật khẩu'))));
await pb.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
check('B6 phiên cũ của admin kia bị đăng xuất', await visible(pb.getByRole('heading', { name: 'Đăng nhập quản trị' })));
await login(pb, 'nv1@test.local', 'MatKhau-moi-1');
check('B6 mật khẩu cũ không còn đăng nhập được', await visible(pb.getByText('Email hoặc mật khẩu không đúng.')));
await login(pb, 'nv1@test.local', 'TamThoi-2026');
check('B6 mật khẩu tạm mới: lại bị buộc đổi', await visible(pb.getByText('Bạn đang dùng mật khẩu tạm')));

// B7. Sửa thông tin, xóa
await rowNv1().getByRole('button', { name: 'Sửa' }).click();
await pa.getByLabel('Tên hiển thị').fill('Nhân viên Một (đã sửa)');
await pa.getByRole('button', { name: 'Lưu', exact: true }).click();
check('B7 sửa tên: dòng cập nhật', await visible(pa.locator('tbody tr', { hasText: 'Nhân viên Một (đã sửa)' })));
await rowNv1().getByRole('button', { name: 'Xóa' }).click();
check('B7 xóa: hộp xác nhận nêu email', await visible(pa.getByRole('dialog', { name: 'Xóa quản trị viên?' })) && (await pa.getByRole('dialog').textContent()).includes('nv1@test.local'));
await pa.getByRole('button', { name: 'Xóa vĩnh viễn' }).click();
check('B7 xóa xong: dòng biến mất', await until(pa, () => !document.querySelector('tbody').textContent.includes('nv1@test.local')));
await pb.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
check('B7 phiên của admin vừa bị xóa cũng bị đăng xuất', await visible(pb.getByRole('heading', { name: 'Đăng nhập quản trị' })));
await B.ctx.close();

// B8. Tài khoản của tôi (master)
await pa.getByRole('link', { name: 'Tài khoản của tôi' }).click();
check('B8 chuyển mục không tải lại trang, URL /admin/account', await visible(pa.getByRole('heading', { name: 'Tài khoản của tôi', level: 1 })) && new URL(pa.url()).pathname === '/admin/account');
check('B8 master có thêm khung "Sửa thông tin"', await visible(pa.getByRole('heading', { name: 'Sửa thông tin' })));
await pa.getByLabel('Tên hiển thị').fill('Chủ hệ thống');
await pa.getByRole('button', { name: 'Lưu thông tin' }).click();
check('B8 sửa tên master: thanh trên cập nhật', await visible(pa.locator('.adm-name', { hasText: 'Chủ hệ thống' })));
await pa.goBack();
check('B8 nút Back quay về mục trước', await visible(pa.getByRole('heading', { name: 'Quản trị viên', level: 1 })) && new URL(pa.url()).pathname === '/admin/admins');
await pa.goForward();

await visible(pa.getByRole('heading', { name: 'Đổi mật khẩu' }));
await pa.getByLabel('Mật khẩu hiện tại').fill(MASTER.pass);
await pa.getByLabel('Mật khẩu mới', { exact: true }).fill(MASTER.pass);
await pa.getByLabel('Nhập lại mật khẩu mới').fill(MASTER.pass);
await pa.getByRole('button', { name: 'Đổi mật khẩu' }).click();
check('B8 mật khẩu mới trùng mật khẩu cũ: báo lỗi', await visible(pa.getByText('Mật khẩu mới phải khác mật khẩu hiện tại.')));
await pa.getByLabel('Mật khẩu mới', { exact: true }).fill('Master-doi-2026');
await pa.getByLabel('Nhập lại mật khẩu mới').fill('Master-doi-2026');
await pa.getByRole('button', { name: 'Đổi mật khẩu' }).click();
check('B8 đổi mật khẩu thành công: vẫn đăng nhập (không bị văng)', await visible(pa.getByText('Đã đổi mật khẩu.')) && await visible(pa.getByRole('heading', { name: 'Tài khoản của tôi', level: 1 })));
await pa.reload();
check('B8 tải lại trang vẫn đăng nhập', await visible(pa.locator('.adm-name', { hasText: 'Chủ hệ thống' })));

// B9. Đăng xuất rồi quên mật khẩu bằng email thật (thư ghi vào storage/mail)
await pa.getByRole('button', { name: 'Đăng xuất' }).click();
check('B9 đăng xuất: về màn hình đăng nhập, URL /admin', await visible(pa.getByRole('heading', { name: 'Đăng nhập quản trị' })) && new URL(pa.url()).pathname === '/admin');
await login(pa, MASTER.email, MASTER.pass);
check('B9 mật khẩu cũ của master không còn dùng được', await visible(pa.getByText('Email hoặc mật khẩu không đúng.')));
const mailsBefore = new Set(fs.readdirSync(MAIL_DIR));
await pa.getByRole('button', { name: 'Quên mật khẩu?' }).click();
await pa.getByLabel('Email quản trị').fill('khong.co@test.local');
await pa.getByRole('button', { name: 'Gửi liên kết đặt lại' }).click();
check('B9 email lạ: vẫn báo "đã gửi" (không lộ ai là admin) và không có thư', await visible(pa.getByText('Nếu email thuộc một quản trị viên')) && fs.readdirSync(MAIL_DIR).filter((f) => !mailsBefore.has(f)).length === 0);
await pa.getByLabel('Email quản trị').fill(MASTER.email);
await pa.getByRole('button', { name: 'Gửi liên kết đặt lại' }).click();
await sleep(600);
const newMail = fs.readdirSync(MAIL_DIR).filter((f) => !mailsBefore.has(f) && f.endsWith('.txt'));
check('B9 có đúng 1 thư đặt lại mật khẩu', newMail.length === 1, newMail.join(','));
const mailText = newMail.length ? fs.readFileSync(path.join(MAIL_DIR, newMail[0]), 'utf8') : '';
const link = (mailText.match(/http:\/\/127\.0\.0\.1:\d+\/admin\/reset-password\?token=[0-9a-f]{64}/) || [''])[0];
check('B9 thư chứa liên kết /admin/reset-password?token=', link !== '', link.replace(/token=.*/, 'token=…'));
for (const f of fs.readdirSync(MAIL_DIR)) if (!mailsBefore.has(f)) fs.rmSync(path.join(MAIL_DIR, f), { force: true });

const C = await newAdminPage();
const pc = C.page;
await pc.goto(link);
check('B9 mở liên kết: hiện form đặt mật khẩu mới', await visible(pc.getByRole('heading', { name: 'Đặt mật khẩu mới' })));
await pc.getByLabel('Mật khẩu mới', { exact: true }).fill('Master-quen-2026');
await pc.getByLabel('Nhập lại mật khẩu mới').fill('Master-quen-2026');
await pc.getByRole('button', { name: 'Lưu mật khẩu mới' }).click();
check('B9 đặt xong: báo thành công, có nút Đăng nhập', await visible(pc.getByText('Đã đặt mật khẩu mới.')));
await pc.getByRole('button', { name: 'Đăng nhập' }).click();
check('B9 về màn hình đăng nhập, URL sạch /admin', await visible(pc.getByRole('heading', { name: 'Đăng nhập quản trị' })) && new URL(pc.url()).pathname === '/admin' && pc.url().indexOf('token') === -1);
await login(pc, MASTER.email, 'Master-quen-2026');
const b9ok = await visible(pc.getByRole('heading', { name: 'Tổng quan', level: 1 }));
check('B9 đăng nhập bằng mật khẩu mới', b9ok);
if (!b9ok) console.log('   [chẩn đoán] URL=' + pc.url() + '\n   ' + (await pc.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 400));
await pc.goto(link);
await pc.getByLabel('Mật khẩu mới', { exact: true }).fill('Master-lan-hai-1');
await pc.getByLabel('Nhập lại mật khẩu mới').fill('Master-lan-hai-1');
await pc.getByRole('button', { name: 'Lưu mật khẩu mới' }).click();
check('B9 dùng lại liên kết cũ: bị từ chối', await visible(pc.getByText('Liên kết không hợp lệ hoặc đã hết hạn')));

// B10. Bố cục
await pc.goto(ORIGIN + '/admin/admins');
await visible(pc.getByRole('heading', { name: 'Quản trị viên', level: 1 }));
for (const [w, h, tag] of [[1280, 720, 'desktop'], [1024, 600, 'tablet'], [390, 844, 'phone']]) {
  await pc.setViewportSize({ width: w, height: h });
  await sleep(150);
  const over = await overflowX(pc);
  check(`B10 ${w}x${h}: không có thanh cuộn ngang`, over <= 0, `lệch ${over}px`);
  const small = await pc.evaluate(() => Array.from(document.querySelectorAll('button, a.btn, .adm-nav a')).filter((b) => b.offsetParent && b.getBoundingClientRect().height < 40).map((b) => b.textContent.trim()));
  check(`B10 ${w}x${h}: mọi nút bấm cao từ 40px`, small.length === 0, small.join(','));
  await pc.screenshot({ path: path.join(here, `shot-phase5-admins-${tag}.png`), fullPage: true });
}
await pc.setViewportSize({ width: 390, height: 844 });
const cardMode = await pc.evaluate(() => getComputedStyle(document.querySelector('.adm-table tbody tr')).display);
check('B10 điện thoại: dòng bảng chuyển thành thẻ', cardMode === 'block');
await pc.getByRole('button', { name: 'Thêm quản trị viên' }).click();
await pc.screenshot({ path: path.join(here, 'shot-phase5-dialog-phone.png') });
check('B10 điện thoại: hộp thoại không tràn ngang', (await overflowX(pc)) <= 0);

check('B11 không có lỗi JS/console trong suốt kịch bản', errors.length === 0, errors.slice(0, 3).join(' | '));
check('B11 PHP không báo lỗi/cảnh báo nào', !/Warning|Fatal|Notice|Deprecated/.test(phpErr), phpErr.split('\n').slice(0, 2).join(' '));

await browser.close();
stopAll();
console.log(failures === 0 ? '\nTẤT CẢ ĐẠT' : `\n${failures} LỖI`);
process.exit(failures === 0 ? 0 : 1);
