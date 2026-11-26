// Máy chủ thử nghiệm (chỉ để mình kiểm tra giao diện): phục vụ public/assets và giả lập API, không cần PHP.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.PUBLIC_DIR || '/home/claude/carweb/public';   // thư mục public của dự án
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml' };
export const state = { user: null, prefs: { layout: null }, handlers: {}, dynamic: null, media: {} };

// Giống public/index.php: chèn appearance-boot.js vào <head> để đặt theme trước khi vẽ trang (không bị chớp trắng).
function bootScript() {
  try { return fs.readFileSync(path.join(ROOT, 'assets/js/appearance-boot.js'), 'utf8'); } catch (e) { return ''; }
}
function page() {
  const boot = JSON.stringify({ appName: 'PH Car Play', basePath: '', apiBase: '/api' });
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PH Car Play</title><meta name="theme-color" content="#0f0f0f"><script>${bootScript()}</script><link rel="stylesheet" href="/assets/css/app.css?v=1"></head><body><div id="app"></div>
<script id="boot" type="application/json">${boot}</script><script type="module" src="/assets/js/main.js?v=1"></script></body></html>`;
}
const send = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

export function start(port = 8123) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      let body = '';
      for await (const c of req) body += c;
      if (state.dynamic) { const r = state.dynamic(req.method, url, body ? JSON.parse(body) : {}); if (r !== undefined) return send(res, r.status || 200, r.body); }
      const custom = state.handlers[req.method + ' ' + url.pathname];
      if (custom) return custom(req, res, url, body ? JSON.parse(body) : {}, send);
      if (url.pathname === '/api/auth/me') {
        const features = ['youtube', 'pip', 'layout'];
        return send(res, 200, { ok: true, data: { user: state.user, guest: !state.user, csrf: 'tok', plan: state.user ? 'member' : 'guest', features: state.user ? [...features, 'playlists_cloud'] : features, expires_at: null } });
      }
      if (url.pathname === '/api/user/preferences') {
        if (req.method === 'PUT') { state.prefs.layout = { ...(state.prefs.layout || {}), ...JSON.parse(body).layout }; }
        return send(res, 200, { ok: true, data: state.prefs });
      }
      return send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Không có ' + url.pathname } });
    }
    if (url.pathname.startsWith('/media/')) {
      const m = state.media[url.pathname];
      if (!m) { res.writeHead(404); return res.end('no'); }
      // hỗ trợ Range để tua được (giống máy chủ video thật)
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (range) {
        const total = m.data.length;
        const from = range[1] ? Number(range[1]) : 0;
        const to = range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
        res.writeHead(206, { 'Content-Type': m.type, 'Content-Length': to - from + 1, 'Content-Range': `bytes ${from}-${to}/${total}`, 'Accept-Ranges': 'bytes' });
        return res.end(m.data.subarray(from, to + 1));
      }
      res.writeHead(200, { 'Content-Type': m.type, 'Content-Length': m.data.length, 'Accept-Ranges': 'bytes' });
      return res.end(m.data);
    }
    if (url.pathname.startsWith('/assets/')) {
      const file = path.join(ROOT, url.pathname);
      if (file.startsWith(ROOT) && fs.existsSync(file)) {
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        return fs.createReadStream(file).pipe(res);
      }
      res.writeHead(404); return res.end('no');
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page());
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
