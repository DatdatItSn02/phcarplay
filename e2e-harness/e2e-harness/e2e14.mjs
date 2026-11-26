import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');

// Giai đoạn 13: phần WEBSITE của ứng dụng Android/iOS (core/nativeApp.js), trên PHP THẬT (php -S + SQLite tạm) và Chromium thật.
// Chromium được đặt User-Agent của ứng dụng ("... PHCarPlayApp/1.0.0 (Android)") và một kênh PHCarPlayNative GIẢ ghi lại tin website gửi,
// rồi kịch bản gọi window.__phApp.* như ứng dụng thật gọi bằng evaluateJavascript.
// Kiểm tra: nhận ra ứng dụng, nút Quay lại (đóng hộp thoại -> thoát "Chỉ video" -> về Trang chủ -> để ứng dụng thoát),
// phím nhạc (phát/dừng, bài sau/trước, tua), ra nền thì dừng / hiện lại thì phát tiếp, báo bài đang phát,
// tìm bằng giọng nói của máy (kể cả khi WebView không có Web Speech), lỗi giọng nói, tắt cửa sổ nổi trong ứng dụng;
// trình duyệt thường không bị ảnh hưởng. Máy chủ Piped GIẢ phát clip.webm thật bằng thẻ <video>.
// KHÔNG thử được: ứng dụng Android/iOS thật (phần Java/Swift), WebView thật, nhận giọng nói thật, nút vô lăng thật.
const PUBLIC_DIR = process.env.PUBLIC_DIR;
if (!PUBLIC_DIR) { console.error('Cần đặt PUBLIC_DIR=/duong/dan/den/public'); process.exit(2); }
const PROJECT = path.dirname(PUBLIC_DIR);
const here = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.env.PORT || 8093);
const PIPED_PORT = Number(process.env.PIPED_PORT || 8137);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PIPED = `http://localhost:${PIPED_PORT}`;
const DB = path.join(os.tmpdir(), `carweb-e2e14-${process.pid}.sqlite`);
const MASTER = { email: 'master@test.local', pass: 'Master-12345' };
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 PHCarPlayApp/1.0.0 (Android)';
const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 PHCarPlayApp/1.0.0 (iOS)';

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
    YOUTUBE_EMBED: 'false', YOUTUBE_KEY_HINT: 'false', MUSIC_QUERY: 'nhạc e2e14 ' + RUN },
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

// ---------- A. Ứng dụng Android (User-Agent + kênh giả), WebView không có Web Speech ----------
let { ctx, page } = await open({ ua: UA_ANDROID, channel: 'android' });
const a1 = await page.evaluate(() => ({ app: document.documentElement.getAttribute('data-app'), fns: Object.keys(window.__phApp || {}).sort().join(',') }));
check('A1 nhận ra ứng dụng Android: <html data-app="android">, có window.__phApp (back, cast, lifecycle, mediaKey, voice)', a1.app === 'android' && a1.fns === 'back,cast,lifecycle,mediaKey,voice', JSON.stringify(a1));
const playing0 = await waitPlaying(page, true);
await page.waitForTimeout(400);
let st = await lastState(page);
check('A2 tự phát khi mở ứng dụng và báo bài đang phát cho ứng dụng (tên bài, kênh, đang phát)', playing0 && st && st.playing === true && st.title === titleOf(ids[0]) && st.artist === 'Kênh thử', JSON.stringify(st));
const pipA = await page.evaluate(() => { const b = document.querySelector('button[aria-label="Cửa sổ nổi"]'); const hnt = document.querySelector('.pip-hint'); return { btnHidden: !b || b.hidden, hint: hnt ? (hnt.hidden ? '' : hnt.textContent) : '' }; });
check('A3 trong ứng dụng: không có nút cửa sổ nổi và không có dòng "chưa hỗ trợ cửa sổ nổi" (không phát khi ứng dụng ở nền)', pipA.btnHidden && pipA.hint === '', JSON.stringify(pipA));

