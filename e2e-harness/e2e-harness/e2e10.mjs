import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');

// Giai đoạn 9 trên PHP THẬT (php -S + SQLite tạm) và Chromium thật, với một máy chủ GIẢ đóng vai:
//  - Piped hỏng (trả trang web), Invidious hỏng một nửa (tìm kiếm lỗi; chỉ trả luồng cho một video nhưng luồng đó 404),
//  - YouTube: youtubei/v1/search, youtubei/v1/next (video liên quan), gợi ý tìm kiếm, và thư viện iframe_api GIẢ
//    (trình phát giả có cùng các hàm playVideo/pauseVideo/seekTo/cueVideoById... và báo sự kiện như YouTube thật).
// Kiểm tra: tìm kiếm qua YouTube khi Piped/Invidious hỏng; phát bằng trình phát YouTube; nút của website điều khiển được;
// video cấm nhúng thì báo và tự chuyển bài; hết bài tự sang bài sau; luồng trực tiếp 404 thì tự chuyển sang trình phát YouTube;
// cửa sổ nổi báo không dùng được; CSP cho phép đúng nguồn YouTube; giới hạn số lần hỏi YouTube mỗi giờ.
// Không thử được: YouTube thật (máy thử không có Internet), quảng cáo, chặn tự phát của trình duyệt thật trên xe.
const PUBLIC_DIR = process.env.PUBLIC_DIR;
if (!PUBLIC_DIR) { console.error('Cần đặt PUBLIC_DIR=/duong/dan/den/public'); process.exit(2); }
const PROJECT = path.dirname(PUBLIC_DIR);
const here = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.env.PORT || 8094);
const FAKE_PORT = Number(process.env.FAKE_PORT || 8133);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const FAKE = `http://localhost:${FAKE_PORT}`;
const DB = path.join(os.tmpdir(), `carweb-e2e10-${process.pid}.sqlite`);
const MASTER = { email: 'master@test.local', pass: 'Master-12345' };

let failures = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mã video 11 ký tự; tên quyết định hành vi của trình phát giả.
// Đuôi riêng mỗi lần chạy: máy chủ PHP lưu đệm kết quả, lần chạy sau vẫn phải gọi tới máy chủ giả.
const RUN = (process.pid.toString(36) + 'zzzzz').slice(0, 5);
const A = 'NORMAL' + RUN;
const B = 'NOEMBED' + RUN.slice(0, 4);   // chủ video cấm nhúng -> lỗi 150
const C = 'SHORT0' + RUN;   // hết sau 2 giây -> tự sang bài sau
const D = 'BROKEN' + RUN;   // Invidious trả luồng trực tiếp nhưng luồng 404 -> trình duyệt tự chuyển sang trình phát YouTube
const R = 'RELATE' + RUN;
const Q = 'mưa rơi ' + RUN;
const TITLES = { [A]: 'Bài YouTube một', [B]: 'Bài cấm nhúng', [C]: 'Bài ngắn', [D]: 'Bài luồng hỏng', [R]: 'Bài liên quan' };
const vr = (id) => ({ videoRenderer: { videoId: id, title: { runs: [{ text: TITLES[id] }] }, ownerText: { runs: [{ text: 'Kênh YouTube' }] },
  lengthText: { simpleText: '3:20' }, viewCountText: { simpleText: '12,345 views' }, publishedTimeText: { simpleText: '1 year ago' } } });
const searchPage = (ids) => ({ contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [
  { itemSectionRenderer: { contents: ids.map(vr) } },
  { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'TRANG-2' } } } }] } } } } });

