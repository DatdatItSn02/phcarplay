import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');

// Giai đoạn 7: kiểm tra bảo mật trên PHP THẬT (php -S + SQLite tạm) và Chromium thật.
//  - tiêu đề bảo mật (CSP, chống nhúng khung, HSTS chỉ khi HTTPS), cookie phiên, phiên lưu trong storage/sessions,
//  - giới hạn tần suất qua HTTP (429 + Retry-After; đăng nhập sai mặc định KHÔNG bị giới hạn theo quyết định dự án), chặn đọc file ngoài thư mục assets,
//  - ứng dụng chạy trọn vẹn dưới CSP: một máy chủ Piped GIẢ ở cổng khác (khác nguồn gốc như Piped thật) trả kết quả tìm kiếm,
//    ảnh bìa và luồng video WebM; trang phải phát được video và không có vi phạm CSP nào;
//  - CSP thật sự chặn script lạ (script nội tuyến chèn vào trang, eval).
// Không thử được: hls.js tải từ CDN (máy thử không có Internet), HTTPS thật.
const PUBLIC_DIR = process.env.PUBLIC_DIR;
if (!PUBLIC_DIR) { console.error('Cần đặt PUBLIC_DIR=/duong/dan/den/public'); process.exit(2); }
const PROJECT = path.dirname(PUBLIC_DIR);
const here = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.env.PORT || 8096);
const PIPED_PORT = Number(process.env.PIPED_PORT || 8131);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PIPED = `http://localhost:${PIPED_PORT}`;   // "localhost" khác "127.0.0.1": trình duyệt coi là nguồn gốc khác, giống Piped thật
const DB = path.join(os.tmpdir(), `carweb-e2e8-${process.pid}.sqlite`);
const MASTER = { email: 'master@test.local', pass: 'Master-12345' };

