import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');

// Giai đoạn 15 (đợt 2) - CHIẾU MÀN HÌNH ĐIỆN THOẠI LÊN MÀN HÌNH XE: phần WEBSITE, trên PHP THẬT và HAI trang Chromium thật
// nối với nhau bằng WebRTC THẬT (kênh dữ liệu), tin kết nối đi qua API ghép nối thật.
//  - Trang "màn hình xe": trình duyệt thường 1024x600. Bấm "Chiếu ĐT" -> mã 6 số -> nhận hình -> chia 2 bên.
//  - Trang "điện thoại": User-Agent ứng dụng Android 1.2.0 + kênh PHCarPlayNative GIẢ. Phần chụp màn hình của Android được
//    GIẢ bằng cách trả ảnh JPEG cho địa chỉ /__cast/frame (ứng dụng thật trả ảnh này từ bộ nhớ) và gọi window.__phApp.cast(...).
// Kiểm tra: ghép nối bằng mã (sai mã, đúng mã), hình tới đúng kích thước và có màu, bố cục chia đôi phía tài xế, Lấp đầy / Vừa khung,
// Đổi bên, Toàn màn hình (giai đoạn 17, thử kỹ ở e2e19), điện thoại xoay ngang, mất kết nối tự nối lại, dừng từ màn hình xe, dừng từ điện thoại, từ chối quyền,
// máy không hỗ trợ thì không có nút, màn hình 800x480.
// KHÔNG thử được: phần Java chụp màn hình thật (MediaProjection), điện thoại và màn hình xe thật, dây USB / Wi-Fi thật.
const PUBLIC_DIR = process.env.PUBLIC_DIR;
if (!PUBLIC_DIR) { console.error('Cần đặt PUBLIC_DIR=/duong/dan/den/public'); process.exit(2); }
const PROJECT = path.dirname(PUBLIC_DIR);
const here = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.env.PORT || 8096);
const PIPED_PORT = Number(process.env.PIPED_PORT || 8140);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PIPED = `http://localhost:${PIPED_PORT}`;
const DB = path.join(os.tmpdir(), `carweb-e2e17-${process.pid}.sqlite`);
const MASTER = { email: 'master@test.local', pass: 'Master-12345' };
const UA_OLD = 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 PHCarPlayApp/1.0.0 (Android)';
const UA_ANDROID = UA_OLD.replace('PHCarPlayApp/1.0.0', 'PHCarPlayApp/1.2.0');
const UA_IOS_OLD = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 PHCarPlayApp/1.0.0 (iOS)';

const UA_IOS = UA_IOS_OLD.replace('PHCarPlayApp/1.0.0', 'PHCarPlayApp/1.2.0');

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
    YOUTUBE_EMBED: 'false', YOUTUBE_KEY_HINT: 'false', MUSIC_QUERY: 'nhạc e2e17 ' + RUN },
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

// Hai trang trên cùng một máy: cho WebRTC dùng địa chỉ nội bộ (máy thật dùng địa chỉ Wi-Fi / USB).
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--allow-loopback-in-peer-connection', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
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

// ---------- Ảnh JPEG giả cho "màn hình điện thoại" (vẽ trong trình duyệt): dọc 540x1170 và ngang 1170x540 ----------
const tool = await (await browser.newContext()).newPage();
async function makeJpeg(w, h, color, label) {
  const b64 = await tool.evaluate(async ([w2, h2, color2, label2]) => {
    const c = document.createElement('canvas');
    c.width = w2; c.height = h2;
    const g = c.getContext('2d');
    g.fillStyle = color2; g.fillRect(0, 0, w2, h2);
    g.fillStyle = '#fff'; g.font = 'bold 80px sans-serif'; g.fillText(label2, 40, 140);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.7));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return btoa(s);
  }, [w, h, color, label]);
  return Buffer.from(b64, 'base64');
}
const PORTRAIT = { w: 540, h: 1170, jpg: [await makeJpeg(540, 1170, '#1565c0', 'DOC 1'), await makeJpeg(540, 1170, '#0d47a1', 'DOC 2')] };
const LANDSCAPE = { w: 1170, h: 540, jpg: [await makeJpeg(1170, 540, '#2e7d32', 'NGANG 1'), await makeJpeg(1170, 540, '#1b5e20', 'NGANG 2')] };
await tool.context().close();

