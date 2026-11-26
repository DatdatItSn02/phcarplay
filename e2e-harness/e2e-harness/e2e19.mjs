import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');

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
const PORT = Number(process.env.PORT || 8091);
const PIPED_PORT = Number(process.env.PIPED_PORT || 8141);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PIPED = `http://localhost:${PIPED_PORT}`;
const DB = path.join(os.tmpdir(), `carweb-e2e19-${process.pid}.sqlite`);
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
    YOUTUBE_KEY_HINT: 'false', MUSIC_QUERY: 'nhạc e2e19 ' + RUN },
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

// =====================================================================
// V. Micro: tạm dừng nhạc lúc nghe, tìm xong phát tiếp
// =====================================================================
const carCtx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
const car = await carCtx.newPage();
car.on('pageerror', (e) => errors.push('xe: ' + e.message));
car.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errors.push('xe console: ' + m.text()); });
await car.addInitScript(installFakes, { channel: null, fakeSpeech: true, items: ITEMS });
let searchDelay = 1500;
let searchFail = false;
await car.route('**/api/youtube/search*', async (route) => {
  if (searchFail) return route.abort('failed');
  await sleep(searchDelay);
  return route.continue();
});
await car.goto(ORIGIN + '/');
await car.waitForSelector('.split');
await waitPlaying(car, true);
await car.waitForFunction((s) => document.querySelector(s).currentTime > 2.5, VIDEO, { timeout: 8000 }).catch(() => {});
await railBtn(car, 'Tìm kiếm').click();
const mic = car.locator('.view[data-view="search"] .search-mic');
const recCount = () => car.evaluate(() => window.__recs.length);
check('V0 mục Tìm kiếm có nút micro, nhạc đang phát', await mic.isVisible() && await isPlaying(car));
const title0 = await nowTitle(car);
const t0 = await time(car);
await mic.click();
await car.locator('.voice-text').waitFor();
const pausedListening = await waitPlaying(car, false, 3000);
await sleep(500);
check('V1 bấm micro: hộp "Đang nghe...", nhạc tạm dừng và vẫn dừng trong lúc nghe', pausedListening && !(await isPlaying(car)) && (await car.locator('.voice-text').textContent()) === 'Đang nghe...');
await car.evaluate(() => window.__say('nhạc thử micro'));
await sleep(600);   // máy chủ đang trả kết quả (chậm 1,5 giây)
const mid1 = { dialogs: await overlays(car), playing: await isPlaying(car), query: await car.locator('.view[data-view="search"] .search-input').inputValue(), rows: await car.locator('.view[data-view="search"] .vrow').count() };
check('V2 nói xong: đóng hộp, tìm đúng câu vừa nói; ĐANG TÌM thì nhạc vẫn dừng', mid1.dialogs === 0 && !mid1.playing && mid1.query === 'nhạc thử micro' && mid1.rows === 0, JSON.stringify(mid1));
await car.locator('.view[data-view="search"] .vrow').first().waitFor({ timeout: 8000 });
const resumed1 = await waitPlaying(car, true, 4000);
const t1 = await time(car);
check('V3 có kết quả thì phát tiếp đúng bài, đúng chỗ đang nghe (không phát lại từ đầu)', resumed1 && (await nowTitle(car)) === title0 && t1 >= t0 - 0.3, `${title0} ${t0.toFixed(1)} -> ${t1.toFixed(1)}`);

// không nghe thấy gì -> phát lại ngay; Thử lại -> dừng lại để nghe; đóng hộp -> phát lại ngay
await mic.click();
await waitPlaying(car, false, 3000);
await car.evaluate(() => window.__fail('no-speech'));
await car.locator('.voice').getByRole('button', { name: 'Thử lại' }).waitFor({ timeout: 3000 });
const hint = await car.locator('.voice .hint').textContent();
check('V4 không nghe thấy gì: báo "Chưa nghe thấy gì", có nút Thử lại, nhạc phát lại ngay', /Chưa nghe thấy gì/.test(hint) && await waitPlaying(car, true, 3000), hint);
const before5 = await recCount();
await car.locator('.voice').getByRole('button', { name: 'Thử lại' }).click();
check('V5 bấm "Thử lại": nghe lần mới và lại tạm dừng nhạc', (await recCount()) === before5 + 1 && await waitPlaying(car, false, 3000));
await car.keyboard.press('Escape');
const closed6 = await waitPlaying(car, true, 3000);
check('V6 đóng hộp micro khi chưa nói: nhạc phát lại ngay, dừng nghe', closed6 && (await overlays(car)) === 0 && await car.evaluate(() => window.__recs[window.__recs.length - 1].aborted));

