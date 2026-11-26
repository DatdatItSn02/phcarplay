// Giai đoạn 17: bấm micro để tìm bằng giọng nói thì tạm dừng nhạc (micro khỏi thu lẫn tiếng nhạc),
// tìm xong thì phát tiếp đúng chỗ đang nghe.
//   begin()          mở micro: đang phát thì tạm dừng và nhớ lại (không phát thì không làm gì)
//   end()            tìm xong / nói không được / đóng hộp: phát tiếp nếu chính lần này đã tạm dừng
// Trong lúc đó người dùng tự bấm phát, chọn bài khác hay bài tự chuyển thì bỏ qua, không tự phát lại.
// Phòng xa: giữ lâu quá maxHoldMs (vd. tìm mãi không xong) thì tự phát lại.
// controller: { snapshot(), toggle() } (playerController.js); onState(fn) -> hủy theo dõi (media.onState).
// canResume(): false thì không tự phát lại (ứng dụng điện thoại đang ở nền - như cách cũ của giai đoạn 13).
// Dùng chung cho micro của trình duyệt (Web Speech) và nhận giọng nói của ứng dụng điện thoại.

export function createVoicePause({
  controller, onState,
  canResume = () => true,
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) },
  maxHoldMs = 45000,
}) {
  let held = null;   // { id, off, timer }

  function drop() {
    const h = held;
    held = null;
    if (!h) return null;
    if (h.off) h.off();
    timers.clear(h.timer);
    return h;
  }

  function begin() {
    if (held) return false;   // đang giữ rồi (bấm "Thử lại" trong hộp micro)
    const s = controller.snapshot();
    if (!s.current || s.status !== 'playing') return false;
    const id = s.current.id;
    held = { id, off: null, timer: null };
    controller.toggle();   // tạm dừng (đồng bộ, trước khi bắt đầu theo dõi)
    if (!held) return false;
    held.off = onState((st) => {
      if (!held) return;
      // người dùng tự bấm phát, đổi bài, hay bài đang tải: không còn là "nhạc mình đã tạm dừng" nữa
      if (!st.current || st.current.id !== held.id || st.status === 'playing' || st.status === 'loading') drop();
    });
    held.timer = timers.set(() => end(), maxHoldMs);
    return true;
  }

  function end() {
    const h = drop();
    if (!h) return false;
    const s = controller.snapshot();
    if (!s.current || s.current.id !== h.id || s.status !== 'paused') return false;
    if (!canResume()) return false;
    controller.toggle();   // phát tiếp
    return true;
  }

  return { begin, end, isHolding: () => Boolean(held), destroy: () => { drop(); } };
}