// "Phần Android" giả của một trang điện thoại: trả ảnh cho /__cast/frame, cứ 150ms có một ảnh mới.
async function fakeCapture(page) {
  const cap = { on: false, seq: 0, src: PORTRAIT, served: 0, timer: null };
  cap.timer = setInterval(() => { if (cap.on) { cap.seq += 1; page.evaluate(() => { if (window.__phApp) window.__phApp.cast('frame'); }).catch(() => {}); } }, 150);
  await page.route('**/__cast/frame*', (route) => {
    const since = Number(new URL(route.request().url()).searchParams.get('since')) || 0;
    if (!cap.on) return route.fulfill({ status: 410, body: '' });
    if (cap.seq <= since) return route.fulfill({ status: 204, body: '' });
    cap.served += 1;
    return route.fulfill({ status: 200, contentType: 'image/jpeg', body: cap.src.jpg[cap.seq % 2],
      headers: { 'X-Cast-Seq': String(cap.seq), 'X-Cast-Width': String(cap.src.w), 'X-Cast-Height': String(cap.src.h), 'Cache-Control': 'no-store' } });
  });
  return cap;
}
const castMsgs = async (page) => (await sent(page)).filter((m) => String(m.type).indexOf('cast.') === 0);
const attr = (page, name) => page.evaluate((n) => document.documentElement.getAttribute(n), name);
const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; }, sel);
const canvasInfo = (page) => page.evaluate(() => {
  const c = document.querySelector('.cast-canvas');
  if (!c || !c.width) return { w: 0, h: 0, px: [0, 0, 0] };
  const d = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height * 0.75), 1, 1).data;
  return { w: c.width, h: c.height, px: [d[0], d[1], d[2]], fit: getComputedStyle(c).objectFit };
});
const waitFor = async (fn, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(150); } return false; };
const openSettings = async (page) => { await page.locator('.rail-settings').click(); await page.locator('.settings').waitFor(); };
// giai đoạn 17: điện thoại đã ghép đôi thì hộp hiện danh sách màn hình xe; nhập mã mới phải bấm "Thêm màn hình xe khác"
// dòng trạng thái của hộp trên điện thoại (giai đoạn 17: lỗi ở .cast-status, bước đang làm ở .cast-busy-text)
const phoneStatus = (page) => page.locator('.cast-send').evaluate((e) => [...e.querySelectorAll('.cast-status, .cast-busy-text')].filter((x) => x.getClientRects().length).map((x) => x.textContent).join(' | ')).catch(() => '');
const showCodeForm = async (page) => {
  const add = page.getByRole('button', { name: 'Thêm màn hình xe khác (nhập mã)' });
  await sleep(300);
  if (await add.isVisible()) await add.click();
  await page.locator('#cast-code').waitFor();
};
const carCode = async (page) => (await page.locator('.cast-code').textContent()).replace(/[^0-9]/g, '');
// ghi lại các RTCPeerConnection của trang để kịch bản tự làm đứt kết nối
const spyPeers = (page) => page.addInitScript(() => {
  const Real = window.RTCPeerConnection;
  window.__pcs = [];
  window.RTCPeerConnection = function (...a) { const p = new Real(...a); window.__pcs.push(p); return p; };
  window.RTCPeerConnection.prototype = Real.prototype;
});

// ---------- A. Màn hình xe lấy mã ----------
const carCtx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
const car = await carCtx.newPage();
car.on('pageerror', (e) => errors.push('xe: ' + e.message));
await car.addInitScript(installFakes, { channel: null, noSpeech: true, items: ids.map((id) => ({ id, title: titleOf(id), uploader: 'Kênh thử', duration: 30, thumbnail: PIPED + '/thumb.svg' })) });
await car.goto(ORIGIN + '/');
await car.waitForSelector('.split');
await waitPlaying(car, true);
const castBtn = car.locator('.rail-cast');
check('A1 màn hình xe có nút "Chiếu ĐT" trên thanh mục', await castBtn.isVisible() && (await castBtn.textContent()).trim() === 'Chiếu ĐT');
await castBtn.click();
await car.locator('.cast-code').waitFor();
await car.waitForFunction(() => /^[0-9]{3} [0-9]{3}$/.test(document.querySelector('.cast-code').textContent), null, { timeout: 8000 });
const code1 = await carCode(car);
check('A2 hộp ghép nối: mã 6 số thật to, đồng hồ đếm ngược, hướng dẫn 2 cách nối', code1.length === 6
  && /Mã còn hiệu lực [45]:[0-9]{2}/.test(await car.locator('.cast-code-timer').textContent())
  && (await car.locator('.cast-way').count()) === 2 && (await car.locator('.cast-steps > li').count()) === 3
  && (await car.locator('.cast-code').evaluate((e) => parseFloat(getComputedStyle(e).fontSize))) >= 48);
