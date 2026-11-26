import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');

// Giai đoạn 17 (đợt 2), trên PHP THẬT và Chromium thật: GHÉP ĐÔI MỘT LẦN, lần sau bấm "Chia sẻ" là chiếu.
//  P. Lần đầu: nút "Chia sẻ" ở thanh dưới của điện thoại -> chưa ghép đôi thì hiện ô nhập mã -> nhập mã -> chiếu; hai máy nhớ nhau.
//  S. Lần sau: bấm "Chia sẻ" -> Android hỏi quyền -> màn hình xe TỰ nhận (không mã, không bấm gì trên xe) -> chia đôi.
//     Màn hình xe chỉ hỏi máy chủ khi đã ghép đôi, ~3 giây/lần, đang chiếu thì thôi hỏi.
//  M. Nhiều xe: danh sách để chọn; xe không mở PH Car Play thì điện thoại báo rõ sau 30 giây.
//  Q. "Quên thiết bị" ở màn hình xe và ở điện thoại (xóa mềm); bên kia hết thấy, màn hình xe thôi hỏi.
// (Dưới đây là phần đầu của e2e19 cho giai đoạn 17 đợt 1, giữ nguyên để dùng chung máy chủ giả.)
// Giai đoạn 17 (đợt 1), trên PHP THẬT và Chromium thật:
//  V. Micro: bấm micro thì tạm dừng nhạc, tìm xong thì phát tiếp đúng bài, đúng chỗ (máy chủ trả kết quả chậm để thấy rõ
//     "đang tìm vẫn dừng"); không nghe thấy gì / đóng hộp thì phát lại ngay; Thử lại; tìm lỗi; đang dừng sẵn thì để yên;
//     người dùng tự bấm phát / đổi bài trong lúc nghe thì không đụng vào; micro ở Trang chủ.
//     Nhận giọng nói là lớp SpeechRecognition GIẢ (Chromium chạy nền không có micro).
//  F. Màn hình xe "Toàn màn hình" khi đang chiếu điện thoại (HAI trang nối WebRTC thật như e2e17): hình điện thoại chiếm cả
//     màn hình, nhạc thành cửa sổ nổi (thẻ video được chuyển vào, KHÔNG tải lại, nhạc không ngắt), ⏮ ⏯ ⏭, kéo + dính góc,
//     không kéo ra ngoài, không kéo nhầm bản đồ, thu nhỏ thành bong bóng, nhớ góc, Chia đôi trả video về trình phát,
//     Vừa khung/Lấp đầy, điện thoại xoay ngang, dừng chiếu khi đang toàn màn hình.
//  E. Bài phát bằng trình phát YouTube nhúng (iframe_api GIẢ): cửa sổ nổi hiện ảnh bìa, khung YouTube không bị chuyển chỗ
//     (không tải lại), nút phát/dừng vẫn điều khiển được.
//  J. Màn hình xe 800x480 chạy ứng dụng Android: cửa sổ nổi gọn (bỏ phần hình), nút Quay lại thoát "Toàn màn hình".
// KHÔNG thử được: micro và nhận giọng nói thật, YouTube thật, điện thoại/màn hình xe thật, WebView Android cũ.
const PUBLIC_DIR = process.env.PUBLIC_DIR;
if (!PUBLIC_DIR) { console.error('Cần đặt PUBLIC_DIR=/duong/dan/den/public'); process.exit(2); }
const PROJECT = path.dirname(PUBLIC_DIR);
const here = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.env.PORT || 8089);
const PIPED_PORT = Number(process.env.PIPED_PORT || 8142);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PIPED = `http://localhost:${PIPED_PORT}`;
const DB = path.join(os.tmpdir(), `carweb-e2e20-${process.pid}.sqlite`);
const MASTER = { email: 'master@test.local', pass: 'Master-12345' };
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 PHCarPlayApp/1.2.0 (Android)';

