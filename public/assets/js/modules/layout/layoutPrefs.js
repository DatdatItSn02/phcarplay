import { sanitizeLayout } from '../../core/layoutMath.js';

const KEY = 'carweb_layout';

function browserStorage() {
  return {
    getItem: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    setItem: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* bỏ qua */ } },
  };
}

/**
 * Lưu và đọc tỉ lệ chia màn hình. Luôn lưu vào thiết bị (mở lên là có ngay);
 * nếu đã đăng nhập thì đồng bộ thêm lên tài khoản (gom nhiều lần kéo thành một lần gửi).
 */
export function createLayoutPrefs({ api, hasUser, storage = browserStorage(), debounceMs = 600, timers = { setTimeout: (...a) => setTimeout(...a), clearTimeout: (...a) => clearTimeout(...a) } }) {
  let timer = null;

  function readLocal() {
    try { return JSON.parse(storage.getItem(KEY)); } catch (e) { return null; }
  }
  function writeLocal(layout) {
    storage.setItem(KEY, JSON.stringify(layout));
  }

  return {
    // Đọc ngay, đồng bộ, dùng để vẽ lần đầu không bị chậm.
    loadLocal: () => sanitizeLayout(readLocal()),

    // Đã đăng nhập: lấy bố cục lưu trên tài khoản. Trả null nếu không có gì mới để áp dụng.
    async loadRemote() {
      if (!hasUser()) return null;
      try {
        const data = await api.get('/user/preferences');
        if (data && data.layout) {
          writeLocal(data.layout);
          return sanitizeLayout(data.layout);
        }
        const local = readLocal();
        if (local) api.put('/user/preferences', { layout: sanitizeLayout(local) }).catch(() => {});   // lần đầu: đẩy bố cục của khách lên
      } catch (e) { /* mất mạng: dùng bản trên thiết bị */ }
      return null;
    },

    save(layout) {
      writeLocal(layout);
      if (!hasUser()) return;
      timers.clearTimeout(timer);
      timer = timers.setTimeout(() => { api.put('/user/preferences', { layout }).catch(() => {}); }, debounceMs);
    },
  };
}