// tìm bị lỗi (mất mạng) -> vẫn phát tiếp
searchFail = true;
await mic.click();
await waitPlaying(car, false, 3000);
await car.evaluate(() => window.__say('mất mạng'));
await car.locator('.view[data-view="search"]').getByText('Không tìm được').waitFor({ timeout: 6000 }).catch(() => {});
check('V7 tìm bị lỗi: báo "Không tìm được" và nhạc vẫn phát tiếp', await car.locator('.view[data-view="search"]').getByText('Không tìm được').isVisible() && await waitPlaying(car, true, 3000));
searchFail = false;

// đang dừng sẵn -> tìm xong vẫn để dừng
await car.locator('.player .ctl-group .ctl-main').click();
await waitPlaying(car, false, 3000);
await mic.click();
await sleep(300);
await car.evaluate(() => window.__say('đang dừng sẵn'));
await car.locator('.view[data-view="search"] .vrow').first().waitFor({ timeout: 8000 });
await sleep(1200);
check('V8 nhạc đang dừng sẵn: tìm bằng giọng nói xong vẫn để dừng (không tự phát)', !(await isPlaying(car)));
await car.locator('.player .ctl-group .ctl-main').click();
await waitPlaying(car, true, 3000);

// người dùng tự bấm phát (nút trên vô lăng / tai nghe = Media Session) trong lúc nghe -> tìm xong không đụng vào
await mic.click();
await waitPlaying(car, false, 3000);
await car.evaluate(() => window.__ms.play());
const playedByUser = await waitPlaying(car, true, 3000);
await car.evaluate(() => window.__say('tự bấm phát'));
await car.locator('.view[data-view="search"] .search-input').evaluate((e) => e.value).catch(() => '');
await sleep(2300);   // đợi tìm xong (1,5 giây)
check('V9 trong lúc nghe người dùng tự bấm phát: tìm xong nhạc vẫn phát (không bị dừng nhầm)', playedByUser && await isPlaying(car));
// đổi bài trong lúc nghe -> bài mới phát tiếp, không bị dừng
const titleBefore = await nowTitle(car);
await mic.click();
await waitPlaying(car, false, 3000);
await car.evaluate(() => window.__ms.nexttrack());
await car.waitForFunction((t) => { const e = document.querySelector('.now-title'); return e && e.textContent !== t; }, titleBefore, { timeout: 6000 }).catch(() => {});
const newTitle = await nowTitle(car);
await waitPlaying(car, true, 6000);
await car.evaluate(() => window.__say('đổi bài'));
await sleep(2300);
check('V10 trong lúc nghe đổi sang bài khác (nút vô lăng): tìm xong bài mới vẫn phát', newTitle !== titleBefore && (await nowTitle(car)) === newTitle && await isPlaying(car), `${titleBefore} -> ${newTitle}`);

// micro ở Trang chủ
await railBtn(car, 'Trang chủ').click();
const homeMic = car.locator('.view[data-view="home"] .search-mic');
await homeMic.click();
const pausedHome = await waitPlaying(car, false, 3000);
await car.evaluate(() => window.__say('nhạc trang chủ'));
await sleep(600);
const midHome = { view: await activeView(car), playing: await isPlaying(car), query: await car.locator('.view[data-view="search"] .search-input').inputValue() };
await car.locator('.view[data-view="search"] .vrow').first().waitFor({ timeout: 8000 });
check('V11 micro ở Trang chủ: dừng lúc nghe, sang mục Tìm kiếm tìm câu vừa nói, đang tìm vẫn dừng, tìm xong phát tiếp',
  pausedHome && midHome.view === 'search' && !midHome.playing && midHome.query === 'nhạc trang chủ' && await waitPlaying(car, true, 4000), JSON.stringify(midHome));
searchDelay = 0;