let failures = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Máy chủ giả: Piped (bài thường), một bài chỉ phát được bằng trình phát YouTube, iframe_api GIẢ ----------
const clip = fs.readFileSync(path.join(here, 'clip.webm'));
const thumb = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#2a6"/></svg>');
const RUN = ('v' + process.pid.toString(36) + 'zzzzzzzzzz').slice(0, 10);
const ids = [RUN + '1', RUN + '2', RUN + '3'];
const EMB = RUN + 'E';                         // Piped trả lời nhưng không có luồng nào -> máy chủ cho phát bằng YouTube nhúng
const titleOf = (id) => 'Bài ' + id;
const pItem = (id) => ({ type: 'stream', url: '/watch?v=' + id, title: titleOf(id), uploaderName: 'Kênh thử', duration: 30, thumbnail: PIPED + '/thumb.svg', views: 1000, uploaded: Date.now() - 86400000 });
const fakeIframeApi = `(function(){
  window.__ytLog=[]; window.__ytLoads=0; window.__ytPlayers=0;
  function Player(el, o){ var s=this; window.__ytPlayers++; window.__ytLast=s; this.o=o; this.id=o.videoId; this.t=0; this.timer=null; this.state=-1;
    var f=document.createElement('iframe'); f.src='about:blank'; f.className='yt-fake'; f.addEventListener('load', function(){ window.__ytLoads++; });
    el.parentNode.replaceChild(f, el); setTimeout(function(){ o.events.onReady({target:s}); }, 30); }
  Player.prototype.set=function(st){ this.state=st; this.o.events.onStateChange({data:st}); };
  Player.prototype.playVideo=function(){ var s=this; window.__ytLog.push('play:'+this.id); clearInterval(this.timer);
    setTimeout(function(){ s.set(1); s.timer=setInterval(function(){ s.t+=0.2; }, 200); }, 30); };
  Player.prototype.loadVideoById=function(id){ clearInterval(this.timer); this.id=id; this.t=0; this.playVideo(); };
  Player.prototype.pauseVideo=function(){ window.__ytLog.push('pause:'+this.id); clearInterval(this.timer); this.set(2); };
  Player.prototype.stopVideo=function(){ clearInterval(this.timer); };
  ['seekTo','mute','unMute','destroy','cueVideoById'].forEach(function(m){ Player.prototype[m]=function(){}; });
  Player.prototype.isMuted=function(){ return false; };
  Player.prototype.getCurrentTime=function(){ return this.t; }; Player.prototype.getDuration=function(){ return 200; };
  Player.prototype.getVideoData=function(){ return { video_id: this.id, title: '', author: '' }; };
  window.YT={Player:Player}; if (typeof window.onYouTubeIframeAPIReady==='function') window.onYouTubeIframeAPIReady();
})();`;
const piped = http.createServer((req, res) => {
  const u = new URL(req.url, PIPED);
  const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/search') return json({ items: ids.map(pItem), nextpage: null });
  if (u.pathname === '/trending') return json(ids.map(pItem));
  if (u.pathname === '/suggestions') return json([]);
  if (u.pathname.startsWith('/streams/')) {
    const id = u.pathname.slice('/streams/'.length);
    if (id === EMB) return json({ title: titleOf(id), uploader: 'Kênh thử', duration: 200, thumbnailUrl: PIPED + '/thumb.svg', livestream: false, hls: null, videoStreams: [], audioStreams: [], relatedStreams: [] });
    return json({ title: titleOf(id), uploader: 'Kênh thử', duration: 30, thumbnailUrl: PIPED + '/thumb.svg', livestream: false, hls: null,
      videoStreams: [{ url: PIPED + '/clip.webm', mimeType: 'video/webm', quality: '360p', height: 360, videoOnly: false, bitrate: 1 }],
      audioStreams: [], relatedStreams: ids.map(pItem) });
  }
  if (u.pathname.startsWith('/yt/')) return json({});
  if (u.pathname === '/iframe_api') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(fakeIframeApi); }
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
    YOUTUBE_EMBED: 'true', YOUTUBE_IFRAME_API_URL: PIPED + '/iframe_api', YOUTUBE_WEB_BASE: PIPED + '/yt', YOUTUBE_SUGGEST_URL: PIPED + '/yt/suggest',
    YOUTUBE_KEY_HINT: 'false', MUSIC_QUERY: 'nhạc e2e20 ' + RUN },
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

