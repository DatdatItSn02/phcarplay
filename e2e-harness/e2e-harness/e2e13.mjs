import { createRequire } from 'node:module';
import { execSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');

// Giai đoạn 12: hàng đợi khi mở web và các chế độ phát, trên PHP THẬT (php -S + SQLite tạm) và Chromium thật.
// Máy chủ GIẢ: Piped/Invidious hỏng, YouTube (youtubei) trả bài gợi ý, iframe_api GIẢ chạy nhanh (mỗi bài dài 40 giây, hết sau ~3 giây thật).
// Kiểm tra: hàng đợi lúc mở web = bài hay nghe -> playlist -> video mặc định cuối, KHÔNG gọi tìm kiếm; người mới + Tự phát bật thì
// tìm 1 bài gợi ý, Tự phát tắt thì không phát; Lặp 1 bài, Lặp toàn bộ, Tắt lặp + Tự phát, Trộn bài; nhớ lựa chọn (thiết bị + tài khoản).
// Video mặc định chỉ vào hàng đợi khi chưa có bài hay nghe và bài trong playlist. Trộn bài = phát ngẫu nhiên, không sắp xếp lại hàng đợi.
// Không thử được: YouTube thật.
const PUBLIC_DIR = process.env.PUBLIC_DIR;
if (!PUBLIC_DIR) { console.error('Cần đặt PUBLIC_DIR=/duong/dan/den/public'); process.exit(2); }
const PROJECT = path.dirname(PUBLIC_DIR);
const here = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.env.PORT || 8098);
const FAKE_PORT = Number(process.env.FAKE_PORT || 8136);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const FAKE = `http://localhost:${FAKE_PORT}`;
const DB = path.join(os.tmpdir(), `carweb-e2e13-${process.pid}.sqlite`);
const MASTER = { email: 'master@test.local', pass: 'Master-12345' };
const RUN = (process.pid.toString(36) + 'zzzzz').slice(0, 5);

let failures = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const vid = (n) => ('T' + RUN + String(n).padStart(5, '0')).slice(0, 11);
const TREND = Array.from({ length: 25 }, (_, i) => vid(i));
const DEF = ('D' + RUN + 'ddddddddd').slice(0, 11);
const P = Array.from({ length: 10 }, (_, i) => ('P' + RUN + String(i).padStart(5, '0')).slice(0, 11));
const ytHits = [];
const X = ('X' + RUN + 'xxxxxxxxx').slice(0, 11);
const Y = ('Y' + RUN + 'yyyyyyyyy').slice(0, 11);
const vr = (id) => ({ videoRenderer: { videoId: id, title: { runs: [{ text: 'Bài ' + id }] }, ownerText: { runs: [{ text: 'Kênh' }] }, lengthText: { simpleText: '3:20' } } });
const searchPage = (ids) => ({ contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: ids.map(vr) } }] } } } } });