// =====================================================================
// F. "Toàn màn hình" khi đang chiếu: nhạc thành cửa sổ nổi
// =====================================================================
await car.locator('.rail-cast').click();
await car.waitForFunction(() => { const e = document.querySelector('.cast-code'); return e && /^[0-9]{3} [0-9]{3}$/.test(e.textContent); }, null, { timeout: 8000 });
const code1 = await carCode(car);
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA_ANDROID, hasTouch: true, isMobile: true });
const phone = await phoneCtx.newPage();
phone.on('pageerror', (e) => errors.push('điện thoại: ' + e.message));
await phone.addInitScript(installFakes, { channel: 'android', fakeSpeech: false, items: [] });
const cap = await fakeCapture(phone);
await phone.goto(ORIGIN + '/');
await phone.waitForSelector('.split');
await openSettings(phone);
await phone.locator('#set-cast').getByRole('button', { name: 'Chiếu lên màn hình xe' }).click();
await phone.locator('#cast-code').fill(code1);
await phone.getByRole('button', { name: 'Kết nối' }).click();
await waitFor(async () => (await castMsgs(phone)).length === 1);
cap.on = true;
await phone.evaluate(() => window.__phApp.cast('started', { width: 540, height: 1170 }));
const live = await waitFor(async () => (await attr(car, 'data-cast')) === 'side' && (await canvasInfo(car)).w === 540, 20000);
check('F0 nối xong: màn hình xe chia đôi, có nút "Toàn màn hình" trên khung chiếu', live && await car.locator('.cast-bar').getByRole('button', { name: 'Toàn màn hình' }).isVisible());
await car.locator('.toast').waitFor({ state: 'hidden', timeout: 9000 }).catch(() => {});
await waitPlaying(car, true);
await watchVideo(car);
const panBefore = (await canvasInfo(car)).pos;
await car.locator('.cast-bar').getByRole('button', { name: 'Toàn màn hình' }).click();
await sleep(300);
const pane = await rect(car, '.cast-pane');
const stage = await rect(car, '.cast-stage');
const labels = await car.evaluate(() => [...document.querySelectorAll('.cast-tool:not([hidden]) .cast-tool-text')].filter((e) => e.getClientRects().length).map((e) => e.textContent));
check('F1 "Toàn màn hình": hình điện thoại chiếm cả màn hình xe, ẩn hẳn ứng dụng nghe nhạc; thanh nút: Vừa khung, Chia đôi, Dừng chiếu',
  (await rect(car, '.app')) === null && pane.l === 0 && pane.t === 0 && near(pane.w, 1024, 1) && near(pane.h, 600, 1) && (await attr(car, 'data-cast-full')) === '' && labels.join('|') === 'Vừa khung|Chia đôi|Dừng chiếu',
  JSON.stringify({ pane, labels }));
const fl = await rect(car, '.cast-float');
const fs1 = await floatState(car);
const titleBox = await rect(car, '.cast-float-info');
const mediaBox = await rect(car, '.cast-float-media');
check('F2 cửa sổ nhạc nổi ở góc dưới bên phải khung chiếu, nằm trên thanh nút, rộng ~30% màn hình, cao không quá 45%; tên bài đè ở mép dưới hình',
  fs1 && fs1.corner === 'br' && fs1.card && !fs1.bubble && near(fl.r, stage.r - 12, 2) && near(fl.b, stage.b - 12, 2) && fl.w >= 280 && fl.w <= 330 && fl.h <= stage.h * 0.46
  && titleBox && near(titleBox.b, mediaBox.b, 1) && titleBox.t > mediaBox.t, JSON.stringify({ fl, stage, titleBox, mediaBox }));
