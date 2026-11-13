// Giai đoạn 6 (giao diện kiểu YouTube cho màn hình xe): các phần tính toán không cần trình duyệt.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { THEME_MODES, DEFAULT_THEME, KEYS, normalizeTheme, isNight, resolveTheme, createAppearance } from '../../public/assets/js/core/appearance.js';
import { createRecentSearches } from '../../public/assets/js/modules/browser/recentSearches.js';
import { VOICE_MSG, voiceMessage, recognitionClass, listenOnce } from '../../public/assets/js/modules/browser/voiceSearch.js';
import { createYoutubeApi } from '../../public/assets/js/modules/youtube/youtubeApi.js';
import { LAYOUTS, currentLayoutId } from '../../public/assets/js/modules/settings/settingsDialog.js';
import { widthClass } from '../../public/assets/js/modules/browser/browserPanel.js';
import { DEFAULT_CHIPS } from '../../public/assets/js/modules/browser/homeView.js';
import { avatarColor, initial } from '../../public/assets/js/core/avatar.js';
import { createSplitController } from '../../public/assets/js/core/splitController.js';
import { hasIcon } from '../../public/assets/js/core/icons.js';

const memStorage = (init = {}) => {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
};
function fakeMedia(dark) {
  const q = { matches: dark, fns: [], addEventListener: (t, fn) => q.fns.push(fn), removeEventListener: (t, fn) => { q.fns = q.fns.filter((f) => f !== fn); } };
  q.set = (v) => { q.matches = v; q.fns.forEach((f) => f()); };
  return q;
}
function fakeTimers() {
  const t = { fns: [], setInterval: (fn) => { t.fns.push(fn); return t.fns.length; }, clearInterval: () => { t.cleared = true; }, tick: () => t.fns.forEach((f) => f()) };
  return t;
}

test('theme: chế độ hợp lệ, mặc định tối, giờ tối từ 18h đến trước 6h', () => {
  assert.deepEqual(THEME_MODES, ['auto', 'light', 'dark', 'time']);
  assert.equal(DEFAULT_THEME, 'dark');
  assert.equal(normalizeTheme('xyz'), 'dark');
  assert.equal(normalizeTheme(null), 'dark');
  assert.equal(normalizeTheme('time'), 'time');
  assert.deepEqual([5, 6, 12, 17, 18, 23, 0].map(isNight), [true, false, false, false, true, true, true]);
});

test('resolveTheme: sáng/tối cố định, tự động theo máy, theo giờ', () => {
  assert.equal(resolveTheme('light', { prefersDark: true }), 'light');
  assert.equal(resolveTheme('dark', { prefersDark: false }), 'dark');
  assert.equal(resolveTheme('auto', { prefersDark: true }), 'dark');
  assert.equal(resolveTheme('auto', { prefersDark: false }), 'light');
  assert.equal(resolveTheme('time', { hour: 20 }), 'dark');
  assert.equal(resolveTheme('time', { hour: 9 }), 'light');
  assert.equal(resolveTheme('rác', {}), 'dark');
});