// Chạy TRƯỚC mã của website: kênh ứng dụng giả, nhận giọng nói GIẢ (hoặc bỏ hẳn), ghi lại các hành động Media Session, playlist có sẵn.
function installFakes(o) {
  window.__sent = [];
  const rec = (s) => { window.__sent.push(JSON.parse(s)); };
  if (o.channel === 'android') window.PHCarPlayNative = { postMessage: rec };
  ['webkitSpeechRecognition', 'SpeechRecognition'].forEach((k) => {
    try { delete window[k]; } catch (e) { /* bỏ qua */ }
    try { if (window[k]) Object.defineProperty(window, k, { value: undefined, configurable: true, writable: true }); } catch (e) { /* bỏ qua */ }
  });
  if (o.fakeSpeech) {
    window.__recs = [];
    const FakeRec = function () { this.lang = ''; this.onresult = null; this.onerror = null; this.onend = null; this.aborted = false; window.__recs.push(this); };
    FakeRec.prototype.start = function () { this.started = true; };
    FakeRec.prototype.stop = function () { const s = this; setTimeout(() => { if (s.onend) s.onend(); }, 0); };
    FakeRec.prototype.abort = function () { this.aborted = true; const s = this; setTimeout(() => { if (s.onend) s.onend(); }, 0); };
    window.SpeechRecognition = FakeRec;
    window.webkitSpeechRecognition = FakeRec;
    window.__say = (t) => { const r = window.__recs[window.__recs.length - 1]; const one = [{ transcript: t }]; one.isFinal = true; r.onresult({ resultIndex: 0, results: [one] }); };
    window.__fail = (code) => { const r = window.__recs[window.__recs.length - 1]; r.onerror({ error: code }); if (r.onend) r.onend(); };
  }
  window.__ms = {};
  try {
    const ms = navigator.mediaSession;
    const real = ms.setActionHandler.bind(ms);
    ms.setActionHandler = (a, fn) => { window.__ms[a] = fn; try { real(a, fn); } catch (e) { /* bỏ qua */ } };
  } catch (e) { /* bỏ qua */ }
  try {
    localStorage.setItem('carweb_guest', '1');
    localStorage.setItem('carweb_playlists', JSON.stringify({ playlists: [{ id: 'l1', name: 'Thử', items: o.items, updated_at: '2026-01-01T00:00:00Z' }] }));
  } catch (e) { /* bỏ qua */ }
}
const ITEMS = ids.concat([EMB]).map((id) => ({ id, title: titleOf(id), uploader: 'Kênh thử', duration: 30, thumbnail: PIPED + '/thumb.svg' }));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--allow-loopback-in-peer-connection', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
const errors = [];
const VIDEO = 'video.media-video';
const isPlaying = (page) => page.evaluate((s) => { const v = document.querySelector(s); return Boolean(v && !v.paused && v.readyState > 1); }, VIDEO);
const waitPlaying = (page, want = true, ms = 8000) => page.waitForFunction(([s, w]) => { const v = document.querySelector(s); return Boolean(v && !v.paused && v.readyState > 1) === w; }, [VIDEO, want], { timeout: ms }).then(() => true, () => false);
const time = (page) => page.evaluate((s) => document.querySelector(s).currentTime, VIDEO);
const nowTitle = (page) => page.evaluate(() => (document.querySelector('.now-title') || {}).textContent || '');
const overlays = (page) => page.locator('.overlay').count();
const railBtn = (page, name) => page.locator('.rail').getByRole('button', { name, exact: true });
const activeView = (page) => page.evaluate(() => { const v = document.querySelector('.view:not([hidden])'); return v ? v.getAttribute('data-view') : ''; });
const sent = (page) => page.evaluate(() => window.__sent.slice());
const castMsgs = async (page) => (await sent(page)).filter((m) => String(m.type).indexOf('cast.') === 0);
const attr = (page, name) => page.evaluate((n) => document.documentElement.getAttribute(n), name);
const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; }, sel);
const near = (a, b, d = 2) => Math.abs(a - b) <= d;
const waitFor = async (fn, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(150); } return false; };
const openSettings = async (page) => { await page.locator('.rail-settings').click(); await page.locator('.settings').waitFor(); };
const carCode = async (page) => (await page.locator('.cast-code').textContent()).replace(/[^0-9]/g, '');
const canvasInfo = (page) => page.evaluate(() => { const c = document.querySelector('.cast-canvas'); return c && c.width ? { w: c.width, h: c.height, fit: getComputedStyle(c).objectFit, pos: c.style.objectPosition } : { w: 0, h: 0 }; });
const floatState = (page) => page.evaluate(() => {
  const f = document.querySelector('.cast-float');
  if (!f || f.hidden) return null;
  const vis = (s) => { const e = f.querySelector(s); return Boolean(e && e.getClientRects().length); };
  return { corner: f.dataset.corner, kind: f.dataset.kind, min: f.hasAttribute('data-min'), compact: f.hasAttribute('data-compact'),
    video: Boolean(f.querySelector('video.media-video')), card: vis('.cast-float-card'), bubble: vis('.cast-float-bubble'), media: vis('.cast-float-media'),
    art: vis('.cast-float-art'), title: (f.querySelector('.cast-float-title') || {}).textContent, play: (f.querySelector('.ctl-main') || { getAttribute: () => '' }).getAttribute('aria-label'),
    prefs: localStorage.getItem('carweb_cast_float') };
});
// đếm sự kiện "tải lại" của thẻ video (loadstart / emptied / abort) và "pause" để chắc việc chuyển chỗ không làm gián đoạn
const watchVideo = (page) => page.evaluate((s) => {
  const v = document.querySelector(s);
  v.currentTime = 1;   // còn nhiều thời gian trước khi hết bài (bài thử dài 30 giây)
  window.__vev = { loadstart: 0, emptied: 0, abort: 0, pause: 0 };
  if (!window.__vevOn) { window.__vevOn = true; Object.keys(window.__vev).forEach((k) => v.addEventListener(k, () => { window.__vev[k]++; })); }
  window.__vsrc = v.currentSrc;
}, VIDEO);
const videoEvents = (page) => page.evaluate(() => Object.assign({ same: document.querySelector('video.media-video').currentSrc === window.__vsrc }, window.__vev));
// kéo bằng chuột: từ (x1,y1) tới (x2,y2) qua nhiều bước; mid(): gọi giữa chừng (trước khi thả)
async function drag(page, x1, y1, x2, y2, mid = null) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 5 });
  const m = mid ? await mid() : null;
  await page.mouse.up();
  await sleep(450);   // chờ trượt vào góc
  return m;
}