await car.screenshot({ path: path.join(here, 'shot-phase15-cast-code.png') });
check('A3 chưa chiếu: bố cục chưa đổi', (await attr(car, 'data-cast')) === null && (await rect(car, '.cast-pane')) === null);

// ---------- B. Điện thoại (ứng dụng Android 1.2.0) nhập mã ----------
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA_ANDROID, hasTouch: true, isMobile: true });
const phone = await phoneCtx.newPage();
phone.on('pageerror', (e) => errors.push('điện thoại: ' + e.message));
await spyPeers(phone);
await phone.addInitScript(installFakes, { channel: 'android', noSpeech: true, items: ids.map((id) => ({ id, title: titleOf(id), uploader: 'Kênh thử', duration: 30, thumbnail: PIPED + '/thumb.svg' })) });
const cap = await fakeCapture(phone);
await phone.goto(ORIGIN + '/');
await phone.waitForSelector('.split');
await waitPlaying(phone, true);
check('B1 điện thoại: thanh mục không có nút "Chiếu ĐT" (điện thoại là máy phát)', !(await phone.locator('.rail-cast').isVisible()));
await openSettings(phone);
const setCast = phone.locator('#set-cast');
check('B2 Cài đặt của ứng dụng có mục "Chiếu lên màn hình xe"', await setCast.isVisible());
await setCast.getByRole('button', { name: 'Chiếu lên màn hình xe' }).click();
const codeInput = phone.locator('#cast-code');
await codeInput.waitFor();
check('B3 ô nhập mã dùng bàn phím số', (await codeInput.getAttribute('inputmode')) === 'numeric');
const wrong = code1 === '000000' ? '111111' : '000000';
await codeInput.fill(wrong);
await phone.getByRole('button', { name: 'Kết nối' }).click();
await phone.locator('.cast-send .cast-status.error').waitFor({ timeout: 6000 }).catch(() => {});
check('B4 nhập sai mã: báo lỗi, chưa xin quyền ghi màn hình', /Mã không đúng/.test(await phoneStatus(phone)) && (await castMsgs(phone)).length === 0);
await codeInput.fill(code1);
check('B5 mã tự tách 3-3 cho dễ nhìn', (await codeInput.inputValue()) === code1.slice(0, 3) + ' ' + code1.slice(3));
await phone.getByRole('button', { name: 'Kết nối' }).click();
await waitFor(async () => (await castMsgs(phone)).length === 1);
const startMsg = (await castMsgs(phone))[0] || {};
check('B6 mã đúng: website bảo ứng dụng chụp màn hình', startMsg.type === 'cast.start' && startMsg.maxSide === 1280 && startMsg.quality === 70 && startMsg.fps === 12, JSON.stringify(startMsg));
check('B6 điện thoại nhắc chọn "Bắt đầu" ở hộp hỏi quyền của Android', /hỏi quyền ghi màn hình/.test(await phoneStatus(phone)));
await car.locator('.cast-status').filter({ hasText: 'đã nhập mã' }).waitFor({ timeout: 6000 }).catch(() => {});
check('B7 màn hình xe: báo tên điện thoại đã nhập mã, đang nối', /"SM-A546E" đã nhập mã\. Đang nối/.test(await car.locator('.cast-status').textContent()));

