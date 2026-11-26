import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');

// Giai đoạn 15 (đợt 1) - NGHE NHẠC TRONG NỀN: phần WEBSITE, trên PHP THẬT (php -S + SQLite tạm) và Chromium thật.
// Chromium được đặt User-Agent của ứng dụng bản 1.1.0 và kênh PHCarPlayNative GIẢ ghi lại tin website gửi;
// kịch bản gọi window.__phApp.lifecycle('hidden' | 'visible' | 'nudge') như ứng dụng thật.
// Kiểm tra: website báo cài đặt cho ứng dụng; ra nền nhạc vẫn chạy và tự sang bài kế; tắt "Phát trong nền" trong Cài đặt thì
// ra nền dừng / hiện lại phát tiếp; cài đặt được nhớ; iPhone tự dừng video lúc ra nền thì 'nudge' phát lại (người dùng tự dừng thì không);
// ứng dụng bản cũ 1.0.0 được nhắc cập nhật và vẫn dừng khi ra nền; trình duyệt thường không có mục này.
// KHÔNG thử được: phần Java/Swift (dịch vụ nền, thông báo, chế độ âm thanh nền), điện thoại thật, tắt màn hình thật,
// bài phát bằng trình phát YouTube (đã có kiểm thử đơn vị: tests/js/nativeapp.test.mjs).
const PUBLIC_DIR = process.env.PUBLIC_DIR;
if (!PUBLIC_DIR) { console.error('Cần đặt PUBLIC_DIR=/duong/dan/den/public'); process.exit(2); }
const PROJECT = path.dirname(PUBLIC_DIR);
const here = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.env.PORT || 8095);
const PIPED_PORT = Number(process.env.PIPED_PORT || 8139);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PIPED = `http://localhost:${PIPED_PORT}`;
const DB = path.join(os.tmpdir(), `carweb-e2e16-${process.pid}.sqlite`);
const MASTER = { email: 'master@test.local', pass: 'Master-12345' };
const UA_OLD = 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 PHCarPlayApp/1.0.0 (Android)';
const UA_ANDROID = UA_OLD.replace('PHCarPlayApp/1.0.0', 'PHCarPlayApp/1.1.0');
const UA_IOS_OLD = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 PHCarPlayApp/1.0.0 (iOS)';

const UA_IOS = UA_IOS_OLD.replace('PHCarPlayApp/1.0.0', 'PHCarPlayApp/1.1.0');

let failures = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Máy chủ Piped giả (mã video riêng cho mỗi lần chạy vì PHP lưu đệm kết quả) ----------
const clip = fs.readFileSync(path.join(here, 'clip.webm'));
const thumb = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#2a6"/></svg>');
const RUN = ('m' + process.pid.toString(36) + 'zzzzzzzzzz').slice(0, 10);
const ids = [RUN + '1', RUN + '2', RUN + '3'];
const titleOf = (id) => 'Bài ' + id;
const pItem = (id) => ({ type: 'stream', url: '/watch?v=' + id, title: titleOf(id), uploaderName: 'Kênh thử', duration: 30, thumbnail: PIPED + '/thumb.svg', views: 1000, uploaded: Date.now() - 86400000 });
const piped = http.createServer((req, res) => {
  const u = new URL(req.url, PIPED);
  const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/search') return json({ items: ids.map(pItem), nextpage: null });
  if (u.pathname === '/trending') return json(ids.map(pItem));
  if (u.pathname === '/suggestions') return json([]);
  if (u.pathname.startsWith('/streams/')) {
    const id = u.pathname.slice('/streams/'.length);
    return json({ title: titleOf(id), uploader: 'Kênh thử', duration: 30, thumbnailUrl: PIPED + '/thumb.svg', livestream: false, hls: null,
      videoStreams: [{ url: PIPED + '/clip.webm', mimeType: 'video/webm', quality: '360p', height: 360, videoOnly: false, bitrate: 1 }],
      audioStreams: [], relatedStreams: ids.map(pItem) });
  }
  if (u.pathname === '/thumb.svg') { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end(thumb); }
  if (u.pathname === '/clip.webm') {
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      const from = m[1] ? Number(m[1]) : 0;
      const to = m[2] ? Math.min(Number(m[2]), clip.length - 1) : clip.length - 1;
      res.writeHead(206, { 'Content-Type': 'video/webm', 'Content-Length': to - from + 1, 'Content-Range': `bytes ${from}-${to}/${clip.length}`, 'Accept-Ranges': 'bytes' });
      return res.end(clip.subarray(from, to + 1));
    }
    res.writeHead(200, { 'Content-Type': 'video/webm', 'Content-Length': clip.length, 'Accept-Ranges': 'bytes' });
    return res.end(clip);
  }
  res.writeHead(404); res.end('no');
});
await new Promise((r) => piped.listen(PIPED_PORT, r));

