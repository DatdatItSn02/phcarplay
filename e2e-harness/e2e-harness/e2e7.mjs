import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');
import { start, state } from './server.mjs';

// Giai đoạn 6: giao diện kiểu YouTube cho màn hình xe.
// Kiểm tra: theme sáng/tối (không chớp, tự động, theo giờ), cỡ chữ lớn, thanh điều hướng bên phải,
// mọi cỡ màn hình xe (không cuộn, nút >= 44px), độ tương phản chữ, chạm/chạm đúp trên video,
// tìm bằng giọng nói (giả lập), tìm gần đây, danh mục, thanh phát nhỏ, hộp thoại lồng nhau, lỗi + Thử lại.

function wav(seconds) {
  const rate = 8000, n = rate * seconds, buf = Buffer.alloc(44 + n, 128);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40);
  return buf;
}
state.media['/media/long.wav'] = { type: 'audio/wav', data: wav(60) };
state.media['/media/thumb.svg'] = { type: 'image/svg+xml', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#355"/></svg>') };
const vid = (id, extra = {}) => ({ id, title: `Bài ${id} với tên khá dài để thử xuống dòng`, uploader: 'Kênh Thử', duration: 60, thumbnail: '/media/thumb.svg', views: 45000, uploaded_at: Date.now() - 86400000, ...extra });

const calls = [];
let trendingFails = 0;
state.dynamic = (method, url) => {
  const p = url.pathname;
  calls.push(`${method} ${p}${url.search}`);
  const ok = (data) => ({ status: 200, body: { ok: true, data } });
  if (p === '/api/youtube/trending') {
    if (trendingFails > 0) { trendingFails--; return { status: 502, body: { ok: false, error: { code: 'UPSTREAM', message: 'Máy chủ video đang bận.' } } }; }
    return ok({ items: Array.from({ length: 8 }, (_, i) => vid('trend' + i)) });
  }
  if (p === '/api/youtube/suggest') return ok({ suggestions: ['nhạc lofi', 'nhạc lofi chill'] });
  if (p === '/api/youtube/search') return ok({ items: [vid('s1'), vid('s2'), vid('s3')], next: null });
  if (p.startsWith('/api/youtube/stream/')) {
    const id = p.split('/').pop();
    return ok({ id, title: `Bài ${id}`, uploader: 'Kênh Thử', duration: 60, thumbnail: '/media/thumb.svg', live: false, hls: null,
      sources: [{ url: '/media/long.wav', height: 360, mime: 'audio/wav', quality: '360p', bitrate: 1 }], audio: [], related: [vid('rel1')] });
  }
  if (p.startsWith('/api/playlists')) return { status: 401, body: { ok: false, error: { code: 'UNAUTHORIZED', message: 'Bạn cần đăng nhập.' } } };
  return undefined;
};

const server = await start();
const errors = [];
let failures = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) failures++; };
async function until(page, fn, arg, ms = 8000) { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (e) { return false; } }
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