const fakeIframeApi = `(function(){
  window.__ytLog=[];
  function Player(el, o){ var s=this; this.o=o; this.id=o.videoId; this.t=0; this.timer=null; var f=document.createElement('iframe'); f.src='about:blank'; el.parentNode.replaceChild(f, el);
    setTimeout(function(){ o.events.onReady({target:s}); }, 30); }
  Player.prototype.set=function(st){ this.state=st; this.o.events.onStateChange({data:st}); };
  Player.prototype.playVideo=function(){ var s=this; window.__ytLog.push('play:'+this.id); clearInterval(this.timer);
    setTimeout(function(){ s.set(1); s.timer=setInterval(function(){ s.t+=3; if(s.t>=40){ clearInterval(s.timer); s.t=40; s.set(0); } }, 200); }, 30); };
  Player.prototype.loadVideoById=function(id){ clearInterval(this.timer); this.id=id; this.t=0; this.playVideo(); };
  Player.prototype.pauseVideo=function(){ clearInterval(this.timer); this.set(2); };
  Player.prototype.stopVideo=function(){ clearInterval(this.timer); };
  ['seekTo','destroy','cueVideoById'].forEach(function(m){ Player.prototype[m]=function(){}; });
  Player.prototype.mute=function(){ window.__ytLog.push('mute'); }; Player.prototype.unMute=function(){ window.__ytLog.push('unmute'); };
  Player.prototype.setVolume=function(v){ window.__ytLog.push('vol:'+v); };
  Player.prototype.getCurrentTime=function(){ return this.t; }; Player.prototype.getDuration=function(){ return 40; };
  Player.prototype.getVideoData=function(){ return { video_id: this.id, title: 'x', author: 'y' }; };
  window.YT={Player:Player}; if (typeof window.onYouTubeIframeAPIReady==='function') window.onYouTubeIframeAPIReady();
})();`;
const fake = http.createServer(async (req, res) => {
  const u = new URL(req.url, FAKE);
  for await (const c of req) { void c; }
  const json = (o, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname.startsWith('/piped/')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>down</html>'); }
  if (u.pathname.startsWith('/inv/')) return json({ error: 'bảo trì' }, 500);
  if (u.pathname.startsWith('/yt/')) ytHits.push(u.pathname);
  if (u.pathname === '/yt/youtubei/v1/search') return json(searchPage(TREND));
  if (u.pathname === '/yt/youtubei/v1/next') return json(searchPage([]));
  if (u.pathname === '/complete/search') return json([u.searchParams.get('q'), []]);
  if (u.pathname === '/iframe_api') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(fakeIframeApi); }
  res.writeHead(404); res.end('no');
});
await new Promise((r) => fake.listen(FAKE_PORT, r));

fs.rmSync(DB, { force: true });
const php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', PUBLIC_DIR, path.join(PROJECT, 'tests/support/serve_sqlite.php')], {
  env: { ...process.env, CARWEB_TEST_DB: DB, CARWEB_TEST_SEED: '1', CARWEB_TEST_MASTER_EMAIL: MASTER.email, CARWEB_TEST_MASTER_PASS: MASTER.pass,
    APP_URL: ORIGIN, MAIL_DRIVER: 'log', APP_DEBUG: 'false', VIDEO_SOURCES: 'piped,invidious',
    PIPED_API_URLS: FAKE + '/piped', INVIDIOUS_API_URLS: FAKE + '/inv',
    YOUTUBE_WEB_BASE: FAKE + '/yt', YOUTUBE_SUGGEST_URL: FAKE + '/complete/search', YOUTUBE_IFRAME_API_URL: FAKE + '/iframe_api',
    YOUTUBE_KEY_HINT: 'false', MUSIC_QUERY: 'nhạc e2e13 ' + RUN, DEFAULT_VIDEO_URL: 'https://youtu.be/' + DEF },
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

function sql(query, params = []) {
  const code = '$p=new PDO("sqlite:".$argv[1]);$s=$p->prepare($argv[2]);$s->execute(json_decode($argv[3],true));echo json_encode($s->fetchAll(PDO::FETCH_ASSOC));';
  const r = spawnSync('php', ['-r', code, DB, query, JSON.stringify(params)], { encoding: 'utf8' });
  return JSON.parse(r.stdout || '[]');
}
function jar() {
  const cookies = {};
  const self = {
    csrf: '',
    async call(method, url, body) {
      const h = { Accept: 'application/json' };
      const c = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
      if (c) h.Cookie = c;
      if (body !== undefined) h['Content-Type'] = 'application/json';
      if (method !== 'GET' && self.csrf) h['X-CSRF-Token'] = self.csrf;
      const res = await fetch(ORIGIN + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const line of res.headers.getSetCookie()) { const [pair] = line.split(';'); const i = pair.indexOf('='); cookies[pair.slice(0, i)] = pair.slice(i + 1); }
      let json = null;
      try { json = await res.json(); } catch (e) { /* không phải JSON */ }
      return { status: res.status, json, code: json && json.error ? json.error.code : null };
    },
    async refresh() { const me = await self.call('GET', '/api/auth/me'); self.csrf = me.json.data.csrf; },
  };
  return self;
}
const item = (id) => ({ id, title: 'Bài ' + id, uploader: 'Kênh', duration: 200, thumbnail: 'javascript:alert(1)' });
const countOf = (email, id) => { const r = sql('SELECT play_count FROM user_play_stats WHERE video_id = ? AND user_id = (SELECT id FROM users WHERE email = ?)', [id, email]); return r.length ? Number(r[0].play_count) : 0; };


