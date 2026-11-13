import { createRequire } from 'node:module';
import { execSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');

// Giai đoạn 8 trên PHP THẬT (php -S + SQLite tạm) và Chromium thật:
//  A. trang đăng nhập/đăng ký: form không bị kéo dài, nút chuyển không phình, đổi thẻ thì nút chuyển và phần đầu đứng yên (nhiều cỡ màn hình)
//  B. nguồn video dự phòng: Piped GIẢ hỏng (trả trang web thay vì dữ liệu), Invidious GIẢ chạy được (luồng phát là đường dẫn
//     tương đối "/latest_version?..." đi qua chính máy chủ Invidious) -> tìm kiếm và phát video vẫn được
//  C. trang quản trị Key: cột STT, ô tích, chọn tất cả, thanh thao tác hàng loạt (thu hồi, xóa), bộ lọc "Đã xóa" có người xóa
//  D. không dùng DELETE: người dùng xóa playlist / quản trị xóa người dùng -> dòng vẫn còn trong database, có người xóa và thời điểm
const PUBLIC_DIR = process.env.PUBLIC_DIR;
if (!PUBLIC_DIR) { console.error('Cần đặt PUBLIC_DIR=/duong/dan/den/public'); process.exit(2); }
const PROJECT = path.dirname(PUBLIC_DIR);
const here = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.env.PORT || 8095);
const FAKE_PORT = Number(process.env.FAKE_PORT || 8132);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const FAKE = `http://localhost:${FAKE_PORT}`;
const DB = path.join(os.tmpdir(), `carweb-e2e9-${process.pid}.sqlite`);
const MASTER = { email: 'master@test.local', pass: 'Master-12345' };

let failures = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Piped giả (hỏng) + Invidious giả (chạy) ----------
const clip = fs.readFileSync(path.join(here, 'clip.webm'));
const RUN = ('e9' + process.pid.toString(36) + 'zzzzzzzz').slice(0, 10);
const ids = [RUN + '1', RUN + '2', RUN + '3'];
const Q = 'nhạc ' + RUN;
const invItem = (id, i) => ({ type: 'video', videoId: id, title: 'Bài Invidious ' + (i + 1), author: 'Kênh Invidious', lengthSeconds: 200, viewCount: 1234, published: Math.floor(Date.now() / 1000) - 86400 });
const hits = [];
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, FAKE);
  hits.push(u.pathname);
  const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname.startsWith('/piped/')) {   // Piped hỏng kiểu hay gặp: trả trang web (Cloudflare) thay vì dữ liệu
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end('<!DOCTYPE html><html><body>Just a moment...</body></html>');
  }
  if (u.pathname === '/inv/api/v1/search') return json(Number(u.searchParams.get('page') || 1) > 1 ? [] : ids.map(invItem));
  if (u.pathname === '/inv/api/v1/search/suggestions') return json({ query: u.searchParams.get('q'), suggestions: ['nhạc &amp; thử'] });
  if (u.pathname.startsWith('/inv/api/v1/videos/')) {
    const id = u.pathname.split('/').pop();
    return json({ title: 'Bài Invidious', author: 'Kênh Invidious', lengthSeconds: 30, liveNow: false,
      formatStreams: [{ url: `/latest_version?id=${id}&itag=18&local=true`, type: 'video/webm; codecs="vp8"', size: '640x360', qualityLabel: '360p' }],
      adaptiveFormats: [], recommendedVideos: ids.map((x, i) => invItem(x, i)) });
  }
  if (u.pathname === '/inv/latest_version') {
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
await new Promise((r) => fake.listen(FAKE_PORT, r));

// ---------- PHP thật ----------
fs.rmSync(DB, { force: true });
const php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', PUBLIC_DIR, path.join(PROJECT, 'tests/support/serve_sqlite.php')], {
  env: { ...process.env, CARWEB_TEST_DB: DB, CARWEB_TEST_SEED: '1', CARWEB_TEST_MASTER_EMAIL: MASTER.email, CARWEB_TEST_MASTER_PASS: MASTER.pass,
    APP_URL: ORIGIN, MAIL_DRIVER: 'log', VIDEO_SOURCES: 'piped,invidious',
    PIPED_API_URLS: FAKE + '/piped', INVIDIOUS_API_URLS: FAKE + '/inv', PIPED_VERIFY_SSL: 'false', INVIDIOUS_VERIFY_SSL: 'false',
    MUSIC_QUERY: 'nhạc thử e2e9 ' + process.pid, APP_DEBUG: 'false' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let phpErr = '';
php.stderr.on('data', (d) => { phpErr += d.toString(); });
const stopAll = () => {
  try { php.kill(); } catch (e) { /* đã tắt */ }
  try { fake.close(); } catch (e) { /* đã tắt */ }
  fs.rmSync(DB, { force: true });
  fs.rmSync(DB + '.ratelimit', { recursive: true, force: true });
};
process.on('exit', stopAll);
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(ORIGIN + '/api/health')).ok) break; } catch (e) { /* chưa sẵn sàng */ }
  await sleep(100);
}