// Giai đoạn 12: hàng đợi lúc mở web lấy từ playlist trên thiết bị (không còn lấy danh sách gợi ý).
const SEED_PLAYLIST = JSON.stringify({ playlists: [{ id: 'l1', name: 'Thử', items: Array.from({ length: 8 }, (_, i) => vid('trend' + i)), updated_at: '2026-01-01T00:00:00Z' }] });
async function open({ viewport = { width: 1024, height: 600 }, storage = {}, colorScheme = 'dark', voice = false } = {}) {
  storage = Object.assign({ carweb_playlists: SEED_PLAYLIST }, storage);
  state.user = null;
  const ctx = await browser.newContext({ viewport, colorScheme });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.addInitScript((st) => {
    try { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); localStorage.setItem('carweb_guest', '1'); for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v); } } catch (e) { /* bỏ qua */ }   // chỉ lần mở đầu, tải lại thì giữ những gì trang đã lưu
    // ghi lại theme ngay khi <body> xuất hiện (trước khi JS chính chạy) để biết có bị chớp màu không
    new MutationObserver((list, obs) => {
      if (document.body) { window.__firstTheme = document.documentElement.getAttribute('data-theme'); window.__firstText = document.documentElement.getAttribute('data-text'); obs.disconnect(); }
    }).observe(document, { childList: true, subtree: true });
  }, storage);
  if (voice) {
    await page.addInitScript(() => {
      window.SpeechRecognition = window.webkitSpeechRecognition = class {
        start() { setTimeout(() => this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'nhạc lo' }], { isFinal: false })] }), 400);
          setTimeout(() => { this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'nhạc lofi' }], { isFinal: true })] }); this.onend && this.onend(); }, 1500); }
        stop() {} abort() {}
      };
    });
  }
  await page.goto('http://localhost:8123/');
  await page.waitForSelector('.split');
  return { ctx, page };
}
const nav = (page, name) => page.locator('.rail').getByRole('button', { name, exact: true }).click();
const theme = (page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const bodyBg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

// ===== 1. Theme =====
let { ctx, page } = await open({ storage: { carweb_theme: 'light' } });
check('1 theme đã lưu "Sáng" áp dụng ngay khi trang bắt đầu vẽ (không chớp tối)', (await page.evaluate(() => window.__firstTheme)) === 'light' && (await bodyBg(page)) === 'rgb(255, 255, 255)');
check('1 thẻ theme-color của trình duyệt đổi theo (trắng)', (await page.evaluate(() => document.querySelector('meta[name="theme-color"]').content)) === '#ffffff');
await page.locator('.rail').getByRole('button', { name: /Giao diện sáng/ }).click();
check('1 nút nhanh trên thanh điều hướng đổi sang tối, nhớ lựa chọn', (await theme(page)) === 'dark' && (await page.evaluate(() => localStorage.getItem('carweb_theme'))) === 'dark' && (await bodyBg(page)) === 'rgb(15, 15, 15)');
await page.reload(); await page.waitForSelector('.split');
check('1 tải lại trang vẫn tối', (await page.evaluate(() => window.__firstTheme)) === 'dark');
await page.locator('.rail-settings').click();
await page.getByRole('radio', { name: /Tự động/ }).click();
check('1 chọn "Tự động": theo máy (máy đang tối)', (await theme(page)) === 'dark');
await page.emulateMedia({ colorScheme: 'light' });
check('1 "Tự động": máy đổi sang sáng thì trang đổi theo ngay', await until(page, () => document.documentElement.getAttribute('data-theme') === 'light'));
await page.getByRole('radio', { name: /Theo giờ/ }).click();
const hour = await page.evaluate(() => new Date().getHours());
check('1 "Theo giờ": tối từ 18h đến 6h', (await theme(page)) === ((hour >= 18 || hour < 6) ? 'dark' : 'light'), `giờ ${hour}`);
await page.getByRole('radio', { name: 'Tối', exact: true }).click();
check('1 ô đang chọn được đánh dấu (aria-checked)', (await page.getByRole('radio', { name: 'Tối', exact: true }).getAttribute('aria-checked')) === 'true' && (await page.getByRole('radio', { name: /Tự động/ }).getAttribute('aria-checked')) === 'false');

// ===== 2. Cỡ chữ lớn, thanh điều hướng bên phải =====
await page.getByRole('radio', { name: /Lớn/ }).click();
check('2 "Chữ lớn": cỡ chữ gốc 18px', (await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)) === '18px');
await page.getByRole('radio', { name: /Bên phải/ }).click();
await page.keyboard.press('Escape');
const railX = await page.evaluate(() => ({ rail: document.querySelector('.rail').getBoundingClientRect().left, work: document.querySelector('.workspace').getBoundingClientRect().left }));
check('2 thanh điều hướng chuyển sang bên phải (xe tay lái bên phải)', railX.rail > railX.work, JSON.stringify(railX));
await page.reload(); await page.waitForSelector('.split');
check('2 tải lại: vẫn chữ lớn và thanh bên phải ngay từ đầu', (await page.evaluate(() => window.__firstText)) === 'large' && (await page.evaluate(() => document.documentElement.getAttribute('data-rail'))) === 'right');
await page.close(); await ctx.close();

