import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');
import { start, state } from './server.mjs';

// Hồi quy: sau khi đặt lại mật khẩu bằng liên kết trong email, bấm "Đăng nhập" rồi đăng nhập thì phải vào được ứng dụng
// (trước đây nút đăng nhập ở màn hình này không có phản ứng gì cho tới khi tải lại trang).
const server = await start();
const browser = await chromium.launch();
let failures = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); if (!ok) failures++; };
const user = { id: 1, email: 'a@test.local', name: 'A', status: 'active', expires_at: null };
state.user = null;
state.handlers['POST /api/auth/reset'] = (req, res, url, body, send) => send(res, 200, { ok: true, data: { message: 'Đã đặt mật khẩu mới. Bạn có thể đăng nhập.' } });
state.handlers['POST /api/auth/login'] = (req, res, url, body, send) => {
  state.user = user;
  send(res, 200, { ok: true, data: { user, guest: false, csrf: 'tok', plan: 'member', features: ['youtube', 'pip', 'layout', 'playlists_cloud'], expires_at: null } });
};
state.handlers['GET /api/youtube/trending'] = (req, res, url, body, send) => send(res, 200, { ok: true, data: { items: [] } });
state.handlers['GET /api/playlists'] = (req, res, url, body, send) => send(res, 200, { ok: true, data: { playlists: [] } });

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:8123/reset-password?token=abc123');
await page.getByLabel('Mật khẩu mới', { exact: true }).fill('matkhau-moi');
await page.getByLabel('Nhập lại mật khẩu mới').fill('matkhau-moi');
await page.getByRole('button', { name: 'Lưu mật khẩu mới' }).click();
await page.getByRole('button', { name: 'Đăng nhập' }).click();
check('sau khi đặt mật khẩu: bấm Đăng nhập hiện form đăng nhập, URL sạch', await page.getByRole('tab', { name: 'Đăng nhập' }).isVisible() && new URL(page.url()).pathname === '/');
await page.getByLabel('Email').fill('a@test.local');
await page.getByLabel('Mật khẩu', { exact: true }).fill('matkhau-moi');
await page.locator('form button[type="submit"]').click();
let inApp = true;
try { await page.waitForSelector('.split', { timeout: 5000 }); } catch (e) { inApp = false; }
check('đăng nhập xong vào được ứng dụng (không phải tải lại trang)', inApp);
await browser.close();
server.close();
console.log(failures === 0 ? '\nTẤT CẢ ĐẠT' : `\n${failures} LỖI`);
process.exit(failures === 0 ? 0 : 1);
