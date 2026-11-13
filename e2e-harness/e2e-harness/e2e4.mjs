import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');
import { start, state } from './server.mjs';

// Giai đoạn 4: cửa sổ nổi (PiP), toàn màn hình, Media Session.
// - Video là clip.webm THẬT (có hình, 30 giây) nên videoWidth và các sự kiện là của Chromium thật.
// - Media Session là của Chromium thật (đọc navigator.mediaSession.metadata, gọi đúng các hàm xử lý đã đăng ký).
// - API cửa sổ nổi và toàn màn hình là bản GIẢ (initScript): Chromium chạy nền không mở được cửa sổ nổi thật.
//   Bản giả mô phỏng đúng hành vi (document.pictureInPictureElement, các sự kiện enter/leave) và đếm số lần gọi.
//   Cửa sổ nổi thật phải thử trên thiết bị của bạn.
const here = path.dirname(fileURLToPath(import.meta.url));
state.media['/media/clip.webm'] = { type: 'video/webm', data: fs.readFileSync(path.join(here, 'clip.webm')) };
function wav(seconds) {
  const rate = 8000, n = rate * seconds, buf = Buffer.alloc(44 + n, 128);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate, 28);
  buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40);
  return buf;
}
state.media['/media/clip.wav'] = { type: 'audio/wav', data: wav(20) };
state.media['/media/thumb.svg'] = { type: 'image/svg+xml', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#355"/></svg>') };

const vid = (id, extra = {}) => ({ id, title: `Bài ${id}`, uploader: 'Ca sĩ Thử', duration: 30, thumbnail: '/media/thumb.svg', views: 1000, uploaded_at: Date.now() - 86400000, ...extra });
let audioOnly = false;   // true: máy chủ giả chỉ đưa luồng âm thanh (không có hình)
state.dynamic = (method, url) => {
  const p = url.pathname;
  const ok = (data, status = 200) => ({ status, body: { ok: true, data } });
  if (p === '/api/youtube/trending') return ok({ items: [vid('trending001'), vid('trending002'), vid('trending003')] });
  if (p.startsWith('/api/youtube/stream/')) {
    const id = p.split('/').pop();
    const source = audioOnly
      ? { url: '/media/clip.wav', height: 360, mime: 'audio/wav', quality: '360p', bitrate: 1 }
      : { url: '/media/clip.webm', height: 180, mime: 'video/webm', quality: '180p', bitrate: 1 };
    return ok({ id, title: `Bài ${id}`, uploader: 'Ca sĩ Thử', duration: 30, thumbnail: '/media/thumb.svg', live: false, hls: null, sources: [source], audio: [], related: [vid(id + 'r1'), vid(id + 'r2')] });
  }
  // Giai đoạn 12: hàng đợi lúc mở web lấy từ playlist (không còn lấy danh sách gợi ý), nên tạo sẵn một playlist 3 bài.
  if (p === '/api/playlists' && method === 'GET') return ok({ playlists: [{ id: 1, name: 'Thử', count: 3, updated_at: '2026-01-01 00:00:00' }] });
  if (p === '/api/playlists/1' && method === 'GET') return ok({ id: 1, name: 'Thử', items: [vid('trending001'), vid('trending002'), vid('trending003')] });
  if (p === '/api/user/preferences') return ok({ layout: null, playback: null });
  if (p.startsWith('/api/user/plays')) return ok({ items: [] });
  if (p === '/api/auth/logout') { state.user = null; return ok({ csrf: 'tok2' }); }
  return undefined;
};

const server = await start();
const errors = [];
let failures = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) failures++; };
const until = async (page, fn, arg, ms = 8000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };

// API cửa sổ nổi + toàn màn hình giả, và bộ ghi lại các hàm Media Session đã đăng ký. Chạy TRƯỚC mã của app.
function installFakes(opts) {
  window.__pip = { enter: 0, exit: 0 };
  window.__fs = { enter: 0, exit: 0 };
  window.__pipFail = null;
  let pipEl = null;
  let fsEl = null;
  Object.defineProperty(document, 'pictureInPictureEnabled', { get: () => !opts.noPip, configurable: true });
  Object.defineProperty(document, 'pictureInPictureElement', { get: () => pipEl, configurable: true });
  HTMLVideoElement.prototype.requestPictureInPicture = function () {
    window.__pip.enter += 1;
    if (window.__pipFail) return Promise.reject(new DOMException('giả lập', window.__pipFail));
    if (!this.videoWidth) return Promise.reject(new DOMException('không có hình', 'InvalidStateError'));
    pipEl = this;
    setTimeout(() => this.dispatchEvent(new Event('enterpictureinpicture')), 0);
    return Promise.resolve({});
  };
  document.exitPictureInPicture = function () {
    window.__pip.exit += 1;
    const v = pipEl;
    pipEl = null;
    if (v) setTimeout(() => v.dispatchEvent(new Event('leavepictureinpicture')), 0);
    return Promise.resolve();
  };
  Object.defineProperty(document, 'fullscreenElement', { get: () => fsEl, configurable: true });
  Element.prototype.requestFullscreen = function () {
    window.__fs.enter += 1;
    fsEl = this;
    setTimeout(() => document.dispatchEvent(new Event('fullscreenchange')), 0);
    return Promise.resolve();
  };
  document.exitFullscreen = function () {
    window.__fs.exit += 1;
    fsEl = null;
    setTimeout(() => document.dispatchEvent(new Event('fullscreenchange')), 0);
    return Promise.resolve();
  };
  window.__ms = {};
  if (navigator.mediaSession) {
    const orig = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
    navigator.mediaSession.setActionHandler = (name, fn) => { window.__ms[name] = fn; return orig(name, fn); };
  }
}

async function open(browser, { user = null, viewport = { width: 1280, height: 720 }, fakes = {} } = {}) {
  state.user = user;
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.addInitScript(installFakes, fakes);
  await page.addInitScript((items) => { try {
    localStorage.setItem('carweb_guest', '1');
    localStorage.setItem('carweb_playlists', JSON.stringify({ playlists: [{ id: 'l1', name: 'Thử', items, updated_at: '2026-01-01T00:00:00Z' }] }));   // hàng đợi lúc mở web (giai đoạn 12)
  } catch (e) { /* bỏ qua */ } }, [vid('trending001'), vid('trending002'), vid('trending003')]);
  await page.goto('http://localhost:8123/');
  await page.waitForSelector('.split');
  return { ctx, page };
}
const pipBtn = (page) => page.getByRole('button', { name: 'Cửa sổ nổi' });
const fsBtn = (page) => page.getByRole('button', { name: 'Toàn màn hình' });
const isPlaying = (page) => page.evaluate(() => { const v = document.querySelector('video'); return !!v && !v.paused && !v.ended; });
const title = (page) => page.locator('.now-title').textContent();
const waitTitle = (page, t) => until(page, (x) => document.querySelector('.now-title').textContent === x, t, 8000);
const fit = (page) => page.evaluate(() => {
  const b = document.querySelector('.player');
  const chips = document.querySelector('.player .ctlrow').getBoundingClientRect();
  const stage = document.querySelector('.stage').getBoundingClientRect();
  const tools = document.querySelector('.stage-tools').getBoundingClientRect();
  const hint = document.querySelector('.pip-hint');
  const hintRect = hint && !hint.hidden ? hint.getBoundingClientRect() : null;
  const btn = document.querySelector('.stage-btn:not([hidden])');
  return {
    scroll: b.scrollHeight - b.clientHeight,
    chipsBottom: Math.round(chips.bottom),
    hintBottom: hintRect ? Math.round(hintRect.bottom) : null,
    paneBottom: Math.round(b.getBoundingClientRect().bottom),
    // 9.1: nút thao tác nằm NGOÀI khung video (hàng dưới tên bài), không che video, không tràn khỏi khung ngang
    toolsOutside: tools.width === 0 || ((tools.top >= stage.bottom - 1 || tools.bottom <= stage.top + 1) && tools.right <= b.getBoundingClientRect().right + 1),
    btnSize: btn ? Math.round(btn.getBoundingClientRect().width) : 0,
    // hàng nút không tràn ngang (nút cuối cùng vẫn nằm trong khung trình phát)
    ctlFit: (() => { const row = document.querySelector('.player .ctlrow'); const pr = b.getBoundingClientRect(); return [...row.querySelectorAll('button')].filter((x) => x.getClientRects().length > 0).every((x) => x.getBoundingClientRect().right <= pr.right + 1 && x.getBoundingClientRect().left >= pr.left - 1); })(),
  };
});

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