// ===== 3. Mọi cỡ màn hình: không cuộn, nút điều khiển thấy đủ, vùng chạm >= 44px =====
const SIZES = [[800, 480], [1024, 600], [1280, 720], [1920, 720], [420, 880], [390, 844]];
for (const [w, hh] of SIZES) {
  for (const th of ['dark', 'light']) {
    for (const text of (w === 1024 || w === 800 ? ['normal', 'large'] : ['normal'])) {
      ({ ctx, page } = await open({ viewport: { width: w, height: hh }, storage: { carweb_theme: th, carweb_text: text } }));
      await until(page, () => document.querySelectorAll('.view:not([hidden]) .vrow').length > 0);
      await page.waitForTimeout(400);
      const r = await page.evaluate(() => {
        const de = document.documentElement;
        const player = document.querySelector('.player');
        const ctl = document.querySelector('.player .ctlrow').getBoundingClientRect();
        const small = [];
        document.querySelectorAll('button, a[href], [role="radio"], [role="tab"], input:not([type="range"]), select').forEach((el) => {
          const b = el.getBoundingClientRect();
          if (!b.width || !b.height || el.closest('[hidden]') || el.tabIndex < 0) return;
          if (b.bottom < 0 || b.top > innerHeight || b.right < 0 || b.left > innerWidth) return;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none') return;
          if (b.height < 43.5 || b.width < 43.5) small.push(`${el.className || el.tagName}:${Math.round(b.width)}x${Math.round(b.height)}`);
        });
        return { pageScroll: [de.scrollWidth - innerWidth, de.scrollHeight - innerHeight], playerScroll: player.scrollHeight - player.clientHeight, ctlVisible: ctl.bottom <= innerHeight && ctl.top >= 0, small };
      });
      const tag = `${w}x${hh} ${th}${text === 'large' ? ' chữ lớn' : ''}`;
      check(`3 ${tag}: trang không cuộn, trình phát không cuộn, thấy đủ nút điều khiển`, r.pageScroll[0] <= 0 && r.pageScroll[1] <= 0 && r.playerScroll <= 1 && r.ctlVisible, JSON.stringify({ p: r.pageScroll, pl: r.playerScroll }));
      check(`3 ${tag}: mọi nút đang thấy đều >= 44px`, r.small.length === 0, r.small.slice(0, 5).join(' '));
      await page.close(); await ctx.close();
    }
  }
}

