import { createRequire } from 'node:module';
import { execSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');

// Giai đoạn 11: "bài bạn hay nghe" ở đầu tab "Tất cả", trên PHP THẬT (php -S + SQLite tạm) và Chromium thật.
// Máy chủ GIẢ: Piped/Invidious hỏng, YouTube (youtubei) trả 25 bài gợi ý, thư viện iframe_api GIẢ chạy nhanh
// (1 giây thật = 15 giây phát) để thử được quy tắc "nghe từ 30 giây mới tính 1 lượt".
// Kiểm tra: đếm lượt trên trình duyệt (khách: lưu trên thiết bị; tài khoản: lưu trên máy chủ), tab "Tất cả" có bài hay nghe
// đứng đầu kèm dấu "Bạn hay nghe", đủ 20 bài, không trùng; ẩn một bài; xóa danh sách trong Cài đặt; không dùng DELETE.
// Không thử được: YouTube thật.
const PUBLIC_DIR = process.env.PUBLIC_DIR;
if (!PUBLIC_DIR) { console.error('Cần đặt PUBLIC_DIR=/duong/dan/den/public'); process.exit(2); }
const PROJECT = path.dirname(PUBLIC_DIR);
const here = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.env.PORT || 8097);
const FAKE_PORT = Number(process.env.FAKE_PORT || 8135);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const FAKE = `http://localhost:${FAKE_PORT}`;
const DB = path.join(os.tmpdir(), `carweb-e2e12-${process.pid}.sqlite`);
const MASTER = { email: 'master@test.local', pass: 'Master-12345' };
const RUN = (process.pid.toString(36) + 'zzzzz').slice(0, 5);

let failures = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const vid = (n) => ('T' + RUN + String(n).padStart(5, '0')).slice(0, 11);
const TREND = Array.from({ length: 25 }, (_, i) => vid(i));
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
    setTimeout(function(){ s.set(1); s.timer=setInterval(function(){ s.t+=3; if(s.t>=200){ clearInterval(s.timer); s.t=200; s.set(0); } }, 200); }, 30); };
  Player.prototype.loadVideoById=function(id){ clearInterval(this.timer); this.id=id; this.t=0; this.playVideo(); };
  Player.prototype.pauseVideo=function(){ clearInterval(this.timer); this.set(2); };
  Player.prototype.stopVideo=function(){ clearInterval(this.timer); };
  ['seekTo','mute','unMute','destroy','cueVideoById'].forEach(function(m){ Player.prototype[m]=function(){}; });
  Player.prototype.getCurrentTime=function(){ return this.t; }; Player.prototype.getDuration=function(){ return 200; };
  Player.prototype.getVideoData=function(){ return { video_id: this.id, title: 'x', author: 'y' }; };
  window.YT={Player:Player}; if (typeof window.onYouTubeIframeAPIReady==='function') window.onYouTubeIframeAPIReady();
})();`;
const fake = http.createServer(async (req, res) => {
  const u = new URL(req.url, FAKE);
  for await (const c of req) { void c; }
  const json = (o, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname.startsWith('/piped/')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>down</html>'); }
  if (u.pathname.startsWith('/inv/')) return json({ error: 'bảo trì' }, 500);
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
    YOUTUBE_KEY_HINT: 'false', MUSIC_QUERY: 'nhạc e2e12 ' + RUN },
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

// ---------- A. API ----------
const guest = jar();
await guest.refresh();
check('A1 khách không gọi được API lượt nghe (lưu trên thiết bị)', (await guest.call('POST', '/api/user/plays', item(X))).status === 401);
const u = jar();
await u.refresh();
await u.call('POST', '/api/auth/register', { email: 'nghe@test.local', name: 'Người Nghe', password: 'mat-khau-1', phone: '0912000121' });
await u.refresh();
for (const id of [X, X, Y, Y, Y]) await u.call('POST', '/api/user/plays', item(id));
const bad = await u.call('POST', '/api/user/plays', item('ngan'));
const top = (await u.call('GET', '/api/user/plays/top')).json.data.items;
check('A2 API: bài nghe từ 2 lượt, nhiều lượt trước; mã sai bị từ chối; ảnh bìa tạo lại từ mã (không dùng đường dẫn gửi lên)',
  top.map((x) => x.id).join() === [Y, X].join() && top[0].plays === 3 && bad.code === 'VALIDATION_FAILED' && top[0].thumbnail === `https://i.ytimg.com/vi/${Y}/mqdefault.jpg`, JSON.stringify(top).slice(0, 200));