// ===== 1. Có hình, trình duyệt hỗ trợ: nút, Media Session, cửa sổ nổi, đổi bài, đưa về =====
let { ctx, page } = await open(browser);
check('mở web: tự phát bài đầu có hình (video thật)', await waitTitle(page, 'Bài trending001') && await until(page, () => { const v = document.querySelector('video'); return v && !v.paused && v.videoWidth === 320; }));
check('nút "Cửa sổ nổi" và "Toàn màn hình" hiện, nút nổi bấm được', await pipBtn(page).isVisible() && await fsBtn(page).isVisible() && (await pipBtn(page).getAttribute('aria-disabled')) === 'false');
check('không hiện dòng gợi ý "không hỗ trợ"', await page.locator('.pip-hint').isHidden());
const sizes1 = await fit(page);
check('các nút thao tác nằm ngoài khung video (không che hình) và đủ lớn để chạm (≥ 44px)', sizes1.toolsOutside && sizes1.btnSize >= 44, JSON.stringify(sizes1));

// Media Session thật của Chromium
const ms1 = await page.evaluate(() => { const m = navigator.mediaSession.metadata; return { title: m && m.title, artist: m && m.artist, art: m ? m.artwork.length : -1, state: navigator.mediaSession.playbackState, handlers: Object.keys(window.__ms).filter((k) => typeof window.__ms[k] === 'function').sort() }; });
check('Media Session: tên bài, kênh, ảnh bìa và trạng thái "playing"', ms1.title === 'Bài trending001' && ms1.artist === 'Ca sĩ Thử' && ms1.art === 1 && ms1.state === 'playing', JSON.stringify(ms1));
check('Media Session: đủ 7 hành động (phát, dừng, trước, sau, tua lùi, tua tới, tua đến)', ms1.handlers.join(',') === 'nexttrack,pause,play,previoustrack,seekbackward,seekforward,seekto', ms1.handlers.join(','));
await page.evaluate(() => window.__ms.pause());
check('hành động "pause" từ thông báo/cửa sổ nổi dừng video', await until(page, () => document.querySelector('video').paused) && await page.evaluate(() => navigator.mediaSession.playbackState) === 'paused');
await page.evaluate(() => window.__ms.play());
check('hành động "play" phát lại', await until(page, () => !document.querySelector('video').paused) && await page.evaluate(() => navigator.mediaSession.playbackState) === 'playing');
await page.evaluate(() => window.__ms.seekforward({ seekOffset: 5 }));
check('"tua tới" 5 giây', await until(page, () => document.querySelector('video').currentTime >= 4.5), String(await page.evaluate(() => document.querySelector('video').currentTime)));
await page.evaluate(() => window.__ms.seekto({ seekTime: 2 }));
check('"tua đến" giây thứ 2', await until(page, () => { const t = document.querySelector('video').currentTime; return t >= 1.9 && t < 4; }));
await page.evaluate(() => window.__ms.nexttrack());
check('hành động "nexttrack" chuyển bài, metadata đổi theo', await waitTitle(page, 'Bài trending002') && await until(page, () => navigator.mediaSession.metadata && navigator.mediaSession.metadata.title === 'Bài trending002'));
await page.evaluate(() => window.__ms.previoustrack());
check('hành động "previoustrack" quay lại bài trước', await waitTitle(page, 'Bài trending001'));
await page.locator('.volrow .vol').evaluate((el) => { el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true })); });
check('âm lượng (giai đoạn 12.2): kéo thanh âm lượng thì thẻ video đổi âm lượng theo', await until(page, () => Math.abs(document.querySelector('video').volume - 0.3) < 0.01));
await page.locator('.volrow .vol').evaluate((el) => { el.value = '100'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await until(page, () => { const v = document.querySelector('video'); return v && !v.paused && v.videoWidth === 320; });

// Vào cửa sổ nổi
await page.evaluate(() => { window.__video = document.querySelector('video'); });
await pipBtn(page).click();
check('bấm "Cửa sổ nổi": gọi API đúng 1 lần, nút sáng lên', await until(page, () => window.__pip.enter === 1 && document.pictureInPictureElement === document.querySelector('video') && document.querySelector('.stage-btn[aria-pressed]').getAttribute('aria-pressed') === 'true'));
check('khung video báo "Đang phát ở cửa sổ nổi." kèm nút "Đưa về đây"', await until(page, () => document.querySelector('.stage-overlay.on .overlay-text') && /Đang phát ở cửa sổ nổi/.test(document.querySelector('.stage-overlay.on .overlay-text').textContent)) && await page.getByRole('button', { name: 'Đưa về đây' }).isVisible());
check('đang nổi: nút "Bấm để phát" không hiện lẫn vào', await page.getByRole('button', { name: 'Bấm để phát' }).isHidden());
await page.screenshot({ path: 'shot-phase4-pip-active.png' });

// Đổi bài khi đang nổi
await page.getByRole('button', { name: 'Bài kế tiếp' }).click();
check('đổi bài khi đang nổi: bài mới phát', await waitTitle(page, 'Bài trending002') && await until(page, () => { const v = document.querySelector('video'); return v && !v.paused && v.videoWidth === 320; }));
const keep = await page.evaluate(() => ({ exits: window.__pip.exit, still: document.pictureInPictureElement === document.querySelector('video'), same: window.__video === document.querySelector('video'), videos: document.querySelectorAll('video').length }));
check('đổi bài KHÔNG làm đóng cửa sổ nổi (không gọi thoát, vẫn cùng một thẻ video)', keep.exits === 0 && keep.still && keep.same && keep.videos === 1, JSON.stringify(keep));
check('sau khi đổi bài vẫn hiện "Đang phát ở cửa sổ nổi"', /Đang phát ở cửa sổ nổi/.test(await page.locator('.overlay-text').textContent()));

// Đưa về
await page.getByRole('button', { name: 'Đưa về đây' }).click();
check('"Đưa về đây": thoát cửa sổ nổi, lớp phủ biến mất, nút tắt sáng', await until(page, () => window.__pip.exit === 1 && !document.pictureInPictureElement && !document.querySelector('.stage-overlay.on')) && (await pipBtn(page).getAttribute('aria-pressed')) === 'false');
check('video vẫn đang phát sau khi đưa về', await isPlaying(page));

// Người dùng tự đóng bằng nút X của cửa sổ nổi (trình duyệt gửi sự kiện leave)
await pipBtn(page).click();
await until(page, () => document.pictureInPictureElement);
await page.evaluate(() => { document.exitPictureInPicture(); });
check('đóng cửa sổ nổi từ phía trình duyệt: giao diện tự cập nhật', await until(page, () => !document.querySelector('.stage-overlay.on') && document.querySelector('.stage-btn[aria-pressed]').getAttribute('aria-pressed') === 'false'));

// Trình duyệt từ chối (ví dụ không có thao tác của người dùng)
await page.evaluate(() => { window.__pipFail = 'NotAllowedError'; });
await pipBtn(page).click();
check('bị trình duyệt từ chối: hiện thông báo tiếng Việt, giao diện không kẹt', await until(page, () => /chỉ mở cửa sổ nổi khi bạn bấm nút/.test((document.querySelector('.toast') || {}).textContent || '')) && !(await page.locator('.stage-overlay.on').count()));
await page.evaluate(() => { window.__pipFail = null; });

// Toàn màn hình
await fsBtn(page).click();
check('"Toàn màn hình": phóng to thẻ video và bật điều khiển có sẵn của trình duyệt', await until(page, () => document.fullscreenElement === document.querySelector('video') && document.querySelector('video').controls === true));
await fsBtn(page).click();
check('bấm lại: thoát toàn màn hình, tắt điều khiển có sẵn', await until(page, () => !document.fullscreenElement && document.querySelector('video').controls === false));
await page.close(); await ctx.close();

// ===== 2. Thành viên: đăng xuất khi đang nổi thì đóng cửa sổ nổi và gỡ Media Session =====
({ ctx, page } = await open(browser, { user: { id: 1, email: 'a@b.c', name: 'An', status: 'active', expires_at: null } }));
await waitTitle(page, 'Bài trending001');
await until(page, () => { const v = document.querySelector('video'); return v && !v.paused && v.videoWidth === 320; });
await pipBtn(page).click();
await until(page, () => document.pictureInPictureElement);
await page.locator('.rail-settings').click();   // giai đoạn 6: Đăng xuất nằm trong Cài đặt
await page.getByRole('dialog', { name: 'Cài đặt' }).getByRole('button', { name: 'Đăng xuất' }).click();
check('đăng xuất khi đang nổi: cửa sổ nổi được đóng', await until(page, () => window.__pip.exit >= 1 && !document.pictureInPictureElement));
check('đăng xuất: Media Session được gỡ (không còn metadata, hành động bị hủy)', await until(page, () => navigator.mediaSession.metadata === null && window.__ms.play === null && window.__ms.nexttrack === null));
check('đăng xuất: nhạc dừng (không còn thẻ video)', await until(page, () => document.querySelectorAll('video').length === 0 || document.querySelector('video').paused));
await page.close(); await ctx.close();

// ===== 3. Bài chỉ có âm thanh: nút mờ, bấm vào có thông báo lý do =====
audioOnly = true;
({ ctx, page } = await open(browser));
await waitTitle(page, 'Bài trending001');
await until(page, () => { const v = document.querySelector('video'); return v && !v.paused; });
await until(page, () => document.querySelector('.stage-btn[aria-pressed]').getAttribute('aria-disabled') === 'true');
check('chỉ có âm thanh: nút "Cửa sổ nổi" mờ đi (aria-disabled) nhưng vẫn hiện', await pipBtn(page).isVisible() && (await pipBtn(page).getAttribute('aria-disabled')) === 'true');
await pipBtn(page).click({ force: true });
check('bấm vào nút mờ: hiện lý do, không gọi API cửa sổ nổi', await until(page, () => /chỉ có âm thanh nên không có hình để nổi/.test((document.querySelector('.toast') || {}).textContent || '')) && (await page.evaluate(() => window.__pip.enter)) === 0);
check('chỉ có âm thanh: Media Session vẫn chạy', await page.evaluate(() => navigator.mediaSession.metadata && navigator.mediaSession.metadata.title) === 'Bài trending001');
await page.close(); await ctx.close();
audioOnly = false;

// ===== 4. Trình duyệt không hỗ trợ cửa sổ nổi: ẩn nút + gợi ý, các phần khác vẫn chạy =====
({ ctx, page } = await open(browser, { fakes: { noPip: true } }));
await waitTitle(page, 'Bài trending001');
check('không hỗ trợ: nút "Cửa sổ nổi" bị ẩn (vẫn có trong trang nhưng không thấy)', await page.locator('button[aria-label="Cửa sổ nổi"]').count() === 1 && await page.locator('button[aria-label="Cửa sổ nổi"]').isHidden());
check('không hỗ trợ: hiện gợi ý ngắn', await page.locator('.pip-hint').isVisible() && /chưa hỗ trợ cửa sổ nổi/.test(await page.locator('.pip-hint').textContent()));
check('không hỗ trợ: nút "Toàn màn hình" và Media Session vẫn dùng được', await fsBtn(page).isVisible() && await page.evaluate(() => navigator.mediaSession.metadata && navigator.mediaSession.metadata.title) === 'Bài trending001');
await page.close(); await ctx.close();

// ===== 5. Tài khoản không có quyền "pip" =====
state.handlers['GET /api/auth/me'] = (req, res, url, body, send) => send(res, 200, { ok: true, data: { user: null, guest: true, csrf: 'tok', plan: 'guest', features: ['youtube', 'layout'], expires_at: null } });
({ ctx, page } = await open(browser));
await waitTitle(page, 'Bài trending001');
check('không có quyền "pip": nút ẩn, gợi ý nói rõ lý do', await page.locator('button[aria-label="Cửa sổ nổi"]').count() === 1 && await page.locator('button[aria-label="Cửa sổ nổi"]').isHidden() && /chưa có quyền dùng cửa sổ nổi/.test(await page.locator('.pip-hint').textContent()));
await page.close(); await ctx.close();
delete state.handlers['GET /api/auth/me'];

// ===== 6. Các cỡ màn hình xe: không bị cắt, không phải cuộn (có cửa sổ nổi, và khi hiện dòng gợi ý) =====
for (const vp of [{ width: 1280, height: 720 }, { width: 1024, height: 600 }, { width: 800, height: 480 }]) {
  for (const [label, fakes] of [['hỗ trợ', {}], ['không hỗ trợ, có gợi ý', { noPip: true }]]) {
    ({ ctx, page } = await open(browser, { viewport: vp, fakes }));
    await waitTitle(page, 'Bài trending001');
    await page.waitForTimeout(300);
    const f = await fit(page);
    const bottom = f.hintBottom === null ? f.chipsBottom : f.hintBottom;
    check(`${vp.width}x${vp.height} (${label}): đủ nút, không phải cuộn, nút thao tác không che video, hàng nút không tràn ngang`, f.scroll <= 1 && bottom <= f.paneBottom && f.toolsOutside && f.ctlFit, JSON.stringify(f));
    if (vp.width === 1024) await page.screenshot({ path: `shot-phase4-1024x600-${fakes.noPip ? 'hint' : 'ok'}.png` });
    if (vp.width === 800 && !fakes.noPip) await page.screenshot({ path: 'shot-phase4-800x480.png' });
    await page.close(); await ctx.close();
  }
}

// ===== 7. Màn hình dọc (điện thoại) =====
({ ctx, page } = await open(browser, { viewport: { width: 420, height: 880 } }));
await waitTitle(page, 'Bài trending001');
// Giai đoạn 14: điện thoại dọc gom cửa sổ nổi/toàn màn hình vào nút "⋯" (bảng chọn nằm ngoài khung video).
await page.getByRole('button', { name: 'Thêm tùy chọn phát' }).click();
check('màn hình dọc: cửa sổ nổi nằm trong nút "⋯", không che video', await page.locator('.sheet').getByRole('menuitem', { name: 'Cửa sổ nổi' }).isVisible() && !(await pipBtn(page).isVisible()));
await page.keyboard.press('Escape');
await page.screenshot({ path: 'shot-phase4-portrait.png' });
await page.close(); await ctx.close();

check('không có lỗi JavaScript nào', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
