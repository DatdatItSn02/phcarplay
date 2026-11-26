// Toàn màn hình cho thẻ <video> duy nhất. Thẻ video của app không có thanh điều khiển riêng,
// nên khi vào toàn màn hình ta tạm bật điều khiển có sẵn của trình duyệt (phát/dừng, tua...) và tắt lại khi thoát.
// Trên Android Chrome, đang toàn màn hình mà bấm Home thì trình duyệt thường tự chuyển sang cửa sổ nổi.

const DOC_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'];
const VIDEO_EVENTS = ['webkitbeginfullscreen', 'webkitendfullscreen'];

export const FS_MSG = {
  fail: 'Không vào được toàn màn hình.',
  closeFail: 'Không thoát được toàn màn hình.',
};

/** @param {{video: HTMLVideoElement, doc: Document}} deps   Trạng thái: { supported, active } */
export function createFullscreen({ video, doc }) {
  const listeners = new Set();
  let last = '';
  let destroyed = false;

  // 'standard' | 'webkit' (Safari cũ) | 'ios' (iPhone chỉ cho toàn màn hình thẻ video) | null
  function kind() {
    if (typeof video.requestFullscreen === 'function' && doc.fullscreenEnabled !== false) return 'standard';
    if (typeof video.webkitRequestFullscreen === 'function' && doc.webkitFullscreenEnabled !== false) return 'webkit';
    if (typeof video.webkitEnterFullscreen === 'function') return 'ios';
    return null;
  }

  function isActive(k) {
    if (k === 'standard') return doc.fullscreenElement === video;
    if (k === 'webkit') return doc.webkitFullscreenElement === video;
    if (k === 'ios') return Boolean(video.webkitDisplayingFullscreen);
    return false;
  }

  function compute() {
    const k = kind();
    return { supported: k !== null, active: k !== null && isActive(k) };
  }

  function refresh() {
    if (destroyed) return;
    const s = compute();
    if (video.controls !== s.active) video.controls = s.active;   // điều khiển có sẵn chỉ bật khi toàn màn hình
    const key = JSON.stringify(s);
    if (key === last) return;
    last = key;
    listeners.forEach((fn) => fn(s));
  }

  DOC_EVENTS.forEach((ev) => doc.addEventListener(ev, refresh));
  VIDEO_EVENTS.forEach((ev) => video.addEventListener(ev, refresh));
  last = JSON.stringify(compute());

  async function enter() {
    const k = kind();
    if (k === null) return { ok: false, message: FS_MSG.fail };
    if (isActive(k)) return { ok: true };
    try {
      if (k === 'standard') await video.requestFullscreen();
      else if (k === 'webkit') await video.webkitRequestFullscreen();
      else video.webkitEnterFullscreen();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: FS_MSG.fail };
    }
  }

  async function exit() {
    const k = kind();
    if (k === null || !isActive(k)) return { ok: true };
    try {
      if (k === 'standard') await doc.exitFullscreen();
      else if (k === 'webkit') await doc.webkitExitFullscreen();
      else video.webkitExitFullscreen();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: FS_MSG.closeFail };
    }
  }

  return {
    snapshot: compute,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    enter,
    exit,
    toggle() { const k = kind(); return k !== null && isActive(k) ? exit() : enter(); },
    destroy() {
      if (destroyed) return;
      const k = kind();
      const wasActive = k !== null && isActive(k);
      destroyed = true;   // gỡ bộ theo dõi trước rồi mới thoát, để không gọi ngược vào giao diện đang bị dỡ
      DOC_EVENTS.forEach((ev) => doc.removeEventListener(ev, refresh));
      VIDEO_EVENTS.forEach((ev) => video.removeEventListener(ev, refresh));
      listeners.clear();
      if (wasActive) exit();
      video.controls = false;
    },
  };
}