const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const apiCalls = [];
async function newPage(init = null) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|i\.ytimg\.com/.test(m.text())) errors.push(m.text()); });
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/youtube/')) apiCalls.push(u.pathname); });
  if (init) await page.addInitScript(init.fn, init.arg);
  return { ctx, page };
}
const ytlog = (page) => page.evaluate(() => (window.__ytLog || []).slice());
const plays = async (page) => (await ytlog(page)).filter((l) => /^play:/.test(l)).map((l) => l.slice(5));
const queueIds = (page) => page.evaluate(() => [...document.querySelectorAll('.view:not([hidden]) .vrow')].map((li) => li.getAttribute('data-id')));
const openQueue = async (page) => { await page.locator('.rail').getByRole('button', { name: 'Hàng đợi', exact: true }).click(); await page.waitForTimeout(300); };
const waitPlays = (page, n, ms = 12000) => page.waitForFunction((k) => (window.__ytLog || []).filter((l) => /^play:/.test(l)).length >= k, n, { timeout: ms }).then(() => true, () => false);
const label = (page) => page.locator('.pill-repeat').getAttribute('aria-label');

// ---------- A. Người có tài khoản: hàng đợi lúc mở web ----------
const u = jar();
await u.refresh();
await u.call('POST', '/api/auth/register', { email: 'hangdoi@test.local', name: 'Hàng Đợi', password: 'mat-khau-1', phone: '0913000131' });
await u.refresh();
for (const id of [TREND[3], TREND[3], TREND[3], TREND[4], TREND[4]]) await u.call('POST', '/api/user/plays', item(id));
const pl = await u.call('POST', '/api/playlists', { name: 'Đi làm' });
const pid = pl.json.data.id || (pl.json.data.playlist && pl.json.data.playlist.id);
await u.call('POST', `/api/playlists/${pid}/items`, { items: [P[0], TREND[4]].concat(P.slice(1)).map(item) });
await u.call('POST', '/api/auth/logout');

let { ctx, page } = await newPage();
await page.goto(ORIGIN + '/');
await page.getByRole('button', { name: /Đăng nhập/ }).first().click().catch(() => {});
apiCalls.length = 0; ytHits.length = 0;
await page.getByLabel('Email').fill('hangdoi@test.local');
await page.getByLabel('Mật khẩu', { exact: true }).fill('mat-khau-1');
await page.locator('form').getByRole('button', { name: 'Đăng nhập', exact: true }).click();
await waitPlays(page, 1);
await openQueue(page);
let q = await queueIds(page);
check('A1 mở web: hàng đợi = bài hay nghe (nhiều lượt trước) -> bài trong playlist, không trùng; đã có bài nên KHÔNG thêm video mặc định',
  q.join() === [TREND[3], TREND[4]].concat(P).join(), JSON.stringify(q));
check('A2 tự phát bài đầu hàng đợi (bài hay nghe nhất)', (await plays(page))[0] === TREND[3]);
check('A3 lúc mở web không gọi tìm kiếm để thêm bài vào hàng đợi (chỉ Trang chủ tải danh sách gợi ý để hiển thị)', !apiCalls.includes('/api/youtube/search'), JSON.stringify([...new Set(apiCalls)]));
await page.screenshot({ path: path.join(here, 'shot-phase12-queue.png') });
const LAST = P[P.length - 1];
const mode = async () => (await label(page)).replace('Chế độ phát: ', '');
const setMode = async (want) => { for (let i = 0; i < 4 && (await mode()) !== want; i++) await page.locator('.pill-repeat').click(); };
const mixState = () => page.evaluate(() => { const b = [...document.querySelectorAll('.ctlrow .pill')].find((x) => /Tự phát/.test(x.textContent)); return { pressed: b.getAttribute('aria-pressed'), locked: b.getAttribute('aria-disabled') }; });