const hits = [];
const fakeIframeApi = `(function(){
  var FAKE=${JSON.stringify(FAKE)};
  window.__ytLog=[];
  function Player(el, opts){
    var self=this; this.opts=opts; this.state=-1; this.id=opts.videoId; this.t=0; this.timer=null;
    window.__ytPlayers=(window.__ytPlayers||[]); window.__ytPlayers.push(this);
    var f=document.createElement('iframe'); f.src=FAKE+'/embed/'+opts.videoId; f.className='yt-fake'; f.setAttribute('allow','autoplay');
    el.parentNode.replaceChild(f, el); this.iframe=f;
    window.__ytLog.push('new:'+opts.videoId+':origin='+((opts.playerVars||{}).origin||''));
    setTimeout(function(){ self.state=5; opts.events.onReady({target:self}); }, 60);
  }
  Player.prototype.set=function(s){ this.state=s; this.opts.events.onStateChange({data:s, target:this}); };
  Player.prototype.dur=function(){ return /^SHORT/.test(this.id) ? 2 : 200; };
  Player.prototype.playVideo=function(){ var self=this; window.__ytLog.push('play:'+this.id);
    if(/^NOEMBED/.test(this.id)){ setTimeout(function(){ self.opts.events.onError({data:150, target:self}); }, 60); return; }
    // giả lập trình duyệt chặn tự phát CÓ TIẾNG (như Chrome/Safari thật khi chưa chạm vào trang)
    if(window.__blockSound && !this.muted){ window.__ytLog.push('blocked:'+this.id); if(this.opts.events.onAutoplayBlocked) setTimeout(function(){ self.opts.events.onAutoplayBlocked({target:self}); }, 30); return; }
    setTimeout(function(){ self.set(1); clearInterval(self.timer);
      self.timer=setInterval(function(){ self.t+=0.25; if(self.t>=self.dur()){ clearInterval(self.timer); self.t=self.dur(); self.set(0); } }, 250); }, 60); };
  Player.prototype.pauseVideo=function(){ clearInterval(this.timer); window.__ytLog.push('pause:'+this.id); this.set(2); };
  Player.prototype.stopVideo=function(){ clearInterval(this.timer); window.__ytLog.push('stop:'+this.id); this.state=5; };
  Player.prototype.cueVideoById=function(id){ clearInterval(this.timer); this.id=id; this.t=0; this.state=5; this.iframe.src=FAKE+'/embed/'+id; window.__ytLog.push('cue:'+id); };
  Player.prototype.loadVideoById=function(id){ this.cueVideoById(id); window.__ytLog.push('load:'+id); this.playVideo(); };
  Player.prototype.getVideoData=function(){ return { video_id: this.id, title: 'Tên thật ' + this.id, author: 'Kênh thật' }; };
  Player.prototype.mute=function(){ this.muted=true; window.__ytLog.push('mute'); };
  Player.prototype.unMute=function(){ this.muted=false; window.__ytLog.push('unmute'); };
  Player.prototype.getVolume=function(){ return 100; };
  Player.prototype.seekTo=function(t){ this.t=t; window.__ytLog.push('seek:'+Math.round(t)); };
  Player.prototype.getCurrentTime=function(){ return this.t; };
  Player.prototype.getDuration=function(){ return this.dur(); };
  Player.prototype.destroy=function(){ clearInterval(this.timer); };
  window.YT={Player:Player, PlayerState:{ENDED:0,PLAYING:1,PAUSED:2,BUFFERING:3,CUED:5}};
  if (typeof window.onYouTubeIframeAPIReady==='function') window.onYouTubeIframeAPIReady();
})();`;

