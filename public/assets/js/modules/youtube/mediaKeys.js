// Giai đoạn 13: phím điều khiển nhạc do ứng dụng điện thoại chuyển vào (nút trên vô lăng, tai nghe Bluetooth, bàn phím).
// Thuần JS: controller (playerController) và surface (lớp giả thẻ video trong media.js) truyền từ ngoài vào.

export const SEEK_STEP = 10;

function quiet(result) {
  if (result && typeof result.catch === 'function') result.catch(() => {});
}

/** Làm theo phím 'play' | 'pause' | 'toggle' | 'next' | 'prev' | 'forward' | 'rewind'. Trả về true nếu đã xử lý. */
export function handleMediaKey(key, { controller, surface, seekStep = SEEK_STEP }) {
  if (!controller.snapshot().current) return false;   // chưa có bài nào: không làm gì
  switch (key) {
    case 'toggle': quiet(controller.toggle()); return true;
    case 'play': if (surface.paused) quiet(controller.toggle()); return true;
    case 'pause': if (!surface.paused) quiet(controller.toggle()); return true;
    case 'next': quiet(controller.next()); return true;
    case 'prev': quiet(controller.prev()); return true;
    case 'forward':
    case 'rewind': {
      const dur = surface.duration;
      let t = (surface.currentTime || 0) + (key === 'forward' ? seekStep : -seekStep);
      if (Number.isFinite(dur) && dur > 0) t = Math.min(t, Math.max(0, dur - 1));
      try { surface.currentTime = Math.max(0, t); } catch (e) { /* bỏ qua */ }
      return true;
    }
    default: return false;
  }
}