// ---------- B. Giao diện, người có tài khoản ----------
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|i\.ytimg\.com/.test(m.text())) errors.push(m.text()); });
  return { ctx, page };
}
const homeRows = (page) => page.evaluate(() => [...document.querySelectorAll('.view:not([hidden]) .vrow')].map((li) => ({
  id: li.getAttribute('data-id'), freq: li.getAttribute('data-frequent') === '1', text: li.innerText })));
const goHome = async (page) => {
  await page.locator('.rail').getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
  await page.locator('.rail').getByRole('button', { name: 'Trang chủ', exact: true }).click();
  await page.waitForTimeout(600);
};

let { ctx, page } = await newPage();
await page.goto(ORIGIN + '/');
await page.getByRole('button', { name: /Đăng nhập/ }).first().click().catch(() => {});
await page.getByLabel('Email').fill('nghe@test.local');
await page.getByLabel('Mật khẩu', { exact: true }).fill('mat-khau-1');
await page.locator('form').getByRole('button', { name: 'Đăng nhập', exact: true }).click();
await page.waitForFunction(() => document.querySelectorAll('.view:not([hidden]) .vrow').length >= 20, null, { timeout: 10000 }).catch(() => {});
let rows = await homeRows(page);
check('B1 tab "Tất cả": bài hay nghe đứng đầu (nhiều lượt trước), có dòng "Bạn hay nghe" (không ghi số lần nghe)',
  rows[0] && rows[0].id === Y && rows[1].id === X && rows[0].freq && /Bạn hay nghe/.test(rows[0].text) && !/lần/.test(rows[0].text) && !rows[2].freq && !/hay nghe/.test(rows[2].text), JSON.stringify(rows.slice(0, 3)));
check('B2 thiếu thì thêm bài gợi ý cho đủ 20 bài, không trùng, bài gợi ý không có dấu "hay nghe"',
  rows.length === 20 && new Set(rows.map((r) => r.id)).size === 20 && rows.slice(2).every((r) => !r.freq) && rows[2].id === TREND[0], `${rows.length} bài`);
check('B3 chỉ tab "Tất cả" có bài hay nghe (chỉ có một danh sách, không tách mục riêng)', (await page.locator('.view:not([hidden]) .vlist').count()) === 1);
await page.screenshot({ path: path.join(here, 'shot-phase11-home.png') });

// đếm lượt trên trình duyệt: mở web tự phát bài đầu (Y); phát thêm TREND[1] hai lần (mỗi lần từ 30 giây) -> vào danh sách
const playRow = async (id) => { await page.locator(`.view:not([hidden]) .vrow[data-id="${id}"] .vmain`).click(); };
await page.waitForFunction(() => (window.__ytLog || []).length > 0, null, { timeout: 8000 }).catch(() => {});
const before = countOf('nghe@test.local', TREND[1]);
await playRow(TREND[1]);
await page.waitForTimeout(800);   // ~12 giây phát: chưa đủ 30 giây
const early = countOf('nghe@test.local', TREND[1]);
await page.waitForTimeout(2200);  // ~45 giây
const once = countOf('nghe@test.local', TREND[1]);
await page.waitForTimeout(1500);
const still = countOf('nghe@test.local', TREND[1]);
check('B4 nghe chưa tới 30 giây thì chưa tính; tới 30 giây tính đúng 1 lượt (lưu trên máy chủ)', before === 0 && early === 0 && once === 1 && still === 1, JSON.stringify({ before, early, once, still }));
await playRow(TREND[1]);
await page.waitForTimeout(3000);
check('B5 bấm phát lại cùng bài là một lượt mới', countOf('nghe@test.local', TREND[1]) === 2);
await goHome(page);
rows = await homeRows(page);
const pos = rows.findIndex((r) => r.id === TREND[1]);
check('B6 quay lại Trang chủ: bài vừa nghe 2 lần tự lên nhóm "hay nghe" (không cần tải lại trang)', pos >= 0 && pos <= 2 && rows[pos].freq && rows.length === 20, JSON.stringify(rows.slice(0, 4)));