check('F3 thẻ video của website được chuyển vào cửa sổ nổi (trình phát không còn giữ), đang hiện hình video', fs1.video && (await car.locator('.stage video.media-video').count()) === 0 && fs1.kind === 'video' && !fs1.art);
const tA = await time(car);
await sleep(1300);
const ev1 = await videoEvents(car);
const tB = await time(car);
check('F4 nhạc/hình chạy tiếp liền mạch: không tải lại, không dừng giây nào', await isPlaying(car) && tB - tA > 0.9 && ev1.same && ev1.loadstart === 0 && ev1.emptied === 0 && ev1.abort === 0 && ev1.pause === 0, JSON.stringify({ tA, tB, ev1 }));
check('F5 cửa sổ hiện đúng tên bài đang phát và kênh', fs1.title === await car.evaluate(() => document.querySelector('.now-title').textContent) && /Kênh thử/.test(await car.locator('.cast-float-sub').textContent()));
await car.screenshot({ path: path.join(here, 'shot-phase17-full-float.png') });
await car.locator('.cast-float .ctl-main').click();
const pausedF = await waitPlaying(car, false, 3000);
await waitFor(async () => (await floatState(car)).play === 'Phát', 3000);
const lblPaused = (await floatState(car)).play;
await car.locator('.cast-float .ctl-main').click();
const playedF = await waitPlaying(car, true, 3000);
await waitFor(async () => (await floatState(car)).play === 'Tạm dừng', 3000);   // nhãn đổi khi trình phát báo đã phát
const lblPlaying = (await floatState(car)).play;
check('F6 nút ⏯ trên cửa sổ nổi dừng / phát được nhạc (nhãn đổi theo)', pausedF && lblPaused === 'Phát' && playedF && lblPlaying === 'Tạm dừng', JSON.stringify({ pausedF, lblPaused, playedF, lblPlaying }));

// kéo: lên góc trên bên trái; giữa chừng kéo ra ngoài màn hình thì cửa sổ dừng ở mép
await watchVideo(car);
const fr = await rect(car, '.cast-float');
const grabX = fr.l + fr.w / 2;
const grabY = fr.t + 40;   // phần hình, tránh 2 nút ở góc
const outside = await drag(car, grabX, grabY, -150, -150, () => rect(car, '.cast-float'));
await sleep(100);
const flTL = await rect(car, '.cast-float');
const fsTL = await floatState(car);
check('F7 kéo ra ngoài màn hình: cửa sổ dừng ở mép khung chiếu (không mất)', outside && outside.l >= stage.l - 1 && outside.t >= stage.t - 1, JSON.stringify(outside));
check('F8 thả ra: cửa sổ tự dính vào góc trên bên trái và nhớ góc đó', fsTL.corner === 'tl' && near(flTL.l, stage.l + 12, 2) && near(flTL.t, stage.t + 12, 2) && JSON.parse(fsTL.prefs).corner === 'tl', JSON.stringify(flTL));
check('F9 kéo cửa sổ không kéo nhầm bản đồ ở dưới, không bấm nhầm nút phát/dừng', (await canvasInfo(car)).pos === panBefore && await isPlaying(car));
// kéo nửa chừng rồi thả gần góc dưới trái
const fr2 = await rect(car, '.cast-float');
await drag(car, fr2.l + fr2.w / 2, fr2.t + 40, stage.l + 160, stage.b - 80);
const fsBL = await floatState(car);
const flBL = await rect(car, '.cast-float');
check('F10 thả gần góc dưới bên trái: dính vào góc đó', fsBL.corner === 'bl' && near(flBL.l, stage.l + 12, 2) && near(flBL.b, stage.b - 12, 2), JSON.stringify(flBL));
// thu nhỏ thành bong bóng
await car.locator('.cast-float').getByRole('button', { name: 'Thu nhỏ' }).click();
await sleep(200);
const fsMin = await floatState(car);
const bub = await rect(car, '.cast-float-bubble');
const bubRadius = await car.locator('.cast-float-bubble').evaluate((e) => getComputedStyle(e).borderRadius);
check('F11 "Thu nhỏ": thành bong bóng tròn ~72px ở cùng góc, nhạc vẫn phát (video vẫn nằm trong cửa sổ, không tải lại)', fsMin.min && fsMin.bubble && !fsMin.card && near(bub.w, 72, 2) && near(bub.h, 72, 2) && bubRadius === '50%'
  && near(bub.l, stage.l + 12, 2) && near(bub.b, stage.b - 12, 2) && await isPlaying(car) && fsMin.video && (await videoEvents(car)).loadstart === 0, JSON.stringify({ bub, bubRadius }));