test('createAppearance: đọc, lưu, đổi nhanh, báo thay đổi, theo máy và theo đồng hồ', () => {
  const storage = memStorage({ [KEYS.theme]: 'auto', [KEYS.text]: 'large' });
  const media = fakeMedia(true);
  let hour = 17;
  const timers = fakeTimers();
  const applied = [];
  const a = createAppearance({ storage, media: () => media, now: () => ({ getHours: () => hour }), apply: (v) => applied.push(v), timers });
  assert.deepEqual(a.get(), { theme: 'dark', mode: 'auto', text: 'large', rail: 'left' });
  assert.equal(applied.length, 1, 'vẽ ngay khi tạo');
  const seen = [];
  const off = a.onChange((v) => seen.push(v.theme));
  media.set(false);
  assert.equal(a.get().theme, 'light', 'Tự động: máy đổi sang sáng');
  a.setTheme('time');
  assert.equal(storage.data[KEYS.theme], 'time');
  assert.equal(a.get().theme, 'light');
  hour = 18; timers.tick();
  assert.equal(a.get().theme, 'dark', 'Theo giờ: qua 18h thì tối (đồng hồ kiểm tra mỗi phút)');
  a.toggleTheme();
  assert.equal(a.get().mode, 'light');
  assert.equal(storage.data[KEYS.theme], 'light');
  const n = applied.length;
  timers.tick();
  assert.equal(applied.length, n, 'không đổi gì thì không vẽ lại');
  a.setText('normal'); a.setRail('right'); a.setRail('rác');
  assert.equal(storage.data[KEYS.text], 'normal');
  assert.equal(storage.data[KEYS.rail], 'left');
  off();
  const before = seen.length;
  a.setTheme('dark');
  assert.equal(seen.length, before, 'hủy theo dõi thì không gọi nữa');
  const { setTheme } = a;
  setTheme('light');
  assert.equal(a.get().theme, 'light', 'setTheme dùng được khi tách khỏi đối tượng');
  a.destroy();
  assert.ok(timers.cleared);
  assert.equal(media.fns.length, 0);
});

test('createAppearance: bộ nhớ lỗi hoặc giá trị rác vẫn chạy với mặc định', () => {
  const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
  const safe = { getItem: (k) => { try { return broken.getItem(k); } catch (e) { return null; } }, setItem: () => {} };
  const a = createAppearance({ storage: safe, media: () => null, apply: () => {}, timers: fakeTimers() });
  assert.deepEqual(a.get(), { theme: 'dark', mode: 'dark', text: 'normal', rail: 'left' });
  const b = createAppearance({ storage: memStorage({ [KEYS.theme]: '<script>', [KEYS.text]: 'huge', [KEYS.rail]: 'top' }), media: () => null, apply: () => {}, timers: fakeTimers() });
  assert.deepEqual(b.get(), { theme: 'dark', mode: 'dark', text: 'normal', rail: 'left' });
});

test('appearance-boot.js (chạy trong <head>) cho kết quả giống resolveTheme ở mọi trường hợp', () => {
  const file = fileURLToPath(new URL('../../public/assets/js/appearance-boot.js', import.meta.url));
  const code = fs.readFileSync(file, 'utf8');
  assert.ok(!/=>|\blet\b|\bconst\b|\?\.|\?\?/.test(code), 'viết kiểu cũ để chạy trên trình duyệt cũ');
  const RealDate = Date;
  for (const mode of [null, 'auto', 'light', 'dark', 'time', 'rác']) {
    for (const prefersDark of [true, false]) {
      for (const hour of [3, 6, 12, 18, 23]) {
        for (const text of [null, 'large']) {
          const attrs = {};
          const meta = { content: '', setAttribute: (k, v) => { meta[k] = v; } };
          const store = { carweb_theme: mode, carweb_text: text, carweb_rail: 'right' };
          const ctx = {
            document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } }, querySelector: () => meta },
            window: { localStorage: { getItem: (k) => (store[k] === undefined ? null : store[k]) }, matchMedia: () => ({ matches: prefersDark }) },
            Date: class extends RealDate { getHours() { return hour; } },
          };
          vm.runInNewContext(code, ctx);
          const want = resolveTheme(mode, { prefersDark, hour });
          assert.equal(attrs['data-theme'], want, `mode=${mode} dark=${prefersDark} hour=${hour}`);
          assert.equal(meta.content, want === 'dark' ? '#0f0f0f' : '#ffffff');
          assert.equal(attrs['data-text'], text === 'large' ? 'large' : undefined);
          assert.equal(attrs['data-rail'], 'right');
        }
      }
    }
  }
});