// ---------- Ảnh JPEG giả cho "màn hình điện thoại" ----------
const tool = await (await browser.newContext()).newPage();
async function makeJpeg(w, h, color, label) {
  const b64 = await tool.evaluate(async ([w2, h2, color2, label2]) => {
    const c = document.createElement('canvas');
    c.width = w2; c.height = h2;
    const g = c.getContext('2d');
    g.fillStyle = color2; g.fillRect(0, 0, w2, h2);
    g.fillStyle = '#fff'; g.font = 'bold 80px sans-serif'; g.fillText(label2, 40, 140);
    g.fillStyle = '#ffeb3b'; g.beginPath(); g.arc(w2 / 2, h2 * 0.6, Math.min(w2, h2) / 10, 0, Math.PI * 2); g.fill();
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.7));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return btoa(s);
  }, [w, h, color, label]);
  return Buffer.from(b64, 'base64');
}
const PORTRAIT = { w: 540, h: 1170, jpg: [await makeJpeg(540, 1170, '#1565c0', 'BAN DO'), await makeJpeg(540, 1170, '#0d47a1', 'BAN DO')] };
const LANDSCAPE = { w: 1170, h: 540, jpg: [await makeJpeg(1170, 540, '#2e7d32', 'NGANG'), await makeJpeg(1170, 540, '#1b5e20', 'NGANG')] };
await tool.context().close();
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


const UA_CAR1 = 'Mozilla/5.0 (Linux; Android 10; TS10 Build/QP1A.190711.020) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const UA_CAR2 = 'Mozilla/5.0 (Linux; Android 12; UIS7862S) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ITEMS3 = ITEMS.slice(0, 3);
// đếm yêu cầu của màn hình xe tới máy chủ (hỏi lời mời / tạo mã)
function countRequests(page) {
  const c = { incoming: 0, sessions: 0 };
  page.on('request', (r) => {
    const u = r.url();
    if (u.indexOf('/api/cast/incoming') >= 0) c.incoming += 1;
    if (u.indexOf('/api/cast/sessions') >= 0 && r.method() === 'POST' && !/\/cast\/sessions\/\d+\//.test(u)) c.sessions += 1;
  });
  return c;
}
async function openCar(ua, w = 1024, h = 600) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, userAgent: ua });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('xe: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errors.push('xe console: ' + m.text()); });
  await page.addInitScript(installFakes, { channel: null, fakeSpeech: false, items: ITEMS3 });
  const req = countRequests(page);
  await page.goto(ORIGIN + '/');
  await page.waitForSelector('.split');
  return { ctx, page, req };
}
const showCodeForm = async (page) => {
  const add = page.getByRole('button', { name: 'Thêm màn hình xe khác (nhập mã)' });
  if (await add.isVisible()) await add.click();
  await page.locator('#cast-code').waitFor();
};
const getCode = async (page) => {
  await page.locator('.rail-cast').click();
  await page.waitForFunction(() => { const e = document.querySelector('.cast-code'); return e && /^[0-9]{3} [0-9]{3}$/.test(e.textContent); }, null, { timeout: 8000 });
  return carCode(page);
};
const live = (page) => waitFor(async () => (await attr(page, 'data-cast')) === 'side' && (await canvasInfo(page)).w > 0, 20000);
const stoppedCast = (page) => waitFor(async () => (await attr(page, 'data-cast')) === null, 10000);
const phoneStatus = (page) => page.locator('.cast-send').evaluate((e) => [...e.querySelectorAll('.cast-status, .cast-busy-text')].filter((x) => x.getClientRects().length).map((x) => x.textContent).join(' | ')).catch(() => '');
const pairNames = (page) => page.evaluate(() => [...document.querySelectorAll('.cast-pairs .cast-pair-name')].filter((x) => x.getClientRects().length).map((x) => x.textContent));
const devKey = (page) => page.evaluate(() => localStorage.getItem('carweb_cast_device'));
const apiPairs = (page) => page.evaluate(async () => { const r = await fetch('/api/cast/pairs', { headers: { 'X-Cast-Device': localStorage.getItem('carweb_cast_device') } }); return (await r.json()).data.pairs; });