// ---------- PHP thật ----------
fs.rmSync(DB, { force: true });
const php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', PUBLIC_DIR, path.join(PROJECT, 'tests/support/serve_sqlite.php')], {
  env: { ...process.env, CARWEB_TEST_DB: DB, CARWEB_TEST_SEED: '1', CARWEB_TEST_MASTER_EMAIL: MASTER.email, CARWEB_TEST_MASTER_PASS: MASTER.pass,
    APP_URL: ORIGIN, MAIL_DRIVER: 'log', APP_DEBUG: 'false', VIDEO_SOURCES: 'piped', PIPED_API_URLS: PIPED, PIPED_VERIFY_SSL: 'false',
    YOUTUBE_EMBED: 'false', YOUTUBE_KEY_HINT: 'false', MUSIC_QUERY: 'nhạc e2e16 ' + RUN },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let phpErr = '';
php.stderr.on('data', (d) => { phpErr += d.toString(); });
process.on('exit', () => {
  try { php.kill(); } catch (e) { /* đã tắt */ }
  try { piped.close(); } catch (e) { /* đã tắt */ }
  fs.rmSync(DB, { force: true });
  fs.rmSync(DB + '.ratelimit', { recursive: true, force: true });
});
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(ORIGIN + '/api/health')).ok) break; } catch (e) { /* chưa sẵn sàng */ }
  await sleep(100);
}

