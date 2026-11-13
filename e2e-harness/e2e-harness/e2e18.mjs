// Giai đoạn 16 trên PHP THẬT (php -S + SQLite tạm) và Chromium thật:
//  A. Chế độ thử (MAIL_DRIVER=log): màn "Quên mật khẩu" báo rõ thư KHÔNG gửi thật (khung vàng), không nói "đã gửi".
//  B. Máy chủ thư hỏng (SMTP trỏ vào cổng đóng): "Quên mật khẩu" báo lỗi, ở lại màn nhập, bấm lại được ngay.
//  C. Trang quản trị > Tổng quan > thẻ "Gửi email" (chỉ master): hiện cách gửi, chỗ thiếu, gửi thư thử báo lỗi cụ thể + cách sửa,
//     không lộ mật khẩu SMTP; admin thường không thấy thẻ.
// KHÔNG thử được: gửi qua máy chủ thư thật (Gmail...) vì không có tài khoản thư.
// Chạy: PUBLIC_DIR=/duong/dan/carweb/public node e2e18.mjs
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');

const PUBLIC_DIR = process.env.PUBLIC_DIR;
if (!PUBLIC_DIR) { console.error('Cần đặt PUBLIC_DIR=/duong/dan/den/public'); process.exit(2); }
const PROJECT = path.dirname(PUBLIC_DIR);
const here = path.dirname(new URL(import.meta.url).pathname);
const MAIL_DIR = path.join(PROJECT, 'storage', 'mail');
const SECRET = 'bi-mat-SMTP-e2e18';

let failures = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(MAIL_DIR, { recursive: true });
const mailsBefore = new Set(fs.readdirSync(MAIL_DIR));
const servers = [];

async function startServer(port, mailEnv) {
  const db = path.join(os.tmpdir(), `carweb-e2e18-${process.pid}-${port}.sqlite`);
  fs.rmSync(db, { force: true });
  const origin = `http://127.0.0.1:${port}`;
  const php = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', PUBLIC_DIR, path.join(PROJECT, 'tests/support/serve_sqlite.php')], {
    env: { ...process.env, CARWEB_TEST_DB: db, CARWEB_TEST_SEED: '1', APP_URL: origin, APP_DEBUG: 'false',
      VIDEO_SOURCES: 'piped', PIPED_API_URLS: 'http://127.0.0.1:9', YOUTUBE_EMBED: 'false', YOUTUBE_KEY_HINT: 'false', SMS_DRIVER: 'none', ...mailEnv },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  servers.push({ php, db });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(origin + '/api/health')).ok) break; } catch (e) { /* chưa sẵn sàng */ }
    await sleep(100);
  }
  return origin;
}
process.on('exit', () => {
  for (const s of servers) {
    try { s.php.kill(); } catch (e) { /* đã tắt */ }
    fs.rmSync(s.db, { force: true });
    fs.rmSync(s.db + '.ratelimit', { recursive: true, force: true });
  }
  for (const f of fs.readdirSync(MAIL_DIR)) if (!mailsBefore.has(f)) fs.rmSync(path.join(MAIL_DIR, f), { force: true });
});

const LOG = await startServer(8093, { MAIL_DRIVER: 'log' });
const BROKEN = await startServer(8094, { MAIL_DRIVER: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', SMTP_ENCRYPTION: '', SMTP_USER: 'gui@test.local',
  SMTP_PASS: SECRET, MAIL_FROM_EMAIL: 'gui@test.local' });

const browser = await chromium.launch();

async function register(origin, email, phone) {
  const ctx = await browser.newContext();
  const csrf = (await (await ctx.request.get(origin + '/api/auth/me')).json()).data.csrf;
  const r = await ctx.request.post(origin + '/api/auth/register', { headers: { 'X-CSRF-Token': csrf }, data: { email, name: 'Thử', phone, password: 'mat-khau-1' } });
  await ctx.close();
  return r.status();
}

async function forgot(origin, login) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
  const page = await ctx.newPage();
  await page.goto(origin + '/');
  await page.getByRole('button', { name: 'Quên mật khẩu?' }).click();
  await page.getByLabel('Email hoặc số điện thoại đã đăng ký').fill(login);
  await page.getByRole('button', { name: 'Gửi mã' }).click();
  return { ctx, page };
}

// ===================== A. Chế độ thử =====================
check('A0 đăng ký tài khoản thử', (await register(LOG, 'a@test.local', '0912000001')) === 201);
{
  const { ctx, page } = await forgot(LOG, '0912000001');
  await page.locator('input[name="code"]').waitFor({ timeout: 5000 });
  const warn = page.locator('.notice.notice-warn');
  check('A1 chế độ thử: báo rõ thư KHÔNG được gửi thật, khung vàng', (await warn.count()) === 1 && (await warn.innerText()).includes('KHÔNG được gửi thật'));
  check('A1 không nói "đã được gửi tới email"', !(await page.locator('body').innerText()).includes('đã được gửi tới email'));
  await page.screenshot({ path: path.join(here, 'shot-phase16-forgot-testmode.png') });
  await ctx.close();
}

// ===================== B. Máy chủ thư hỏng =====================
check('B0 đăng ký tài khoản thử', (await register(BROKEN, 'b@test.local', '0912000002')) === 201);
{
  const { ctx, page } = await forgot(BROKEN, '0912000002');
  const err = page.getByText('Hiện chưa gửi được email chứa mã');
  await err.waitFor({ timeout: 8000 }).catch(() => {});
  check('B1 thư không đi: báo lỗi thật', await err.isVisible());
  check('B1 ở lại màn nhập (không chuyển sang ô nhập mã)', (await page.locator('input[name="code"]').count()) === 0);
  await page.screenshot({ path: path.join(here, 'shot-phase16-forgot-failed.png') });
  await page.getByRole('button', { name: 'Gửi mã' }).click();
  await sleep(1500);
  check('B2 bấm lại ngay vẫn thử gửi (không im lặng chờ 60 giây)', await err.isVisible() && (await page.locator('input[name="code"]').count()) === 0);
  await ctx.close();
}