// =====================================================================
// P. Lần đầu: ghép đôi bằng mã
// =====================================================================
const c1 = await openCar(UA_CAR1);
const car = c1.page;
await waitPlaying(car, true);
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA_ANDROID, hasTouch: true, isMobile: true });
const phone = await phoneCtx.newPage();
phone.on('pageerror', (e) => errors.push('điện thoại: ' + e.message));
await phone.addInitScript(installFakes, { channel: 'android', fakeSpeech: false, items: ITEMS3 });
const cap = await fakeCapture(phone);
await phone.goto(ORIGIN + '/');
await phone.waitForSelector('.split');
await waitPlaying(phone, true);
const shareBtn = phone.locator('.rail-share');
const barItems = await phone.evaluate(() => [...document.querySelectorAll('.rail .rail-item')].filter((b) => b.getClientRects().length).map((b) => b.textContent.trim()));
check('P1 điện thoại (ứng dụng Android): thanh dưới có nút "Chia sẻ" thay chỗ nút Sáng/Tối, vẫn 6 nút', await shareBtn.isVisible() && barItems.length === 6 && barItems.indexOf('Chia sẻ') >= 0 && !(await phone.locator('.rail-theme').isVisible()), barItems.join('|'));
check('P1 màn hình xe (trình duyệt): có "Chiếu ĐT", không có "Chia sẻ", vẫn có nút Sáng/Tối', await car.locator('.rail-cast').isVisible() && (await car.locator('.rail-share').count()) === 0 && await car.locator('.rail-theme').isVisible());
await phone.screenshot({ path: path.join(here, 'shot-phase17-phone-share-button.png') });
await sleep(3500);
check('P2 màn hình xe CHƯA ghép đôi: không hỏi máy chủ lời mời nào', c1.req.incoming === 0, `incoming=${c1.req.incoming}`);
const code1 = await getCode(car);
check('P3 hộp mã của màn hình xe: chưa có mục "Điện thoại đã ghép đôi"; hướng dẫn nói lần sau không cần mã', !(await car.locator('.cast-paired').isVisible()) && /Lần sau không cần mã/.test(await car.locator('.cast-steps').textContent()));
await shareBtn.click();
await phone.locator('#cast-code').waitFor();
check('P4 điện thoại bấm "Chia sẻ" lần đầu: hiện ô nhập mã (chưa ghép đôi màn hình xe nào), con trỏ ở ô mã', await phone.locator('#cast-code').isVisible()
  && await phone.evaluate(() => document.activeElement && document.activeElement.id === 'cast-code') && /Lần sau chỉ cần bấm/.test(await phone.locator('.cast-join').textContent()));
await phone.locator('#cast-code').fill(code1);
await phone.getByRole('button', { name: 'Kết nối' }).click();
await waitFor(async () => (await castMsgs(phone)).length === 1);
cap.on = true;
await phone.evaluate(() => window.__phApp.cast('started', { width: 540, height: 1170 }));
check('P5 nhập mã + Android cho phép: màn hình xe chia đôi và hiện màn hình điện thoại', await live(car));
const pp = await apiPairs(phone);
const cp = await apiPairs(car);
check('P6 hai máy đã ghép đôi: điện thoại thấy "TS10", màn hình xe thấy "SM-A546E"; màn hình xe ghi nhớ đã ghép đôi', pp.length === 1 && pp[0].name === 'TS10' && pp[0].role === 'sender'
  && cp.length === 1 && cp[0].name === 'SM-A546E' && cp[0].role === 'receiver' && (await car.evaluate(() => localStorage.getItem('carweb_cast_paired'))) === '1', JSON.stringify({ pp, cp }));