// phím nhạc
await call(page, 'mediaKey', 'toggle');
const pausedByKey = await waitPlaying(page, false);
await page.waitForTimeout(200);
st = await lastState(page);
check('A4 phím nhạc "phát/dừng" (vô lăng, tai nghe): dừng, báo ứng dụng playing=false', pausedByKey && st && st.playing === false, JSON.stringify(st));
check('A5 phím "play" khi đang dừng thì phát; "pause" khi đang phát thì dừng; tên phím lạ bị bỏ qua',
  (await call(page, 'mediaKey', 'play')) === true && await waitPlaying(page, true) && (await call(page, 'mediaKey', 'pause')) === true && await waitPlaying(page, false)
  && (await call(page, 'mediaKey', 'eject')) === false);
await call(page, 'mediaKey', 'play');
await waitPlaying(page, true);
await call(page, 'mediaKey', 'next');
await page.waitForFunction((t) => document.querySelector('.now-title').textContent === t, titleOf(ids[1]), { timeout: 8000 }).catch(() => {});
const tNext = await nowTitle(page);
await waitPlaying(page, true);
await call(page, 'mediaKey', 'prev');
await page.waitForFunction((t) => document.querySelector('.now-title').textContent === t, titleOf(ids[0]), { timeout: 8000 }).catch(() => {});
const tPrev = await nowTitle(page);
check('A6 phím "bài sau" / "bài trước" chuyển bài trong hàng đợi', tNext === titleOf(ids[1]) && tPrev === titleOf(ids[0]), `${tNext} / ${tPrev}`);
await waitPlaying(page, true);
await page.waitForTimeout(500);
const t0 = await time(page);
await call(page, 'mediaKey', 'forward');
await page.waitForTimeout(300);
const t1 = await time(page);
await call(page, 'mediaKey', 'rewind');
await page.waitForTimeout(300);
const t2 = await time(page);
check('A7 phím tua tới / tua lui 10 giây', t1 - t0 >= 9 && t1 - t0 <= 11.5 && t1 - t2 >= 9 && t1 - t2 <= 11.5, [t0, t1, t2].map((x) => x.toFixed(1)).join(' -> '));

// ra nền / hiện lại
await call(page, 'lifecycle', 'hidden');
const hiddenPaused = await waitPlaying(page, false);
await call(page, 'lifecycle', 'visible');
const resumed = await waitPlaying(page, true);
await setVisibility(page, 'hidden');
const visPaused = await waitPlaying(page, false);
await setVisibility(page, 'visible');
const visResumed = await waitPlaying(page, true);
check('A8 ứng dụng ra nền thì dừng nhạc (quy định YouTube), hiện lại thì phát tiếp; cả khi chỉ có sự kiện visibilitychange', hiddenPaused && resumed && visPaused && visResumed);
await call(page, 'mediaKey', 'pause');
await waitPlaying(page, false);
await call(page, 'lifecycle', 'hidden');
await call(page, 'lifecycle', 'visible');
await page.waitForTimeout(800);
check('A9 người dùng đã dừng trước khi ra nền: hiện lại vẫn dừng', !(await isPlaying(page)));
await call(page, 'mediaKey', 'play');
await waitPlaying(page, true);

// tìm bằng giọng nói của máy
await railBtn(page, 'Tìm kiếm').click();
const mic = page.locator('.view[data-view="search"] .search-mic');
check('A10 WebView không có Web Speech nhưng ứng dụng có nhận giọng nói: vẫn hiện nút micro', await mic.isVisible());
await mic.click();
await page.waitForTimeout(300);
let msgs = await sent(page);
const start1 = msgs.filter((m) => m.type === 'voice.start').pop();
const pausedForVoice = !(await isPlaying(page));
check('A11 bấm micro: gửi "voice.start" (tiếng Việt) cho ứng dụng, dừng nhạc trong lúc nghe, hiện hộp "Đang nghe..."',
  start1 && start1.lang === 'vi-VN' && pausedForVoice && (await page.locator('.voice-text').textContent()) === 'Đang nghe...', JSON.stringify(start1));
