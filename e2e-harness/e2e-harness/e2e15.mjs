import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');

// Giai đoạn 14 trên PHP THẬT (php -S + SQLite tạm) và Chromium thật:
//  A. Tài khoản bằng số điện thoại: đăng ký bắt buộc SĐT (nhập có dấu cách), đăng nhập bằng SĐT dạng +84, quên mật khẩu bằng
//     mã 6 số (thư ghi vào storage/mail), mã sai báo số lần còn lại, hộp "Số điện thoại và mật khẩu" trong Cài đặt
//     (đổi số, đổi mật khẩu bằng mã: thiết bị khác bị đăng xuất, máy này vẫn vào).
//  B. Giao diện: bộ 3 nút ⏮ ▶ ⏭ nằm đúng giữa dưới video ở 4 cỡ màn hình; điện thoại dọc chỉ còn tên bài + thanh tua + 3 nút + "⋯";
//     bấm ô tìm kiếm trên điện thoại: video thu thành thanh nhỏ ở trên, ẩn thanh mục dưới, ô tìm kiếm không đè lên nút; bấm Tìm thì trở lại.
// KHÔNG thử được: SMS thật (chưa tích hợp), bàn phím ảo thật của điện thoại (mô phỏng bằng cách thu nhỏ chiều cao khung).
const PUBLIC_DIR = process.env.PUBLIC_DIR;
if (!PUBLIC_DIR) { console.error('Cần đặt PUBLIC_DIR=/duong/dan/den/public'); process.exit(2); }
const PROJECT = path.dirname(PUBLIC_DIR);
const here = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.env.PORT || 8092);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `carweb-e2e15-${process.pid}.sqlite`);
const MAIL_DIR = path.join(PROJECT, 'storage', 'mail');

let failures = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.rmSync(DB, { force: true });
fs.mkdirSync(MAIL_DIR, { recursive: true });
const mailsBefore = new Set(fs.readdirSync(MAIL_DIR));
const php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', PUBLIC_DIR, path.join(PROJECT, 'tests/support/serve_sqlite.php')], {
  env: { ...process.env, CARWEB_TEST_DB: DB, CARWEB_TEST_SEED: '1', APP_URL: ORIGIN, MAIL_DRIVER: 'log', APP_DEBUG: 'false',
    VIDEO_SOURCES: 'piped', PIPED_API_URLS: 'http://127.0.0.1:9', YOUTUBE_EMBED: 'false', YOUTUBE_KEY_HINT: 'false', SMS_DRIVER: 'none' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let phpErr = '';
php.stderr.on('data', (d) => { phpErr += d.toString(); });
process.on('exit', () => {
  try { php.kill(); } catch (e) { /* đã tắt */ }
  fs.rmSync(DB, { force: true });
  fs.rmSync(DB + '.ratelimit', { recursive: true, force: true });
  for (const f of fs.readdirSync(MAIL_DIR)) if (!mailsBefore.has(f)) fs.rmSync(path.join(MAIL_DIR, f), { force: true });
});
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(ORIGIN + '/api/health')).ok) break; } catch (e) { /* chưa sẵn sàng */ }
  await sleep(100);
}

// Mã 6 số trong thư mới nhất gửi tới email này (sau thời điểm `since`).
const seen = new Set(mailsBefore);
async function latestCode(email) {
  for (let i = 0; i < 40; i++) {
    const files = fs.readdirSync(MAIL_DIR).filter((f) => !seen.has(f) && f.endsWith('.txt'));
    for (const f of files) {
      const text = fs.readFileSync(path.join(MAIL_DIR, f), 'utf8');
      seen.add(f);
      const m = /là: ([0-9]{6})/.exec(text);
      if (text.indexOf(email) >= 0 && m) return m[1];
    }
    await sleep(100);
  }
  return null;
}