const fake = http.createServer(async (req, res) => {
  const u = new URL(req.url, FAKE);
  hits.push(req.method + ' ' + u.pathname);
  let body = '';
  for await (const c of req) body += c;
  const json = (o, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname.startsWith('/piped/')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>Just a moment...</html>'); }
  if (u.pathname === '/inv/api/v1/videos/' + D) {
    return json({ title: TITLES[D], author: 'Kênh', lengthSeconds: 200, formatStreams: [{ url: '/broken.mp4?id=' + D, type: 'video/mp4; codecs="avc1"', size: '640x360', qualityLabel: '360p' }], adaptiveFormats: [] });
  }
  if (u.pathname.startsWith('/inv/api/')) return json({ error: 'Đang bảo trì' }, 500);   // lỗi có trường error: không bị tạm bỏ qua
  if (u.pathname.startsWith('/inv/broken.mp4')) { res.writeHead(404); return res.end('no'); }
  if (u.pathname === '/yt/youtubei/v1/search') {
    const b = JSON.parse(body || '{}');
    return json(b.continuation ? searchPage([R]) : searchPage([A, B, C, D]));
  }
  if (u.pathname === '/yt/youtubei/v1/next') return json({ contents: { twoColumnWatchNextResults: { secondaryResults: searchPage([R]) } } });
  if (u.pathname === '/complete/search') return json([u.searchParams.get('q'), ['nhạc youtube một', 'nhạc youtube hai']]);
  if (u.pathname === '/iframe_api') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(fakeIframeApi); }
  if (u.pathname.startsWith('/embed/')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<!DOCTYPE html><body style="background:#300;color:#fff;font:20px sans-serif">Trình phát YouTube giả: ' + u.pathname.slice(7) + '</body>'); }
  res.writeHead(404); res.end('no');
});
await new Promise((r) => fake.listen(FAKE_PORT, r));

fs.rmSync(DB, { force: true });
const php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', PUBLIC_DIR, path.join(PROJECT, 'tests/support/serve_sqlite.php')], {
  env: { ...process.env, CARWEB_TEST_DB: DB, CARWEB_TEST_SEED: '1', CARWEB_TEST_MASTER_EMAIL: MASTER.email, CARWEB_TEST_MASTER_PASS: MASTER.pass,
    APP_URL: ORIGIN, MAIL_DRIVER: 'log', APP_DEBUG: 'false', VIDEO_SOURCES: 'piped,invidious',   // "youtube" vẫn tự thêm làm nguồn cuối
    PIPED_API_URLS: FAKE + '/piped', INVIDIOUS_API_URLS: FAKE + '/inv',
    YOUTUBE_WEB_BASE: FAKE + '/yt', YOUTUBE_SUGGEST_URL: FAKE + '/complete/search', YOUTUBE_IFRAME_API_URL: FAKE + '/iframe_api',
    YOUTUBE_DIRECT_PER_HOUR: '40', MUSIC_QUERY: 'nhạc e2e10 ' + process.pid },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let phpErr = '';
php.stderr.on('data', (d) => { phpErr += d.toString(); });
process.on('exit', () => {
  try { php.kill(); } catch (e) { /* đã tắt */ }
  try { fake.close(); } catch (e) { /* đã tắt */ }
  fs.rmSync(DB, { force: true });
  fs.rmSync(DB + '.ratelimit', { recursive: true, force: true });
});
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(ORIGIN + '/api/health')).ok) break; } catch (e) { /* chưa sẵn sàng */ }
  await sleep(100);
}

// ---------- A. API và tiêu đề ----------
{
  const res = await fetch(ORIGIN + '/');
  const csp = res.headers.get('content-security-policy') || '';
  const html = await res.text();
  const boot = JSON.parse((/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/.exec(html) || [])[1] || '{}');
  check('A1 trang gửi cấu hình trình phát YouTube cho giao diện', boot.youtube && boot.youtube.embed === true && boot.youtube.iframeApi === FAKE + '/iframe_api', JSON.stringify(boot.youtube));
  const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src ')) || '';
  const frameSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('frame-src ')) || '';
  check('A2 CSP cho chạy thư viện trình phát và nhúng khung từ đúng nguồn YouTube, vẫn cấm script nội tuyến tùy ý',
    scriptSrc.includes(FAKE) && frameSrc.includes(FAKE) && frameSrc.includes('https://www.youtube.com') && !scriptSrc.includes("'unsafe-inline'"), scriptSrc + ' | ' + frameSrc);
  const adm = (await fetch(ORIGIN + '/admin')).headers.get('content-security-policy') || '';
  check('A3 trang quản trị không mở nguồn YouTube', !adm.includes(FAKE) && !adm.includes('youtube'));

  const s = await (await fetch(ORIGIN + '/api/youtube/search?q=' + encodeURIComponent(Q))).json();
  check('A4 Piped/Invidious hỏng -> tìm kiếm trực tiếp từ YouTube', s.ok && s.data.items.map((x) => x.id).join() === [A, B, C, D].join() && s.data.next === 'y:TRANG-2', JSON.stringify(s).slice(0, 200));
  const before = hits.filter((x) => x === 'POST /yt/youtubei/v1/search').length;
  await fetch(ORIGIN + '/api/youtube/search?q=' + encodeURIComponent(Q));
  check('A5 cùng từ khóa lần hai lấy từ bộ nhớ đệm, không hỏi lại YouTube', hits.filter((x) => x === 'POST /yt/youtubei/v1/search').length === before);
  const p2 = await (await fetch(ORIGIN + '/api/youtube/search?q=' + encodeURIComponent(Q) + '&page=y%3ATRANG-2')).json();
  check('A6 trang sau đi thẳng YouTube', p2.ok && p2.data.items.length === 1 && p2.data.items[0].id === R);
  const sg = await (await fetch(ORIGIN + '/api/youtube/suggest?q=' + encodeURIComponent('nhạc'))).json();
  check('A7 gợi ý tìm kiếm từ YouTube', sg.ok && sg.data.suggestions[0] === 'nhạc youtube một', JSON.stringify(sg));
  const st = await (await fetch(ORIGIN + '/api/youtube/stream/' + A)).json();
  check('A8 không có luồng trực tiếp -> máy chủ trả embed kèm bài liên quan', st.ok && st.data.embed === true && st.data.source === 'youtube' && st.data.related[0].id === R, JSON.stringify(st).slice(0, 200));
  const sd = await (await fetch(ORIGIN + '/api/youtube/stream/' + D)).json();
  check('A9 video có luồng từ Invidious thì vẫn trả luồng trực tiếp (giao diện tự xử lý khi luồng hỏng)', sd.ok && sd.data.source === 'invidious' && !sd.data.embed && sd.data.sources[0].url.indexOf(FAKE + '/inv/broken.mp4') === 0);
}

