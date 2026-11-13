import { createRequire } from 'node:module';
import { execSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');

// Giai đoạn 10: khóa YouTube Data API riêng của người dùng, trên PHP THẬT (php -S + SQLite tạm) và Chromium thật,
// với máy chủ GIẢ đóng vai Piped hỏng, Invidious hỏng, YouTube (youtubei) và YouTube Data API (googleapis).
// Khóa giả: AIza...TOT (dùng được), AIza...HET (hết lượt), AIza...SAI (Google báo sai).
// Kiểm tra: lưu/thay/bỏ khóa qua API và qua Cài đặt; database chỉ có bản mã hóa; tìm kiếm dùng đúng khóa của người đó;
// khách và người khác không dùng khóa này; khóa hết lượt thì vẫn có kết quả kèm thông báo nhẹ; bỏ khóa không dùng DELETE.
// Không thử được: Google thật (máy thử không có Internet).
const PUBLIC_DIR = process.env.PUBLIC_DIR;
if (!PUBLIC_DIR) { console.error('Cần đặt PUBLIC_DIR=/duong/dan/den/public'); process.exit(2); }
const PROJECT = path.dirname(PUBLIC_DIR);
const here = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.env.PORT || 8096);
const FAKE_PORT = Number(process.env.FAKE_PORT || 8134);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const FAKE = `http://localhost:${FAKE_PORT}`;
const DB = path.join(os.tmpdir(), `carweb-e2e11-${process.pid}.sqlite`);
const MASTER = { email: 'master@test.local', pass: 'Master-12345' };
const RUN = (process.pid.toString(36) + 'zzzzz').slice(0, 5);
const KEY_OK = 'AIzaSyE2E-KHOA-TOT-000000000000-' + RUN + 'TOT';
const KEY_QUOTA = 'AIzaSyE2E-KHOA-HET-000000000000-' + RUN + 'HET';
const KEY_BAD = 'AIzaSyE2E-KHOA-SAI-000000000000-' + RUN + 'SAI';
const KEY_WEB = 'AIzaSyE2E-KHOA-WEB-000000000000-' + RUN + 'WEB';   // khóa giới hạn theo website (chọn sai ở bước 2)

let failures = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const vid = (s) => (s + RUN + 'xxxxxxxxxxx').slice(0, 11);
const API_VID = vid('APIKEY');
const DIRECT_VID = vid('DIRECT');
const vr = (id, title) => ({ videoRenderer: { videoId: id, title: { runs: [{ text: title }] }, ownerText: { runs: [{ text: 'Kênh' }] }, lengthText: { simpleText: '3:20' } } });
const searchPage = (items) => ({ contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: items } }] } } } } });