await car.screenshot({ path: path.join(here, 'shot-phase17-bubble.png') });
await drag(car, bub.l + bub.w / 2, bub.t + bub.h / 2, stage.r - 100, stage.b - 100);
const fsMin2 = await floatState(car);
const bub2 = await rect(car, '.cast-float-bubble');
check('F12 kéo bong bóng sang phải: dính góc dưới bên phải, kéo xong KHÔNG tự mở ra', fsMin2.min && fsMin2.corner === 'br' && near(bub2.r, stage.r - 12, 2) && near(bub2.b, stage.b - 12, 2), JSON.stringify(bub2));
await car.locator('.cast-float-bubble').click();
await sleep(200);
const fsOpen = await floatState(car);
check('F13 chạm bong bóng: mở lại cửa sổ ở góc đó, nhớ lựa chọn', !fsOpen.min && fsOpen.card && fsOpen.corner === 'br' && JSON.stringify(JSON.parse(fsOpen.prefs)) === '{"corner":"br","min":false}', fsOpen.prefs);
// Vừa khung / Lấp đầy vẫn dùng được khi toàn màn hình
await car.locator('.cast-bar').getByRole('button', { name: 'Vừa khung' }).click();
await sleep(250);
const fitInfo = { fit: (await canvasInfo(car)).fit, pane: await rect(car, '.cast-pane') };
await car.locator('.cast-bar').getByRole('button', { name: 'Lấp đầy' }).click();
await sleep(250);
check('F14 "Vừa khung" khi toàn màn hình: thấy trọn màn hình điện thoại (viền hai bên), khung vẫn cả màn hình; "Lấp đầy" thì phóng kín',
  fitInfo.fit === 'contain' && near(fitInfo.pane.w, 1024, 1) && (await canvasInfo(car)).fit === 'cover', JSON.stringify(fitInfo));
// điện thoại xoay ngang -> hình ngang phủ kín màn hình xe
cap.src = LANDSCAPE;
const turned = await waitFor(async () => (await canvasInfo(car)).w === 1170);
await sleep(300);
const landPane = await rect(car, '.cast-pane');
check('F15 điện thoại xoay ngang khi toàn màn hình: hình ngang phủ kín màn hình xe, cửa sổ nổi vẫn ở đó', turned && near(landPane.w, 1024, 1) && (await floatState(car)).card);
await car.screenshot({ path: path.join(here, 'shot-phase17-full-landscape.png') });
cap.src = PORTRAIT;
await waitFor(async () => (await canvasInfo(car)).w === 540);

// "Chia đôi" trên cửa sổ nổi: trở lại chia đôi, thẻ video về lại trình phát, nhạc không ngắt
await watchVideo(car);
const tC = await time(car);
await car.locator('.cast-float').getByRole('button', { name: 'Chia đôi' }).click();
await sleep(300);
const ev2 = await videoEvents(car);
const split = { app: await rect(car, '.app'), pane: await rect(car, '.cast-pane'), float: await car.locator('.cast-float').isVisible(), inStage: await car.locator('.stage > video.media-video').count(), full: await attr(car, 'data-cast-full') };
await sleep(800);
check('F16 "Chia đôi" (trên cửa sổ nổi): hai bên như cũ, cửa sổ nổi biến mất, thẻ video về lại trình phát, nhạc không ngắt / không tải lại',
  split.app && near(split.pane.w + split.app.w, 1024, 2) && !split.float && split.inStage === 1 && split.full === null && await isPlaying(car) && (await time(car)) > tC
  && ev2.loadstart === 0 && ev2.emptied === 0 && ev2.pause === 0 && ev2.same, JSON.stringify({ split, ev2 }));
check('F17 sau khi chia đôi: thanh phát nhỏ của phần nhạc hiện đúng bài', await car.locator('.minibar').isVisible() && (await car.locator('.minibar-title').textContent()) === await nowTitle(car));
await car.locator('.cast-bar').getByRole('button', { name: 'Toàn màn hình' }).click();
await sleep(300);
const fsAgain = await floatState(car);
check('F18 vào lại "Toàn màn hình": cửa sổ nổi ở góc đã chọn (dưới phải), đang mở', fsAgain && fsAgain.corner === 'br' && fsAgain.card && fsAgain.video);
// ⏭ ⏮ trên cửa sổ nổi
const tBefore = (await floatState(car)).title;
await car.locator('.cast-float').getByRole('button', { name: 'Bài kế tiếp' }).click();
await car.waitForFunction((t) => { const e = document.querySelector('.cast-float-title'); return e && e.textContent !== t; }, tBefore, { timeout: 6000 }).catch(() => {});
const tNext = (await floatState(car)).title;
const playingNext = await waitPlaying(car, true, 6000);
await car.locator('.cast-float').getByRole('button', { name: 'Bài trước' }).click();
await car.waitForFunction((t) => { const e = document.querySelector('.cast-float-title'); return e && e.textContent === t; }, tBefore, { timeout: 6000 }).catch(() => {});
const tPrev = (await floatState(car)).title;
check('F19 ⏭ trên cửa sổ nổi sang bài kế tiếp (video phát ngay trong cửa sổ), ⏮ quay lại bài trước', tNext !== tBefore && playingNext && tPrev === tBefore && (await floatState(car)).video, `${tBefore} -> ${tNext} -> ${tPrev}`);