// Android cho phép -> ứng dụng báo 'started' và bắt đầu có ảnh
cap.on = true;
await phone.evaluate(() => window.__phApp.cast('started', { width: 540, height: 1170 }));
const live = await waitFor(async () => (await attr(car, 'data-cast')) === 'side' && (await canvasInfo(car)).w === 540, 20000);
check('C1 hai máy nối thẳng với nhau (WebRTC), màn hình xe nhận được hình', live, JSON.stringify(await canvasInfo(car)));
const ci = await canvasInfo(car);
check('C2 hình đúng kích thước điện thoại 540x1170 và đúng màu (xanh dương)', ci.w === 540 && ci.h === 1170 && ci.px[2] > 120 && ci.px[2] > ci.px[0] + 40, JSON.stringify(ci));
check('C3 hộp ghép nối tự đóng khi đã nối, lớp "đang chờ hình" biến mất khi có ảnh', (await car.locator('.cast-dialog').count()) === 0 && !(await car.locator('.cast-veil').isVisible()));
const pane = await rect(car, '.cast-pane');
const appBox = await rect(car, '.app');
const rail = await rect(car, '.rail');
const music = await rect(car, '.work-music');
const stage = await rect(car, '.cast-stage');
const radius = await car.locator('.cast-pane').evaluate((e) => getComputedStyle(e).borderTopLeftRadius);
check('C4 chia HẲN màn hình: bản đồ chiếm trọn nửa trái (sát mép, cao hết màn hình, không bo góc)', pane && pane.l === 0 && pane.t === 0 && Math.abs(pane.b - 600) <= 1 && Math.abs(pane.w - 512) <= 2 && radius === '0px', JSON.stringify({ pane, radius }));
check('C4 cả ứng dụng nghe nhạc (kể cả thanh mục) dồn sang nửa phải, không đè lên bản đồ', Math.abs(appBox.l - pane.r) <= 1 && Math.abs(appBox.r - 1024) <= 1 && rail.l >= pane.r - 1 && music.l >= rail.r - 1 && music.w > 300, JSON.stringify({ appBox, rail, music }));
check('C5 mặc định "Lấp đầy": hình phóng kín nửa màn hình, không viền đen', ci.fit === 'cover' && Math.abs(stage.w - pane.w) <= 2);
check('C6 phần nhạc thu gọn: danh sách + thanh phát nhỏ, nhạc vẫn phát', (await focusOf(car)) === 'right' && await car.locator('.minibar').isVisible() && await isPlaying(car));
check('C7 nút "Chiếu ĐT" sáng lên khi đang chiếu', (await castBtn.getAttribute('aria-pressed')) === 'true');
const fitsHalf = await car.evaluate(() => {
  const inView = (sel) => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; };
  const labels = [...document.querySelectorAll('.cast-tool:not([hidden]) .cast-tool-text')].filter((e) => e.getClientRects().length).map((e) => e.textContent);
  const t = document.querySelector('.minibar-title');
  return { play: inView('.minibar .ctl-main'), bar: inView('.minibar'), search: inView('.search-fake'), titleW: t ? Math.round(t.getBoundingClientRect().width) : 0, labels, scrollX: document.documentElement.scrollWidth <= innerWidth };
});
check('C8 nửa màn hình vẫn đủ chỗ: ô tìm kiếm, thanh phát nhỏ (thấy tên bài, nút phát), không tràn ngang; nút trên khung bản đồ có chữ', fitsHalf.play && fitsHalf.bar && fitsHalf.search && fitsHalf.titleW >= 90 && fitsHalf.scrollX && fitsHalf.labels.join('|') === 'Đổi bên|Vừa khung|Toàn màn hình|Dừng chiếu', JSON.stringify(fitsHalf));
await car.locator('.toast').filter({ hasText: 'Kéo hình' }).waitFor({ timeout: 4000 }).catch(() => {});
check('C9 lần đầu có lời nhắc "Kéo hình để chọn phần bản đồ muốn xem"', /Kéo hình để chọn phần bản đồ muốn xem/.test(await car.locator('.toast').textContent().catch(() => '')));
await phone.locator('.cast-live-title').waitFor({ timeout: 6000 }).catch(() => {});
check('C10 điện thoại: báo đang chiếu, có nút Dừng chiếu, nhắc mở bản đồ', /Đang chiếu lên (màn hình xe|"Màn hình xe")/.test(await phone.locator('.cast-live-title').textContent())
  && await phone.getByRole('button', { name: 'Dừng chiếu' }).isVisible() && /bản đồ/.test(await phone.locator('.cast-tips').textContent()));
check('C11 điện thoại tự dừng nhạc của mình khi bắt đầu chiếu', !(await isPlaying(phone)));
await car.locator('.toast').waitFor({ state: 'hidden', timeout: 9000 }).catch(() => {});
await car.screenshot({ path: path.join(here, 'shot-phase15-cast-live.png') });
await phone.screenshot({ path: path.join(here, 'shot-phase15-cast-phone.png') });
const served1 = cap.served;
await sleep(1200);
check('C12 hình cập nhật liên tục', cap.served > served1 + 3);