// Chạy TRƯỚC mã của website: cửa sổ nổi giả (để thấy khác biệt trình duyệt / ứng dụng), kênh ứng dụng giả, bỏ Web Speech.
function installFakes(o) {
  try {
    let pipEl = null;
    Object.defineProperty(document, 'pictureInPictureEnabled', { get: () => true, configurable: true });
    Object.defineProperty(document, 'pictureInPictureElement', { get: () => pipEl, configurable: true });
    HTMLVideoElement.prototype.requestPictureInPicture = function () { pipEl = this; return Promise.resolve({}); };
    document.exitPictureInPicture = function () { pipEl = null; return Promise.resolve(); };
  } catch (e) { /* bỏ qua */ }
  window.__sent = [];
  const rec = (s) => { window.__sent.push(JSON.parse(s)); };
  if (o.channel === 'android') window.PHCarPlayNative = { postMessage: rec };
  if (o.channel === 'ios') window.webkit = { messageHandlers: { PHCarPlayNative: { postMessage: rec } } };
  if (o.noSpeech) {
    ['webkitSpeechRecognition', 'SpeechRecognition'].forEach((k) => {
      try { delete window[k]; } catch (e) { /* bỏ qua */ }
      try { if (window[k]) Object.defineProperty(window, k, { value: undefined, configurable: true, writable: true }); } catch (e) { /* bỏ qua */ }
    });
  }
  try {
    localStorage.setItem('carweb_guest', '1');
    localStorage.setItem('carweb_playlists', JSON.stringify({ playlists: [{ id: 'l1', name: 'Thử', items: o.items, updated_at: '2026-01-01T00:00:00Z' }] }));
  } catch (e) { /* bỏ qua */ }
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
async function open({ ua = null, channel = null, noSpeech = true, viewport = { width: 1024, height: 600 } } = {}) {
  const opts = { viewport };
  if (ua) opts.userAgent = ua;
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(installFakes, { channel, noSpeech, items: ids.map((id) => ({ id, title: titleOf(id), uploader: 'Kênh thử', duration: 30, thumbnail: PIPED + '/thumb.svg' })) });
  await page.goto(ORIGIN + '/');
  await page.waitForSelector('.split');
  return { ctx, page };
}
const isPlaying = (page) => page.evaluate(() => { const v = document.querySelector('video.media-video'); return Boolean(v && !v.paused && v.readyState > 1); });
const waitPlaying = (page, want = true, ms = 8000) => page.waitForFunction((w) => { const v = document.querySelector('video.media-video'); return Boolean(v && !v.paused && v.readyState > 1) === w; }, want, { timeout: ms }).then(() => true, () => false);
const nowTitle = (page) => page.locator('.now-title').textContent();
const sent = (page) => page.evaluate(() => window.__sent.slice());
const call = (page, fn, arg) => page.evaluate(([f, a]) => { const r = window.__phApp[f](a); return r; }, [fn, arg]);
const time = (page) => page.evaluate(() => document.querySelector('video.media-video').currentTime);
const overlays = (page) => page.locator('.overlay').count();
const railBtn = (page, name) => page.locator('.rail').getByRole('button', { name, exact: true });
const activeView = (page) => page.evaluate(() => { const v = document.querySelector('.view:not([hidden])'); return v ? v.getAttribute('data-view') : ''; });
const focusOf = (page) => page.evaluate(() => { const s = document.querySelector('[data-focus]'); return s ? s.getAttribute('data-focus') : null; });
const setVisibility = (page, state) => page.evaluate((s) => {
  Object.defineProperty(document, 'visibilityState', { get: () => s, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}, state);
const lastState = async (page) => { const s = (await sent(page)).filter((m) => m.type === 'state'); return s[s.length - 1] || null; };

const bgMsgs = async (page) => (await sent(page)).filter((m) => m.type === 'background').map((m) => m.enabled);
const sysPause = (page) => page.evaluate(() => { document.querySelector('video.media-video').pause(); });   // hệ điều hành tự dừng video
const openSettings = async (page) => { await page.locator('.rail-settings').click(); await page.locator('.settings').waitFor(); };
const closeDialog = async (page) => { await page.keyboard.press('Escape'); await page.waitForTimeout(150); };

// ---------- A. Ứng dụng Android bản 1.1.0 ----------
let { ctx, page } = await open({ ua: UA_ANDROID, channel: 'android' });
check('A1 đang phát bài đầu', await waitPlaying(page, true));
check('A2 website báo cho ứng dụng: đang bật "Phát trong nền" (mặc định)', JSON.stringify(await bgMsgs(page)) === '[true]', JSON.stringify(await bgMsgs(page)));

await call(page, 'lifecycle', 'hidden');
await page.waitForTimeout(900);
const t0 = await time(page);
await page.waitForTimeout(700);
check('A3 ra nền: nhạc vẫn chạy', await isPlaying(page) && (await time(page)) > t0);
const before = await nowTitle(page);
await call(page, 'mediaKey', 'next');                         // nút "Bài kế" trên thông báo / vô lăng lúc đang ở nền
await page.waitForFunction((b) => document.querySelector('.now-title').textContent !== b, before, { timeout: 8000 }).catch(() => {});
check('A4 ở nền: bấm "Bài kế" thì sang bài và phát', (await nowTitle(page)) !== before && await waitPlaying(page, true));
const st = await lastState(page);
check('A4 ứng dụng được báo tên bài mới (cho thông báo)', Boolean(st) && st.playing === true && st.title === (await nowTitle(page)), JSON.stringify(st));
// bài hết ở nền -> tự sang bài kế
const title2 = await nowTitle(page);
await page.evaluate(() => { const v = document.querySelector('video.media-video'); v.currentTime = Math.max(0, v.duration - 0.4); });
await page.waitForFunction((b) => document.querySelector('.now-title').textContent !== b, title2, { timeout: 10000 }).catch(() => {});
check('A5 ở nền: hết bài thì tự phát bài kế', (await nowTitle(page)) !== title2 && await waitPlaying(page, true));
await call(page, 'mediaKey', 'pause');
await waitPlaying(page, false);
await call(page, 'lifecycle', 'visible');
await page.waitForTimeout(500);
check('A6 người dùng dừng ở nền (nút thông báo): hiện lại vẫn dừng', !(await isPlaying(page)));
await call(page, 'mediaKey', 'play');
await waitPlaying(page, true);

// Cài đặt: tắt "Phát trong nền"
await openSettings(page);
const sec = page.locator('#set-background');
check('A7 Cài đặt có mục "Phát trong nền", đang chọn Bật', await sec.isVisible() && (await sec.getByRole('radio', { name: /^Bật/ }).getAttribute('aria-checked')) === 'true');
await sec.scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(here, 'shot-phase15-background-setting.png') });
await sec.getByRole('radio', { name: /^Tắt/ }).click();
check('A8 chọn Tắt: báo ngay cho ứng dụng', JSON.stringify(await bgMsgs(page)) === '[true,false]', JSON.stringify(await bgMsgs(page)));
await closeDialog(page);
await call(page, 'lifecycle', 'hidden');
const offPaused = await waitPlaying(page, false);
await call(page, 'lifecycle', 'visible');
const offResumed = await waitPlaying(page, true);
check('A9 đã tắt: ra nền thì dừng, hiện lại thì phát tiếp (như trước)', offPaused && offResumed);
await page.reload();
await page.waitForSelector('.split');
await page.waitForTimeout(600);
check('A10 mở lại ứng dụng: vẫn nhớ đang Tắt và báo lại cho ứng dụng', JSON.stringify(await bgMsgs(page)) === '[false]', JSON.stringify(await bgMsgs(page)));
await openSettings(page);
await page.locator('#set-background').getByRole('radio', { name: /^Bật/ }).click();
check('A11 bật lại', JSON.stringify(await bgMsgs(page)) === '[false,true]');
await ctx.close();

// ---------- B. iPhone bản 1.1.0: iOS tự dừng video lúc ra nền ----------
({ ctx, page } = await open({ ua: UA_IOS, channel: 'ios', viewport: { width: 390, height: 844 } }));
await waitPlaying(page, true);
check('B1 iPhone: website báo bật "Phát trong nền"', JSON.stringify(await bgMsgs(page)) === '[true]');
await call(page, 'lifecycle', 'hidden');
await setVisibility(page, 'hidden');
await sysPause(page);
await waitPlaying(page, false);
const nudged = await call(page, 'lifecycle', 'nudge');
check('B2 iPhone tự dừng video lúc ra nền: "nudge" phát lại', nudged === true && await waitPlaying(page, true));
await call(page, 'lifecycle', 'nudge');
await page.waitForTimeout(300);
check('B3 nhắc thêm lần nữa lúc đang phát: không bị dừng', await isPlaying(page));
await call(page, 'mediaKey', 'pause');                        // người dùng bấm dừng ở màn hình khóa
await waitPlaying(page, false);
await call(page, 'lifecycle', 'nudge');
await page.waitForTimeout(400);
await setVisibility(page, 'visible');
await call(page, 'lifecycle', 'visible');
await page.waitForTimeout(400);
check('B4 người dùng tự dừng: nudge và hiện lại đều không tự phát', !(await isPlaying(page)));
await ctx.close();

// ---------- C. Ứng dụng bản cũ 1.0.0 ----------
({ ctx, page } = await open({ ua: UA_OLD, channel: 'android' }));
await waitPlaying(page, true);
check('C1 bản 1.0.0: không gửi tin "background"', (await bgMsgs(page)).length === 0);
await call(page, 'lifecycle', 'hidden');
const oldPaused = await waitPlaying(page, false);
await call(page, 'lifecycle', 'visible');
check('C2 bản 1.0.0: ra nền vẫn dừng, hiện lại phát tiếp', oldPaused && await waitPlaying(page, true));
await openSettings(page);
check('C3 bản 1.0.0: Cài đặt nhắc cài bản ứng dụng mới, không có nút Bật/Tắt',
  await page.locator('#set-background').getByText('Hãy cài bản ứng dụng mới').isVisible() && (await page.locator('#set-background [role="radio"]').count()) === 0);
await ctx.close();

// ---------- D. Trình duyệt thường ----------
({ ctx, page } = await open({}));
await openSettings(page);
check('D1 trình duyệt thường: không có mục "Phát trong nền"', (await page.locator('#set-background').count()) === 0 && (await page.locator('.settings .set-section').count()) > 2);
await ctx.close();
await browser.close();

check('không có lỗi JavaScript nào', errors.length === 0, errors.slice(0, 3).join(' | '));
check('PHP không báo lỗi/cảnh báo nào', !/Warning|Fatal|Notice|Deprecated/.test(phpErr), phpErr.split('\n').filter((l) => /Warning|Fatal|Notice|Deprecated/.test(l)).slice(0, 2).join(' '));
console.log(failures ? `\nCÓ ${failures} MỤC CHƯA ĐẠT` : '\nTẤT CẢ ĐẠT');
process.exit(failures ? 1 : 0);