await call(page, 'voice', { id: start1.id, kind: 'partial', text: 'nhạc' });
const partial = await page.locator('.voice-text').textContent();
await call(page, 'voice', { id: start1.id, kind: 'result', text: 'nhạc thử giọng nói' });
await page.waitForTimeout(300);
const afterVoice = { dialogs: await overlays(page), query: await page.locator('.view[data-view="search"] .search-input').inputValue() };
await page.locator('.view[data-view="search"] .vrow').first().waitFor({ timeout: 8000 }).catch(() => {});
const rows = await page.locator('.view[data-view="search"] .vrow').count();
const resumedAfterVoice = await waitPlaying(page, true);
check('A12 ứng dụng gửi chữ đang nói rồi kết quả: hộp hiện chữ, đóng hộp, tìm đúng câu đã nói, có kết quả, nhạc phát tiếp',
  partial === 'nhạc' && afterVoice.dialogs === 0 && afterVoice.query === 'nhạc thử giọng nói' && rows === 3 && resumedAfterVoice, JSON.stringify({ partial, afterVoice, rows, resumedAfterVoice }));
await mic.click();
await page.waitForTimeout(200);
msgs = await sent(page);
const start2 = msgs.filter((m) => m.type === 'voice.start').pop();
await call(page, 'voice', { id: start2.id, kind: 'error', code: 'app-denied' });
await page.waitForTimeout(200);
const errText = await page.locator('.voice .hint').textContent();
const retryVisible = await page.locator('.voice').getByRole('button', { name: 'Thử lại' }).isVisible();
check('A13 ứng dụng chưa được dùng micro: hộp báo cách bật quyền trong Cài đặt của máy, có nút Thử lại', /chưa được phép dùng micro/.test(errText) && retryVisible, errText);
await page.locator('.voice').getByRole('button', { name: 'Thử lại' }).click();
await page.waitForTimeout(200);
msgs = await sent(page);
const start3 = msgs.filter((m) => m.type === 'voice.start').pop();
await call(page, 'voice', { id: start3.id, kind: 'error', code: 'aborted' });
await page.waitForTimeout(200);
check('A14 Thử lại gửi lần nghe mới; người dùng tự đóng màn hình nghe của máy thì đóng luôn hộp', start3.id === start2.id + 1 && (await overlays(page)) === 0);
await mic.click();
await page.waitForTimeout(200);
msgs = await sent(page);
const start4 = msgs.filter((m) => m.type === 'voice.start').pop();
const backClosesVoice = await call(page, 'back');
await page.waitForTimeout(200);
msgs = await sent(page);
check('A15 nút Quay lại khi đang nghe: đóng hộp và báo ứng dụng dừng nghe (voice.stop)', backClosesVoice === true && (await overlays(page)) === 0 && msgs.some((m) => m.type === 'voice.stop' && m.id === start4.id));

// nút Quay lại
await page.locator('.rail').getByRole('button', { name: /Cài đặt/ }).click();
await page.waitForTimeout(300);
const dlgOpen = await overlays(page);
const b1 = await call(page, 'back');
await page.waitForTimeout(200);
const dlgAfter = await overlays(page);
await page.getByRole('button', { name: 'Chỉ hiện video' }).click();
await page.waitForTimeout(300);
const f1 = await focusOf(page);
const b2 = await call(page, 'back');
await page.waitForTimeout(200);
const f2 = await focusOf(page);
const v1 = await activeView(page);
const b3 = await call(page, 'back');
await page.waitForTimeout(200);
const v2 = await activeView(page);
const b4 = await call(page, 'back');
check('A16 Quay lại: đóng hộp thoại -> thoát "Chỉ video" -> về Trang chủ -> ở Trang chủ thì trả false (ứng dụng hỏi "bấm lần nữa để thoát")',
  dlgOpen === 1 && b1 === true && dlgAfter === 0 && f1 === 'left' && b2 === true && f2 === '' && v1 === 'search' && b3 === true && v2 === 'home' && b4 === false,
  JSON.stringify({ dlgOpen, b1, dlgAfter, f1, b2, f2, v1, b3, v2, b4 }));