// ===== 4. Độ tương phản chữ (WCAG AA 4.5:1) ở cả hai theme =====
for (const th of ['dark', 'light']) {
  ({ ctx, page } = await open({ storage: { carweb_theme: th } }));
  await until(page, () => document.querySelectorAll('.view:not([hidden]) .vrow').length > 0);
  const res = await page.evaluate(() => {
    const rgb = (s) => s.match(/[\d.]+/g).map(Number);
    const lum = (c) => { const a = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
    const ratio = (f, b) => { const [x, y] = [lum(f), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const bg = rgb(getComputedStyle(document.body).backgroundColor);
    const out = {};
    for (const [name, sel] of [['tên video', '.vtitle'], ['kênh/lượt xem', '.vsub'], ['chữ thanh điều hướng', '.rail-item span'], ['tên bài đang phát', '.now-title'], ['thời gian', '.time']]) {
      const el = document.querySelector(sel);
      if (el) out[name] = Math.round(ratio(rgb(getComputedStyle(el).color), bg) * 10) / 10;
    }
    const chip = document.querySelector('.chip[aria-pressed="true"]');
    if (chip) out['chip đang chọn'] = Math.round(ratio(rgb(getComputedStyle(chip).color), rgb(getComputedStyle(chip).backgroundColor)) * 10) / 10;
    return out;
  });
  check(`4 theme ${th}: chữ đủ tương phản (>= 4.5)`, Object.values(res).every((v) => v >= 4.5) && Object.keys(res).length >= 5, JSON.stringify(res));
  await page.close(); await ctx.close();
}

// ===== 5. Chạm và chạm đúp trên video =====
({ ctx, page } = await open({ viewport: { width: 1280, height: 720 } }));
await until(page, () => { const v = document.querySelector('video'); return v && !v.paused && v.currentTime > 0; });
const stage = await page.locator('.stage').boundingBox();
await page.evaluate(() => { document.querySelector('video').currentTime = 30; });
await page.mouse.click(stage.x + stage.width * 0.9, stage.y + stage.height / 2);
await page.waitForTimeout(80);
await page.mouse.click(stage.x + stage.width * 0.9, stage.y + stage.height / 2);
await page.waitForTimeout(450);
let t = await page.evaluate(() => document.querySelector('video').currentTime);
check('5 chạm đúp bên phải video: tua tới 10 giây, không bị dừng', t >= 39.5 && t < 42 && !(await page.evaluate(() => document.querySelector('video').paused)), t.toFixed(2));
check('5 hiện dấu "10 giây" bên phải', await page.locator('.stage-flash.right').evaluate((e) => e.classList.contains('show')));
await page.mouse.click(stage.x + stage.width * 0.1, stage.y + stage.height / 2);
await page.waitForTimeout(80);
await page.mouse.click(stage.x + stage.width * 0.1, stage.y + stage.height / 2);
await page.waitForTimeout(450);
t = await page.evaluate(() => document.querySelector('video').currentTime);
check('5 chạm đúp bên trái: tua lùi 10 giây', t >= 29.5 && t < 32, t.toFixed(2));
await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
check('5 chạm một lần giữa video: tạm dừng', await until(page, () => document.querySelector('video').paused, null, 3000));
await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
check('5 chạm lần nữa: phát tiếp', await until(page, () => !document.querySelector('video').paused, null, 3000));
const playBox = await page.locator('.ctl-main').first().boundingBox();
check('5 nút phát/tạm dừng to (>= 56px)', playBox.width >= 56 && playBox.height >= 56, `${Math.round(playBox.width)}px`);

// ===== 6. Thanh phát nhỏ khi chỉ hiện danh sách =====
await page.locator('.rail-settings').click();
await page.getByRole('radio', { name: 'Chỉ danh sách' }).click();
await page.keyboard.press('Escape');
const mini = page.locator('.minibar');
check('6 "Chỉ danh sách": hiện thanh phát nhỏ với tên bài', await mini.isVisible() && (await mini.locator('.minibar-title').textContent()).startsWith('Bài trend0'));
check('6 danh sách mở rộng thành lưới thẻ', await until(page, () => document.querySelector('.browse').getAttribute('data-w') === 'l'));   // kích thước cập nhật sau một nhịp (ResizeObserver)
await mini.locator('.ctl-main').click();
check('6 nút tạm dừng trên thanh nhỏ hoạt động', await until(page, () => document.querySelector('video').paused, null, 3000));
await mini.locator('.ctl-main').click();
await mini.getByRole('button', { name: 'Hiện lại trình phát' }).click();
const focusAfter = await page.locator('.split').getAttribute('data-focus');
check('6 "Hiện lại trình phát": về chia hai khung, thanh nhỏ ẩn', !focusAfter && !(await mini.isVisible()), String(focusAfter));
await page.close(); await ctx.close();

// ===== 7. Danh mục, tìm kiếm gần đây, giọng nói, hộp thoại lồng nhau =====
({ ctx, page } = await open({ voice: true }));
await until(page, () => document.querySelectorAll('.view:not([hidden]) .vrow').length > 0);
calls.length = 0;
await page.locator('.chip', { hasText: 'Bolero' }).click();
check('7 bấm danh mục "Bolero": tìm sẵn từ khóa, không phải gõ', await until(page, () => true) && await (async () => { await page.waitForTimeout(400); return calls.some((c) => c.startsWith('GET /api/youtube/search') && decodeURIComponent(c).includes('bolero')); })());
check('7 danh mục đang chọn được đánh dấu', (await page.locator('.chip', { hasText: 'Bolero' }).getAttribute('aria-pressed')) === 'true');
await page.locator('.view:not([hidden])').getByRole('button', { name: 'Tìm bằng giọng nói' }).click();
check('7 bấm micro: hiện hộp "đang nghe", chữ hiện dần', await until(page, () => /nhạc lo/.test((document.querySelector('.voice-text') || {}).textContent || '')));
check('7 nói xong: tự đóng hộp, chuyển sang Tìm kiếm với đúng câu đã nói', await until(page, () => !document.querySelector('.voice') && document.querySelector('.search-input').value === 'nhạc lofi'));
check('7 kết quả tìm bằng giọng nói hiện ra', await until(page, () => document.querySelectorAll('.view:not([hidden]) .vrow').length === 3));
await page.getByLabel('Xóa chữ đã gõ').click();
check('7 ô trống: hiện "Tìm kiếm gần đây" có câu vừa tìm', await until(page, () => /nhạc lofi/.test((document.querySelector('.recent-item') || {}).textContent || '')));
await page.reload(); await page.waitForSelector('.split');
await nav(page, 'Tìm kiếm');
check('7 tải lại trang: tìm gần đây vẫn còn, bấm lại là tìm', await until(page, () => !!document.querySelector('.recent-item')));
await page.locator('.recent-item .suggest-main').first().click();
check('7 bấm một mục tìm gần đây: ra kết quả', await until(page, () => document.querySelectorAll('.view:not([hidden]) .vrow').length === 3));
await page.locator('.view:not([hidden]) .vmore').first().click();
const sheet = page.getByRole('dialog', { name: 'Tùy chọn' });
check('7 nút ⋮: bảng thao tác có ảnh, tên bài và 4 thao tác lớn', await sheet.isVisible() && (await sheet.getByRole('menuitem').count()) === 4 && (await sheet.locator('.sheet-info').count()) === 1);
const itemBox = await sheet.getByRole('menuitem').first().boundingBox();
check('7 mỗi thao tác cao >= 48px', itemBox.height >= 48, `${Math.round(itemBox.height)}px`);
await sheet.getByRole('menuitem', { name: 'Phát tiếp theo' }).click();
check('7 "Phát tiếp theo": đóng bảng, báo đã thêm', await until(page, () => !document.querySelector('.sheet') && /phát ngay sau bài hiện tại/.test((document.querySelector('.toast') || {}).textContent || '')));
await page.locator('.rail-settings').click();
await page.getByRole('dialog', { name: 'Cài đặt' }).getByRole('button', { name: 'Đăng nhập hoặc tạo tài khoản' }).isVisible();
await page.keyboard.press('Escape');
check('7 Esc đóng Cài đặt và trả focus về nút Cài đặt', await until(page, () => !document.querySelector('.dialog') && document.activeElement.classList.contains('rail-settings')));
await page.close(); await ctx.close();

// ===== 8. Lỗi tải video: báo rõ và có nút Thử lại =====
trendingFails = 1;
({ ctx, page } = await open());
check('8 tải lỗi: hiện thông báo kèm nút "Thử lại"', await until(page, () => /Máy chủ video đang bận/.test(document.querySelector('.view:not([hidden])').textContent)));
await page.locator('.view:not([hidden])').getByRole('button', { name: 'Thử lại' }).click();
check('8 bấm "Thử lại": danh sách hiện ra', await until(page, () => document.querySelectorAll('.view:not([hidden]) .vrow').length === 8));
await page.close(); await ctx.close();

check('không có lỗi JavaScript nào', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); server.close();
console.log(failures ? `\nCÓ ${failures} MỤC CHƯA ĐẠT` : '\nTẤT CẢ ĐẠT');
process.exit(failures ? 1 : 0);
