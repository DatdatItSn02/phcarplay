// Theo dõi phiên đăng nhập: hỏi máy chủ định kỳ (và khi quay lại thiết bị) xem tài khoản còn đăng nhập ở thiết bị này không.
// Cần thiết vì thiết bị cũ đang mở sẵn sẽ không tự biết mình đã bị đăng xuất khi người dùng đăng nhập nơi khác.
export function createSessionWatcher({
  check,                 // () => Promise<payload>  (gọi GET /auth/me)
  hasUser,               // () => boolean           (đang có người đăng nhập?)
  onLoggedOut,           // (payload) => void       (máy chủ báo không còn đăng nhập)
  intervalMs = 60000,
  timers = { setInterval: (...a) => setInterval(...a), clearInterval: (...a) => clearInterval(...a) },   // bọc lại: trình duyệt cấm gọi setInterval như phương thức của đối tượng khác
  doc = typeof document !== 'undefined' ? document : null,
}) {
  let handle = null;
  let busy = false;

  async function tick() {
    if (busy || !hasUser()) return;
    busy = true;
    try {
      const payload = await check();
      if (!payload.user) onLoggedOut(payload);
    } catch (e) {
      /* mất mạng: thử lại ở lần sau, không đăng xuất người dùng */
    } finally {
      busy = false;
    }
  }

  function onVisibility() {
    if (doc && doc.visibilityState === 'visible') tick();
  }

  return {
    tick,
    start() {
      if (handle !== null) return;
      handle = timers.setInterval(tick, intervalMs);
      if (doc) doc.addEventListener('visibilitychange', onVisibility);
    },
    stop() {
      if (handle !== null) timers.clearInterval(handle);
      handle = null;
      if (doc) doc.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