// ---------- D. Nút trên khung chiếu ----------
// kéo hình lên: thấy phần dưới của màn hình điện thoại
const pos0 = await car.locator('.cast-canvas').evaluate((e) => e.style.objectPosition);
await car.mouse.move(stage.l + stage.w / 2, stage.t + stage.h * 0.7);
await car.mouse.down();
await car.mouse.move(stage.l + stage.w / 2, stage.t + stage.h * 0.3, { steps: 4 });
await car.mouse.up();
const pos1 = await car.locator('.cast-canvas').evaluate((e) => e.style.objectPosition);
const yOf = (p) => parseFloat(String(p).split(' ')[1]);
check('D1 "Lấp đầy": kéo hình lên thì thấy phần dưới của màn hình điện thoại (và được nhớ)', pos0 === '50% 50%' && yOf(pos1) > 80 && (await car.evaluate(() => JSON.parse(localStorage.getItem('carweb_cast_view2')).panY)) > 0.8, `${pos0} -> ${pos1}`);
const grip = await rect(car, '.cast-grip');
await car.mouse.move(grip.l + grip.w / 2, grip.t + grip.h / 2);
await car.mouse.down();
await car.mouse.move(1024 * 0.6, grip.t + grip.h / 2, { steps: 4 });
await car.mouse.up();
const dragged = await rect(car, '.cast-pane');
check('D2 kéo vạch chia để đổi độ rộng hai bên', Math.abs(dragged.w / 1024 - 0.6) < 0.03, (dragged.w / 1024).toFixed(2));
await car.screenshot({ path: path.join(here, 'shot-phase15-cast-fill.png') });
await car.getByRole('button', { name: 'Vừa khung' }).click();
await sleep(250);
const fitPane = await rect(car, '.cast-pane');
const fitStage = await rect(car, '.cast-stage');
const want = fitStage.h * 540 / 1170;
check('D3 "Vừa khung": thấy trọn màn hình điện thoại, cột vẫn sát mép và cao hết màn hình, rộng đúng tỉ lệ máy (không viền đen)',
  (await canvasInfo(car)).fit === 'contain' && Math.abs(fitStage.w - want) <= 3 && fitPane.l === 0 && fitPane.t === 0 && Math.abs(fitPane.b - 600) <= 1, `rộng ${fitStage.w.toFixed(0)} / cần ${want.toFixed(0)}`);
await car.screenshot({ path: path.join(here, 'shot-phase15-cast-fit.png') });
// điện thoại xoay ngang (đang "Vừa khung")
cap.src = LANDSCAPE;
const turned = await waitFor(async () => (await canvasInfo(car)).w === 1170);
await sleep(300);
const wide = await rect(car, '.cast-pane');
const ci2 = await canvasInfo(car);
check('E1 điện thoại xoay ngang: khung chiếu tự rộng ra (tối đa 62%), hình xanh lá', turned && wide.w > fitPane.w + 150 && wide.w / 1024 <= 0.63 && ci2.px[1] > ci2.px[2] + 30, `${(wide.w / 1024).toFixed(2)} ${JSON.stringify(ci2.px)}`);
await car.screenshot({ path: path.join(here, 'shot-phase15-cast-landscape.png') });
cap.src = PORTRAIT;
await waitFor(async () => (await canvasInfo(car)).w === 540);
await car.getByRole('button', { name: 'Lấp đầy' }).click();
await sleep(250);
check('D4 "Lấp đầy" trở lại độ rộng đã kéo', Math.abs((await rect(car, '.cast-pane')).w / 1024 - 0.6) < 0.03 && (await canvasInfo(car)).fit === 'cover');
await car.getByRole('button', { name: 'Đổi bên' }).click();
await sleep(250);
const swapped = await rect(car, '.cast-pane');
const app2 = await rect(car, '.app');
check('D5 "Đổi bên": bản đồ sang hẳn nửa phải (sát mép phải), ứng dụng sang trái', Math.abs(swapped.r - 1024) <= 1 && app2.l === 0 && Math.abs(app2.r - swapped.l) <= 1, JSON.stringify({ swapped, app2 }));
await car.getByRole('button', { name: 'Đổi bên' }).click();
await sleep(250);
await car.locator('.cast-bar').getByRole('button', { name: 'Toàn màn hình' }).click();
await sleep(250);
const onlyPane = await rect(car, '.cast-pane');
check('D6 "Toàn màn hình": bản đồ chiếm cả màn hình, nhạc là cửa sổ nổi có nút phát/dừng', (await rect(car, '.app')) === null && Math.abs(onlyPane.w - 1024) <= 1 && await car.locator('.cast-float .ctl-main').isVisible());
await car.locator('.cast-float .ctl-main').click();
const pausedFromBar = await waitPlaying(car, false);
await car.locator('.cast-float .ctl-main').click();
check('D7 nút phát/dừng trên cửa sổ nổi điều khiển được nhạc', pausedFromBar && await waitPlaying(car, true));
await car.locator('.cast-bar').getByRole('button', { name: 'Chia đôi' }).click();
await sleep(250);
check('D8 "Chia đôi" trở lại chia đôi, cửa sổ nổi biến mất', (await rect(car, '.app')) !== null && !(await car.locator('.cast-float').isVisible()));