test('tìm kiếm gần đây: mới nhất lên đầu, không trùng (không phân biệt hoa thường), tối đa 8, xóa được', () => {
  const storage = memStorage();
  const r = createRecentSearches({ storage });
  assert.deepEqual(r.list(), []);
  r.add('  Nhạc Trẻ '); r.add('bolero'); r.add('nhạc trẻ');
  assert.deepEqual(r.list(), ['nhạc trẻ', 'bolero']);
  r.add('');
  assert.equal(r.list().length, 2);
  for (let i = 0; i < 10; i++) r.add('q' + i);
  assert.equal(r.list().length, 8);
  assert.equal(r.list()[0], 'q9');
  assert.deepEqual(r.remove('Q9'), r.list());
  assert.ok(!r.list().includes('q9'));
  r.add('x'.repeat(300));
  assert.equal(r.list()[0].length, 100);
  r.clear();
  assert.deepEqual(r.list(), []);
  storage.setItem('carweb_recent_searches', '{hỏng');
  assert.deepEqual(r.list(), [], 'dữ liệu hỏng thì coi như trống');
  storage.setItem('carweb_recent_searches', JSON.stringify(['a', 5, null, ' ', 'b']));
  assert.deepEqual(r.list(), ['a', 'b']);
});

test('giọng nói: thông báo tiếng Việt cho từng lỗi, tìm lớp nhận dạng', () => {
  assert.equal(voiceMessage('not-allowed'), VOICE_MSG['not-allowed']);
  assert.equal(voiceMessage('lạ'), VOICE_MSG.other);
  assert.equal(voiceMessage('toString'), VOICE_MSG.other);
  const A = function A() {}; const B = function B() {};
  assert.equal(recognitionClass({ SpeechRecognition: A, webkitSpeechRecognition: B }), A);
  assert.equal(recognitionClass({ webkitSpeechRecognition: B }), B);
  assert.equal(recognitionClass({}), null);
});

function fakeRecognition(script) {
  return class {
    constructor() { this.started = false; fakeRecognition.last = this; }
    start() { this.started = true; script(this); }
    stop() { this.stopped = true; }
    abort() { this.aborted = true; }
  };
}
const res = (text, isFinal) => Object.assign([{ transcript: text }], { isFinal });

test('listenOnce: chữ tạm thời rồi kết quả cuối, tiếng Việt, chỉ báo một lần', () => {
  const got = { partial: [], result: [], error: [], end: 0 };
  const Rec = fakeRecognition((r) => {
    r.onresult({ resultIndex: 0, results: [res('nhạc', false)] });
    r.onresult({ resultIndex: 0, results: [res('nhạc trẻ', true)] });
    r.onend();
  });
  listenOnce({ Recognition: Rec, onPartial: (t) => got.partial.push(t), onResult: (t) => got.result.push(t), onError: (c) => got.error.push(c), onEnd: () => { got.end++; } });
  assert.equal(fakeRecognition.last.lang, 'vi-VN');
  assert.deepEqual(got.partial, ['nhạc']);
  assert.deepEqual(got.result, ['nhạc trẻ']);
  assert.deepEqual(got.error, []);
  assert.equal(got.end, 1);
  assert.ok(fakeRecognition.last.stopped);
});

test('listenOnce: không nói gì / bị chặn micro / start lỗi đều báo lỗi đúng mã', () => {
  let err = [];
  listenOnce({ Recognition: fakeRecognition((r) => r.onend()), onError: (c) => err.push(c) });
  assert.deepEqual(err, ['no-speech']);
  err = [];
  listenOnce({ Recognition: fakeRecognition((r) => { r.onerror({ error: 'not-allowed' }); r.onend(); }), onError: (c) => err.push(c) });
  assert.deepEqual(err, ['not-allowed']);
  err = [];
  let ended = 0;
  listenOnce({ Recognition: fakeRecognition(() => { throw new Error('busy'); }), onError: (c) => err.push(c), onEnd: () => { ended++; } });
  assert.deepEqual(err, ['other']);
  assert.equal(ended, 1);
  const s = listenOnce({ Recognition: fakeRecognition(() => {}), onError: (c) => err.push(c) });
  s.stop();
  assert.ok(fakeRecognition.last.aborted);
});

