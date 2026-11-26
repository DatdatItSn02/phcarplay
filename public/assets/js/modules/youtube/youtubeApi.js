// Gọi API YouTube của máy chủ (máy chủ gọi Piped, giao diện không gọi Piped trực tiếp).
// Danh sách thịnh hành được nhớ 5 phút: lúc mở web cả phần tự phát lẫn Trang chủ đều cần, chỉ tải một lần (đỡ tốn 4G trên xe).
export function createYoutubeApi(api, { now = () => Date.now(), ttlMs = 300000, notice = null } = {}) {
  const enc = encodeURIComponent;
  const shown = {};
  let trendingCache = null;
  return {
    // Máy chủ có thể kèm "notice" (khóa API riêng hết lượt / không dùng được): báo nhẹ một lần mỗi phiên.
    search: (q, page) => api.get(`/youtube/search?q=${enc(q)}${page ? `&page=${enc(page)}` : ''}`).then((data) => {
      if (data && data.notice && notice && !shown[data.notice]) { shown[data.notice] = true; try { notice(data.notice); } catch (e) { /* bỏ qua */ } }
      return data;
    }),
    suggest: (q) => api.get(`/youtube/suggest?q=${enc(q)}`),
    stream: (id) => api.get(`/youtube/stream/${enc(id)}`),
    trending() {
      if (trendingCache && now() - trendingCache.at < ttlMs) return trendingCache.promise;
      const promise = api.get('/youtube/trending');
      trendingCache = { at: now(), promise };
      promise.catch(() => { if (trendingCache && trendingCache.promise === promise) trendingCache = null; });   // lỗi thì lần sau tải lại
      return promise;
    },
  };
}