// ---------- F. Mất kết nối -> tự nối lại ----------
const before = await phone.evaluate(() => window.__pcs.length);
await phone.evaluate(() => { window.__pcs[window.__pcs.length - 1].close(); });
const veil = await waitFor(async () => car.locator('.cast-veil').isVisible(), 15000);
const veilText = veil ? await car.locator('.cast-veil').textContent() : '';
const back = await waitFor(async () => !(await car.locator('.cast-veil').isVisible()) && (await phone.evaluate(() => window.__pcs.length)) > before, 30000);
const servedAfter = cap.served;
await sleep(800);
check('F1 đứt kết nối: màn hình xe báo "đang nối lại", khung chiếu vẫn giữ chỗ', veil && /Đang nối lại/.test(veilText) && (await attr(car, 'data-cast')) === 'side', veilText);
check('F2 điện thoại tự mời lại, hình chạy tiếp, nhạc không bị ngắt', back && cap.served > servedAfter && await isPlaying(car));

// ---------- G. Dừng từ màn hình xe ----------
await car.getByRole('button', { name: 'Dừng chiếu' }).click();
const closed = await waitFor(async () => (await attr(car, 'data-cast')) === null);
const g1 = { closed, pane: await rect(car, '.cast-pane'), app: await rect(car, '.app'), focus: await focusOf(car), playing: await isPlaying(car), pressed: await castBtn.getAttribute('aria-pressed') };
check('G1 màn hình xe bấm "Dừng chiếu": ứng dụng trở lại toàn màn hình như trước, nhạc vẫn phát', g1.closed && g1.pane === null && g1.app.l === 0 && Math.abs(g1.app.w - 1024) <= 1 && !g1.focus && g1.playing && g1.pressed === 'false', JSON.stringify(g1));
const told = await waitFor(async () => /Màn hình xe đã dừng chiếu/.test(await phoneStatus(phone)));
const msgs = await castMsgs(phone);
check('G2 điện thoại biết ngay và bảo ứng dụng ngừng chụp', told && msgs[msgs.length - 1].type === 'cast.stop', JSON.stringify(msgs.map((m) => m.type)));
cap.on = false;

// ---------- H. Lần 2: dừng từ điện thoại ----------
await castBtn.click();
await car.waitForFunction((old) => { const e = document.querySelector('.cast-code'); return e && /^[0-9]{3} [0-9]{3}$/.test(e.textContent) && e.textContent.replace(' ', '') !== old; }, code1, { timeout: 8000 });
const code2 = await carCode(car);
check('H1 lần sau lấy mã mới (mã cũ không dùng lại)', code2.length === 6 && code2 !== code1);
await showCodeForm(phone);
await codeInput.fill(code1);
await phone.getByRole('button', { name: 'Kết nối' }).click();
await waitFor(async () => /Mã không đúng/.test(await phoneStatus(phone)));
check('H2 mã cũ đã dùng thì bị từ chối', /Mã không đúng/.test(await phoneStatus(phone)));
await codeInput.fill(code2);
await phone.getByRole('button', { name: 'Kết nối' }).click();
await waitFor(async () => (await castMsgs(phone)).filter((m) => m.type === 'cast.start').length === 2);
cap.on = true;
await phone.evaluate(() => window.__phApp.cast('started', { width: 540, height: 1170 }));
check('H3 nối lại lần 2', await waitFor(async () => (await attr(car, 'data-cast')) === 'side' && (await canvasInfo(car)).w === 540, 20000));
await phone.getByRole('button', { name: 'Dừng chiếu' }).click();
const carClosed = await waitFor(async () => (await attr(car, 'data-cast')) === null);
check('H4 điện thoại bấm "Dừng chiếu": màn hình xe trở lại bình thường và báo "Điện thoại đã dừng chiếu"', carClosed && /Điện thoại đã dừng chiếu/.test(await car.locator('.toast').textContent()));
await phone.locator('.cast-pair-go').first().waitFor({ timeout: 6000 }).catch(() => {});
check('H5 điện thoại trở về danh sách màn hình xe đã ghép đôi (giai đoạn 17), ứng dụng được bảo ngừng chụp', await phone.locator('.cast-pair-go').first().isVisible() && (await castMsgs(phone)).pop().type === 'cast.stop');
cap.on = false;

