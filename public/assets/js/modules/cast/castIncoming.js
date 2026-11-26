// Giai đoạn 17 (đợt 2): màn hình xe ĐÃ GHÉP ĐÔI hỏi máy chủ vài giây một lần "có điện thoại nào vừa bấm Chia sẻ không"
// (mặc định 3 giây, máy chủ báo lại bằng poll_seconds = CAST_POLL_SECONDS). Có thì gọi onIncoming(lời mời, iceServers).
//  - Chưa ghép đôi (device.isPaired() = false) thì KHÔNG hỏi gì cả.
//  - Đang chiếu (isBusy) hoặc trang đang ẩn (chuyển sang ứng dụng khác) thì tạm thôi hỏi, hiện lại thì hỏi ngay (poke()).
//  - Máy chủ báo không còn cặp nào (bên kia bấm "Quên") thì thôi hỏi hẳn.
//  - Lỗi mạng / máy chủ: chờ lâu dần (tối đa 60 giây) rồi hỏi lại.
export function createCastIncoming({
  castApi, device,
  isBusy = () => false,
  isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  onIncoming = () => {},
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) },
  defaultMs = 3000,
}) {
  let timer = null;
  let stopped = true;
  let inflight = false;
  let ms = defaultMs;
  let fails = 0;

  function schedule(delay) {
    if (stopped) return;
    if (timer !== null) timers.clear(timer);
    timer = timers.set(tick, delay);
  }

  async function tick() {
    timer = null;
    if (stopped || !device.isPaired()) return;
    if (isHidden() || isBusy() || inflight) { schedule(ms); return; }
    inflight = true;
    let data = null;
    try {
      data = await castApi.incoming(device.key());
    } catch (e) {
      inflight = false;
      fails += 1;
      schedule(Math.min(60000, ms * Math.pow(2, Math.min(fails, 5))));
      return;
    }
    inflight = false;
    fails = 0;
    if (stopped) return;
    if (data && Number(data.poll_seconds) >= 2) ms = Number(data.poll_seconds) * 1000;
    if (data && Number(data.pairs) === 0 && !data.incoming) { device.setPaired(false); return; }   // không còn cặp nào
    if (data && data.incoming) {
      try { onIncoming(data.incoming, data.ice_servers || []); } catch (e) { /* bỏ qua: lần sau hỏi tiếp */ }
    }
    schedule(ms);
  }

  return {
    /** Bắt đầu (nếu đã ghép đôi thì hỏi ngay). */
    start() { stopped = false; if (device.isPaired()) schedule(0); },
    /** Vừa ghép đôi xong (điện thoại nhập mã kèm khóa thiết bị): từ giờ hỏi lời mời. */
    paired() { device.setPaired(true); stopped = false; if (timer === null && !inflight) schedule(ms); },
    /** Trang hiện lại / vừa dừng chiếu: hỏi ngay. */
    poke() { if (!stopped && device.isPaired() && !inflight) schedule(0); },
    isRunning: () => !stopped && device.isPaired(),
    stop() { stopped = true; if (timer !== null) timers.clear(timer); timer = null; },
  };
}
