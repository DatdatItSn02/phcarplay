/**
 * Chọn bài kế tiếp kiểu "Mix" từ danh sách video liên quan:
 * bỏ bài vừa phát gần đây, ưu tiên bài có độ dài giống một bài nhạc, rồi bốc ngẫu nhiên trong vài ứng viên đầu
 * (để không bị lặp vòng nhưng vẫn bám sát gợi ý của YouTube).
 */
export function pickMix(related, { history = [], exclude = [], minSec = 60, maxSec = 900, pool = 5, rand = Math.random } = {}) {
  const skip = new Set([...history, ...exclude]);
  const fresh = (related || []).filter((it) => it && it.id && !skip.has(it.id));
  const tiers = [
    (it) => it.duration >= minSec && it.duration <= maxSec,    // giống một bài nhạc
    (it) => it.duration >= 30 && it.duration <= 3600,          // nới lỏng
    () => true,
  ];
  for (const ok of tiers) {
    const candidates = fresh.filter(ok);
    if (candidates.length) {
      const top = candidates.slice(0, pool);
      return top[Math.min(top.length - 1, Math.floor(rand() * top.length))];
    }
  }
  return null;
}