// ---------- B. Giao diện trên Chromium ----------
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
// Giai đoạn 12: hàng đợi lúc mở web lấy từ playlist trên thiết bị (không còn lấy danh sách gợi ý): tạo sẵn A, B, C, D.
await page.addInitScript((items) => { try { localStorage.setItem('carweb_playlists', JSON.stringify({ playlists: [{ id: 'l1', name: 'Thử', items, updated_at: '2026-01-01T00:00:00Z' }] })); } catch (e) { /* bỏ qua */ } },
  [A, B, C, D].map((id) => ({ id, title: TITLES[id], uploader: 'Kênh YouTube', duration: 200, thumbnail: '' })));
await page.addInitScript(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => { window.__csp.push(e.violatedDirective + ' ' + e.blockedURI); });
});
page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|i\.ytimg\.com/.test(m.text())) errors.push(m.text()); });
const log = () => page.evaluate(() => (window.__ytLog || []).slice());
const waitLog = (re, ms = 10000) => page.waitForFunction((src) => (window.__ytLog || []).some((l) => new RegExp(src).test(l)), re.source, { timeout: ms }).then(() => true, () => false);

await page.goto(ORIGIN + '/');
await page.getByRole('button', { name: 'Dùng thử, không cần tài khoản' }).click();
const startedA = await waitLog(new RegExp('^play:' + A + '$'));
const status = () => page.evaluate(() => {
  const st = document.querySelector('.stage');
  return { embed: st && st.classList.contains('is-embed'), frame: !!document.querySelector('.media-embed iframe.yt-fake'), videoHidden: document.querySelector('video.media-video').hidden,
    title: (document.querySelector('.now-title') || {}).textContent, tag: !(document.querySelector('.now-source') || { hidden: true }).hidden,
    tapHidden: getComputedStyle(document.querySelector('.stage-tap')).display === 'none' };
});
const s1 = await status();
check('B1 mở web: danh sách nhạc lấy từ YouTube, tự phát bài đầu bằng trình phát YouTube', startedA && s1.embed && s1.frame && s1.videoHidden && s1.title === TITLES[A], JSON.stringify(s1));
check('B2 hiện nhãn "Trình phát YouTube", bỏ lớp chạm để bấm được nút của YouTube', s1.tag && s1.tapHidden);
check('B3 trình phát được tạo với origin của website (YouTube cần để nhận lệnh điều khiển)', (await log()).some((l) => l === 'new:' + A + ':origin=' + ORIGIN));
const t1 = await page.waitForFunction(() => { const s = document.querySelector('.seek'); return s && Number(s.value) >= 1; }, null, { timeout: 6000 }).then(() => true, () => false);
const seekInfo = await page.evaluate(() => ({ max: document.querySelector('.seek').max, time: document.querySelector('.time').textContent }));
check('B4 thanh tua chạy theo trình phát YouTube và biết thời lượng', t1 && seekInfo.max === '200', JSON.stringify(seekInfo));
await page.getByRole('button', { name: 'Tạm dừng' }).first().click();
const paused = await waitLog(new RegExp('^pause:' + A + '$'), 3000);
await page.waitForTimeout(300);
const playLabel = await page.locator('.ctl-main').first().getAttribute('aria-label');
check('B5 nút Tạm dừng của website dừng được trình phát YouTube', paused && playLabel === 'Phát', playLabel);
await page.locator('.seek').evaluate((el) => { el.value = '120'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
check('B6 tua bằng thanh tua của website', (await log()).includes('seek:120'));
// 9.1: các nút thao tác nằm NGOÀI khung video (hàng dưới tên bài); khi phát bằng trình phát YouTube thì ẩn Cửa sổ nổi
// và Toàn màn hình (YouTube có nút toàn màn hình riêng), chỉ giữ nút "Chỉ hiện video".
const tools = await page.evaluate(() => {
  const vis = (lbl) => { const b = document.querySelector('.now-row .stage-tools button[aria-label="' + lbl + '"]'); return b ? !b.hidden && b.offsetParent !== null : null; };
  const st = document.querySelector('.stage').getBoundingClientRect();
  const tb = document.querySelector('.now-row .stage-tools');
  const r = tb ? tb.getBoundingClientRect() : null;
  return { inStage: document.querySelectorAll('.stage .stage-tools').length, pip: vis('Cửa sổ nổi'), fs: vis('Toàn màn hình'), theater: vis('Chỉ hiện video'),
    outside: r ? (r.top >= st.bottom - 1 || r.bottom <= st.top + 1) : false };
});
check('B7 nút thao tác nằm ngoài khung video; chế độ YouTube ẩn Cửa sổ nổi + Toàn màn hình, giữ "Chỉ hiện video"',
  tools.inStage === 0 && tools.outside && tools.pip === false && tools.fs === false && tools.theater === true, JSON.stringify(tools));
await page.screenshot({ path: path.join(here, 'shot-phase9-embed.png') });

// bài kế: B cấm nhúng -> báo lỗi, tự chuyển sang C; C hết sau 2 giây -> tự sang D; D luồng trực tiếp 404 -> trình phát YouTube
await page.getByRole('button', { name: 'Bài kế tiếp' }).first().click();
const sawB = await waitLog(new RegExp('^play:' + B + '$'));
const toastB = await page.getByText('Chủ video không cho phát trên website khác.', { exact: false }).first().waitFor({ timeout: 6000 }).then(() => true, () => false);
const sawC = await waitLog(new RegExp('^play:' + C + '$'));
check('B8 video cấm nhúng: báo "Chủ video không cho phát..." và tự chuyển bài kế', sawB && toastB && sawC);
const sawD = await waitLog(new RegExp('^play:' + D + '$'), 15000);
const lines = await log();
check('B9 hết bài tự sang bài sau (trình phát YouTube báo hết bài)', lines.indexOf('cue:' + D) > lines.indexOf('play:' + C), lines.slice(-6).join(' '));
const s2 = await status();
check('B10 luồng trực tiếp không phát được trên trình duyệt -> tự chuyển sang trình phát YouTube', sawD && s2.embed && s2.title === TITLES[D] && hits.some((x) => x.indexOf('GET /inv/broken.mp4') === 0), JSON.stringify(s2));
check('B11 dùng lại MỘT trình phát YouTube cho mọi bài (không tạo khung mới)', lines.filter((l) => l.indexOf('new:') === 0).length === 1 && (await page.locator('.media-embed iframe').count()) === 1);

await page.waitForFunction(() => document.querySelector('.ctl-main').getAttribute('aria-label') === 'Tạm dừng', null, { timeout: 3000 }).catch(() => {});
const autoInfo = await page.evaluate(() => ({ label: document.querySelector('.ctl-main').getAttribute('aria-label'),
  overlay: [...document.querySelectorAll('button')].some((b) => b.offsetParent !== null && /Bấm để phát/.test(b.textContent)) }));
check('B11b đổi bài/tự chuyển bài thì video tự phát, không cần bấm lại (dùng loadVideoById, không hiện "Bấm để phát")',
  lines.includes('load:' + D) && autoInfo.label === 'Tạm dừng' && !autoInfo.overlay, JSON.stringify(autoInfo));
const flashed = await page.evaluate(() => [...document.querySelectorAll('.toast, [role="alert"], [role="status"]')].map((t) => t.textContent).join(' | '));
check('B11c không hiện thông báo "không phát được"/"cần bấm" khi chuyển bài thành công', !/bấm để phát|không tự phát|chặn tự phát/i.test(flashed), flashed);

// tìm kiếm trên giao diện
await page.locator('.rail').getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
await page.getByLabel('Tìm kiếm video').fill(Q);
await page.getByLabel('Tìm kiếm video').press('Enter');
const rows = await page.waitForFunction(() => document.querySelectorAll('.view:not([hidden]) .vrow').length === 4, null, { timeout: 8000 }).then(() => true, () => false);
check('B12 giao diện tìm kiếm hiện kết quả từ YouTube', rows);
check('B13 không có vi phạm CSP nào', (await page.evaluate(() => window.__csp.length)) === 0, await page.evaluate(() => window.__csp.join(' | ')));

// màn hình xe 1024x600: khung YouTube vừa khung, không tràn
await page.setViewportSize({ width: 1024, height: 600 });
await page.locator('.rail').getByRole('button', { name: 'Trang chủ', exact: true }).click().catch(() => {});
await page.waitForTimeout(500);
const fit = await page.evaluate(() => {
  const st = document.querySelector('.stage').getBoundingClientRect();
  const fr = document.querySelector('.media-embed iframe').getBoundingClientRect();
  return { ok: Math.abs(st.width - fr.width) < 2 && Math.abs(st.height - fr.height) < 2, sw: document.documentElement.scrollWidth <= innerWidth, st: [st.width, st.height], fr: [fr.width, fr.height] };
});
check('B14 1024x600: khung YouTube vừa khít khung trình phát, không tràn ngang', fit.ok && fit.sw, JSON.stringify(fit));
await page.screenshot({ path: path.join(here, 'shot-phase9-embed-1024x600.png') });
const home = await page.evaluate(() => ({ rows: document.querySelectorAll('.view:not([hidden]) .vrow').length, text: document.body.innerText }));
check('B15 Trang chủ "Tất cả" hiện danh sách video để chọn', home.rows > 0, 'số dòng ' + home.rows);
check('B16 không còn chữ "[object ...]" hay "null" trên giao diện', !/\[object |\bnull\b/.test(home.text), (/.{0,30}(\[object |\bnull\b).{0,30}/.exec(home.text) || [''])[0]);
await ctx.close();
await browser.close();

// ---------- C. Giới hạn số lần hỏi YouTube mỗi giờ (YOUTUBE_DIRECT_PER_HOUR=40) ----------
{
  let blocked = null;
  for (let i = 0; i < 45 && !blocked; i++) {
    const r = await (await fetch(ORIGIN + '/api/youtube/search?q=' + encodeURIComponent('khóa ' + RUN + ' ' + i))).json();
    if (!r.ok) blocked = { i, r };
  }
  const ytCalls = hits.filter((x) => x.indexOf('/yt/youtubei') >= 0 || x.indexOf('/complete/search') >= 0).length;
  check('C1 vượt giới hạn mỗi giờ thì máy chủ ngừng hỏi YouTube và báo lỗi dễ hiểu', blocked && blocked.r.error.code === 'UPSTREAM_FAILED' && ytCalls <= 40, JSON.stringify(blocked && blocked.r) + ' / ' + ytCalls + ' lần');
}

// ---------- D. DEFAULT_VIDEO_URL: mở website là phát video mặc định (máy chủ PHP thứ hai có biến này) ----------
{
  const PORT2 = PORT + 1;
  const ORIGIN2 = `http://127.0.0.1:${PORT2}`;
  const DB2 = DB + '-2';
  fs.rmSync(DB2, { force: true });
  const php2 = spawn('php', ['-S', `127.0.0.1:${PORT2}`, '-t', PUBLIC_DIR, path.join(PROJECT, 'tests/support/serve_sqlite.php')], {
    env: { ...process.env, CARWEB_TEST_DB: DB2, CARWEB_TEST_SEED: '1', CARWEB_TEST_MASTER_EMAIL: MASTER.email, CARWEB_TEST_MASTER_PASS: MASTER.pass,
      APP_URL: ORIGIN2, MAIL_DRIVER: 'log', APP_DEBUG: 'false', VIDEO_SOURCES: 'piped,invidious',
      PIPED_API_URLS: FAKE + '/piped', INVIDIOUS_API_URLS: FAKE + '/inv',
      YOUTUBE_WEB_BASE: FAKE + '/yt', YOUTUBE_SUGGEST_URL: FAKE + '/complete/search', YOUTUBE_IFRAME_API_URL: FAKE + '/iframe_api',
      MUSIC_QUERY: 'nhạc e2e10 ' + process.pid, DEFAULT_VIDEO_URL: 'https://youtu.be/' + R + '?si=chiase' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  php2.stderr.on('data', (d) => { phpErr += d.toString(); });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(ORIGIN2 + '/api/health')).ok) break; } catch (e) { /* chưa sẵn sàng */ }
    await sleep(100);
  }
  const html = await (await fetch(ORIGIN2 + '/')).text();
  const boot = JSON.parse((/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/.exec(html) || [])[1] || '{}');
  check('D1 máy chủ đọc DEFAULT_VIDEO_URL (dạng youtu.be/...?si=) ra mã video', boot.youtube && boot.youtube.defaultVideo === R, JSON.stringify(boot.youtube));
  const b2 = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p2 = await (await b2.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  p2.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  await p2.goto(ORIGIN2 + '/');
  await p2.getByRole('button', { name: 'Dùng thử, không cần tài khoản' }).click();
  const first = await p2.waitForFunction(() => (window.__ytLog || []).some((l) => /^play:/.test(l)), null, { timeout: 10000 }).then(() => p2.evaluate(() => window.__ytLog.find((l) => /^play:/.test(l))), () => null);
  const title = await p2.waitForFunction((t) => { const e = document.querySelector('.now-title'); return e && e.textContent === t; }, 'Tên thật ' + R, { timeout: 5000 }).then(() => true, () => false);
  const q = await p2.evaluate(() => document.querySelectorAll('.queue-list li, .qrow').length);
  check('D2 mở website là tự phát video mặc định, sau đó hiện đúng tên bài lấy từ YouTube', first === 'play:' + R && title, String(first));
  await p2.screenshot({ path: path.join(here, 'shot-phase91-default.png') });

  // trình duyệt chặn tự phát có tiếng: tự tắt tiếng để vẫn phát, hiện nút "Bật tiếng"; bấm thì có tiếng lại
  const p3 = await (await b2.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  p3.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  await p3.addInitScript(() => { window.__blockSound = true; });
  await p3.goto(ORIGIN2 + '/');
  await p3.getByRole('button', { name: 'Dùng thử, không cần tài khoản' }).click();
  const mutedPlay = await p3.waitForFunction(() => { const l = window.__ytLog || []; return l.indexOf('mute') >= 0 && l.slice(l.indexOf('mute')).some((x) => /^play:/.test(x)); }, null, { timeout: 10000 }).then(() => true, () => false);
  await p3.waitForFunction(() => document.querySelector('.ctl-main').getAttribute('aria-label') === 'Tạm dừng', null, { timeout: 5000 }).catch(() => {});
  const soundBtn = p3.getByRole('button', { name: 'Bật tiếng' });
  const btnShown = await soundBtn.isVisible().catch(() => false);
  const lbl3 = await p3.evaluate(() => { const b = document.querySelector('.ctl-main'); return b ? b.getAttribute('aria-label') : document.body.innerText.slice(0, 300); });
  check('D3 trình duyệt chặn tự phát có tiếng: tự tắt tiếng để video VẪN phát, hiện nút "Bật tiếng"', mutedPlay && btnShown && lbl3 === 'Tạm dừng', JSON.stringify({ mutedPlay, btnShown, lbl3 }));
  await p3.screenshot({ path: path.join(here, 'shot-phase91-muted.png') });
  await soundBtn.click().catch(() => {});
  const unmuted = await p3.waitForFunction(() => (window.__ytLog || []).includes('unmute'), null, { timeout: 3000 }).then(() => true, () => false);
  check('D4 bấm "Bật tiếng" (hoặc chạm bất kỳ đâu trên website) thì có tiếng lại và nút ẩn đi', unmuted && !(await soundBtn.isVisible().catch(() => false)));
  await b2.close();
  php2.kill();
  fs.rmSync(DB2, { force: true });
  fs.rmSync(DB2 + '.ratelimit', { recursive: true, force: true });
}

check('không có lỗi JavaScript nào', errors.length === 0, errors.slice(0, 3).join(' | '));
check('PHP không báo lỗi/cảnh báo nào', !/Warning|Fatal|Notice|Deprecated/.test(phpErr), phpErr.split('\n').filter((l) => /Warning|Fatal|Notice|Deprecated/.test(l)).slice(0, 2).join(' '));
console.log(failures ? `\nCÓ ${failures} MỤC CHƯA ĐẠT` : '\nTẤT CẢ ĐẠT');
process.exit(failures ? 1 : 0);
