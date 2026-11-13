// Giai đoạn 12: nhớ chế độ phát (Lần lượt / Lặp tất cả / Lặp 1 bài / Trộn bài) và Tự phát. Luôn lưu trên thiết bị; đã đăng nhập thì đồng bộ lên tài khoản
// (cùng chỗ với cài đặt bố cục: /api/user/preferences, khóa "playback").

const KEY = 'carweb_playback';
// repeat: 'off' (lần lượt) | 'all' (lặp tất cả) | 'one' (lặp 1 bài) | 'shuffle' (trộn bài). Bản cũ lưu shuffle: true riêng -> 'shuffle'.
export const DEFAULT_PLAYBACK = { repeat: 'off', autoMix: true };

export function sanitizePlayback(v) {
  const o = v && typeof v === 'object' ? v : {};
  let repeat = ['off', 'all', 'one', 'shuffle'].indexOf(o.repeat) >= 0 ? o.repeat : 'off';
  if (repeat === 'off' && o.shuffle === true) repeat = 'shuffle';
  return { repeat, autoMix: o.autoMix !== false };
}

function browserStorage() {
  return {
    getItem: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    setItem: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* bỏ qua */ } },
  };
}

export function createPlaybackPrefs({ api, hasUser = () => false, storage = browserStorage(), debounceMs = 600, timers = { setTimeout: (...a) => setTimeout(...a), clearTimeout: (...a) => clearTimeout(...a) } }) {
  let timer = null;
  const readLocal = () => { try { return JSON.parse(storage.getItem(KEY)); } catch (e) { return null; } };
  const writeLocal = (pb) => storage.setItem(KEY, JSON.stringify(pb));
  return {
    loadLocal: () => sanitizePlayback(readLocal()),
    // Đã đăng nhập: lấy chế độ lưu trên tài khoản (null nếu chưa có hoặc mất mạng).
    async loadRemote() {
      if (!hasUser() || !api) return null;
      try {
        const data = await api.get('/user/preferences');
        if (data && data.playback) {
          const pb = sanitizePlayback(data.playback);
          writeLocal(pb);
          return pb;
        }
        const local = readLocal();
        if (local) api.put('/user/preferences', { playback: sanitizePlayback(local) }).catch(() => {});   // lần đầu: đẩy lựa chọn trên thiết bị lên
      } catch (e) { /* dùng bản trên thiết bị */ }
      return null;
    },
    save(pb) {
      const clean = sanitizePlayback(pb);
      writeLocal(clean);
      if (!hasUser() || !api) return;
      timers.clearTimeout(timer);
      timer = timers.setTimeout(() => { api.put('/user/preferences', { playback: clean }).catch(() => {}); }, debounceMs);
    },
  };
}