/** Đọc thẳng database SQLite (để chắc chắn dòng "đã xóa" vẫn còn). */
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
    async refresh(prefix) { const me = await self.call('GET', prefix + '/auth/me'); self.csrf = me.json.data.csrf; },
  };
  return self;
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
async function newPage(viewport = { width: 1280, height: 720 }, theme = 'dark') {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript((t) => { try { localStorage.setItem('carweb_theme', t); } catch (e) { /* bỏ qua */ } }, theme);
  return { ctx, page };
}

// ---------- A. Trang đăng nhập / đăng ký ----------
for (const [w, hgt] of [[983, 880], [800, 480], [1024, 600], [1366, 768], [1920, 1080], [390, 844]]) {
  const { ctx, page } = await newPage({ width: w, height: hgt });
  await page.goto(ORIGIN + '/');
  await page.getByRole('tab', { name: 'Đăng nhập' }).waitFor();
  const measure = () => page.evaluate(() => {
    const r = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) }; };
    const tab = r('.tab[aria-selected="true"]');
    const thumb = getComputedStyle(document.querySelector('.tabs'), '::before');
    return { tabs: r('.tabs'), tab, card: r('.auth .card'), top: r('.auth-top'), body: r('.auth-body'), sw: document.documentElement.scrollWidth, iw: innerWidth, thumbW: parseFloat(thumb.width) };
  });
  const a = await measure();
  await page.getByRole('tab', { name: 'Tạo tài khoản' }).click();
  await sleep(350);
  const b = await measure();
  const selected = await page.getByRole('tab', { name: 'Tạo tài khoản' }).getAttribute('aria-selected');
  check(`A ${w}x${hgt}: nút chuyển cao vừa phải (≤ 60px), viên trượt bằng nửa thanh, không tràn ngang`,
    a.tabs.h <= 60 && a.tab.h >= 44 && Math.abs(a.thumbW - (a.tabs.w / 2 - 6)) <= 3 && a.sw <= a.iw, JSON.stringify({ tabs: a.tabs.h, tab: a.tab.h, thumb: a.thumbW }));
  check(`A ${w}x${hgt}: khung form ôm vừa nội dung (không bị kéo dài)`, a.card.bottom - a.body.bottom <= 40, `card ${a.card.bottom} body ${a.body.bottom}`);
  check(`A ${w}x${hgt}: đổi sang Tạo tài khoản: phần đầu và nút chuyển đứng yên, viên trượt sang phải`,
    selected === 'true' && a.tabs.y === b.tabs.y && a.top.y === b.top.y && a.tabs.x === b.tabs.x && b.tab.x > a.tab.x, `tabs y ${a.tabs.y}->${b.tabs.y}`);
  if (w === 983) await page.screenshot({ path: path.join(here, 'shot-phase8-auth-983.png') });
  await ctx.close();
}