test('youtubeApi: danh sách thịnh hành nhớ 5 phút, lỗi thì lần sau tải lại', async () => {
  let t = 0;
  let calls = 0;
  let fail = false;
  const api = { get: (url) => { calls++; return fail ? Promise.reject(new Error('lỗi')) : Promise.resolve({ url }); } };
  const yt = createYoutubeApi(api, { now: () => t });
  const a = await yt.trending();
  await yt.trending();
  assert.equal(calls, 1);
  t = 299999; await yt.trending();
  assert.equal(calls, 1);
  t = 300001; await yt.trending();
  assert.equal(calls, 2);
  fail = true; t = 700000;
  await assert.rejects(yt.trending());
  fail = false;
  await yt.trending();
  assert.equal(calls, 4, 'lần lỗi không bị nhớ');
  assert.equal(a.url, '/youtube/trending');
  assert.equal((await yt.search('a b&c', 'p 2')).url, '/youtube/search?q=a%20b%26c&page=p%202');
});

test('bố cục chọn bằng hình: nhận ra ô đang dùng', () => {
  assert.deepEqual(LAYOUTS.map((l) => l.id), ['video', 'even', 'list', 'only-video', 'only-list']);
  assert.equal(currentLayoutId({ ratio: 0.7, focus: null }), 'video');
  assert.equal(currentLayoutId({ ratio: 0.51, focus: null }), 'even');
  assert.equal(currentLayoutId({ ratio: 0.3, focus: null }), 'list');
  assert.equal(currentLayoutId({ ratio: 0.62, focus: null }), '');
  assert.equal(currentLayoutId({ ratio: 0.3, focus: 'left' }), 'only-video');
  assert.equal(currentLayoutId({ ratio: 0.3, focus: 'right' }), 'only-list');
});

test('kiểu danh sách theo bề rộng khung (rem)', () => {
  assert.deepEqual([12, 20.9, 21, 27.9, 28, 46.9, 47, 90].map(widthClass), ['xs', 'xs', 's', 's', 'm', 'm', 'l', 'l']);
});

test('danh mục mặc định ở Trang chủ giống máy chủ (HomeChips::DEFAULT)', () => {
  const php = fs.readFileSync(fileURLToPath(new URL('../../app/Services/HomeChips.php', import.meta.url)), 'utf8');
  const m = /const DEFAULT\s*=\s*((?:'[^']*'\s*\.?\s*)+);/.exec(php);
  assert.ok(m, 'tìm thấy HomeChips::DEFAULT');
  const raw = (m[1].match(/'[^']*'/g) || []).map((x) => x.slice(1, -1)).join('');
  const fromPhp = raw.split(',').map((p) => { const [label, q] = p.split('='); return { label: label.trim(), q: q.trim() }; });
  assert.deepEqual(DEFAULT_CHIPS, fromPhp);
});

test('ảnh đại diện chữ cái: màu cố định theo tên, chữ cái đầu (kể cả tiếng Việt)', () => {
  assert.equal(avatarColor('An'), avatarColor('An'));
  assert.match(avatarColor(''), /^#[0-9a-f]{6}$/);
  assert.equal(initial('  Ánh Dương'), 'Á');
  assert.equal(initial(''), '?');
  assert.equal(initial(null), '?');
});

test('khung chia: setFocus chỉ nhận left/right, còn lại là chia hai', () => {
  const c = createSplitController({ layout: { h: 0.6, v: 0.5 } });
  c.setSize(1200, 600);
  c.setFocus('left'); assert.equal(c.snapshot().focus, 'left');
  c.setFocus('right'); assert.equal(c.snapshot().focus, 'right');
  c.setFocus('xyz'); assert.equal(c.snapshot().focus, null);
  c.setFocus(null); assert.equal(c.snapshot().focus, null);
});

test('mọi biểu tượng giao diện mới dùng đều có hình', () => {
  for (const n of ['home', 'search', 'library', 'queue', 'settings', 'more', 'mic', 'history', 'northWest', 'playNext', 'addQueue', 'moon', 'sun', 'autoMode', 'clock', 'logout', 'login', 'key', 'person', 'dashboard', 'people', 'shield', 'receipt', 'rewind', 'forward', 'expand', 'collapse', 'car']) {
    assert.ok(hasIcon(n), n);
  }
});