check('P7 khóa thiết bị 48 ký tự hex, mỗi máy một khóa riêng', /^[a-f0-9]{48}$/.test(await devKey(phone)) && /^[a-f0-9]{48}$/.test(await devKey(car)) && (await devKey(phone)) !== (await devKey(car)));
const pollsDuringLive0 = c1.req.incoming;
await sleep(5000);
check('P8 đang chiếu: màn hình xe không hỏi lời mời', c1.req.incoming === pollsDuringLive0, `${pollsDuringLive0} -> ${c1.req.incoming}`);
await phone.getByRole('button', { name: 'Dừng chiếu' }).click();
await stoppedCast(car);
cap.on = false;
await phone.locator('.cast-pairs .cast-pair-go').first().waitFor({ timeout: 6000 }).catch(() => {});
check('P9 dừng chiếu: hộp trên điện thoại hiện danh sách màn hình xe đã ghép đôi ("TS10")', (await pairNames(phone)).join('|') === 'TS10');
await phone.keyboard.press('Escape');
const before = c1.req.incoming;
await sleep(7200);
const polled = c1.req.incoming - before;
check('P10 màn hình xe đã ghép đôi, đang rảnh: hỏi lời mời ~3 giây/lần', polled >= 2 && polled <= 4, `${polled} lần trong 7,2 giây`);

// =====================================================================
// S. Lần sau: bấm "Chia sẻ" là chiếu
// =====================================================================
const sessionsBefore = c1.req.sessions;
const msgsBefore = (await castMsgs(phone)).length;
await shareBtn.click();
const started = await waitFor(async () => (await castMsgs(phone)).length === msgsBefore + 1, 6000);
const startMsg = (await castMsgs(phone)).pop();
check('S1 bấm "Chia sẻ" (đã ghép đôi đúng 1 màn hình xe): Android hỏi quyền NGAY, không phải chọn hay nhập gì', started && startMsg.type === 'cast.start' && /hỏi quyền ghi màn hình/.test(await phoneStatus(phone)), JSON.stringify(startMsg));
cap.on = true;
const t0 = Date.now();
await phone.evaluate(() => window.__phApp.cast('started', { width: 540, height: 1170 }));
const toastSeen = await car.locator('.toast').filter({ hasText: 'đang chia sẻ màn hình' }).waitFor({ timeout: 8000 }).then(() => true, () => false);
const gotLive = await live(car);
const took = (Date.now() - t0) / 1000;
check('S2 cho phép xong: màn hình xe TỰ nhận (báo "SM-A546E đang chia sẻ màn hình"), chia đôi, có hình - không cần mã, không bấm gì trên xe',
  toastSeen && gotLive && took < 10 && c1.req.sessions === sessionsBefore && (await car.locator('.cast-dialog').count()) === 0, `${took.toFixed(1)} giây`);
await phone.locator('.cast-live').waitFor({ timeout: 6000 }).catch(() => {});
check('S3 điện thoại: "Đang chiếu lên "TS10"", nút Chia sẻ sáng lên', /Đang chiếu lên "TS10"/.test(await phone.locator('.cast-live-title').textContent()) && (await shareBtn.getAttribute('aria-pressed')) === 'true');
await phone.screenshot({ path: path.join(here, 'shot-phase17-phone-sharing.png') });
await phone.keyboard.press('Escape');
await shareBtn.click();
await phone.locator('.cast-live').waitFor({ timeout: 4000 }).catch(() => {});
check('S4 đang chiếu mà bấm "Chia sẻ": chỉ mở trạng thái + nút Dừng chiếu (không chia sẻ lần nữa)', await phone.getByRole('button', { name: 'Dừng chiếu' }).isVisible() && (await castMsgs(phone)).length === msgsBefore + 1);
// màn hình xe bấm "Dừng chiếu"
await car.locator('.cast-bar').getByRole('button', { name: 'Dừng chiếu' }).click();
await stoppedCast(car);
const told = await waitFor(async () => /Màn hình xe đã dừng chiếu/.test(await phoneStatus(phone)));
check('S5 màn hình xe dừng: điện thoại báo "Màn hình xe đã dừng chiếu", ngừng chụp, hiện lại danh sách để chia sẻ lại', told && (await castMsgs(phone)).pop().type === 'cast.stop' && (await pairNames(phone)).join('|') === 'TS10' && (await shareBtn.getAttribute('aria-pressed')) === 'false');
cap.on = false;
// chia sẻ lại từ danh sách trong hộp
await phone.locator('.cast-pair-go').first().click();
await waitFor(async () => (await castMsgs(phone)).filter((m) => m.type === 'cast.start').length === 3);
cap.on = true;
await phone.evaluate(() => window.__phApp.cast('started', { width: 540, height: 1170 }));
check('S6 bấm tên xe trong danh sách: chia sẻ lại được', await live(car));
await phone.getByRole('button', { name: 'Dừng chiếu' }).click();
await stoppedCast(car);
cap.on = false;
await phone.keyboard.press('Escape');