// ---------- B. Piped hỏng -> Invidious ----------
{
  const r = await (await fetch(ORIGIN + '/api/youtube/search?q=' + encodeURIComponent(Q))).json();
  check('B1 Piped trả trang web thay vì dữ liệu -> tìm kiếm tự chuyển sang Invidious', r.ok && r.data.items.length === 3 && r.data.items[0].title === 'Bài Invidious 1', JSON.stringify(r).slice(0, 160));
  check('B1 mã trang kế tiếp thuộc Invidious', r.ok && r.data.next === 'i:2');
  const pipedCalls = hits.filter((p) => p.startsWith('/piped/')).length;
  await fetch(ORIGIN + '/api/youtube/search?q=' + encodeURIComponent(Q + ' hai'));
  check('B2 Piped hỏng bị tạm bỏ qua: lần tìm sau không gọi lại Piped', hits.filter((p) => p.startsWith('/piped/')).length === pipedCalls, `${pipedCalls}`);
  const s = await (await fetch(ORIGIN + '/api/youtube/stream/' + ids[0])).json();
  check('B3 luồng phát lấy từ Invidious, đường dẫn đi qua máy chủ Invidious (đầy đủ địa chỉ)',
    s.ok && s.data.source === 'invidious' && s.data.sources[0].url === `${FAKE}/inv/latest_version?id=${ids[0]}&itag=18&local=true`, JSON.stringify(s).slice(0, 200));
  const sg = await (await fetch(ORIGIN + '/api/youtube/suggest?q=' + encodeURIComponent('nhạc ' + RUN))).json();
  check('B4 gợi ý tìm kiếm từ Invidious, đã đổi "&amp;" thành "&"', sg.ok && sg.data.suggestions[0] === 'nhạc & thử', JSON.stringify(sg));

  const { ctx, page } = await newPage();
  await page.goto(ORIGIN + '/');
  await page.getByRole('button', { name: 'Dùng thử, không cần tài khoản' }).click();
  const auto = await page.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.paused && v.currentTime > 0.3; }, null, { timeout: 15000 }).then(() => true, () => false);
  const src = await page.evaluate(() => (document.querySelector('video') || {}).currentSrc || '');
  check('B5 mở web: danh sách nhạc lấy từ Invidious và tự phát được video qua máy chủ Invidious (Chromium thật)', auto && src.startsWith(FAKE + '/inv/latest_version'), src);
  await page.locator('.rail').getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
  await page.getByLabel('Tìm kiếm video').fill(Q);
  await page.getByLabel('Tìm kiếm video').press('Enter');
  const results = await page.waitForFunction(() => document.querySelectorAll('.view:not([hidden]) .vrow').length === 3, null, { timeout: 8000 }).then(() => true, () => false);
  check('B6 giao diện hiện kết quả tìm kiếm (từ Invidious)', results);
  await ctx.close();
}