const apiCalls = [];   // các lần gọi Data API: { path, key, q }
const fakeIframeApi = `(function(){
  function Player(el, o){ var s=this; this.o=o; this.id=o.videoId; var f=document.createElement('iframe'); f.src='about:blank'; el.parentNode.replaceChild(f, el);
    setTimeout(function(){ o.events.onReady({target:s}); }, 30); }
  Player.prototype.playVideo=function(){ var s=this; setTimeout(function(){ s.o.events.onStateChange({data:1}); }, 30); };
  Player.prototype.loadVideoById=function(id){ this.id=id; this.playVideo(); };
  ['pauseVideo','stopVideo','seekTo','mute','unMute','destroy'].forEach(function(m){ Player.prototype[m]=function(){}; });
  Player.prototype.getCurrentTime=function(){ return 0; }; Player.prototype.getDuration=function(){ return 200; };
  Player.prototype.getVideoData=function(){ return { video_id: this.id, title: 'x', author: 'y' }; };
  window.YT={Player:Player}; if (typeof window.onYouTubeIframeAPIReady==='function') window.onYouTubeIframeAPIReady();
})();`;
const fake = http.createServer(async (req, res) => {
  const u = new URL(req.url, FAKE);
  for await (const c of req) { void c; }
  const json = (o, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname.startsWith('/piped/')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>down</html>'); }
  if (u.pathname.startsWith('/inv/')) return json({ error: 'bảo trì' }, 500);
  if (u.pathname === '/yt/youtubei/v1/search') return json(searchPage([vr(DIRECT_VID, 'Bài đọc trực tiếp')]));
  if (u.pathname.startsWith('/gapi/')) {
    const key = u.searchParams.get('key') || '';
    apiCalls.push({ path: u.pathname, key, q: u.searchParams.get('q') || '' });
    if (key === KEY_BAD) return json({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', errors: [{ reason: 'badRequest' }], status: 'INVALID_ARGUMENT', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }] } }, 400);
    if (key === KEY_WEB) return json({ error: { code: 403, message: 'Requests from referer <empty> are blocked.', errors: [{ reason: 'forbidden' }], status: 'PERMISSION_DENIED', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }] } }, 403);
    if (key === KEY_QUOTA) return json({ error: { code: 403, errors: [{ reason: 'quotaExceeded' }] } }, 403);
    if (key !== KEY_OK) return json({ error: { code: 400, errors: [{ reason: 'keyInvalid' }] } }, 400);
    if (u.pathname === '/gapi/videos' && u.searchParams.get('part') === 'id') return json({ items: [{ id: 'dQw4w9WgXcQ' }] });
    if (u.pathname === '/gapi/videos') return json({ items: [{ id: API_VID, contentDetails: { duration: 'PT4M' }, statistics: { viewCount: '77' } }] });
    if (u.pathname === '/gapi/search') return json({ items: [{ id: { videoId: API_VID }, snippet: { title: 'Bài từ khóa riêng', channelTitle: 'Kênh API', liveBroadcastContent: 'none' } }] });
  }
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
    YOUTUBE_API_BASE: FAKE + '/gapi', APP_KEY: 'e2e11-ma-bi-mat-cua-website-' + RUN, MUSIC_QUERY: 'nhạc e2e11 ' + RUN },
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
const search = async (who, q) => (await who.call('GET', '/api/youtube/search?q=' + encodeURIComponent(q))).json;

// ---------- A. API ----------
const guest = jar();
await guest.refresh();
check('A1 khách không xem/lưu được khóa riêng (cần đăng nhập)', (await guest.call('GET', '/api/user/youtube-key')).status === 401);

const a = jar();
await a.refresh();
await a.call('POST', '/api/auth/register', { email: 'khoa@test.local', name: 'Có Khóa', password: 'mat-khau-1', phone: '0911000111' });
await a.refresh();
const st0 = (await a.call('GET', '/api/user/youtube-key')).json.data;
check('A2 người dùng mới: tính năng bật, chưa có khóa', st0.enabled === true && st0.has_key === false, JSON.stringify(st0));

const badFmt = await a.call('PUT', '/api/user/youtube-key', { key: 'abc' });
const badKey = await a.call('PUT', '/api/user/youtube-key', { key: KEY_BAD });
const webKey = await a.call('PUT', '/api/user/youtube-key', { key: KEY_WEB });
check('A3 khóa sai dạng hoặc Google báo sai thì không lưu, báo đúng cách sửa (dán thiếu ký tự / chọn sai "Giới hạn ứng dụng")',
  badFmt.code === 'VALIDATION_FAILED' && badKey.code === 'VALIDATION_FAILED' && /dán thiếu/.test(badKey.json.error.details.key)
  && webKey.code === 'VALIDATION_FAILED' && /Giới hạn ứng dụng/.test(webKey.json.error.details.key) && /Không có/.test(webKey.json.error.details.key)
  && sql('SELECT * FROM user_api_keys').length === 0,
  JSON.stringify([badKey.json && badKey.json.error.details, webKey.json && webKey.json.error.details]));

const before = apiCalls.length;
const saved = await a.call('PUT', '/api/user/youtube-key', { key: KEY_OK });
const s = saved.json.data;
check('A4 lưu khóa đúng: thử với Google đúng 1 lần, chỉ trả 4 ký tự cuối',
  saved.status === 200 && s.has_key && s.last4 === KEY_OK.slice(-4) && s.checked === 'ok' && !JSON.stringify(saved.json).includes(KEY_OK)
  && apiCalls.length - before === 1 && apiCalls[apiCalls.length - 1].path === '/gapi/videos', JSON.stringify(s));
const row = sql('SELECT key_enc, key_hint FROM user_api_keys')[0] || {};
check('A5 database chỉ có bản mã hóa của khóa', row.key_enc && row.key_enc.startsWith('v1:') && !row.key_enc.includes('AIza') && row.key_hint === KEY_OK.slice(-4));

const n1 = apiCalls.length;
const r1 = await search(a, 'mưa ' + RUN);
check('A6 người có khóa: tìm kiếm đi thẳng bằng khóa của chính mình (không cần Piped/đọc trực tiếp)',
  r1.ok && r1.data.items[0].id === API_VID && apiCalls.slice(n1).some((c) => c.path === '/gapi/search' && c.key === KEY_OK), JSON.stringify(r1).slice(0, 160));

const n2 = apiCalls.length;
const g = await search(guest, 'nắng ' + RUN);
const b = jar();
await b.refresh();
await b.call('POST', '/api/auth/register', { email: 'khongkhoa@test.local', name: 'Không Khóa', password: 'mat-khau-2', phone: '0911000112' });
await b.refresh();
const rb = await search(b, 'gió ' + RUN);
check('A7 khách và người khác KHÔNG dùng khóa này: tìm bằng cách khác',
  g.ok && g.data.items[0].id === DIRECT_VID && rb.ok && rb.data.items[0].id === DIRECT_VID && apiCalls.slice(n2).length === 0, JSON.stringify(apiCalls.slice(n2)));

const r1b = await search(a, 'mưa ' + RUN);
check('A8 cùng từ khóa lần hai lấy từ bộ nhớ đệm, không tốn lượt', r1b.ok && apiCalls.length === n2);

// khóa hết lượt: Google không cho thử -> vẫn lưu (báo rõ), tìm kiếm vẫn có kết quả kèm thông báo nhẹ
const q = await a.call('PUT', '/api/user/youtube-key', { key: KEY_QUOTA });
check('A9 thay bằng khóa đang hết lượt: vẫn lưu, báo "quota"', q.status === 200 && q.json.data.checked === 'quota' && q.json.data.state === 'quota', JSON.stringify(q.json.data));
const r2 = await search(a, 'sấm ' + RUN);
check('A10 khóa hết lượt: vẫn có kết quả (đọc trực tiếp) và có thông báo nhẹ', r2.ok && r2.data.items[0].id === DIRECT_VID && /hết lượt hôm nay/.test(r2.data.notice || ''), JSON.stringify(r2.data).slice(0, 200));

const del = await a.call('DELETE', '/api/user/youtube-key');
const rows = sql('SELECT key_enc, key_hint FROM user_api_keys WHERE user_id = (SELECT id FROM users WHERE email = ?)', ['khoa@test.local']);
check('A11 bỏ khóa: còn dòng trong database nhưng để trống (không DELETE)', del.status === 200 && del.json.data.has_key === false && rows.length === 1 && rows[0].key_enc === null);

// ---------- B. Giao diện Cài đặt ----------
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|i\.ytimg\.com/.test(m.text())) errors.push(m.text()); });
await page.goto(ORIGIN + '/');
await page.getByRole('button', { name: /Đăng nhập/ }).first().click().catch(() => {});
await page.getByLabel('Email').fill('khoa@test.local');
await page.getByLabel('Mật khẩu', { exact: true }).fill('mat-khau-1');
await page.locator('form').getByRole('button', { name: 'Đăng nhập', exact: true }).click();
await page.locator('.rail').getByRole('button', { name: 'Cài đặt' }).click();
const sec = page.locator('.ykey');
await sec.locator('.ykey-steps').waitFor({ timeout: 5000 });
const guide = await page.evaluate(() => ({
  steps: [...document.querySelectorAll('.ykey-steps > li > strong')].map((e) => e.textContent),
  sub2: document.querySelectorAll('.ykey-steps > li:nth-child(2) .ykey-sub > li').length,
  warn: (document.querySelector('.ykey-steps .ykey-warn') || {}).textContent || '',
  links: [...document.querySelectorAll('.ykey-steps a')].map((a) => [a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')]),
  beforeInput: (() => { const st = document.querySelector('.ykey-steps'); const inp = document.querySelector('#ykey-input'); return Boolean(st && inp && (st.compareDocumentPosition(inp) & Node.DOCUMENT_POSITION_FOLLOWING)); })(),
}));
check('B1 Cài đặt có mục "Khóa YouTube API của bạn": 3 bước hiện sẵn trước ô nhập, bước 2 chia 5 bước nhỏ có cảnh báo chỗ dễ sai, nút mở thẳng đúng trang Google (tab mới)',
  await page.getByRole('heading', { name: 'Khóa YouTube API của bạn' }).isVisible() && guide.steps.length === 3 && guide.beforeInput && guide.sub2 === 5 && /Websites/.test(guide.warn)
  && guide.links.length === 2 && guide.links.every((l) => /^https:\/\/console\.cloud\.google\.com\//.test(l[0]) && l[1] === '_blank' && /noopener/.test(l[2])), JSON.stringify(guide));
await sec.locator('.ykey-steps').scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(here, 'shot-phase10-guide.png') });
await sec.locator('.ykey-steps > li').nth(1).screenshot({ path: path.join(here, 'shot-phase11-step2.png') });
await sec.getByText('Câu hỏi thường gặp').click();
check('B1b có mục câu hỏi thường gặp (miễn phí, an toàn)', await sec.getByText('Có mất tiền không?').isVisible());
await sec.getByLabel('Dán khóa YouTube').fill(KEY_BAD);
await sec.getByRole('button', { name: 'Kiểm tra và lưu' }).click();
const errShown = await sec.getByRole('alert').filter({ hasText: 'dán thiếu' }).waitFor({ timeout: 5000 }).then(() => true, () => false);
check('B2 dán khóa sai: báo lỗi ngay dưới ô nhập', errShown);
await sec.getByLabel('Dán khóa YouTube').fill(KEY_OK);
await sec.getByRole('button', { name: 'Kiểm tra và lưu' }).click();
const ok = await sec.getByText('••••' + KEY_OK.slice(-4)).waitFor({ timeout: 5000 }).then(() => true, () => false);
check('B3 dán khóa đúng: hiện "Khóa đang dùng ••••xxxx" và trạng thái dùng được', ok && await sec.getByText('Đang dùng được').isVisible());
check('B4 trang không chứa khóa đầy đủ sau khi lưu', !(await page.content()).includes(KEY_OK));
await page.screenshot({ path: path.join(here, 'shot-phase10-key.png') });
await sec.getByRole('button', { name: 'Bỏ khóa' }).click();
const removed = await sec.getByLabel('Dán khóa YouTube').waitFor({ timeout: 5000 }).then(() => true, () => false);
check('B5 bấm "Bỏ khóa": quay về ô nhập khóa', removed);
const fit = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
check('B6 1024x600: không tràn ngang', fit);
await ctx.close();

// ---------- C. Nhắc thêm khóa (giai đoạn 10.2) ----------
async function searchUi(pg, text) {
  await pg.locator('.rail').getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
  await pg.getByLabel('Tìm kiếm video').fill(text);
  await pg.getByLabel('Tìm kiếm video').press('Enter');
  await pg.waitForFunction(() => document.querySelectorAll('.view:not([hidden]) .vrow').length > 0, null, { timeout: 8000 }).catch(() => {});
  await pg.waitForTimeout(200);
}
const hintOf = (pg) => pg.evaluate(() => { const e = document.querySelector('.view:not([hidden]) .key-hint'); return e ? e.innerText : null; });
{
  // khách: tìm phải dùng cách dự phòng -> hiện nhắc mời đăng nhập; lần tìm sau cùng ngày không nhắc
  const gctx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
  const gp = await gctx.newPage();
  gp.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  await gp.goto(ORIGIN + '/');
  await gp.getByRole('button', { name: 'Dùng thử, không cần tài khoản' }).click();
  await searchUi(gp, 'mây ' + RUN);
  const h1 = await hintOf(gp);
  const btns = await gp.evaluate(() => [...document.querySelectorAll('.key-hint button')].map((b) => { const r = b.getBoundingClientRect(); return [b.textContent, Math.round(r.top), Math.round(r.height)]; }));
check('C1 khách tìm phải dùng cách dự phòng: hiện dòng nhắc nhẹ, nút "Đăng nhập" và "Để sau" cùng một hàng, đủ lớn để chạm',
  h1 && /Tìm kiếm đang chậm/.test(h1) && /Đăng nhập rồi thêm khóa/.test(h1) && btns.length === 2 && btns[0][0] === 'Đăng nhập' && btns[1][0] === 'Để sau' && btns[0][1] === btns[1][1] && btns[0][2] >= 44, JSON.stringify(btns));
  await gp.screenshot({ path: path.join(here, 'shot-phase10-hint.png') });
  await searchUi(gp, 'trăng ' + RUN);
  check('C2 cùng ngày tìm tiếp: không nhắc lại', (await hintOf(gp)) === null);
  const box = await gp.evaluate(() => { const v = document.querySelector('.stage'); return v ? !document.querySelector('.stage .key-hint') : true; });
  check('C3 dòng nhắc không bao giờ nằm trên khung video', box);
  await gctx.close();

  // người đã đăng nhập, chưa có khóa: bấm "Thêm khóa" mở thẳng mục khóa trong Cài đặt
  const uctx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
  const up = await uctx.newPage();
  up.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  await up.goto(ORIGIN + '/');
  await up.getByRole('button', { name: /Đăng nhập/ }).first().click().catch(() => {});
  await up.getByLabel('Email').fill('khongkhoa@test.local');
  await up.getByLabel('Mật khẩu', { exact: true }).fill('mat-khau-2');
  await up.locator('form').getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await up.locator('.rail').getByRole('button', { name: 'Tìm kiếm', exact: true }).waitFor();
  await searchUi(up, 'sương ' + RUN);
  const h2 = await hintOf(up);
  await up.locator('.key-hint').getByRole('button', { name: 'Thêm khóa' }).click().catch(() => {});
  const opened = await up.locator('#set-ykey').waitFor({ timeout: 5000 }).then(() => true, () => false);
  const inView = opened && await up.evaluate(() => { const r = document.querySelector('#set-ykey').getBoundingClientRect(); return r.top >= -1 && r.top < innerHeight; });
  check('C4 người đã đăng nhập chưa có khóa: nút "Thêm khóa" mở Cài đặt, cuộn thẳng tới mục khóa', h2 && /Thêm khóa/.test(h2) && !/Đăng nhập/.test(h2) && inView, String(h2));
  await up.keyboard.press('Escape');
  // "Để sau": 7 ngày không nhắc (giả lập ngày mai bằng cách lùi lastShown, vẫn trong 7 ngày)
  await up.evaluate(() => { localStorage.setItem('carweb.keyHint', JSON.stringify({ lastShown: 0, snoozeUntil: Date.now() + 6 * 86400000 })); });
  await searchUi(up, 'nắng mới ' + RUN);
  check('C5 đã bấm "Để sau": trong 7 ngày không nhắc', (await hintOf(up)) === null);
  await uctx.close();

  // người có khóa riêng: không bao giờ nhắc
  const kctx = await browser.newContext({ viewport: { width: 1024, height: 600 } });
  const kp = await kctx.newPage();
  await kp.goto(ORIGIN + '/');
  await kp.getByRole('button', { name: /Đăng nhập/ }).first().click().catch(() => {});
  await kp.getByLabel('Email').fill('khoa@test.local');
  await kp.getByLabel('Mật khẩu', { exact: true }).fill('mat-khau-1');
  await kp.locator('form').getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await kp.locator('.rail').getByRole('button', { name: 'Cài đặt' }).click();
  await kp.getByLabel('Dán khóa YouTube').fill(KEY_OK);
  await kp.getByRole('button', { name: 'Kiểm tra và lưu' }).click();
  await kp.getByText('••••' + KEY_OK.slice(-4)).waitFor({ timeout: 5000 }).catch(() => {});
  await kp.keyboard.press('Escape');
  await kp.evaluate(() => { localStorage.removeItem('carweb.keyHint'); });
  await searchUi(kp, 'hoa ' + RUN);
  check('C6 người đã có khóa riêng: không nhắc', (await hintOf(kp)) === null);
  await kctx.close();
}
const hintApi = await search(guest, 'mưa phùn ' + RUN);
check('C7 máy chủ chỉ gắn key_hint khi phải dùng cách dự phòng và người dùng chưa có khóa', hintApi.data.key_hint === true && !('key_hint' in r1.data));
await browser.close();

check('không có lỗi JavaScript nào', errors.length === 0, errors.slice(0, 3).join(' | '));
check('PHP không báo lỗi/cảnh báo nào', !/Warning|Fatal|Notice|Deprecated/.test(phpErr), phpErr.split('\n').filter((l) => /Warning|Fatal|Notice|Deprecated/.test(l)).slice(0, 2).join(' '));
check('log không chứa khóa API', !fs.readdirSync(path.join(PROJECT, 'storage/logs')).some((f) => { try { return fs.readFileSync(path.join(PROJECT, 'storage/logs', f), 'utf8').includes(KEY_OK); } catch (e) { return false; } }));
console.log(failures ? `\nCÓ ${failures} MỤC CHƯA ĐẠT` : '\nTẤT CẢ ĐẠT');
process.exit(failures ? 1 : 0);