// ===================== C. Trang quản trị: thẻ "Gửi email" =====================
async function adminPage(origin) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(origin + '/admin');
  await page.getByLabel('Email').fill('master@test.local');
  await page.getByLabel('Mật khẩu').fill('Master-12345');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.getByRole('heading', { name: 'Tổng quan', level: 1 }).waitFor({ timeout: 8000 });
  return { ctx, page };
}
{
  const { ctx, page } = await adminPage(LOG);
  const card = page.locator('.mail-card');
  await card.getByText('Chế độ thử', { exact: true }).waitFor({ timeout: 5000 }).catch(() => {});
  const t = await card.innerText();
  check('C1 master thấy thẻ "Gửi email" ở chế độ thử, kèm cách sửa', t.includes('Gửi email') && t.includes('Chế độ thử') && t.includes('MAIL_DRIVER=smtp'));
  check('C1 ô nhận thư điền sẵn email của master', (await card.getByLabel('Gửi thư thử tới').inputValue()) === 'master@test.local');
  await card.getByRole('button', { name: 'Gửi thư thử' }).click();
  await card.getByText('KHÔNG gửi tới master@test.local').waitFor({ timeout: 5000 }).catch(() => {});
  check('C2 gửi thử ở chế độ thử: nói rõ không gửi thật', await card.getByText('KHÔNG gửi tới master@test.local').isVisible());
  await page.getByRole('button', { name: 'Làm mới' }).click();
  await sleep(600);
  check('C2 bấm "Làm mới" vẫn giữ kết quả gửi thử', await card.getByText('KHÔNG gửi tới master@test.local').isVisible());
  await page.goto(LOG + '/admin/audit');
  await page.getByRole('heading', { name: 'Nhật ký thao tác', level: 1 }).waitFor({ timeout: 8000 }).catch(() => {});
  await sleep(1000);
  const auditText = await page.locator('.adm-main').innerText();
  check('C3 nhật ký ghi "Gửi thư thử"', /Gửi thư thử[\s\S]*master@test\.local - chế độ thử/.test(auditText), auditText.slice(0, 300).replace(/\n/g, ' | '));
  // admin thường không thấy thẻ
  const csrf = (await (await ctx.request.get(LOG + '/admin/api/auth/me')).json()).data.csrf;
  await ctx.request.post(LOG + '/admin/api/admins', { headers: { 'X-CSRF-Token': csrf }, data: { email: 'nv@test.local', name: 'NV', password: 'TamThoi-123' } });
  await ctx.close();
  const c2 = await browser.newContext();
  const p2 = await c2.newPage();
  await p2.goto(LOG + '/admin');
  await p2.getByLabel('Email').fill('nv@test.local');
  await p2.getByLabel('Mật khẩu').fill('TamThoi-123');
  await p2.getByRole('button', { name: 'Đăng nhập' }).click();
  await sleep(1200);
  const csrf2 = (await (await c2.request.get(LOG + '/admin/api/auth/me')).json()).data.csrf;
  await c2.request.post(LOG + '/admin/api/account/password', { headers: { 'X-CSRF-Token': csrf2 }, data: { current_password: 'TamThoi-123', new_password: 'MatKhau-Moi-1' } });
  await p2.goto(LOG + '/admin/dashboard');
  await p2.getByRole('heading', { name: 'Tổng quan', level: 1 }).waitFor({ timeout: 8000 }).catch(() => {});
  await sleep(800);
  check('C4 admin thường không thấy thẻ "Gửi email"', (await p2.getByRole('heading', { name: 'Tổng quan', level: 1 }).isVisible()) && (await p2.locator('.mail-card').count()) === 0);
  await c2.close();
}
{
  const { ctx, page } = await adminPage(BROKEN);
  const card = page.locator('.mail-card');
  await card.getByText('Gửi thật', { exact: true }).waitFor({ timeout: 5000 }).catch(() => {});
  const t = await card.innerText();
  check('C5 SMTP: hiện máy chủ, đã điền tên/mật khẩu, không có cảnh báo', t.includes('Gửi thật') && t.includes('127.0.0.1:1') && t.includes('đã điền mật khẩu') && (await card.locator('.notice-warn').count()) === 0);
  await card.getByRole('button', { name: 'Gửi thư thử' }).click();
  const err = card.locator('.notice-error');
  await err.waitFor({ timeout: 8000 }).catch(() => {});
  const et = (await err.count()) ? await err.innerText() : '';
  check('C6 gửi thử thất bại: lỗi cụ thể + cách sửa', et.includes('Không gửi được thư thử') && et.includes('Không kết nối được SMTP 127.0.0.1:1') && et.includes('Cách sửa:') && et.includes('SMTP_HOST'));
  check('C6 không có chữ "null" lạc trong thẻ', !/\bnull\b/.test(await card.innerText()));
  check('C6 không lộ mật khẩu SMTP trên trang', !(await page.content()).includes(SECRET));
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: path.join(here, 'shot-phase16-admin-mail.png') });
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} kiểm tra KHÔNG đạt` : '\nTất cả đạt');
process.exit(failures ? 1 : 0);