// ---------- C. Quản trị key: STT, ô tích, thao tác hàng loạt, Đã xóa ----------
{
  const m = jar();
  await m.refresh('/admin/api');
  await m.call('POST', '/admin/api/auth/login', { email: MASTER.email, password: MASTER.pass });
  await m.refresh('/admin/api');
  const made = await m.call('POST', '/admin/api/keys', { count: 5, days: 30, note: 'lô e2e9' });
  check('C0 tạo 5 key', made.status === 201 && made.json.data.items.length === 5);
  const bad = await m.call('POST', '/admin/api/keys/bulk', { action: 'xoa-het', ids: [] });
  check('C1 API hàng loạt kiểm tra dữ liệu (thao tác lạ, danh sách rỗng) -> 422', bad.status === 422 && bad.json.error.details.action && bad.json.error.details.ids, JSON.stringify(bad.json));

  const { ctx, page } = await newPage({ width: 1366, height: 768 });
  await page.goto(ORIGIN + '/admin');
  await page.getByLabel('Email').fill(MASTER.email);
  await page.getByLabel('Mật khẩu').fill(MASTER.pass);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.locator('.adm-nav').waitFor({ timeout: 8000 });
  await page.locator('.adm-nav').getByRole('link', { name: 'Key kích hoạt', exact: true }).click();
  await page.locator('tbody tr').first().waitFor({ timeout: 8000 });
  const heads = await page.locator('thead th').allTextContents();
  const stt = await page.locator('tbody td.num').allTextContents();
  check('C2 bảng key có cột ô tích và STT 1..5', heads[1] === 'STT' && (await page.locator('thead input[type=checkbox]').count()) === 1 && stt.join(',') === '1,2,3,4,5', heads.join('|') + ' / ' + stt.join(','));
  const boxSize = await page.locator('tbody .check-hit').first().boundingBox();
  check('C2 ô tích có vùng bấm ≥ 44px', boxSize && boxSize.width >= 44 && boxSize.height >= 44, JSON.stringify(boxSize));
  check('C3 chưa chọn gì thì không hiện thanh thao tác', await page.locator('.bulkbar').isHidden());
  await page.locator('tbody input[type=checkbox]').nth(0).check();
  await page.locator('tbody input[type=checkbox]').nth(1).check();
  const bar = await page.locator('.bulkbar').textContent();
  const headState = await page.locator('thead input[type=checkbox]').evaluate((el) => ({ checked: el.checked, ind: el.indeterminate }));
  check('C3 chọn 2 key: thanh thao tác hiện "Đã chọn 2 key", ô chọn tất cả ở trạng thái lưng chừng', /Đã chọn 2 key/.test(bar) && headState.ind && !headState.checked, bar);
  await page.locator('.bulkbar').getByRole('button', { name: /^Thu hồi/ }).click();
  await page.getByRole('button', { name: 'Thu hồi 2 key' }).click();
  await page.getByText('Đã thu hồi 2 key').waitFor({ timeout: 8000 });
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 5 && document.querySelector('.bulkbar').hidden);
  const revoked = (await m.call('GET', '/admin/api/keys?status=revoked')).json.data.total;
  check('C4 thu hồi hàng loạt: 2 key chuyển sang Đã thu hồi, bỏ chọn sau khi xong', revoked === 2, String(revoked));

  await page.locator('thead input[type=checkbox]').check();
  const allChecked = await page.locator('tbody input[type=checkbox]:checked').count();
  check('C5 chọn tất cả trong trang', allChecked === 5 && /Đã chọn 5 key/.test(await page.locator('.bulkbar').textContent()));
  await page.locator('.bulkbar').getByRole('button', { name: /^Xóa/ }).click();
  await page.getByRole('button', { name: 'Xóa 5 key' }).click();
  await page.getByText('Đã xóa 5 key').waitFor({ timeout: 8000 });
  await page.getByText('Chưa có key nào').waitFor({ timeout: 8000 });
  const rows = sql('SELECT COUNT(*) AS n, SUM(CASE WHEN deleted_at IS NOT NULL AND deleted_by_email = ? THEN 1 ELSE 0 END) AS d FROM license_keys', [MASTER.email]);
  check('C6 xóa hàng loạt: 5 key vẫn còn trong database, được đánh dấu người xóa và thời điểm', rows[0].n === 5 && rows[0].d === 5, JSON.stringify(rows));
  await page.getByLabel('Lọc theo trạng thái key').selectOption('deleted');
  await page.locator('tbody tr').first().waitFor({ timeout: 8000 });
  const delText = await page.locator('tbody').textContent();
  check('C7 bộ lọc "Đã xóa": hiện 5 key kèm người xóa', (await page.locator('tbody tr').count()) === 5 && delText.includes(MASTER.email) && (await page.locator('thead th', { hasText: 'Người xóa' }).count()) === 1);
  await page.screenshot({ path: path.join(here, 'shot-phase8-keys-deleted.png') });
  const audit = (await m.call('GET', '/admin/api/audit?action=key.bulk_delete')).json.data.items;
  check('C8 nhật ký: một dòng cho cả lô xóa', audit.length === 1 && /5 key/.test(audit[0].detail), JSON.stringify(audit).slice(0, 160));

  // màn hình điện thoại: bảng thành thẻ, ô tích vẫn bấm được
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Lọc theo trạng thái key').selectOption('');
  await page.waitForTimeout(500);
  await m.call('POST', '/admin/api/keys', { count: 2, days: 7, note: 'điện thoại' });
  await page.getByLabel('Lọc theo trạng thái key').selectOption('unused');
  await page.locator('tbody input[type=checkbox]').first().check();
  const sw = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check('C9 điện thoại: chọn được key, thanh thao tác hiện, không tràn ngang', sw && await page.locator('.bulkbar').isVisible());
  await page.screenshot({ path: path.join(here, 'shot-phase8-keys-phone.png') });
  await ctx.close();
}

