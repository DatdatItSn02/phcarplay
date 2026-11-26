// Giai đoạn 12: hàng đợi khi mở web CHỈ gồm bài của chính người dùng (không tự tìm thêm):
//   1. bài hay nghe (tối đa 20, nhiều lượt trước)
//   2. bài trong các playlist (playlist dùng gần nhất trước), tối đa `maxPlaylists` playlist
//   3. video mặc định trong .env (DEFAULT_VIDEO_URL): CHỈ thêm khi hai phần trên đều trống
// Không trùng bài, tối đa `limit` bài. Lỗi ở phần nào thì bỏ qua phần đó.

export const START_LIMIT = 100;

export async function buildStartQueue({ playStats = null, playlists = null, defaultVideo = null, limit = START_LIMIT, maxPlaylists = 10 }) {
  const out = [];
  const seen = new Set();
  const add = (it) => {
    if (out.length >= limit || !it || !it.id || seen.has(it.id)) return;
    seen.add(it.id);
    out.push({ id: it.id, title: it.title, uploader: it.uploader || '', duration: Number(it.duration) || 0, thumbnail: it.thumbnail || `https://i.ytimg.com/vi/${it.id}/mqdefault.jpg` });
  };
  if (playStats) {
    try { (await playStats.top(20)).forEach(add); } catch (e) { /* bỏ qua */ }
  }
  if (playlists) {
    try {
      const lists = (await playlists.list()).filter((p) => p.count > 0).slice(0, maxPlaylists);
      for (let i = 0; i < lists.length && out.length < limit; i++) {
        try { ((await playlists.get(lists[i].id)).items || []).forEach(add); } catch (e) { /* playlist lỗi: bỏ qua */ }
      }
    } catch (e) { /* bỏ qua */ }
  }
  if (defaultVideo && out.length === 0) {   // chỉ khi người dùng chưa có bài hay nghe và chưa có bài trong playlist
    out.push({ id: defaultVideo, title: 'Video mặc định', uploader: '', duration: 0,
      thumbnail: `https://i.ytimg.com/vi/${defaultVideo}/hqdefault.jpg`, placeholder: true });   // tên thật được điền khi phát
  }
  return out;
}
