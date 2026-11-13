import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');
import { start, state } from './server.mjs';

const server = await start();
const browser = await chromium.launch();
const errors = [];
let failures = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); if (!ok) failures++; };

async function open(viewport, user) {
  state.user = user;
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto('http://localhost:8123/');
  if (!user) await page.getByText('Dùng thử, không cần tài khoản').click();
  await page.waitForSelector('.split');
  await page.waitForTimeout(250);
  return page;
}
const geo = (page) => page.evaluate(() => {
  const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
  const s = document.querySelector('.split');
  return { left: r('.pane-left'), divider: r('.divider'), right: r('.pane-right'), orient: s.dataset.orientation, focus: s.dataset.focus, ratio: parseFloat(getComputedStyle(s).getPropertyValue('--ratio')) };
});

// ---- Khách, màn hình ngang ----
let page = await open({ width: 1280, height: 720 }, null);
await page.screenshot({ path: 'shot-after.png' });
let g = await geo(page);
check('thanh chia hiện ra, rộng 18px', Math.abs(g.divider.w - 18) < 1, `(${g.divider.w})`);
const startRatio = g.ratio;
const cx = g.divider.x + g.divider.w / 2, cy = g.divider.y + g.divider.h / 2;
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx - 200, cy, { steps: 8 }); await page.mouse.up();
g = await geo(page);
check('kéo bằng chuột sang trái làm khung trái hẹp lại', g.ratio < startRatio - 0.1, `(${startRatio.toFixed(3)} -> ${g.ratio.toFixed(3)})`);
const ws = await page.evaluate(() => document.querySelector('.split').getBoundingClientRect().width);
check('khung trái + thanh + khung phải vừa khít', Math.abs(g.left.w + g.divider.w + g.right.w - ws) < 2, `(${Math.round(ws)})`);
await page.mouse.move(g.divider.x + 9, cy); await page.mouse.down(); await page.mouse.move(5, cy, { steps: 6 }); await page.mouse.up();
g = await geo(page);
check('kéo hết cỡ vẫn chừa tối thiểu ~240px cho mỗi khung', g.left.w >= 235, `(${Math.round(g.left.w)}px)`);
await page.locator('.divider').dblclick();
g = await geo(page);
check('bấm đúp đưa về tỉ lệ mặc định 0.62', Math.abs(g.ratio - 0.62) < 0.01, `(${g.ratio})`);
// giai đoạn 6: chọn bố cục bằng hình minh họa trong Cài đặt
await page.locator('.rail-settings').click();
await page.getByRole('radio', { name: 'Danh sách lớn' }).click();
check('ô bố cục vừa chọn được đánh dấu', (await page.getByRole('radio', { name: 'Danh sách lớn' }).getAttribute('aria-checked')) === 'true');
await page.keyboard.press('Escape');
g = await geo(page);
check('bố cục "Danh sách lớn" (30/70)', Math.abs(g.ratio - 0.3) < 0.01, `(${g.ratio})`);
await page.locator('.divider').focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
g = await geo(page);
check('phím mũi tên nhích tỉ lệ', Math.abs(g.ratio - 0.34) < 0.01, `(${g.ratio})`);
await page.getByRole('button', { name: 'Chỉ hiện video' }).click();
g = await geo(page);
check('nút "Chỉ hiện video": khung danh sách ẩn', g.focus === 'left' && (await page.locator('.pane-right').isHidden()));
await page.getByRole('button', { name: 'Hiện lại danh sách' }).click();
check('"Hiện lại danh sách" trở về chia hai khung', (await geo(page)).focus === '');
const saved = await page.evaluate(() => localStorage.getItem('carweb_layout'));
check('khách: tỉ lệ được lưu trên thiết bị', saved && JSON.parse(saved).h > 0.2, saved);
await page.close();

// ---- Màn hình dọc (điện thoại) ----
page = await open({ width: 420, height: 860 }, null);
g = await geo(page);
check('màn hình dọc chia trên/dưới', g.orient === 'vertical' && g.right.y > g.left.y + g.left.h - 1, g.orient);
await page.screenshot({ path: 'shot-portrait.png' });
await page.close();

// ---- Thành viên: lưu lên máy chủ (kiểm tra lỗi Illegal invocation đã hết) ----
state.prefs.layout = null;
page = await open({ width: 1280, height: 720 }, { id: 1, email: 'a@b.c', name: 'An', status: 'active', expires_at: null });
g = await geo(page);
await page.mouse.move(g.divider.x + 9, g.divider.y + 300); await page.mouse.down(); await page.mouse.move(g.divider.x - 150, g.divider.y + 300, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(1000);
check('thành viên: tỉ lệ được gửi lên máy chủ', state.prefs.layout && state.prefs.layout.h < 0.55, JSON.stringify(state.prefs.layout));
await page.close();

// Mở lại bằng thiết bị khác (localStorage trống) phải lấy tỉ lệ từ máy chủ
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const p2 = await ctx2.newPage();
p2.on('pageerror', (e) => errors.push(e.message));
await p2.goto('http://localhost:8123/'); await p2.waitForSelector('.split'); await p2.waitForTimeout(500);
g = await geo(p2);
check('thiết bị khác lấy lại đúng tỉ lệ đã lưu trên tài khoản', Math.abs(g.ratio - state.prefs.layout.h) < 0.01, `(${g.ratio} vs ${state.prefs.layout.h})`);
await ctx2.close();

check('không có lỗi JavaScript nào', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