// ---------- D. Không dùng DELETE: playlist, người dùng ----------
{
  const u = jar();
  await u.refresh('/api');
  const reg = await u.call('POST', '/api/auth/register', { email: 'xoa@test.local', name: 'Người Xóa', password: 'mat-khau-1', phone: '0909000091' });
  await u.refresh('/api');
  const pl = await u.call('POST', '/api/playlists', { name: 'Đi làm' });
  const pid = pl.json.data.id || (pl.json.data.playlist && pl.json.data.playlist.id);
  await u.call('POST', `/api/playlists/${pid}/items`, { items: [{ id: ids[0], title: 'A', uploader: 'K', duration: 100, thumbnail: '' }, { id: ids[1], title: 'B', uploader: 'K', duration: 100, thumbnail: '' }] });
  const rm = await u.call('DELETE', `/api/playlists/${pid}/items/${ids[0]}`);
  const del = await u.call('DELETE', `/api/playlists/${pid}`);
  const after = (await u.call('GET', '/api/playlists')).json.data.playlists.length;
  const p = sql('SELECT deleted_at, deleted_by_type, deleted_by_id FROM playlists WHERE id = ?', [pid])[0] || {};
  const items = sql('SELECT video_id, deleted_by_type FROM playlist_items WHERE playlist_id = ? ORDER BY id', [pid]);
  check('D1 người dùng bỏ bài và xóa playlist: danh sách trống, nhưng playlist và 2 bài vẫn còn trong database với dấu "user"',
    reg.status === 201 && rm.status === 200 && del.status === 200 && after === 0 && p.deleted_at && p.deleted_by_type === 'user' && items.length === 2 && items.every((i) => i.deleted_by_type === 'user'),
    JSON.stringify({ p, items }));

  const m = jar();
  await m.refresh('/admin/api');
  await m.call('POST', '/admin/api/auth/login', { email: MASTER.email, password: MASTER.pass });
  await m.refresh('/admin/api');
  const uid = sql("SELECT id FROM users WHERE email = 'xoa@test.local'")[0].id;
  const d = await m.call('DELETE', '/admin/api/users/' + uid);
  const meAfter = await u.call('GET', '/api/auth/me');
  const row = sql('SELECT alive, deleted_at, deleted_by_type, deleted_by_email FROM users WHERE id = ?', [uid])[0];
  check('D2 quản trị xóa người dùng: bị đăng xuất, dòng vẫn còn với người xóa là quản trị viên',
    d.status === 200 && !meAfter.json.data.user && row.alive === null && row.deleted_at && row.deleted_by_type === 'admin' && row.deleted_by_email === MASTER.email, JSON.stringify(row));
  const list = (await m.call('GET', '/admin/api/users?deleted=1')).json.data;
  check('D3 danh sách người dùng: bộ lọc "Đã xóa" hiện người này kèm người xóa', list.total === 1 && list.items[0].deleted.by_email === MASTER.email);
  const again = jar();
  await again.refresh('/api');
  const re = await again.call('POST', '/api/auth/register', { email: 'xoa@test.local', name: 'Đăng ký lại', password: 'mat-khau-2', phone: '0909000091' });
  check('D4 email của tài khoản đã xóa đăng ký lại được (tài khoản mới)', re.status === 201 && sql("SELECT COUNT(*) AS n FROM users WHERE email = 'xoa@test.local'")[0].n === 2);
}

await browser.close();
check('không có lỗi JavaScript nào', errors.length === 0, errors.slice(0, 3).join(' | '));
check('PHP không báo lỗi/cảnh báo nào', !/Warning|Fatal|Notice|Deprecated/.test(phpErr), phpErr.split('\n').filter((l) => /Warning|Fatal|Notice|Deprecated/.test(l)).slice(0, 2).join(' '));
console.log(failures ? `\nCÓ ${failures} MỤC CHƯA ĐẠT` : '\nTẤT CẢ ĐẠT');
process.exit(failures ? 1 : 0);
