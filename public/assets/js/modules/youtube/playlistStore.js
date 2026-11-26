const KEY = 'carweb_playlists';
const MAX_LOCAL_PLAYLISTS = 50;
const MAX_LOCAL_ITEMS = 500;

function browserStorage() {
  return {
    getItem: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    setItem: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* bỏ qua */ } },
  };
}

const pickItem = (i) => ({ id: i.id, title: i.title, uploader: i.uploader || '', duration: Number(i.duration) || 0, thumbnail: i.thumbnail || '' });

/**
 * Kho playlist có cùng một giao diện cho hai trường hợp:
 *  - đã đăng nhập: lưu trên tài khoản (gọi API /playlists)
 *  - khách dùng thử: lưu trên trình duyệt (localStorage), sau khi đăng nhập sẽ được chuyển lên tài khoản (importLocal)
 */
export function createPlaylistStore({ api, hasUser, storage = browserStorage() }) {
  function readLocal() {
    try {
      const d = JSON.parse(storage.getItem(KEY));
      return d && Array.isArray(d.playlists) ? d.playlists : [];
    } catch (e) { return []; }
  }
  const writeLocal = (list) => storage.setItem(KEY, JSON.stringify({ playlists: list }));
  const newId = () => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const now = () => new Date().toISOString();
  const summary = (p) => ({ id: p.id, name: p.name, count: p.items.length, updated_at: p.updated_at });
  const byRecent = (a, b) => String(b.updated_at).localeCompare(String(a.updated_at));
  const enc = encodeURIComponent;

  function mustFind(list, id) {
    const p = list.find((x) => x.id === id);
    if (!p) throw new Error('Không tìm thấy playlist.');
    return p;
  }

  async function list() {
    if (hasUser()) return (await api.get('/playlists')).playlists;
    return readLocal().slice().sort(byRecent).map(summary);
  }

  async function get(id) {
    if (hasUser()) return api.get(`/playlists/${enc(id)}`);
    const p = mustFind(readLocal(), id);
    return { id: p.id, name: p.name, items: p.items.slice() };
  }

  return {
    list,
    get,
    isLocal: () => !hasUser(),

    async create(name) {
      const clean = String(name || '').trim().slice(0, 100);
      if (!clean) throw new Error('Hãy nhập tên playlist.');
      if (hasUser()) return api.post('/playlists', { name: clean });
      const lists = readLocal();
      if (lists.length >= MAX_LOCAL_PLAYLISTS) throw new Error('Bạn đã đạt số playlist tối đa.');
      const p = { id: newId(), name: clean, updated_at: now(), items: [] };
      lists.push(p);
      writeLocal(lists);
      return summary(p);
    },

    async rename(id, name) {
      const clean = String(name || '').trim().slice(0, 100);
      if (!clean) throw new Error('Hãy nhập tên playlist.');
      if (hasUser()) return api.patch(`/playlists/${enc(id)}`, { name: clean });
      const lists = readLocal();
      const p = mustFind(lists, id);
      p.name = clean;
      p.updated_at = now();
      writeLocal(lists);
      return summary(p);
    },

    async remove(id) {
      if (hasUser()) { await api.delete(`/playlists/${enc(id)}`); return; }
      writeLocal(readLocal().filter((p) => p.id !== id));
    },

    // Trả { added, count }. Bài đã có trong playlist được bỏ qua.
    async addItems(id, items) {
      const clean = items.map(pickItem);
      if (hasUser()) return api.post(`/playlists/${enc(id)}/items`, { items: clean });
      const lists = readLocal();
      const p = mustFind(lists, id);
      let added = 0;
      for (const it of clean) {
        if (!p.items.some((x) => x.id === it.id) && p.items.length < MAX_LOCAL_ITEMS) { p.items.push(it); added += 1; }
      }
      if (added) { p.updated_at = now(); writeLocal(lists); }
      return { added, count: p.items.length };
    },

    async removeItem(id, videoId) {
      if (hasUser()) { await api.delete(`/playlists/${enc(id)}/items/${enc(videoId)}`); return; }
      const lists = readLocal();
      const p = mustFind(lists, id);
      p.items = p.items.filter((x) => x.id !== videoId);
      p.updated_at = now();
      writeLocal(lists);
    },

    async reorder(id, videoIds) {
      if (hasUser()) return api.put(`/playlists/${enc(id)}/order`, { video_ids: videoIds });
      const lists = readLocal();
      const p = mustFind(lists, id);
      const map = new Map(p.items.map((x) => [x.id, x]));
      p.items = videoIds.map((v) => map.get(v)).filter(Boolean);
      p.updated_at = now();
      writeLocal(lists);
      return { id: p.id, name: p.name, items: p.items.slice() };
    },

    // Playlist sửa gần nhất mà có bài: dùng để tự phát khi mở web.
    async mostRecentNonEmpty() {
      const first = (await list()).find((p) => p.count > 0);
      return first ? get(first.id) : null;
    },

    // Sau khi đăng nhập: chuyển playlist của khách lên tài khoản. Trả số playlist đã chuyển.
    async importLocal() {
      if (!hasUser()) return 0;
      const local = readLocal().filter((p) => p.items.length);
      if (!local.length) return 0;
      await api.post('/playlists/import', { playlists: local.map((p) => ({ name: p.name, items: p.items })) });
      writeLocal([]);
      return local.length;
    },
  };
}