const browser = await chromium.launch();
const errors = [];
async function newPage(viewport = { width: 1024, height: 600 }, guest = false, mobile = false) {
  const ctx = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
  if (guest) await ctx.addInitScript(() => { try { localStorage.setItem('carweb_guest', '1'); } catch (e) { /* bỏ qua */ } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page };
}
const inApp = async (page) => { try { await page.waitForSelector('.split', { timeout: 6000 }); return true; } catch (e) { return false; } };
async function me(ctx) {
  const r = await ctx.request.get(ORIGIN + '/api/auth/me');
  const j = await r.json();
  return j.data || {};
}

// ===================== A. Tài khoản bằng số điện thoại =====================
const EMAIL = 'sdt@test.local';
const { ctx: A, page: pa } = await newPage();
await pa.goto(ORIGIN + '/');
await pa.getByRole('tab', { name: 'Tạo tài khoản' }).click();
check('A1 form đăng ký có ô Số điện thoại', await pa.getByLabel('Số điện thoại').isVisible());
await pa.getByLabel('Tên hiển thị').fill('Tài Xế SĐT');
await pa.getByLabel('Email', { exact: true }).fill(EMAIL);
await pa.getByLabel('Mật khẩu', { exact: true }).fill('mat-khau-1');
await pa.getByRole('button', { name: 'Tạo tài khoản', exact: true }).last().click();
await sleep(500);
check('A2 thiếu số điện thoại thì không tạo được (báo lỗi ở ô SĐT)', !(await pa.locator('.split').count()) && (await pa.locator('#f-phone').evaluate((el) => el.closest('.field').textContent)).length > 30);
await pa.getByLabel('Số điện thoại').fill('0912 345 678');
await pa.getByRole('button', { name: 'Tạo tài khoản', exact: true }).last().click();
check('A3 đăng ký với SĐT có dấu cách -> vào ứng dụng', await inApp(pa));
check('A3 SĐT lưu dạng 0912345678', (await me(A)).user && (await me(A)).user.phone === '0912345678');

// A4. thiết bị 2: đăng nhập bằng +84
const { ctx: B, page: pb } = await newPage();
await pb.goto(ORIGIN + '/');
check('A4 ô đăng nhập ghi "Email hoặc số điện thoại"', await pb.getByLabel('Email hoặc số điện thoại').isVisible());
await pb.getByLabel('Email hoặc số điện thoại').fill('+84912345678');
await pb.getByLabel('Mật khẩu').fill('mat-khau-1');
await pb.getByRole('button', { name: 'Đăng nhập', exact: true }).last().click();
check('A4 đăng nhập bằng +84912345678 -> vào ứng dụng', await inApp(pb));

// A5. thiết bị 3: quên mật khẩu bằng SĐT
const { ctx: C, page: pc } = await newPage({ width: 390, height: 844 }, false, true);
await pc.goto(ORIGIN + '/');
await pc.getByRole('button', { name: 'Quên mật khẩu?' }).click();
await pc.getByLabel('Email hoặc số điện thoại đã đăng ký').fill('0912345678');
await pc.getByRole('button', { name: 'Gửi mã' }).click();
const codeInput = pc.locator('input[name="code"]');
await codeInput.waitFor({ timeout: 5000 });
check('A5 hiện ô nhập mã, bàn phím số', (await codeInput.getAttribute('inputmode')) === 'numeric');
check('A5 nút "Gửi lại mã" đang khóa và đếm ngược', await pc.getByRole('button', { name: /Gửi lại mã \(\d+ giây\)/ }).isDisabled());
const code1 = await latestCode(EMAIL);
check('A5 thư có mã 6 số', Boolean(code1));
const wrong = code1 === '000000' ? '111111' : '000000';
await codeInput.fill(wrong);
await pc.getByLabel('Mật khẩu mới', { exact: true }).fill('Moi-123456');
await pc.getByLabel('Nhập lại mật khẩu mới').fill('Moi-123456');
await pc.getByRole('button', { name: 'Đặt mật khẩu mới' }).click();
await pc.getByText(/còn 4 lần/).first().waitFor({ timeout: 5000 }).catch(() => {});
check('A6 mã sai: báo số lần còn lại', await pc.getByText(/còn 4 lần/).first().isVisible().catch(() => false));
await codeInput.fill(code1);
await pc.getByRole('button', { name: 'Đặt mật khẩu mới' }).click();
await pc.getByText('Đã đặt mật khẩu mới').first().waitFor({ timeout: 5000 }).catch(() => {});
check('A7 mã đúng: đã đặt mật khẩu mới', await pc.getByText('Đã đặt mật khẩu mới').first().isVisible());
check('A7 thiết bị 1 và 2 bị đăng xuất', !(await me(A)).user && !(await me(B)).user);
await pc.screenshot({ path: path.join(here, 'shot-phase14-forgot-phone.png') });
await pc.getByRole('button', { name: 'Đăng nhập', exact: true }).last().click();
check('A8 quay lại đăng nhập, ô đã điền sẵn SĐT', (await pc.getByLabel('Email hoặc số điện thoại').inputValue()) === '0912345678');
await pc.getByLabel('Mật khẩu').fill('Moi-123456');
await pc.getByRole('button', { name: 'Đăng nhập', exact: true }).last().click();
check('A8 đăng nhập bằng SĐT + mật khẩu mới', await inApp(pc));

// A9. thiết bị 2 đăng nhập lại; thiết bị 1 dùng Cài đặt > Số điện thoại và mật khẩu
await pb.goto(ORIGIN + '/');
await pb.getByLabel('Email hoặc số điện thoại').fill(EMAIL);
await pb.getByLabel('Mật khẩu').fill('Moi-123456');
await pb.getByRole('button', { name: 'Đăng nhập', exact: true }).last().click();
await inApp(pb);
await pa.goto(ORIGIN + '/');
await pa.getByLabel('Email hoặc số điện thoại').fill('0912345678');
await pa.getByLabel('Mật khẩu').fill('Moi-123456');
await pa.getByRole('button', { name: 'Đăng nhập', exact: true }).last().click();
await inApp(pa);
await pa.locator('.rail').getByRole('button', { name: 'Cài đặt' }).click();
check('A9 Cài đặt hiện SĐT của tài khoản', await pa.getByText('SĐT: 0912345678').isVisible());
await pa.getByRole('button', { name: 'Số điện thoại và mật khẩu' }).click();
await pa.locator('#sec-phone').fill('098 765 4321');
await pa.getByRole('button', { name: 'Lưu số mới' }).click();
await sleep(600);
check('A10 đổi số điện thoại', (await me(A)).user.phone === '0987654321' && (await pa.locator('#sec-phone').inputValue()) === '0987654321');
await pa.getByRole('button', { name: 'Gửi mã đổi mật khẩu' }).click();
await pa.locator('#sec-code').waitFor({ timeout: 5000 });
const code2 = await latestCode(EMAIL);
check('A11 mã đổi mật khẩu gửi qua email', Boolean(code2));
await pa.locator('#sec-code').fill(code2);
await pa.locator('#sec-pw').fill('Doi-654321');
await pa.locator('#sec-pw2').fill('Doi-654321');
await pa.getByRole('button', { name: 'Đổi mật khẩu', exact: true }).click();
await pa.getByText('Đã đổi mật khẩu. Các thiết bị khác').waitFor({ timeout: 5000 }).catch(() => {});
check('A11 đổi mật khẩu thành công', await pa.getByText('Đã đổi mật khẩu. Các thiết bị khác').isVisible());
await pa.screenshot({ path: path.join(here, 'shot-phase14-security.png') });
check('A12 máy này vẫn đăng nhập, thiết bị khác bị đăng xuất', Boolean((await me(A)).user) && !(await me(B)).user && !(await me(C)).user);
const fresh = await browser.newContext();
const csrf = (await (await fresh.request.get(ORIGIN + '/api/auth/me')).json()).data.csrf;
const lg = await fresh.request.post(ORIGIN + '/api/auth/login', { headers: { 'X-CSRF-Token': csrf }, data: { login: '0987654321', password: 'Doi-654321' } });
check('A13 đăng nhập bằng số mới + mật khẩu mới', lg.status() === 200);
const old = await fresh.request.post(ORIGIN + '/api/auth/login', { headers: { 'X-CSRF-Token': csrf }, data: { login: '0912345678', password: 'Doi-654321' } });
check('A13 số cũ không còn đăng nhập được', old.status() === 401);
await Promise.all([A.close(), B.close(), C.close(), fresh.close()]);

// ===================== B. Giao diện trình phát =====================
async function measure(page) {
  return page.evaluate(() => {
    const box = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
    const shown = (s) => { const e = document.querySelector(s); return Boolean(e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'); };
    const st = box('.stage');
    const g = box('.ctl-group');
    const p = document.querySelector('.player');
    return { offset: Math.abs((st.l + st.r) / 2 - (g.l + g.r) / 2), phone: p.hasAttribute('data-phone'), more: shown('.ctl-more'), pills: shown('.pill-group'),
      save: shown('.ctl-right .pill'), vol: shown('.volrow'), channel: shown('.now-channel'), ctlBottom: box('.ctlrow').b, playerBottom: box('.player').b,
      overflow: p.scrollHeight > p.clientHeight + 1 };
  });
}
for (const [w, hgt, mobile] of [[390, 844, true], [800, 480, false], [1024, 600, false], [1280, 720, false]]) {
  const { ctx, page } = await newPage({ width: w, height: hgt }, true, mobile);
  await page.goto(ORIGIN + '/');
  await inApp(page);
  await sleep(700);
  const m = await measure(page);
  const tag = `${w}x${hgt}`;
  check(`B1 ${tag}: bộ 3 nút nằm giữa dưới video (lệch ${m.offset.toFixed(1)}px)`, m.offset <= 1.5);
  check(`B1 ${tag}: hàng nút không bị cắt`, m.ctlBottom <= m.playerBottom + 1 && !m.overflow);
  if (mobile) {
    check(`B2 ${tag}: điện thoại chỉ còn 3 nút + "⋯" (ẩn Tự phát/Lặp/Lưu, âm lượng, kênh)`, m.phone && m.more && !m.pills && !m.save && !m.vol && !m.channel);
    await page.screenshot({ path: path.join(here, 'shot-phase14-phone.png') });
    await page.getByRole('button', { name: 'Thêm tùy chọn phát' }).click();
    const sheet = page.locator('.sheet');
    check('B3 nút "⋯" mở bảng: Tự phát, Chế độ phát, Lưu, Chỉ hiện video', (await sheet.getByRole('menuitem').count()) >= 4
      && await sheet.getByRole('menuitem', { name: /Tự phát/ }).isVisible() && await sheet.getByRole('menuitem', { name: /Chế độ phát: Lần lượt/ }).isVisible());
    await page.screenshot({ path: path.join(here, 'shot-phase14-phone-more.png') });
    await sheet.getByRole('menuitem', { name: /Chế độ phát/ }).click();
    await sleep(200);
    await page.getByRole('button', { name: 'Thêm tùy chọn phát' }).click();
    check('B3 đổi chế độ phát từ bảng "⋯"', await page.locator('.sheet').getByRole('menuitem', { name: /Chế độ phát: Lặp tất cả/ }).isVisible());
    await page.locator('.sheet').getByRole('menuitem', { name: 'Chỉ hiện video' }).click();
    await sleep(300);
    check('B3 "Chỉ hiện video" từ bảng "⋯"', (await page.locator('.split').getAttribute('data-focus')) === 'left');
    await page.getByRole('button', { name: 'Thêm tùy chọn phát' }).click();
    await page.locator('.sheet').getByRole('menuitem', { name: 'Hiện lại danh sách' }).click();
    await sleep(300);

    // B4. gõ tìm kiếm (bàn phím ảo mô phỏng bằng cách thu chiều cao còn 470px)
    await page.locator('.rail').getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
    await page.locator('.search-input').first().click();
    await page.setViewportSize({ width: w, height: 470 });
    await sleep(500);
    const t = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const mini = r('.minibar');
      const inp = r('.search-input');
      return { typing: document.documentElement.hasAttribute('data-typing'), focus: document.querySelector('.split').dataset.focus || null,
        rail: getComputedStyle(document.querySelector('.rail')).display, miniTop: mini.top, miniBottom: mini.bottom, inputTop: inp.top, inputBottom: inp.bottom,
        stageShown: document.querySelector('.stage').getClientRects().length > 0, active: document.activeElement && document.activeElement.classList.contains('search-input') };
    });
    check('B4 đang gõ: video thu thành thanh nhỏ ở trên, ô tìm kiếm ngay dưới, không đè nhau', t.typing && t.focus === 'right' && !t.stageShown && t.miniBottom <= t.inputTop && t.inputBottom < 470);
    check('B4 đang gõ: ẩn thanh mục dưới cùng, ô tìm kiếm vẫn đang gõ', t.rail === 'none' && t.active);
    await page.screenshot({ path: path.join(here, 'shot-phase14-phone-typing.png') });
    await page.locator('.search-input').first().fill('nhac tre');
    await page.keyboard.press('Enter');
    await page.setViewportSize({ width: w, height: hgt });
    await sleep(600);
    const a = await page.evaluate(() => ({ typing: document.documentElement.hasAttribute('data-typing'), focus: document.querySelector('.split').dataset.focus || null,
      rail: getComputedStyle(document.querySelector('.rail')).display, stage: document.querySelector('.stage').getClientRects().length > 0 }));
    check('B5 bấm Tìm: trở lại như cũ (video, thanh mục dưới)', !a.typing && !a.focus && a.rail !== 'none' && a.stage);
  } else {
    check(`B2 ${tag}: màn xe/máy tính giữ đủ nút, không có "⋯"`, !m.phone && !m.more && m.pills && m.save);
    await page.locator('.rail').getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
    await page.locator('.search-input').first().click();
    await sleep(300);
    check(`B6 ${tag}: bấm ô tìm kiếm không đổi bố cục`, !(await page.evaluate(() => document.documentElement.hasAttribute('data-typing'))) && !(await page.locator('.split').getAttribute('data-focus')));
    await page.locator('.search-input').first().blur();
    await page.screenshot({ path: path.join(here, `shot-phase14-${tag}.png`) });
  }
  await ctx.close();
}

check('C1 không có lỗi JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));
if (phpErr.indexOf('Fatal') >= 0) check('C2 PHP không lỗi', false, phpErr.slice(0, 300));
await browser.close();
console.log(failures ? `\n${failures} FAIL` : '\nTất cả đạt');
process.exit(failures ? 1 : 0);