// ---------- B. Chế độ phát (một nút: Lần lượt -> Lặp tất cả -> Lặp 1 bài -> Trộn bài) ----------
const seen = [await mode()];
for (let i = 0; i < 4; i++) { await page.locator('.pill-repeat').click(); seen.push(await mode()); }
check('B1 một nút chế độ phát đổi vòng: lần lượt -> lặp tất cả -> lặp 1 bài -> trộn bài -> lần lượt', seen.join(' > ') === 'lần lượt > lặp tất cả > lặp 1 bài > trộn bài > lần lượt', seen.join(' > '));
await setMode('lặp 1 bài');
let n = (await plays(page)).length;
await waitPlays(page, n + 1);
let p = await plays(page);
check('B2 Lặp 1 bài: hết bài phát lại chính bài đó', p[p.length - 1] === p[p.length - 2], JSON.stringify(p.slice(-3)));
const curBefore = p[p.length - 1];
await page.getByRole('button', { name: 'Bài kế tiếp' }).first().click();
await page.waitForTimeout(800);
p = await plays(page);
check('B3 đang Lặp 1 bài bấm "Bài kế tiếp" vẫn chuyển bài, chế độ giữ nguyên', p[p.length - 1] !== curBefore && (await mode()) === 'lặp 1 bài', JSON.stringify(p.slice(-3)));

const m1 = await mixState();
await page.locator('.ctlrow .pill', { hasText: 'Tự phát' }).click({ force: true });   // nút có aria-disabled (vẫn bấm được để nghe lý do) nên Playwright cần force
const toastLock = await page.getByText('Tự phát chỉ dùng được ở chế độ Lần lượt.').first().waitFor({ timeout: 3000 }).then(() => true, () => false);
const m2 = await mixState();
await setMode('lặp tất cả');
const m3 = await mixState();
check('B4 đang lặp (1 bài / tất cả): Tự phát tắt và khóa, bấm thì báo "chỉ dùng được ở chế độ Lần lượt", không đổi lựa chọn',
  m1.pressed === 'false' && m1.locked === 'true' && toastLock && m2.pressed === 'false' && m3.locked === 'true', JSON.stringify([m1, m2, m3]));
await openQueue(page);
n = (await plays(page)).length;
await page.locator(`.view:not([hidden]) .vrow[data-id="${LAST}"] .vmain`).click();
await waitPlays(page, n + 2);
p = await plays(page);
check('B5 Lặp tất cả: hết bài cuối thì quay về bài đầu hàng đợi', p[p.length - 2] === LAST && p[p.length - 1] === TREND[3], JSON.stringify(p.slice(-3)));

// Trộn bài: phát ngẫu nhiên, hàng đợi giữ nguyên
await setMode('trộn bài');
const m4 = await mixState();
const before = await queueIds(page);
await page.locator(`.view:not([hidden]) .vrow[data-id="${before[0]}"] .vmain`).click();   // bắt đầu từ bài đầu, sau khi đã bật Trộn bài
await page.waitForTimeout(300);
n = (await plays(page)).length;
await waitPlays(page, n + 3, 20000);
p = await plays(page);
const after = await queueIds(page);
const seq = p.slice(n - 1, n + 3).map((id) => before.indexOf(id));   // bài đầu + 3 bài trộn tiếp theo
check('B6 Trộn bài: hàng đợi GIỮ NGUYÊN thứ tự, bài kế được chọn ngẫu nhiên (không theo thứ tự), không lặp lại bài vừa phát; Tự phát khóa',
  after.join() === before.join() && new Set(seq).size === 4 && seq.join() !== '0,1,2,3' && m4.locked === 'true' && m4.pressed === 'false',
  JSON.stringify({ order: seq, m4 }));