// =====================================================================
// M. Nhiều xe
// =====================================================================
const c2 = await openCar(UA_CAR2);
const car2 = c2.page;
const code2 = await getCode(car2);
// đã có 1 xe thì nút "Chia sẻ" chia sẻ ngay tới xe đó; thêm xe khác: Cài đặt > "Chiếu lên màn hình xe"
await openSettings(phone);
await phone.locator('#set-cast').getByRole('button', { name: 'Chiếu lên màn hình xe' }).click();
await phone.locator('.cast-pair-go').first().waitFor({ timeout: 6000 }).catch(() => {});
check('M0 Cài đặt > "Chiếu lên màn hình xe": hiện danh sách xe đã ghép đôi (không tự chia sẻ) + nút thêm xe', (await pairNames(phone)).join('|') === 'TS10'
  && await phone.getByRole('button', { name: 'Thêm màn hình xe khác (nhập mã)' }).isVisible() && (await castMsgs(phone)).filter((m) => m.type === 'cast.start').length === 3);
await showCodeForm(phone);
await phone.locator('#cast-code').fill(code2);
await phone.getByRole('button', { name: 'Kết nối' }).click();
await waitFor(async () => (await castMsgs(phone)).filter((m) => m.type === 'cast.start').length === 4);
cap.on = true;
await phone.evaluate(() => window.__phApp.cast('started', { width: 540, height: 1170 }));
check('M1 "Thêm màn hình xe khác (nhập mã)": ghép đôi xe thứ hai và chiếu được', await live(car2));
await phone.getByRole('button', { name: 'Dừng chiếu' }).click();
await stoppedCast(car2);
cap.on = false;
await phone.locator('.cast-pair-go').first().waitFor({ timeout: 6000 }).catch(() => {});
check('M2 danh sách trên điện thoại: hai xe, xe vừa dùng ở trên', (await pairNames(phone)).join('|') === 'UIS7862S|TS10', (await pairNames(phone)).join('|'));
await phone.screenshot({ path: path.join(here, 'shot-phase17-phone-two-cars.png') });
await phone.keyboard.press('Escape');
await phone.keyboard.press('Escape');   // hộp Cài đặt
await sleep(200);
const n0 = (await castMsgs(phone)).length;
await shareBtn.click();
await phone.locator('.cast-pair-go').first().waitFor({ timeout: 6000 });
await sleep(400);
check('M3 hai xe: bấm "Chia sẻ" thì cho chọn xe (chưa hỏi quyền)', (await castMsgs(phone)).length === n0 && (await pairNames(phone)).length === 2);
const car2Before = c2.req.incoming;
await phone.locator('.cast-pair-go').filter({ hasText: 'TS10' }).click();
await waitFor(async () => (await castMsgs(phone)).length === n0 + 1);
cap.on = true;
await phone.evaluate(() => window.__phApp.cast('started', { width: 540, height: 1170 }));
check('M4 chọn "TS10": chỉ TS10 nhận và chiếu, xe kia vẫn bình thường', await live(car) && (await attr(car2, 'data-cast')) === null);
await sleep(3500);
check('M5 xe kia vẫn hỏi lời mời đều (đã ghép đôi, đang rảnh)', c2.req.incoming > car2Before, JSON.stringify({ car2Before, now: c2.req.incoming, paired: await car2.evaluate(() => localStorage.getItem('carweb_cast_paired')), vis: await car2.evaluate(() => document.visibilityState) }));
await phone.getByRole('button', { name: 'Dừng chiếu' }).click();
await stoppedCast(car);
cap.on = false;
// xe không mở PH Car Play: điện thoại báo rõ
await c1.ctx.close();
await phone.locator('.cast-pair-go').filter({ hasText: 'TS10' }).click();
await waitFor(async () => (await castMsgs(phone)).filter((m) => m.type === 'cast.start').length === 6);
cap.on = true;
await phone.evaluate(() => window.__phApp.cast('started', { width: 540, height: 1170 }));
await waitFor(async () => /Đang chờ "TS10" nhận/.test(await phoneStatus(phone)), 6000);
check('M6 màn hình xe đang tắt: điện thoại ghi "Đang chờ "TS10" nhận..."', /Đang chờ "TS10" nhận/.test(await phoneStatus(phone)));
const gaveUp = await waitFor(async () => /"TS10" chưa nhận lời mời/.test(await phoneStatus(phone)), 40000);
check('M7 sau 30 giây không ai nhận: báo rõ (mở PH Car Play trên màn hình xe, hoặc Quên rồi ghép đôi lại), ngừng chụp', gaveUp && (await castMsgs(phone)).pop().type === 'cast.stop', await phoneStatus(phone));
cap.on = false;

