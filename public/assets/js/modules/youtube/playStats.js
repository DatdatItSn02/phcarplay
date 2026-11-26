// Giai đoạn 11: "bài bạn hay nghe" (đưa lên đầu tab "Tất cả" ở Trang chủ).
// Người đã đăng nhập: lưu trên máy chủ (/api/user/plays...). Khách: lưu trên trình duyệt (localStorage) của thiết bị đó.
// Cùng một quy tắc ở cả hai nơi: hiện bài nghe từ MIN_PLAYS lượt, nghe lần cuối trong DAYS ngày, nhiều lượt trước, tối đa LIMIT bài.
// Ẩn một bài / xóa danh sách = đưa số lượt về 0 (nghe lại đủ lượt thì tự hiện lại).

export const MIN_PLAYS = 2;
export const DAYS = 60;
export const LIMIT = 20;
const STORE = 'carweb.plays';
const MAX_LOCAL = 300;   // số bài tối đa nhớ trên thiết bị

const thumb = (id) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
const isId = (id) => /^[A-Za-z0-9_-]{11}$/.test(String(id || ''));

/** Kho lượt nghe trên thiết bị (khách). storage: kiểu localStorage, có thể null hoặc ném lỗi. */
export function createLocalPlayStats({ storage = null, now = () => Date.now() } = {}) {
  let mem = {};
  function load() {
    try { const v = storage ? JSON.parse(storage.getItem(STORE) || 'null') : null; if (v && typeof v === 'object') mem = v; } catch (e) { /* bỏ qua */ }
    return mem;
  }
  function save() {
    const ids = Object.keys(mem);
    if (ids.length > MAX_LOCAL) {   // quá nhiều: bỏ bớt bài nghe lâu nhất
      ids.sort((a, b) => (mem[a].at || 0) - (mem[b].at || 0)).slice(0, ids.length - MAX_LOCAL).forEach((id) => { delete mem[id]; });
    }
    try { if (storage) storage.setItem(STORE, JSON.stringify(mem)); } catch (e) { /* bỏ qua */ }
  }
  return {
    async record(item) {
      if (!item || !isId(item.id)) return;
      load();
      const old = mem[item.id] || { n: 0 };
      mem[item.id] = { n: (old.n || 0) + 1, at: now(), t: String(item.title || ''), u: String(item.uploader || ''), d: Number(item.duration) || 0 };
      save();
    },
    async top(limit = LIMIT) {
      load();
      const since = now() - DAYS * 86400000;
      return Object.keys(mem)
        .filter((id) => isId(id) && mem[id].n >= MIN_PLAYS && (mem[id].at || 0) >= since)
        .sort((a, b) => (mem[b].n - mem[a].n) || ((mem[b].at || 0) - (mem[a].at || 0)))
        .slice(0, Math.min(LIMIT, limit))
        .map((id) => ({ id, title: mem[id].t || `Video ${id}`, uploader: mem[id].u || '', duration: mem[id].d || 0, thumbnail: thumb(id), views: 0, uploaded_at: 0, plays: mem[id].n }));
    },
    async hide(id) { load(); if (mem[id]) { mem[id].n = 0; save(); } },
    async clear() { load(); Object.keys(mem).forEach((id) => { mem[id].n = 0; }); save(); },
  };
}

/** Kho lượt nghe trên máy chủ (người đã đăng nhập). */
export function createRemotePlayStats(api) {
  return {
    record: (item) => api.post('/user/plays', { id: item.id, title: item.title || '', uploader: item.uploader || '', duration: Number(item.duration) || 0 }),
    top: async () => ((await api.get('/user/plays/top')) || {}).items || [],
    hide: (id) => api.post(`/user/plays/${encodeURIComponent(id)}/hide`, {}),
    clear: () => api.post('/user/plays/clear', {}),
  };
}

/** Chọn kho theo trạng thái đăng nhập (kiểm tra mỗi lần gọi). Lỗi mạng khi ghi lượt nghe thì bỏ qua (không làm phiền người nghe). */
export function createPlayStats({ api, hasUser = () => false, storage = null, now = () => Date.now() }) {
  const local = createLocalPlayStats({ storage, now });
  const remote = api ? createRemotePlayStats(api) : null;
  const pick = () => (remote && hasUser() ? remote : local);
  return {
    record: (item) => Promise.resolve().then(() => pick().record(item)).catch(() => {}),
    top: (limit) => pick().top(limit),
    hide: (id) => pick().hide(id),
    clear: () => pick().clear(),
  };
}

/**
 * Bộ đếm: một lần phát được tính 1 lượt khi đã phát ít nhất 30 giây (bài dưới 1 phút: quá nửa bài).
 * tick(): gọi mỗi khi thời gian phát đổi. reset(): khi bắt đầu phát lại / đổi bài.
 */
export function createPlayCounter({ getCurrent, getTime, getDuration, onCount, minSeconds = 30 }) {
  let countedFor = null;   // "id#lần" đã tính
  let session = 0;
  let lastId = null;
  return {
    reset() { session += 1; countedFor = null; },
    tick() {
      const cur = getCurrent();
      if (!cur || !cur.id) return;
      if (cur.id !== lastId) { lastId = cur.id; session += 1; countedFor = null; }
      const key = `${cur.id}#${session}`;
      if (countedFor === key) return;
      const t = Number(getTime()) || 0;
      const d = Number(getDuration());
      const need = Number.isFinite(d) && d > 0 ? Math.min(minSeconds, d / 2) : minSeconds;
      if (t >= need) { countedFor = key; onCount(cur); }
    },
  };
}

/** Danh sách tab "Tất cả": bài hay nghe trước (tối đa limit), thiếu thì thêm bài gợi ý cho đủ, không trùng. */
export function mergeHome(top, rest, limit = LIMIT) {
  const out = [];
  const seen = new Set();
  (top || []).forEach((it) => { if (it && it.id && !seen.has(it.id) && out.length < limit) { seen.add(it.id); out.push(Object.assign({}, it, { frequent: true })); } });
  (rest || []).forEach((it) => { if (it && it.id && !seen.has(it.id) && out.length < limit) { seen.add(it.id); out.push(it); } });
  return out;
}