// Lỗi người dùng báo (bản 12.3): Trộn bài, đang ở bài CUỐI hàng đợi, bấm "Bài kế tiếp" nhiều lần hơn số bài -> không bao giờ "Đã hết bài"
await page.locator(`.view:not([hidden]) .vrow[data-id="${LAST}"] .vmain`).click();
await page.waitForTimeout(400);
let stopped = false;
for (let i = 0; i < before.length + 3; i++) {
  await page.getByRole('button', { name: 'Bài kế tiếp' }).first().click();
  await page.waitForTimeout(250);
  const t = await page.evaluate(() => (document.querySelector('.stage-overlay.on .overlay-text') || {}).textContent || '');
  if (/hết bài/i.test(t)) { stopped = true; break; }
}
check('B6b Trộn bài: ở bài cuối hàng đợi bấm "Bài kế tiếp" liên tục (quá số bài) vẫn chuyển bài, hết lượt thì trộn lượt mới', !stopped && (await queueIds(page)).join() === before.join());

// Lần lượt + Tự phát tắt: hết hàng đợi thì dừng
await setMode('lần lượt');
await page.locator('.ctlrow .pill', { hasText: 'Tự phát' }).click();   // tắt Tự phát
await page.locator(`.view:not([hidden]) .vrow[data-id="${LAST}"] .vmain`).click();
await page.waitForTimeout(4500);
const st = await page.evaluate(() => ({ label: document.querySelector('.ctl-main').getAttribute('aria-label'), text: (document.querySelector('.overlay-text') || {}).textContent }));
const qAfter = await queueIds(page);
check('B7 Lần lượt + Tự phát tắt: hết hàng đợi thì dừng, không thêm bài', st.label === 'Phát' && qAfter.length === before.length, JSON.stringify(st));

// Lần lượt + Tự phát bật: hết hàng đợi thì tự thêm bài
await page.locator('.ctlrow .pill', { hasText: 'Tự phát' }).click();
n = (await plays(page)).length;
await page.locator(`.view:not([hidden]) .vrow[data-id="${LAST}"] .vmain`).click();
await waitPlays(page, n + 2);
await page.waitForTimeout(400);
const qMix = await queueIds(page);
check('B8 Lần lượt + Tự phát bật: hết hàng đợi thì tự thêm bài gợi ý và phát tiếp', qMix.length === before.length + 1, `${before.length} -> ${qMix.length}`);

