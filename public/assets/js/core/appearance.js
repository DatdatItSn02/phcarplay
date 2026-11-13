// Giao diện hiển thị theo từng thiết bị: theme sáng/tối, cỡ chữ, vị trí thanh điều hướng.
// Lưu trong trình duyệt (mỗi màn hình xe, điện thoại có thể chọn khác nhau), không gửi lên máy chủ.
// Không dùng ?. và ?? để chạy được trên trình duyệt cũ của màn hình xe.
// Lưu ý: public/assets/js/appearance-boot.js làm đúng phép tính resolveTheme() này trước khi trang hiện ra (chống nháy màu).

export const THEME_MODES = ['auto', 'light', 'dark', 'time'];
export const DEFAULT_THEME = 'dark';            // xe hơi: mặc định tối để không chói mắt ban đêm
export const NIGHT_FROM = 18;                    // chế độ "Theo giờ": tối từ 18:00 ...
export const NIGHT_TO = 6;                       // ... đến trước 6:00
export const THEME_COLORS = { dark: '#0f0f0f', light: '#ffffff' };
export const KEYS = { theme: 'carweb_theme', text: 'carweb_text', rail: 'carweb_rail' };

export const THEME_LABELS = { auto: 'Tự động', light: 'Sáng', dark: 'Tối', time: 'Theo giờ' };

export function normalizeTheme(mode) {
  return THEME_MODES.indexOf(mode) >= 0 ? mode : DEFAULT_THEME;
}

export function isNight(hour) {
  return hour >= NIGHT_FROM || hour < NIGHT_TO;
}

/** Từ chế độ người dùng chọn ra màu thật sự dùng: 'dark' hoặc 'light'. */
export function resolveTheme(mode, env) {
  const m = normalizeTheme(mode);
  const e = env || {};
  if (m === 'light' || m === 'dark') return m;
  if (m === 'time') return isNight(typeof e.hour === 'number' ? e.hour : 12) ? 'dark' : 'light';
  return e.prefersDark ? 'dark' : 'light';
}

function browserStorage() {
  return {
    getItem: (k) => { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    setItem: (k, v) => { try { window.localStorage.setItem(k, v); } catch (e) { /* chế độ riêng tư: bỏ qua */ } },
  };
}

/** Ghi các thuộc tính lên thẻ <html> để CSS đổi màu, cỡ chữ, vị trí thanh điều hướng. */
export function applyAppearance(doc, view) {
  const root = doc.documentElement;
  root.setAttribute('data-theme', view.theme);
  if (view.text === 'large') root.setAttribute('data-text', 'large'); else root.removeAttribute('data-text');
  if (view.rail === 'right') root.setAttribute('data-rail', 'right'); else root.removeAttribute('data-rail');
  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[view.theme]);
}

/**
 * Bộ điều khiển giao diện. Mọi phụ thuộc vào trình duyệt đều truyền vào được để kiểm thử bằng Node.
 *  storage: { getItem, setItem }   media: hàm (query) => MediaQueryList   now: () => Date
 *  apply(view): vẽ lại (mặc định ghi lên document)   timers: { setInterval, clearInterval }
 */
export function createAppearance(opts) {
  const o = opts || {};
  const storage = o.storage || browserStorage();
  const media = o.media || ((q) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null));
  const now = o.now || (() => new Date());
  const apply = o.apply || ((view) => applyAppearance(document, view));
  const timers = o.timers || { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (id) => clearInterval(id) };
  const listeners = [];

  const state = {
    theme: normalizeTheme(storage.getItem(KEYS.theme)),
    text: storage.getItem(KEYS.text) === 'large' ? 'large' : 'normal',
    rail: storage.getItem(KEYS.rail) === 'right' ? 'right' : 'left',
  };

  const darkQuery = media('(prefers-color-scheme: dark)');
  const prefersDark = () => Boolean(darkQuery && darkQuery.matches);

  function view() {
    return {
      theme: resolveTheme(state.theme, { prefersDark: prefersDark(), hour: now().getHours() }),
      mode: state.theme,
      text: state.text,
      rail: state.rail,
    };
  }

  let last = '';
  function render(force) {
    const v = view();
    const sig = [v.theme, v.mode, v.text, v.rail].join('|');
    if (!force && sig === last) return;
    last = sig;
    apply(v);
    listeners.slice().forEach((fn) => fn(v));
  }

  // Hệ thống đổi sáng/tối (chế độ Tự động) và đồng hồ qua 18:00 / 6:00 (chế độ Theo giờ).
  const onSystem = () => render(false);
  if (darkQuery) {
    if (darkQuery.addEventListener) darkQuery.addEventListener('change', onSystem);
    else if (darkQuery.addListener) darkQuery.addListener(onSystem);
  }
  const tick = timers.setInterval(() => render(false), 60000);

  function save(key, value) { storage.setItem(KEYS[key], value); }

  render(true);

  // Không dùng "this" để có thể truyền thẳng các hàm làm onclick.
  function setTheme(mode) { state.theme = normalizeTheme(mode); save('theme', state.theme); render(false); }

  return {
    get: view,
    setTheme,
    // Nút đổi nhanh: đang tối thì sang sáng và ngược lại (chọn hẳn chế độ Sáng/Tối).
    toggleTheme() { setTheme(view().theme === 'dark' ? 'light' : 'dark'); },
    setText(size) { state.text = size === 'large' ? 'large' : 'normal'; save('text', state.text); render(false); },
    setRail(side) { state.rail = side === 'right' ? 'right' : 'left'; save('rail', state.rail); render(false); },
    onChange(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    destroy() {
      timers.clearInterval(tick);
      if (darkQuery) {
        if (darkQuery.removeEventListener) darkQuery.removeEventListener('change', onSystem);
        else if (darkQuery.removeListener) darkQuery.removeListener(onSystem);
      }
      listeners.length = 0;
    },
  };
}