// ẩn một bài
await page.locator(`.view:not([hidden]) .vrow[data-id="${X}"] .vmore`).click();
await page.getByRole('menuitem', { name: 'Ẩn khỏi bài bạn hay nghe' }).click();
await page.waitForTimeout(600);
rows = await homeRows(page);
const xRow = sql("SELECT play_count, hidden_at FROM user_play_stats WHERE video_id = ?", [X])[0] || {};
check('B7 ⋮ → "Ẩn khỏi bài bạn hay nghe": bài biến khỏi nhóm hay nghe; database chỉ đưa lượt về 0 + ghi thời điểm ẩn (không xóa dòng)',
  !rows.some((r) => r.id === X && r.freq) && Number(xRow.play_count) === 0 && xRow.hidden_at, JSON.stringify(xRow));

// xóa danh sách trong Cài đặt
await page.locator('.rail').getByRole('button', { name: 'Cài đặt' }).click();
await page.getByRole('button', { name: 'Xóa danh sách hay nghe' }).click();
await page.getByRole('button', { name: 'Xóa danh sách', exact: true }).click();
await page.getByText('Đã xóa danh sách hay nghe.').first().waitFor({ timeout: 5000 }).catch(() => {});
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
rows = await homeRows(page);
const left = sql("SELECT COUNT(*) AS n, SUM(play_count) AS s FROM user_play_stats WHERE user_id = (SELECT id FROM users WHERE email = 'nghe@test.local')")[0];
check('B8 Cài đặt → "Xóa danh sách hay nghe" (có hỏi lại): tab "Tất cả" chỉ còn bài gợi ý; dữ liệu vẫn còn, chỉ về 0 lượt',
  rows.length === 20 && rows.every((r) => !r.freq) && Number(left.n) >= 3 && Number(left.s) === 0, JSON.stringify(left));
await ctx.close();

// ---------- C. Khách: lưu trên thiết bị ----------
({ ctx, page } = await newPage());
await page.goto(ORIGIN + '/');
await page.getByRole('button', { name: 'Dùng thử, không cần tài khoản' }).click();
await page.waitForFunction(() => document.querySelectorAll('.view:not([hidden]) .vrow').length >= 20, null, { timeout: 10000 }).catch(() => {});
const gPlay = async (id) => { await page.locator(`.view:not([hidden]) .vrow[data-id="${id}"] .vmain`).click(); await page.waitForTimeout(3000); };
await gPlay(TREND[5]);
await gPlay(TREND[5]);
await goHome(page);
rows = await homeRows(page);
const stored = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('carweb.plays') || '{}'); } catch (e) { return {}; } });
check('C1 khách: lượt nghe lưu trên thiết bị, bài nghe 2 lần lên đầu tab "Tất cả"; máy chủ không lưu gì',
  rows.length === 20 && rows.findIndex((r) => r.id === TREND[5]) <= 1 && rows.find((r) => r.id === TREND[5]).freq && stored[TREND[5]] && stored[TREND[5]].n >= 2
  && sql('SELECT * FROM user_play_stats WHERE video_id = ?', [TREND[5]]).length === 0, JSON.stringify(rows.slice(0, 2)));
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.view:not([hidden]) .vrow').length >= 20, null, { timeout: 10000 }).catch(() => {});
rows = await homeRows(page);
check('C2 khách mở lại web: vẫn nhớ bài hay nghe', rows.some((r) => r.id === TREND[5] && r.freq));
await ctx.close();
await browser.close();

check('không có lỗi JavaScript nào', errors.length === 0, errors.slice(0, 3).join(' | '));
check('PHP không báo lỗi/cảnh báo nào', !/Warning|Fatal|Notice|Deprecated/.test(phpErr), phpErr.split('\n').filter((l) => /Warning|Fatal|Notice|Deprecated/.test(l)).slice(0, 2).join(' '));
console.log(failures ? `\nCÓ ${failures} MỤC CHƯA ĐẠT` : '\nTẤT CẢ ĐẠT');
process.exit(failures ? 1 : 0);