// =====================================================================
// E. Bài phát bằng trình phát YouTube nhúng
// =====================================================================
await waitPlaying(car, true, 6000);
for (let i = 0; i < 5 && (await floatState(car)).title !== titleOf(EMB); i++) {
  const cur = (await floatState(car)).title;
  await car.locator('.cast-float').getByRole('button', { name: 'Bài kế tiếp' }).click();
  await car.waitForFunction((t) => { const e = document.querySelector('.cast-float-title'); return e && e.textContent !== t; }, cur, { timeout: 6000 }).catch(() => {});
}
const embOn = await waitFor(async () => car.evaluate(() => Boolean(document.querySelector('.media-embed iframe.yt-fake')) && window.__ytLast && window.__ytLast.state === 1), 10000);
const fsE = await floatState(car);
const embInfo = await car.evaluate(() => { const f = document.querySelector('.media-embed iframe.yt-fake'); return { inStage: Boolean(f && f.closest('.stage')), inFloat: Boolean(f && f.closest('.cast-float')), loads: window.__ytLoads, players: window.__ytPlayers }; });
check('E1 bài chỉ phát được bằng YouTube nhúng: cửa sổ nổi hiện ảnh bìa + tên bài, khung YouTube vẫn ở trình phát (không chuyển chỗ)',
  embOn && fsE.title === titleOf(EMB) && fsE.kind === 'art' && fsE.art && embInfo.inStage && !embInfo.inFloat, JSON.stringify({ fsE, embInfo }));
await car.screenshot({ path: path.join(here, 'shot-phase17-float-embed.png') });
await car.locator('.cast-float .ctl-main').click();
const embPaused = await waitFor(async () => car.evaluate(() => window.__ytLast.state === 2), 3000);
await car.locator('.cast-float .ctl-main').click();
const embPlay = await waitFor(async () => car.evaluate(() => window.__ytLast.state === 1), 3000);
check('E2 nút ⏯ trên cửa sổ nổi điều khiển trình phát YouTube nhúng', embPaused && embPlay);
await car.locator('.cast-bar').getByRole('button', { name: 'Chia đôi' }).click();
await sleep(250);
await car.locator('.cast-bar').getByRole('button', { name: 'Toàn màn hình' }).click();
await sleep(250);
const embAfter = await car.evaluate(() => ({ loads: window.__ytLoads, players: window.__ytPlayers, state: window.__ytLast.state }));
check('E3 đổi qua lại Chia đôi / Toàn màn hình khi đang phát YouTube nhúng: khung YouTube không tải lại, vẫn phát', embAfter.loads === embInfo.loads && embAfter.players === embInfo.players && embAfter.state === 1, JSON.stringify(embAfter));
await car.locator('.cast-float').getByRole('button', { name: 'Bài trước' }).click();
const backToVideo = await waitFor(async () => { const s = await floatState(car); return s.kind === 'video' && await isPlaying(car); }, 10000);
check('E4 quay về bài phát bằng thẻ video: cửa sổ nổi lại hiện hình video', backToVideo, JSON.stringify(await floatState(car)));

// dừng chiếu khi đang toàn màn hình
await watchVideo(car);
await car.locator('.cast-bar').getByRole('button', { name: 'Dừng chiếu' }).click();
const ended = await waitFor(async () => (await attr(car, 'data-cast')) === null);
const g = { full: await attr(car, 'data-cast-full'), app: await rect(car, '.app'), inStage: await car.locator('.stage > video.media-video').count(), float: await car.locator('.cast-float').count() };
await sleep(600);
const ev3 = await videoEvents(car);
check('F20 "Dừng chiếu" khi đang toàn màn hình: ứng dụng trở lại cả màn hình, thẻ video về trình phát, nhạc vẫn phát liền mạch',
  ended && g.full === null && g.app && near(g.app.w, 1024, 1) && g.inStage === 1 && await isPlaying(car) && ev3.loadstart === 0 && ev3.pause === 0, JSON.stringify({ g, ev3 }));
