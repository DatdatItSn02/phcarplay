import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');
import { start, state } from './server.mjs';

// ---- Dữ liệu giả: 1 clip WAV dài 1 giây, ảnh bìa SVG, API YouTube và playlist ----
function wav(seconds) {
  const rate = 8000, n = rate * seconds, buf = Buffer.alloc(44 + n, 128);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40);
  return buf;
}
state.media['/media/clip.wav'] = { type: 'audio/wav', data: wav(1) };
state.media['/media/thumb.svg'] = { type: 'image/svg+xml', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#355"/></svg>') };

const vid = (id, extra = {}) => ({ id, title: `Bài ${id}`, uploader: 'Ca sĩ Thử', duration: 200, thumbnail: '/media/thumb.svg', views: 1234567, uploaded_at: Date.now() - 3 * 86400000, ...extra });
const calls = [];
let playlists = [];           // máy chủ giả cho thành viên
let nextPid = 1;
const summary = (p) => ({ id: p.id, name: p.name, count: p.items.length, updated_at: p.updated_at });

state.dynamic = (method, url, body) => {
  const path = url.pathname;
  calls.push(`${method} ${path}`);
  const ok = (data, status = 200) => ({ status, body: { ok: true, data } });
  if (path === '/api/youtube/trending') return ok({ items: [vid('trending001'), vid('trending002')] });
  if (path === '/api/youtube/suggest') return ok({ suggestions: ['nhạc trẻ', 'nhạc trữ tình'] });
  if (path === '/api/youtube/search') {
    const page = url.searchParams.get('page');
    return page ? ok({ items: [vid('search00004'), vid('search00005')], next: null }) : ok({ items: [vid('search00001'), vid('search00002'), vid('search00003')], next: 'p2' });
  }
  if (path.startsWith('/api/youtube/stream/')) {
    const id = path.split('/').pop();
    const n = id.replace(/\D/g, '');
    return ok({ id, title: `Bài ${id}`, uploader: 'Ca sĩ Thử', duration: 1, thumbnail: '/media/thumb.svg', live: false, hls: null,
      sources: [{ url: '/media/clip.wav', height: 360, mime: 'audio/wav', quality: '360p', bitrate: 1 }], audio: [],
      related: [vid('related' + n + 'a'), vid('related' + n + 'b')] });
  }
  if (!state.user && path.startsWith('/api/playlists')) return { status: 401, body: { ok: false, error: { code: 'UNAUTHORIZED', message: 'Bạn cần đăng nhập.' } } };
  if (path === '/api/playlists' && method === 'GET') return ok({ playlists: playlists.map(summary) });
  if (path === '/api/playlists' && method === 'POST') { const p = { id: nextPid++, name: body.name, items: [], updated_at: new Date().toISOString() }; playlists.push(p); return ok(summary(p), 201); }
  if (path === '/api/playlists/import') { body.playlists.forEach((x) => playlists.push({ id: nextPid++, name: x.name, items: x.items, updated_at: new Date().toISOString() })); return ok({ created: body.playlists.length }); }
  const m = path.match(/^\/api\/playlists\/(\d+)(\/items)?$/);
  if (m) {
    const p = playlists.find((x) => x.id === Number(m[1]));
    if (!p) return { status: 404, body: { ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy playlist.' } } };
    if (m[2] && method === 'POST') { let added = 0; body.items.forEach((i) => { if (!p.items.some((x) => x.id === i.id)) { p.items.push(i); added++; } }); p.updated_at = new Date().toISOString(); return ok({ added, count: p.items.length }, 201); }
    if (method === 'GET') return ok({ id: p.id, name: p.name, items: p.items });
  }
  return undefined;
};

const server = await start();
const errors = [];
let failures = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) failures++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(page, fn, arg, ms = 8000) { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } }

// Giai đoạn 12: hàng đợi lúc mở web lấy từ bài hay nghe/playlist (không còn lấy danh sách gợi ý),
// nên lần mở đầu của khách có sẵn một playlist cũ gồm 2 bài như danh sách gợi ý trước đây.
const SEED = JSON.stringify({ playlists: [{ id: 'l0', name: 'Có sẵn', updated_at: '2026-01-01T00:00:00Z', items: [vid('trending001'), vid('trending002')] }] });
async function open(browser, { user = null, guestStorage = null, viewport = { width: 1280, height: 760 } } = {}) {
  if (!user && !guestStorage) guestStorage = { carweb_playlists: SEED };
  state.user = user;
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  if (guestStorage) await page.addInitScript((g) => { for (const [k, v] of Object.entries(g)) localStorage.setItem(k, v); }, guestStorage);
  await page.goto('http://localhost:8123/');
  if (!user && !(guestStorage && guestStorage.carweb_guest)) await page.getByText('Dùng thử, không cần tài khoản').click();   // có cờ khách thì vào thẳng, không có cú bấm nào (giống người dùng mở lại web)
  await page.waitForSelector('.split');
  return { ctx, page };
}
const title = (page) => page.locator('.now-title').textContent();
// Giao diện giai đoạn 6: mục chọn ở thanh điều hướng, thao tác với video qua nút ⋮ (bảng thao tác).
const ROWS = '.view:not([hidden]) .vrow';
const nav = (page, name) => page.locator('.rail').getByRole('button', { name, exact: true }).click();
async function act(page, row, label) { await row.locator('.vmore').click(); await page.getByRole('menuitem', { name: label, exact: true }).click(); }
const isPlaying = (page) => page.evaluate(() => { const v = document.querySelector('video'); return !!v && !v.paused && v.currentTime >= 0 && !v.ended; });

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

// ===== 1. Khách: tự phát nhạc thịnh hành khi mở web =====
let { ctx, page } = await open(browser);
check('mở web: tự phát bài đầu của hàng đợi (lấy từ playlist có sẵn)', await until(page, () => document.querySelector('.now-title') && document.querySelector('.now-title').textContent === 'Bài trending001'), '', );
check('video đang phát', await until(page, () => { const v = document.querySelector('video'); return v && !v.paused; }));
check('video đã nhận nguồn phát', (await page.evaluate(() => document.querySelector('video').currentSrc)).endsWith('/media/clip.wav'));
await until(page, () => !document.querySelector('.stage-overlay.on'));
check('đang phát bình thường: không hiện nút "Bấm để phát" và lớp phủ', !(await page.getByRole('button', { name: 'Bấm để phát' }).isVisible()) && !(await page.locator('.stage-overlay.on').count()));
check('chỉ có đúng MỘT thẻ video', (await page.locator('video').count()) === 1);
await page.screenshot({ path: 'shot-phase3-home.png' });

// ===== 2. Tìm kiếm =====
await nav(page, 'Tìm kiếm');
const input = page.getByLabel('Tìm kiếm video');
await input.fill('nhạc');
check('gợi ý hiện khi gõ', await until(page, () => document.querySelectorAll('.suggest-item .suggest-main').length === 2));
await input.press('Enter');
check('kết quả tìm kiếm: 3 video', await until(page, () => document.querySelectorAll('.view:not([hidden]) .vrow').length === 3));
const row = page.locator(ROWS).first();
check('mỗi kết quả có ảnh, tên, kênh, lượt xem, thời gian, thời lượng',
  (await row.locator('img').count()) === 1 && /Bài search00001/.test(await row.locator('.vtitle').textContent())
  && (await row.locator('.vsub').first().textContent()) === 'Ca sĩ Thử' && /1,2 Tr lượt xem · 3 ngày trước/.test(await row.locator('.vsub').nth(1).textContent()) && (await row.locator('.vdur').textContent()) === '3:20');
await page.getByRole('button', { name: 'Tải thêm' }).click();
check('tải thêm: đủ 5 video, hết nút tải thêm', await until(page, () => document.querySelectorAll('.view:not([hidden]) .vrow').length === 5) && await page.getByRole('button', { name: 'Tải thêm' }).isHidden());
await page.screenshot({ path: 'shot-phase3-search.png' });

// ===== 3. Phát ngay, thêm hàng đợi =====
await act(page, page.locator(ROWS).nth(1), 'Phát ngay');
check('"Phát ngay" chuyển sang bài được chọn', await until(page, () => document.querySelector('.now-title').textContent === 'Bài search00002'));
await act(page, page.locator(ROWS).nth(2), 'Thêm vào hàng đợi');
await nav(page, 'Hàng đợi');
const qrows = await page.locator(ROWS).allTextContents();
check('hàng đợi có 4 bài, bài đang phát được đánh dấu', qrows.length === 4 && (await page.locator('.vrow.is-current .vtitle').textContent()) === 'Bài search00002', qrows.length + ' bài');

// ===== 4. Hết bài thì tự chuyển bài kế, hết hàng đợi thì Mix =====
check('hết bài thì tự phát bài kế trong hàng đợi (search00003)', await until(page, () => document.querySelector('.now-title').textContent === 'Bài search00003', null, 6000));
check('hết hàng đợi thì Mix tự chọn bài liên quan', await until(page, () => /^Bài related/.test(document.querySelector('.now-title').textContent), null, 14000), await title(page));
const qAfter = await page.locator(ROWS).count();
check('bài Mix được thêm vào hàng đợi', qAfter >= 5, qAfter + ' bài');
check('Mix vẫn đang phát', await until(page, () => { const v = document.querySelector('video'); return v && !v.paused; }));

// ===== 5. Tắt "Tự phát tiếp" =====
const mixPill = page.locator('.player .pill', { hasText: 'Tự phát' });
await mixPill.click();
check('nút "Tự phát" tắt được', (await mixPill.getAttribute('aria-pressed')) === 'false');
await mixPill.click();
check('bật lại "Tự phát"', (await mixPill.getAttribute('aria-pressed')) === 'true');

// ===== 6. Khách lưu playlist, mở lại web thì tự phát playlist đó =====
await nav(page, 'Tìm kiếm');
await act(page, page.locator(ROWS).nth(3), 'Lưu vào playlist');
await page.locator('.dialog').getByPlaceholder('Tên playlist mới').fill('Nhạc đi đường');
await page.locator('.dialog').getByRole('button', { name: 'Tạo và lưu' }).click();
check('khách lưu playlist: có thông báo', await until(page, () => /Đã thêm 1 bài vào "Nhạc đi đường"/.test((document.querySelector('.toast') || {}).textContent || '')));
await nav(page, 'Playlist');
check('tab Playlist liệt kê playlist vừa tạo (1 bài)', (await page.locator('.prow').first().textContent()).includes('Nhạc đi đường') && (await page.locator('.prow').first().textContent()).includes('1 bài'));
await page.locator('.prow-main').first().click();
check('mở chi tiết playlist thấy bài đã lưu', await until(page, () => document.querySelectorAll('.view:not([hidden]) .vrow').length === 1));
const saved = await page.evaluate(() => localStorage.getItem('carweb_playlists'));
await page.close(); await ctx.close();

({ ctx, page } = await open(browser, { guestStorage: { carweb_playlists: saved } }));
check('mở lại web: tự phát playlist đã lưu (không phải nhạc mặc định)', await until(page, () => document.querySelector('.now-title').textContent === 'Bài search00004'), await title(page));
await page.close(); await ctx.close();

// ===== 7. Thành viên: playlist lưu trên máy chủ + chuyển playlist của khách lên tài khoản =====
playlists = []; calls.length = 0;
const guestPl = JSON.stringify({ playlists: [{ id: 'l1', name: 'Của khách', updated_at: new Date().toISOString(), items: [vid('guestsong01'), vid('guestsong02')] }] });
({ ctx, page } = await open(browser, { user: { id: 1, email: 'a@b.c', name: 'An', status: 'active', expires_at: null }, guestStorage: { carweb_playlists: guestPl } }));
check('thành viên: playlist của khách được chuyển lên tài khoản', await until(page, () => true) && await (async () => { await wait(600); return calls.includes('POST /api/playlists/import'); })());
check('thành viên: tự phát playlist đã chuyển (bài đầu của khách)', await until(page, () => document.querySelector('.now-title').textContent === 'Bài guestsong01'), await title(page));
check('bản lưu trên trình duyệt đã được dọn', (await page.evaluate(() => JSON.parse(localStorage.getItem('carweb_playlists')).playlists.length)) === 0);
await nav(page, 'Tìm kiếm');
await page.getByLabel('Tìm kiếm video').fill('x'); await page.getByLabel('Tìm kiếm video').press('Enter');
await until(page, () => document.querySelectorAll('.view:not([hidden]) .vrow').length === 3);
await act(page, page.locator(ROWS).first(), 'Lưu vào playlist');
await page.locator('.picker-item').first().click();
check('thành viên: lưu bài vào playlist qua máy chủ', await until(page, () => true) && await (async () => { await wait(400); return calls.some((c) => /^POST \/api\/playlists\/\d+\/items$/.test(c)); })());
await page.screenshot({ path: 'shot-phase3-member.png' });
await page.close(); await ctx.close();

// ===== 8. Trình duyệt chặn tự phát (giả lập NotAllowedError đến khi người dùng chạm vào trang) =====
({ ctx, page } = await (async () => {
  state.user = null;
  const c = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const pg = await c.newPage();
  pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await pg.addInitScript(() => {
    localStorage.setItem('carweb_guest', '1');
    const orig = HTMLMediaElement.prototype.play;
    window.__blocked = true;
    HTMLMediaElement.prototype.play = function () { return window.__blocked ? Promise.reject(new DOMException('blocked', 'NotAllowedError')) : orig.call(this); };
    window.addEventListener('pointerdown', () => { window.__blocked = false; }, true);
  });
  await pg.goto('http://localhost:8123/');
  await pg.waitForSelector('.split');
  return { ctx: c, page: pg };
})());
const gestureBtn = page.getByRole('button', { name: 'Bấm để phát' });
let gestureVisible = true;
try { await gestureBtn.waitFor({ state: 'visible', timeout: 6000 }); } catch { gestureVisible = false; }
check('bị chặn tự phát: hiện lớp phủ với nút "Bấm để phát"', gestureVisible);
await page.screenshot({ path: 'shot-phase3-gesture.png' });
await page.getByRole('button', { name: 'Bấm để phát' }).click();
check('bấm xong thì phát và lớp phủ biến mất', await until(page, () => { const v = document.querySelector('video'); return v && !v.paused && !document.querySelector('.stage-overlay').classList.contains('on'); }));
await page.close(); await ctx.close();

// ===== 8b. Các cỡ màn hình xe phổ biến: khung trình phát không bị cắt, không phải cuộn =====
for (const vp of [{ width: 1280, height: 720 }, { width: 1024, height: 600 }, { width: 800, height: 480 }]) {
  ({ ctx, page } = await open(browser, { viewport: vp }));
  await until(page, () => document.querySelector('.now-title') && document.querySelector('.now-title').textContent !== 'Chưa có bài nào');
  await page.waitForTimeout(300);
  const fit = await page.evaluate(() => { const b = document.querySelector('.player'); const last = document.querySelector('.player .ctlrow').getBoundingClientRect(); return { scroll: b.scrollHeight - b.clientHeight, ctlBottom: Math.round(last.bottom), paneBottom: Math.round(b.getBoundingClientRect().bottom), page: document.documentElement.scrollHeight - innerHeight }; });
  check(`màn hình ${vp.width}x${vp.height}: thấy đủ nút điều khiển, không phải cuộn`, fit.scroll <= 1 && fit.ctlBottom <= fit.paneBottom && fit.page <= 0, JSON.stringify(fit));
  if (vp.width === 1024) await page.screenshot({ path: 'shot-phase3-1024x600.png' });
  await page.close(); await ctx.close();
}

// ===== 9. Màn hình dọc =====
({ ctx, page } = await open(browser, { viewport: { width: 420, height: 880 } }));
await until(page, () => document.querySelector('.now-title') && document.querySelector('.now-title').textContent !== 'Chưa có bài nào');
await page.screenshot({ path: 'shot-phase3-portrait.png' });
await page.close(); await ctx.close();

check('không có lỗi JavaScript nào', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