let failures = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Máy chủ Piped giả ----------
const clip = fs.readFileSync(path.join(here, 'clip.webm'));
const thumb = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#2a6"/></svg>');
// Mã video và từ khóa riêng cho mỗi lần chạy: máy chủ PHP lưu đệm kết quả Piped, lần chạy sau vẫn phải gọi tới máy chủ giả.
const RUN = ('e8' + process.pid.toString(36) + 'zzzzzzzz').slice(0, 10);
const ids = [RUN + '1', RUN + '2', RUN + '3'];
const Q = 'nhạc ' + RUN;
const item = (id, i) => ({ type: 'stream', url: '/watch?v=' + id, title: 'Bài thử ' + (i + 1), uploaderName: 'Kênh thử', duration: 200, thumbnail: PIPED + '/thumb.svg?i=' + i, views: 1000, uploaded: Date.now() - 86400000 });
const pipedHits = [];
const piped = http.createServer((req, res) => {
  const u = new URL(req.url, PIPED);
  pipedHits.push(u.pathname);
  const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/search') return json({ items: ids.map(item), nextpage: null });
  if (u.pathname === '/suggestions') return json(['nhạc thử', 'nhạc thử hai']);
  if (u.pathname.startsWith('/streams/')) {
    return json({ title: 'Bài thử', uploader: 'Kênh thử', duration: 30, thumbnailUrl: PIPED + '/thumb.svg', livestream: false, hls: null,
      videoStreams: [{ url: PIPED + '/clip.webm', mimeType: 'video/webm', quality: '360p', height: 360, videoOnly: false, bitrate: 1 }],
      audioStreams: [], relatedStreams: ids.map(item) });
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
  if (u.pathname === '/frame.html') {   // trang lạ thử nhúng website vào khung
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!DOCTYPE html><iframe id="adm" src="${ORIGIN}/admin" width="600" height="400"></iframe><iframe id="app" src="${ORIGIN}/" width="600" height="400"></iframe>`);
  }
  res.writeHead(404); res.end('no');
});
await new Promise((r) => piped.listen(PIPED_PORT, r));

// ---------- PHP thật ----------
fs.rmSync(DB, { force: true });
const php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', PUBLIC_DIR, path.join(PROJECT, 'tests/support/serve_sqlite.php')], {
  env: { ...process.env, CARWEB_TEST_DB: DB, CARWEB_TEST_SEED: '1', CARWEB_TEST_MASTER_EMAIL: MASTER.email, CARWEB_TEST_MASTER_PASS: MASTER.pass,
    APP_URL: ORIGIN, MAIL_DRIVER: 'log', PIPED_API_URLS: PIPED, PIPED_VERIFY_SSL: 'false', MUSIC_QUERY: 'nhạc thử e2e8 ' + process.pid, APP_DEBUG: 'false' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let phpErr = '';
php.stderr.on('data', (d) => { phpErr += d.toString(); });
const stopAll = () => {
  try { php.kill(); } catch (e) { /* đã tắt */ }
  try { piped.close(); } catch (e) { /* đã tắt */ }
  fs.rmSync(DB, { force: true });
  fs.rmSync(DB + '.ratelimit', { recursive: true, force: true });
};
process.on('exit', stopAll);
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(ORIGIN + '/api/health')).ok) break; } catch (e) { /* chưa sẵn sàng */ }
  await sleep(100);
}

// Gửi yêu cầu HTTP thô (giữ nguyên đường dẫn, không để thư viện tự chuẩn hóa "..")
function rawGet(p) {
  return new Promise((resolve) => {
    const s = net.connect(PORT, '127.0.0.1', () => s.write(`GET ${p} HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nConnection: close\r\n\r\n`));
    let buf = '';
    s.on('data', (d) => { buf += d.toString('latin1'); });
    s.on('end', () => resolve({ status: Number((/^HTTP\/1\.\d (\d{3})/.exec(buf) || [])[1] || 0), body: buf.split('\r\n\r\n').slice(1).join('\r\n\r\n') }));
    s.on('error', () => resolve({ status: 0, body: '' }));
  });
}

// ---------- A. Tiêu đề, cookie, phiên ----------
{
  const res = await fetch(ORIGIN + '/');
  const html = await res.text();
  const csp = res.headers.get('content-security-policy') || '';
  const inline = (/<script>([\s\S]*?)<\/script>/.exec(html) || [])[1] || '';
  const hash = crypto.createHash('sha256').update(inline, 'utf8').digest('base64');
  check('A1 trang chính có CSP, mã băm khớp đúng đoạn script nội tuyến duy nhất', inline.length > 100 && csp.includes(`'sha256-${hash}'`), csp.slice(0, 120));
  const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src ')) || '';
  check('A1 CSP: không cho script nội tuyến tùy ý/eval, chặn plugin, khóa thẻ base, chỉ cho chính website nhúng khung',
    scriptSrc !== '' && !scriptSrc.includes("'unsafe-inline'") && !csp.includes('unsafe-eval') && csp.includes("object-src 'none'") && csp.includes("base-uri 'self'") && csp.includes("frame-ancestors 'self'"), scriptSrc);
  check('A1 CSP cho phép hls.js từ CDN đã cấu hình', csp.includes('https://cdnjs.cloudflare.com'));
  check('A1 có X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy', res.headers.get('x-frame-options') === 'SAMEORIGIN' && res.headers.get('x-content-type-options') === 'nosniff'
    && res.headers.get('referrer-policy') === 'strict-origin-when-cross-origin' && /camera=\(\)/.test(res.headers.get('permissions-policy') || ''));
  check('A1 chạy HTTP thường: không gửi HSTS', res.headers.get('strict-transport-security') === null);
  const boot = JSON.parse((/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/.exec(html) || [])[1] || '{}');
  check('A1 trang gửi nguồn hls.js cho giao diện', boot.hlsJs && boot.hlsJs.src === 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.17/hls.min.js', JSON.stringify(boot.hlsJs));

  const adm = await fetch(ORIGIN + '/admin');
  const acsp = adm.headers.get('content-security-policy') || '';
  check('A2 trang quản trị: không cho nhúng khung ở đâu cả, không mở nguồn script ngoài, không lưu bộ nhớ đệm',
    adm.headers.get('x-frame-options') === 'DENY' && acsp.includes("frame-ancestors 'none'") && !acsp.includes('cdnjs') && adm.headers.get('cache-control') === 'no-store');

  const api = await fetch(ORIGIN + '/api/auth/me');
  check('A3 API: CSP default-src none, no-store, nosniff', api.headers.get('content-security-policy') === "default-src 'none'; frame-ancestors 'none'"
    && api.headers.get('cache-control') === 'no-store' && api.headers.get('x-content-type-options') === 'nosniff');
  const cookie = api.headers.get('set-cookie') || '';
  check('A3 cookie phiên: HttpOnly, SameSite=Lax, không có Secure khi chạy HTTP', /carweb_sid=/.test(cookie) && /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie) && !/Secure/i.test(cookie), cookie);
  const sid = (/carweb_sid=([^;]+)/.exec(cookie) || [])[1] || '';
  check('A3 file phiên nằm trong storage/sessions/user (không dùng thư mục chung của máy chủ)', sid !== '' && fs.existsSync(path.join(PROJECT, 'storage/sessions/user', 'sess_' + sid)));
  const fake = await fetch(ORIGIN + '/api/auth/me', { headers: { Cookie: 'carweb_sid=madeupattackerid1234567890' } });
  const fakeSid = (/carweb_sid=([^;]+)/.exec(fake.headers.get('set-cookie') || '') || [])[1] || '';
  check('A3 gửi mã phiên tự đặt: máy chủ không nhận, cấp mã mới (chống session fixation)', fakeSid !== '' && fakeSid !== 'madeupattackerid1234567890', fakeSid);
  const health = await (await fetch(ORIGIN + '/api/health')).json();
  check('A4 /api/health không lộ phiên bản PHP', health.ok && !('php' in health.data), JSON.stringify(health.data));
  const trav = [await rawGet('/assets/..%2f..%2f.env'), await rawGet('/assets/%2e%2e/%2e%2e/app/bootstrap.php'), await rawGet('/.env'), await rawGet('/storage/logs/app.log')];
  check('A5 không đọc được file ngoài thư mục assets (.env, mã nguồn, log)', trav.every((r) => r.status === 404 && !/DB_PASS|<\?php/.test(r.body)), trav.map((r) => r.status).join(','));
}

// ---------- B. Chống dò mật khẩu qua HTTP ----------
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
      return { status: res.status, json, headers: res.headers, code: json && json.error ? json.error.code : null };
    },
    async refresh(prefix) { const me = await self.call('GET', prefix + '/auth/me'); self.csrf = me.json.data.csrf; },
  };
  return self;
}
{
  const u = jar();
  await u.refresh('/api');
  const reg = await u.call('POST', '/api/auth/register', { email: 'sec@test.local', name: 'Bảo Mật', password: 'dung-mat-khau', phone: '0908000081' });
  check('B1 đăng ký người dùng thử', reg.status === 201);
  await u.call('POST', '/api/auth/logout', {});
  await u.refresh('/api');
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await u.call('POST', '/api/auth/login', { email: 'sec@test.local', password: 'sai-' + i })).code);
  check('B1 12 lần sai: đều báo sai mật khẩu', codes.every((c) => c === 'INVALID_CREDENTIALS'), codes.join(','));
  const after = await u.call('POST', '/api/auth/login', { email: 'sec@test.local', password: 'dung-mat-khau' });
  check('B1 mặc định không giới hạn số lần đăng nhập sai (đúng quyết định dự án): gõ đúng vẫn vào được', after.status === 200);
  await u.call('POST', '/api/auth/logout', {});
  await u.refresh('/api');
  const fg = [];
  for (let i = 0; i < 5; i++) fg.push((await u.call('POST', '/api/auth/forgot', { email: 'ai-do@test.local' })).status);
  const fb = await u.call('POST', '/api/auth/forgot', { email: 'ai-do@test.local' });
  check('B2 quên mật khẩu lần 6 trong 1 giờ cho cùng email: 429, có Retry-After và lời nhắn tiếng Việt',
    fg.every((x) => x === 200) && fb.status === 429 && Number(fb.headers.get('retry-after')) > 0 && /thử lại sau \d+ phút/.test(fb.json.error.message), fb.json && fb.json.error.message);
  const a = jar();
  await a.refresh('/admin/api');
  const ac = [];
  for (let i = 0; i < 7; i++) ac.push((await a.call('POST', '/admin/api/auth/login', { email: 'do-tim@test.local', password: 'sai-' + i })).code);
  check('B3 quản trị sai 7 lần: không bị chặn (mặc định), vẫn báo sai mật khẩu', ac.every((c) => c === 'INVALID_CREDENTIALS'), ac.join(','));
}

// ---------- C. Ứng dụng chạy trọn vẹn dưới CSP thật ----------
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
async function newPage(viewport = { width: 1280, height: 720 }) {
  const ctx = await browser.newContext({ viewport, locale: 'vi-VN' });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => { window.__csp.push(e.violatedDirective + ' ' + e.blockedURI); });
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|429)\b|Content Security Policy/.test(m.text())) errors.push('console: ' + m.text()); });
  return { ctx, page };
}
{
  const { ctx, page } = await newPage();
  await page.goto(ORIGIN + '/');
  await page.getByRole('button', { name: 'Dùng thử, không cần tài khoản' }).click();
  const playing = await page.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.paused && v.currentTime > 0.2 && v.videoWidth > 0; }, null, { timeout: 15000 }).then(() => true, () => false);
  check('C1 dưới CSP: tự lấy danh sách, phát được video WebM từ máy chủ Piped khác nguồn gốc', playing, await page.evaluate(() => { const v = document.querySelector('video'); return v ? v.currentSrc : 'không có video'; }));
  const imgs = await page.evaluate(() => Array.from(document.querySelectorAll('.vthumb img')).filter((i) => i.complete && i.naturalWidth > 0).length);
  check('C1 ảnh bìa từ máy chủ Piped hiện được', imgs >= 2, imgs + ' ảnh');
  await page.locator('.rail').getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
  await page.getByLabel('Tìm kiếm video').fill(Q);
  const sugg = await page.waitForFunction(() => document.querySelectorAll('.suggest-item').length === 2, null, { timeout: 8000 }).then(() => true, () => false);
  await page.getByLabel('Tìm kiếm video').press('Enter');
  const results = await page.waitForFunction(() => document.querySelectorAll('.view:not([hidden]) .vrow').length === 3, null, { timeout: 8000 }).then(() => true, () => false);
  check('C2 gợi ý và kết quả tìm kiếm qua máy chủ PHP thật', sugg && results);
  check('C3 không có vi phạm CSP nào khi dùng bình thường', (await page.evaluate(() => window.__csp.length)) === 0, (await page.evaluate(() => window.__csp.join(' | '))));
  const blocked = await page.evaluate(async () => {
    const s = document.createElement('script');
    s.textContent = 'window.__pwned = 1';
    document.body.appendChild(s);
    const img = document.createElement('img');   // kiểu chèn mã qua thuộc tính sự kiện
    img.setAttribute('onerror', 'window.__pwned2 = 1');
    img.src = 'data:,x';
    document.body.appendChild(img);
    await new Promise((r) => setTimeout(r, 300));
    return { pwned: window.__pwned === 1, pwned2: window.__pwned2 === 1, violations: window.__csp.slice() };
  });
  // (Không thử eval ở đây: lệnh chạy từ công cụ kiểm thử không chịu CSP của trang; A1 đã kiểm tra CSP không có 'unsafe-eval'.)
  check('C4 CSP chặn thật: script nội tuyến và thuộc tính onerror chèn vào trang đều không chạy', !blocked.pwned && !blocked.pwned2 && blocked.violations.filter((v) => /script-src/.test(v)).length >= 2, JSON.stringify(blocked));
  check('C5 các thao tác trên đều đi qua máy chủ PHP (trình duyệt không gọi thẳng API Piped)', pipedHits.includes('/search') && pipedHits.includes('/suggestions') && pipedHits.some((p) => p.startsWith('/streams/')));
  await page.waitForFunction(() => document.querySelector('video').currentTime >= 1.6, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const timeInfo = await page.evaluate(() => ({ t: document.querySelector('video').currentTime, label: (document.querySelector('.player .time') || {}).textContent || '' }));
  check('C5 thời gian phát chạy và hiện đúng trên giao diện', timeInfo.t > 0.5 && !/^0:00/.test(timeInfo.label), JSON.stringify(timeInfo));
  await page.screenshot({ path: path.join(here, 'shot-phase7-csp-app.png') });
  await ctx.close();
}
{
  const { ctx, page } = await newPage();
  await page.goto(ORIGIN + '/admin');
  await page.getByLabel('Email').fill(MASTER.email);
  await page.getByLabel('Mật khẩu').fill(MASTER.pass);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  const ok = await page.locator('.adm-nav').waitFor({ timeout: 8000 }).then(() => true, () => false);
  await page.locator('.adm-nav').getByRole('link', { name: 'Nhật ký', exact: true }).click();
  const audit = await page.waitForFunction(() => /Đăng nhập quản trị sai mật khẩu/.test(document.body.textContent) && /sai nhiều lần liên tiếp/.test(document.body.textContent), null, { timeout: 8000 }).then(() => true, () => false);
  const failedRows = await page.locator('tbody tr', { hasText: 'Đăng nhập quản trị sai mật khẩu' }).count();
  check('C6 trang quản trị chạy dưới CSP: đăng nhập, Nhật ký có 5 dòng đăng nhập sai (không phình theo số lần thử) và 1 dòng "sai nhiều lần liên tiếp", không vi phạm CSP',
    ok && audit && failedRows === 5 && (await page.evaluate(() => window.__csp.length)) === 0, failedRows + ' dòng');
  await ctx.close();
}
{
  const { ctx, page } = await newPage();
  await page.goto(PIPED + '/frame.html');
  await sleep(1500);
  const frames = page.frames().filter((f) => f !== page.mainFrame());
  const adm = frames.find((f) => /\/admin/.test(f.url()) || f.name() === 'adm');
  const loaded = await Promise.all(frames.map(async (f) => { try { return await f.evaluate(() => !!document.querySelector('#app, .auth, .adm')); } catch (e) { return false; } }));
  check('C7 trang lạ không nhúng được website (quản trị và trang chính) vào khung', frames.length === 2 && loaded.every((x) => x === false), JSON.stringify({ n: frames.length, loaded, url: adm && adm.url() }));
  await ctx.close();
}
await browser.close();

check('không có lỗi JavaScript nào', errors.length === 0, errors.slice(0, 3).join(' | '));
check('PHP không báo lỗi/cảnh báo nào', !/Warning|Fatal|Notice|Deprecated/.test(phpErr), phpErr.split('\n').filter((l) => /Warning|Fatal|Notice|Deprecated/.test(l)).slice(0, 2).join(' '));
console.log(failures ? `\nCÓ ${failures} MỤC CHƯA ĐẠT` : '\nTẤT CẢ ĐẠT');
process.exit(failures ? 1 : 0);