await page.screenshot({ path: path.join(here, 'shot-phase13-android.png') });
await ctx.close();

// ---------- B. Trình duyệt thường: không có gì thay đổi ----------
({ ctx, page } = await open({ noSpeech: true }));
await waitPlaying(page, true);
const bInfo = await page.evaluate(() => ({ app: document.documentElement.getAttribute('data-app'), ph: typeof window.__phApp, pip: (() => { const b = document.querySelector('button[aria-label="Cửa sổ nổi"]'); return Boolean(b && !b.hidden); })() }));
await railBtn(page, 'Tìm kiếm').click();
const bMic = await page.locator('.view[data-view="search"] .search-mic').count();
await setVisibility(page, 'hidden');
await page.waitForTimeout(800);
const bStill = await isPlaying(page);
check('B1 trình duyệt thường: không có data-app, không có window.__phApp, vẫn có nút cửa sổ nổi, không Web Speech thì không có micro, ẩn tab không dừng nhạc',
  bInfo.app === null && bInfo.ph === 'undefined' && bInfo.pip && bMic === 0 && bStill, JSON.stringify({ bInfo, bMic, bStill }));
await ctx.close();

// ---------- C. Ứng dụng iOS (kênh webkit.messageHandlers) ----------
({ ctx, page } = await open({ ua: UA_IOS, channel: 'ios', viewport: { width: 390, height: 844 } }));
await waitPlaying(page, true);
const cInfo = await page.evaluate(() => ({ app: document.documentElement.getAttribute('data-app'), pip: (() => { const b = document.querySelector('button[aria-label="Cửa sổ nổi"]'); return Boolean(b && !b.hidden); })() }));
await railBtn(page, 'Tìm kiếm').click();
await page.locator('.view[data-view="search"] .search-mic').click();
await page.waitForTimeout(300);
msgs = await sent(page);
const cStart = msgs.filter((m) => m.type === 'voice.start').pop();
await call(page, 'voice', { id: cStart.id, kind: 'result', text: 'bài hát iphone' });
await page.waitForTimeout(300);
const cQuery = await page.locator('.view[data-view="search"] .search-input').inputValue();
check('C1 ứng dụng iOS: data-app="ios", không có cửa sổ nổi, micro gửi qua webkit.messageHandlers, kết quả được tìm',
  cInfo.app === 'ios' && !cInfo.pip && cStart && cQuery === 'bài hát iphone', JSON.stringify({ cInfo, cStart, cQuery }));
const noScrollX = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
check('C2 màn hình iPhone dọc (390x844) không tràn ngang', noScrollX);
await page.screenshot({ path: path.join(here, 'shot-phase13-ios.png') });
await ctx.close();

// ---------- D. User-Agent của ứng dụng nhưng không có kênh (bản ứng dụng cũ / lỗi) ----------
({ ctx, page } = await open({ ua: UA_ANDROID, channel: null }));
await waitPlaying(page, true);
const dKey = await call(page, 'mediaKey', 'toggle');
const dPaused = await waitPlaying(page, false);
await railBtn(page, 'Tìm kiếm').click();
const dMic = await page.locator('.view[data-view="search"] .search-mic').count();
const dBack = await call(page, 'back');
check('D1 không có kênh: phím nhạc và Quay lại vẫn chạy, không có giọng nói của máy (và không có Web Speech) thì ẩn micro', dKey === true && dPaused && dMic === 0 && dBack === true);
await ctx.close();
await browser.close();

check('không có lỗi JavaScript nào', errors.length === 0, errors.slice(0, 3).join(' | '));
check('PHP không báo lỗi/cảnh báo nào', !/Warning|Fatal|Notice|Deprecated/.test(phpErr), phpErr.split('\n').filter((l) => /Warning|Fatal|Notice|Deprecated/.test(l)).slice(0, 2).join(' '));
console.log(failures ? `\nCÓ ${failures} MỤC CHƯA ĐẠT` : '\nTẤT CẢ ĐẠT');
process.exit(failures ? 1 : 0);
