// Định dạng hiển thị bằng tiếng Việt (không dùng ?. và ?? để chạy được trên trình duyệt cũ của màn hình xe).
const pad2 = (n) => String(n).padStart(2, '0');

export function formatDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`;
}

function short(n) {
  const v = n < 10 ? Math.round(n * 10) / 10 : Math.round(n);
  return String(v).replace('.', ',');
}

export function formatViews(n) {
  const v = Number(n) || 0;
  if (v <= 0) return '';
  if (v >= 1e9) return `${short(v / 1e9)} Tỷ lượt xem`;
  if (v >= 1e6) return `${short(v / 1e6)} Tr lượt xem`;
  if (v >= 1e3) return `${short(v / 1e3)} N lượt xem`;
  return `${v} lượt xem`;
}

// ms: thời điểm đăng (mili giây; nếu nhỏ hơn 1e11 thì hiểu là giây).
export function formatAgo(ms, now = Date.now()) {
  let t = Number(ms) || 0;
  if (t <= 0) return '';
  if (t < 1e11) t *= 1000;
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 60) return 'vừa xong';
  const units = [[31536000, 'năm'], [2592000, 'tháng'], [86400, 'ngày'], [3600, 'giờ'], [60, 'phút']];
  for (const [size, label] of units) {
    if (sec >= size) return `${Math.floor(sec / size)} ${label} trước`;
  }
  return '';
}