cap.on = false;

// =====================================================================
// J. Màn hình xe 800x480 chạy ứng dụng Android (PH Car Play trên đầu xe)
// =====================================================================
{
  const c2 = await browser.newContext({ viewport: { width: 800, height: 480 }, userAgent: UA_ANDROID });
  const car2 = await c2.newPage();
  car2.on('pageerror', (e) => errors.push('xe 800: ' + e.message));
  await car2.addInitScript(installFakes, { channel: 'android', fakeSpeech: false, items: ITEMS.slice(0, 3) });
  await car2.goto(ORIGIN + '/');
  await car2.waitForSelector('.split');
  await waitPlaying(car2, true);
  await car2.locator('.rail-cast').click();
  await car2.waitForFunction(() => { const e = document.querySelector('.cast-code'); return e && /^[0-9]{3} [0-9]{3}$/.test(e.textContent); }, null, { timeout: 8000 });
  const codeJ = await carCode(car2);
  // giai đoạn 17 (đợt 2): điện thoại đã ghép đôi với xe đầu -> hộp hiện danh sách; nhập mã xe mới qua "Thêm màn hình xe khác"
  await sleep(300);
  const addCar = phone.getByRole('button', { name: 'Thêm màn hình xe khác (nhập mã)' });
  if (await addCar.isVisible()) await addCar.click();
  await phone.locator('#cast-code').fill(codeJ);
  await phone.getByRole('button', { name: 'Kết nối' }).click();
  await waitFor(async () => (await castMsgs(phone)).filter((m) => m.type === 'cast.start').length === 2);
  cap.on = true;
  await phone.evaluate(() => window.__phApp.cast('started', { width: 540, height: 1170 }));
  const liveJ = await waitFor(async () => (await attr(car2, 'data-cast')) === 'side' && (await canvasInfo(car2)).w === 540, 20000);
  await car2.locator('.toast').waitFor({ state: 'hidden', timeout: 9000 }).catch(() => {});
  await car2.locator('.cast-bar').getByRole('button', { name: 'Toàn màn hình' }).click();
  await sleep(300);
  const st2 = await rect(car2, '.cast-stage');
  const f2 = await rect(car2, '.cast-float');
  const fj = await floatState(car2);
  const btns = await car2.evaluate(() => [...document.querySelectorAll('.cast-float button')].filter((b) => b.getClientRects().length).map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
  check('J1 800x480: cửa sổ nổi gọn (bỏ phần hình, chỉ tên bài + nút), không cao quá 1/3 khung, nút đủ lớn (từ 44px), nhạc vẫn phát',
    liveJ && fj.compact && !fj.media && fj.card && f2.h <= st2.h * 0.34 && f2.r <= st2.r && f2.b <= st2.b && Math.min(...btns) >= 44 && btns.length === 5 && await isPlaying(car2), JSON.stringify({ f2, st2, btns }));
  await car2.screenshot({ path: path.join(here, 'shot-phase17-full-800x480.png') });
  const handled = await car2.evaluate(() => window.__phApp.back());
  await sleep(300);
  check('J2 nút Quay lại của ứng dụng khi toàn màn hình: trở lại chia đôi (không thoát ứng dụng)', handled === true && (await attr(car2, 'data-cast-full')) === null && (await rect(car2, '.app')) !== null && !(await car2.locator('.cast-float').isVisible()));
  await car2.locator('.cast-bar').getByRole('button', { name: 'Dừng chiếu' }).click();
  await waitFor(async () => (await attr(car2, 'data-cast')) === null);
  cap.on = false;
  await c2.close();
}
clearInterval(cap.timer);
await phoneCtx.close();
await carCtx.close();
await browser.close();

check('không có lỗi JavaScript nào', errors.length === 0, errors.slice(0, 3).join(' | '));
check('PHP không báo lỗi/cảnh báo nào', !/Warning|Fatal|Notice|Deprecated/.test(phpErr), phpErr.split('\n').filter((l) => /Warning|Fatal|Notice|Deprecated/.test(l)).slice(0, 2).join(' '));
console.log(failures ? `\nCÓ ${failures} MỤC CHƯA ĐẠT` : '\nTẤT CẢ ĐẠT');
process.exit(failures ? 1 : 0);