// Âm lượng: thanh ngay dưới hàng nút, áp vào trình phát YouTube, nút loa tắt/bật tiếng
const volBox = await page.evaluate(() => { const c = document.querySelector('.ctlrow').getBoundingClientRect(); const v = document.querySelector('.volrow'); const r = v ? v.getBoundingClientRect() : null; const s = document.querySelector('.volrow .vol'); return r ? { below: r.top >= c.bottom - 1, h: Math.round(r.height), thumbOk: s.getBoundingClientRect().height >= 44 } : null; });
await page.locator('.volrow .vol').evaluate((el) => { el.value = '35'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(200);
let yl = await ytlog(page);
const volText1 = await page.locator('.vol-text').textContent();
check('V1 thanh âm lượng nằm ngay dưới hàng nút, đủ cao để chạm; kéo tới 35% thì trình phát YouTube nhận âm lượng 35', volBox && volBox.below && volBox.thumbOk && yl.includes('vol:35') && volText1 === '35%', JSON.stringify({ volBox, volText1 }));
await page.getByRole('button', { name: 'Tắt tiếng' }).click();
await page.waitForTimeout(200);
yl = await ytlog(page);
const t2 = await page.locator('.vol-text').textContent();
await page.getByRole('button', { name: 'Bật tiếng' }).click();
await page.waitForTimeout(200);
const yl2 = await ytlog(page);
check('V2 nút loa: tắt tiếng (trình phát nhận mute, chữ "Tắt tiếng") rồi bật lại (unmute, về 35%)', yl.slice(-2).includes('mute') && t2 === 'Tắt tiếng' && yl2.slice(-2).includes('unmute') && (await page.locator('.vol-text').textContent()) === '35%', JSON.stringify(yl2.slice(-4)));

// Nhớ lựa chọn: đặt Lặp 1 bài + Trộn bài, tải lại trang
await setMode('lặp 1 bài');
await page.waitForTimeout(1200);   // chờ gửi lên tài khoản
const prefPuts = [];
page.on('response', async (r) => { if (r.url().includes('/api/user/preferences') && r.request().method() === 'PUT') prefPuts.push(r.status() + ' ' + (await r.text().catch(() => ''))); });
await page.reload();
await page.waitForSelector('.pill-repeat');
await page.waitForTimeout(1500);
check('B9 tải lại trang: vẫn nhớ "Lặp 1 bài" và âm lượng 35%', (await mode()) === 'lặp 1 bài' && (await page.locator('.vol-text').textContent()) === '35%');
const prefsRow = sql("SELECT data FROM user_preferences WHERE user_id = (SELECT id FROM users WHERE email = 'hangdoi@test.local')")[0] || {};
check('B10 lựa chọn được lưu trên tài khoản (đổi thiết bị vẫn còn)', /"repeat":"one"/.test(prefsRow.data || ''), (prefsRow.data || '') + ' ' + JSON.stringify(sql('SELECT * FROM user_preferences')) + ' ' + JSON.stringify(prefPuts));
const fit = await page.evaluate(() => { const r = document.querySelector('.ctlrow').getBoundingClientRect(); const pl = document.querySelector('.player').getBoundingClientRect(); return { ok: r.right <= pl.right + 1 && document.documentElement.scrollWidth <= innerWidth, w: r.width }; });
const noScroll = await page.evaluate(() => { const p = document.querySelector('.player'); return p.scrollHeight - p.clientHeight <= 1; });
check('B11 1024x600: hàng nút và thanh âm lượng vừa khung, không tràn, không phải cuộn', fit.ok && noScroll, JSON.stringify(fit));
await page.screenshot({ path: path.join(here, 'shot-phase12-controls.png') });
await ctx.close();

// ---------- C. Người mới (khách, chưa có gì) ----------
({ ctx, page } = await newPage());
apiCalls.length = 0;
await page.goto(ORIGIN + '/');
await page.getByRole('button', { name: 'Dùng thử, không cần tài khoản' }).click();
await waitPlays(page, 1);
await openQueue(page);
q = await queueIds(page);
check('C1 khách mới, Tự phát bật: chỉ có video mặc định -> phát nó (hàng đợi không tự thêm danh sách gợi ý)', q.join() === DEF && (await plays(page))[0] === DEF, JSON.stringify(q));
await ctx.close();

({ ctx, page } = await newPage({ fn: () => { try { localStorage.setItem('carweb_playback', JSON.stringify({ repeat: 'off', shuffle: false, autoMix: false })); } catch (e) { /* bỏ qua */ } }, arg: null }));
await page.goto(ORIGIN + '/');
await page.getByRole('button', { name: 'Dùng thử, không cần tài khoản' }).click();
await page.waitForTimeout(2500);
await openQueue(page);
q = await queueIds(page);
check('C2 Tự phát tắt: chỉ phát những gì có trong hàng đợi (ở đây là video mặc định), không tìm thêm', q.join() === DEF, JSON.stringify(q));
await ctx.close();
await browser.close();

check('không có lỗi JavaScript nào', errors.length === 0, errors.slice(0, 3).join(' | '));
check('PHP không báo lỗi/cảnh báo nào', !/Warning|Fatal|Notice|Deprecated/.test(phpErr), phpErr.split('\n').filter((l) => /Warning|Fatal|Notice|Deprecated/.test(l)).slice(0, 2).join(' '));
console.log(failures ? `\nCÓ ${failures} MỤC CHƯA ĐẠT` : '\nTẤT CẢ ĐẠT');
process.exit(failures ? 1 : 0);
