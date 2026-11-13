// Lịch sử tìm kiếm gần đây, lưu trên thiết bị (để người lái xe bấm lại thay vì gõ). Không gửi lên máy chủ.
const KEY = 'carweb_recent_searches';

function browserStorage() {
  return {
    getItem: (k) => { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    setItem: (k, v) => { try { window.localStorage.setItem(k, v); } catch (e) { /* bỏ qua */ } },
  };
}

export function createRecentSearches({ storage = browserStorage(), max = 8 } = {}) {
  function read() {
    try {
      const v = JSON.parse(storage.getItem(KEY));
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, max) : [];
    } catch (e) { return []; }
  }
  const write = (list) => storage.setItem(KEY, JSON.stringify(list.slice(0, max)));
  const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

  return {
    list: read,
    add(q) {
      const text = String(q || '').trim().slice(0, 100);
      if (!text) return read();
      const next = [text].concat(read().filter((x) => !same(x, text)));
      write(next);
      return next.slice(0, max);
    },
    remove(q) {
      const next = read().filter((x) => !same(x, String(q || '')));
      write(next);
      return next;
    },
    clear() { write([]); return []; },
  };
}