// =====================================================================
// Q. Quên thiết bị
// =====================================================================
await car2.locator('.rail-cast').click();
await car2.locator('.cast-paired').waitFor({ timeout: 6000 }).catch(() => {});
check('Q1 hộp mã trên màn hình xe: có mục "Điện thoại đã ghép đôi" với "SM-A546E"', await car2.locator('.cast-paired').isVisible() && (await pairNames(car2)).join('|') === 'SM-A546E');
await car2.screenshot({ path: path.join(here, 'shot-phase17-car-paired-list.png') });
await car2.getByRole('button', { name: 'Quên SM-A546E' }).click();
await car2.locator('.dialog').filter({ hasText: 'Quên điện thoại này?' }).getByRole('button', { name: 'Quên', exact: true }).click();
await waitFor(async () => !(await car2.locator('.cast-paired').isVisible()), 6000);
check('Q2 màn hình xe bấm "Quên": mục ghép đôi biến mất, màn hình xe xóa dấu "đã ghép đôi"', !(await car2.locator('.cast-paired').isVisible()) && (await car2.evaluate(() => localStorage.getItem('carweb_cast_paired'))) === null);
await car2.keyboard.press('Escape');
const q0 = c2.req.incoming;
await sleep(7000);
check('Q3 màn hình xe không còn điện thoại nào ghép đôi: thôi hỏi lời mời', c2.req.incoming - q0 <= 1, `${c2.req.incoming - q0} lần`);
// hộp trên điện thoại đang báo lỗi (M7): đóng, mở lại từ Cài đặt (quản lý danh sách, không tự chia sẻ)
while (await phone.locator('.overlay').count()) { await phone.keyboard.press('Escape'); await sleep(150); }
await openSettings(phone);
await phone.locator('#set-cast').getByRole('button', { name: 'Chiếu lên màn hình xe' }).click();
await phone.locator('.cast-pair-go').first().waitFor({ timeout: 6000 }).catch(() => {});
const afterForget = await apiPairs(phone);
check('Q4 điện thoại: xe đã bị quên không còn trong danh sách (chỉ còn TS10)', afterForget.length === 1 && afterForget[0].name === 'TS10' && (await pairNames(phone)).join('|') === 'TS10', JSON.stringify(afterForget));
// điện thoại quên TS10
const forgetBtn = phone.getByRole('button', { name: 'Quên TS10' });
const startsBefore = (await castMsgs(phone)).length;
await forgetBtn.waitFor({ timeout: 6000 }).catch(() => {});
await forgetBtn.click();
await phone.locator('.dialog').filter({ hasText: 'Quên màn hình xe này?' }).getByRole('button', { name: 'Quên', exact: true }).click();
await phone.locator('#cast-code').waitFor({ timeout: 6000 }).catch(() => {});
check('Q5 điện thoại bấm "Quên" xe cuối cùng: hết danh sách, quay về ô nhập mã; máy chủ không còn cặp nào', await phone.locator('#cast-code').isVisible() && (await apiPairs(phone)).length === 0 && (await castMsgs(phone)).length === startsBefore);
while (await phone.locator('.overlay').count()) { await phone.keyboard.press('Escape'); await sleep(150); }
const startsQ6 = (await castMsgs(phone)).length;
await shareBtn.click();
await phone.locator('#cast-code').waitFor({ timeout: 6000 }).catch(() => {});
check('Q6 bấm "Chia sẻ" sau khi quên hết: hiện ô nhập mã như lần đầu (không hỏi quyền)', await phone.locator('#cast-code').isVisible() && (await castMsgs(phone)).length === startsQ6);

clearInterval(cap.timer);
await phoneCtx.close();
await c2.ctx.close();
await browser.close();

check('không có lỗi JavaScript nào', errors.length === 0, errors.slice(0, 3).join(' | '));
check('PHP không báo lỗi/cảnh báo nào', !/Warning|Fatal|Notice|Deprecated/.test(phpErr), phpErr.split('\n').filter((l) => /Warning|Fatal|Notice|Deprecated/.test(l)).slice(0, 2).join(' '));
console.log(failures ? `\nCÓ ${failures} MỤC CHƯA ĐẠT` : '\nTẤT CẢ ĐẠT');
process.exit(failures ? 1 : 0);