// ---------- I. Người dùng không cho ghi màn hình ----------
await castBtn.click();
await car.waitForFunction((old) => { const e = document.querySelector('.cast-code'); return e && /^[0-9]{3} [0-9]{3}$/.test(e.textContent) && e.textContent.replace(' ', '') !== old; }, code2, { timeout: 8000 });
const code3 = await carCode(car);
await showCodeForm(phone);
await codeInput.fill(code3);
await phone.getByRole('button', { name: 'Kết nối' }).click();
await waitFor(async () => (await castMsgs(phone)).filter((m) => m.type === 'cast.start').length === 3);
await phone.evaluate(() => window.__phApp.cast('denied'));
await waitFor(async () => /chưa cho phép ghi màn hình/.test(await phoneStatus(phone)));
check('I1 từ chối quyền: điện thoại giải thích và cho thử lại', /chưa cho phép ghi màn hình/.test(await phoneStatus(phone)) && await codeInput.isEnabled());
const renewed = await waitFor(async () => { const t = await car.locator('.cast-code').textContent().catch(() => ''); return /^[0-9]{3} [0-9]{3}$/.test(t) && t.replace(' ', '') !== code3; }, 10000);
check('I2 màn hình xe tự hiện mã mới kèm lời nhắc', renewed && /Điện thoại đã hủy/.test(await car.locator('.cast-notice').textContent()));
await car.keyboard.press('Escape');
await sleep(300);
check('I3 đóng hộp ghép nối: hủy chờ, bố cục không đổi', (await car.locator('.cast-dialog').count()) === 0 && (await attr(car, 'data-cast')) === null);
clearInterval(cap.timer);
await phoneCtx.close();
await carCtx.close();

// ---------- J. Màn hình xe nhỏ 800x480 đang chiếu ----------
{
  const c2 = await browser.newContext({ viewport: { width: 800, height: 480 } });
  const car2 = await c2.newPage();
  car2.on('pageerror', (e) => errors.push('xe 800: ' + e.message));
  await car2.addInitScript(installFakes, { channel: null, noSpeech: true, items: ids.map((id) => ({ id, title: titleOf(id), uploader: 'Kênh thử', duration: 30, thumbnail: PIPED + '/thumb.svg' })) });
  await car2.goto(ORIGIN + '/');
  await car2.waitForSelector('.split');
  await car2.locator('.rail-cast').click();
  await car2.waitForFunction(() => { const e = document.querySelector('.cast-code'); return e && /^[0-9]{3} [0-9]{3}$/.test(e.textContent); }, null, { timeout: 8000 });
  const codeJ = await carCode(car2);
  const p2 = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA_ANDROID, hasTouch: true, isMobile: true });
  const phone2 = await p2.newPage();
  await phone2.addInitScript(installFakes, { channel: 'android', noSpeech: true, items: [] });
  const cap2 = await fakeCapture(phone2);
  await phone2.goto(ORIGIN + '/');
  await phone2.waitForSelector('.split');
  await openSettings(phone2);
  await phone2.locator('#set-cast').getByRole('button', { name: 'Chiếu lên màn hình xe' }).click();
  await phone2.locator('#cast-code').fill(codeJ);
  await phone2.getByRole('button', { name: 'Kết nối' }).click();
  await waitFor(async () => (await castMsgs(phone2)).length === 1);
  cap2.on = true;
  await phone2.evaluate(() => window.__phApp.cast('started', { width: 540, height: 1170 }));
  const liveJ = await waitFor(async () => (await attr(car2, 'data-cast')) === 'side' && (await canvasInfo(car2)).w === 540, 20000);
  await sleep(500);
  const j = await car2.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
    const tools = [...document.querySelectorAll('.cast-tool:not([hidden])')].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
    return { pane: r('.cast-pane'), app: r('.app'), mini: r('.minibar'), play: r('.minibar .ctl-main'), search: r('.search-fake'), rail: r('.rail'), settings: r('.rail-settings'),
      rows: [...document.querySelectorAll('.vrow')].filter((e) => { const b = e.getBoundingClientRect(); return b.height > 0 && b.top >= 0 && b.bottom <= r('.minibar').t; }).length, thumbW: (r('.vthumb') || { w: 0 }).w, titleW: (r('.minibar-title') || { w: 0 }).w,
      toolMin: Math.min(...tools.map((b) => Math.min(b.width, b.height))), toolsIn: tools.every((b) => b.left >= 0 && b.right <= 401 && b.bottom <= 481), scrollX: document.documentElement.scrollWidth <= innerWidth };
  });
  check('J1 màn hình 800x480: vẫn chia đúng hai nửa 400/400, cao hết màn hình', liveJ && j.pane.l === 0 && Math.abs(j.pane.w - 400) <= 2 && Math.abs(j.pane.h - 480) <= 1 && Math.abs(j.app.w - 400) <= 2, JSON.stringify({ pane: j.pane, app: j.app }));
  check('J2 màn hình 800x480: nút trên khung bản đồ đủ lớn để bấm (từ 40px) và nằm trong khung', j.toolMin >= 40 && j.toolsIn, String(j.toolMin));
  check('J3 màn hình 800x480: nửa ứng dụng không tràn - thanh mục, ô tìm kiếm, thanh phát nhỏ đều nằm trong màn hình', j.scrollX && j.mini && j.mini.r <= 801 && j.mini.b <= 481 && j.play.r <= 801 && j.search && j.search.r <= 801 && j.settings.b <= 481, JSON.stringify({ mini: j.mini, settings: j.settings }));
  check('J4 màn hình 800x480: danh sách xếp dòng gọn (thấy từ 2 bài trở lên), thanh phát nhỏ đọc được tên bài', j.rows >= 2 && j.thumbW <= 110 && j.titleW >= 90, JSON.stringify({ rows: j.rows, thumbW: j.thumbW, titleW: j.titleW }));
  await car2.locator('.toast').waitFor({ state: 'hidden', timeout: 9000 }).catch(() => {});
  await car2.screenshot({ path: path.join(here, 'shot-phase15-cast-live-800x480.png') });
  clearInterval(cap2.timer);
  await p2.close();
  await c2.close();
}

// ---------- K. Máy không phát hình được thì không có mục trong Cài đặt; màn hình 800x480 ----------
for (const [name, ua, channel] of [['ứng dụng Android 1.1.0', UA_OLD.replace('1.0.0', '1.1.0'), 'android'], ['ứng dụng iPhone 1.2.0', UA_IOS, 'ios'], ['trình duyệt thường', null, null]]) {
  const o = await open({ ua, channel, viewport: { width: 390, height: 844 } });
  await openSettings(o.page);
  check(`K1 ${name}: Cài đặt không có mục "Chiếu lên màn hình xe"`, (await o.page.locator('#set-cast').count()) === 0);
  await o.ctx.close();
}
const small = await open({ viewport: { width: 800, height: 480 } });
const fits = await small.page.evaluate(() => { const r = document.querySelector('.rail'); const b = document.querySelector('.rail-cast').getBoundingClientRect(); const s = document.querySelector('.rail-settings').getBoundingClientRect(); return { cast: b.bottom <= s.top + 1 && b.height >= 44, settings: s.bottom <= innerHeight + 1, scroll: r.scrollHeight <= r.clientHeight + 1 }; });
check('K2 màn hình 800x480: thanh mục vẫn đủ chỗ cho nút "Chiếu ĐT", không bị cắt', fits.cast && fits.settings && fits.scroll, JSON.stringify(fits));
await small.page.locator('.rail-cast').click();
await small.page.locator('.cast-code').waitFor();
await small.page.waitForFunction(() => /^[0-9]{3} [0-9]{3}$/.test(document.querySelector('.cast-code').textContent), null, { timeout: 8000 });
const dlg = await rect(small.page, '.cast-dialog');
check('K3 màn hình 800x480: hộp ghép nối nằm gọn trong màn hình', dlg.t >= 0 && dlg.b <= 481 && dlg.w <= 800);
await small.page.screenshot({ path: path.join(here, 'shot-phase15-cast-code-800x480.png') });
await small.ctx.close();
await browser.close();

check('không có lỗi JavaScript nào', errors.length === 0, errors.slice(0, 3).join(' | '));
check('PHP không báo lỗi/cảnh báo nào', !/Warning|Fatal|Notice|Deprecated/.test(phpErr), phpErr.split('\n').filter((l) => /Warning|Fatal|Notice|Deprecated/.test(l)).slice(0, 2).join(' '));
console.log(failures ? `\nCÓ ${failures} MỤC CHƯA ĐẠT` : '\nTẤT CẢ ĐẠT');
process.exit(failures ? 1 : 0);
