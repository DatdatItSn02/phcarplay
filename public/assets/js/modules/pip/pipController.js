// Cửa sổ nổi (Picture-in-Picture) cho thẻ <video> DUY NHẤT của ứng dụng.
// Thuần JS: nhận video và document từ bên ngoài nên kiểm thử được bằng đối tượng giả.
// Không dùng ?. và ?? để chạy được trên trình duyệt cũ của màn hình xe.

export const PIP_MSG = {
  unsupported: 'Trình duyệt này chưa hỗ trợ cửa sổ nổi.',
  denied: 'Tài khoản của bạn chưa có quyền dùng cửa sổ nổi.',
  noMedia: 'Chưa có video để nổi. Hãy phát một video trước.',
  audioOnly: 'Bài này chỉ có âm thanh nên không có hình để nổi.',
  gesture: 'Trình duyệt chỉ mở cửa sổ nổi khi bạn bấm nút. Hãy bấm lại.',
  invalid: 'Video chưa sẵn sàng hoặc không có hình để nổi.',
  security: 'Trình duyệt đang chặn cửa sổ nổi ở trang này.',
  generic: 'Không mở được cửa sổ nổi.',
  closeFail: 'Không đóng được cửa sổ nổi.',
};

// Đổi lỗi của trình duyệt thành câu tiếng Việt dễ hiểu.
export function explainPipError(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError') return PIP_MSG.gesture;
  if (name === 'InvalidStateError') return PIP_MSG.invalid;
  if (name === 'NotSupportedError') return PIP_MSG.unsupported;
  if (name === 'SecurityError') return PIP_MSG.security;
  return PIP_MSG.generic;
}

// Các sự kiện làm thay đổi trạng thái cửa sổ nổi hoặc việc video có hình hay không.
const EVENTS = ['enterpictureinpicture', 'leavepictureinpicture', 'webkitpresentationmodechanged', 'loadedmetadata', 'loadeddata', 'emptied', 'resize'];

/**
 * @param {{video: HTMLVideoElement, doc: Document, allowed?: boolean, disabled?: boolean}} deps
 * Trạng thái: { supported, allowed, active, ready, reason, hint }
 *   supported: trình duyệt có API cửa sổ nổi; allowed: tài khoản có quyền 'pip'
 *   active: đang nổi; ready: bấm vào được (đang nổi thì bấm để đóng)
 *   reason: vì sao chưa nổi được lúc này (chưa có video, bài chỉ có âm thanh); hint: gợi ý khi nút bị ẩn hẳn
 * disabled: tắt hẳn, không nút, không gợi ý (trong ứng dụng điện thoại: không phát khi ứng dụng ở nền).
 */
export function createPip({ video, doc, allowed = true, disabled = false }) {
  const listeners = new Set();
  let last = '';
  let destroyed = false;

  // 'standard' (Chrome, Edge, Safari mới) | 'webkit' (Safari/iOS cũ) | null
  function mode() {
    if (disabled) return null;
    if (doc.pictureInPictureEnabled === true && typeof video.requestPictureInPicture === 'function' && !video.disablePictureInPicture) return 'standard';
    try {
      if (typeof video.webkitSetPresentationMode === 'function' && typeof video.webkitSupportsPresentationMode === 'function'
        && video.webkitSupportsPresentationMode('picture-in-picture')) return 'webkit';
    } catch (e) { /* coi như không hỗ trợ */ }
    return null;
  }

  function isActive(m) {
    if (m === 'standard') return doc.pictureInPictureElement === video;
    if (m === 'webkit') return video.webkitPresentationMode === 'picture-in-picture';
    return false;
  }

  function compute() {
    const m = mode();
    const supported = m !== null;
    const ok = Boolean(allowed);
    const active = supported && isActive(m);
    let reason = '';
    let hint = '';
    if (!supported) hint = disabled ? '' : PIP_MSG.unsupported;
    else if (!ok) hint = PIP_MSG.denied;
    else if (!active) {
      if (!video.readyState) reason = PIP_MSG.noMedia;
      else if (!video.videoWidth) reason = PIP_MSG.audioOnly;
    }
    return { supported, allowed: ok, active, ready: supported && ok && (active || !reason), reason, hint };
  }

  function refresh() {
    if (destroyed) return;
    const s = compute();
    const key = JSON.stringify(s);
    if (key === last) return;
    last = key;
    listeners.forEach((fn) => fn(s));
  }

  EVENTS.forEach((ev) => video.addEventListener(ev, refresh));
  last = JSON.stringify(compute());

  async function enter() {
    const m = mode();
    const s = compute();
    if (!s.supported) return { ok: false, message: PIP_MSG.unsupported };
    if (!s.allowed) return { ok: false, message: PIP_MSG.denied };
    if (s.active) return { ok: true };
    if (s.reason) return { ok: false, message: s.reason };
    try {
      if (m === 'standard') await video.requestPictureInPicture();
      else video.webkitSetPresentationMode('picture-in-picture');
      return { ok: true };
    } catch (e) {
      return { ok: false, message: explainPipError(e) };
    }
  }

  async function exit() {
    const m = mode();
    if (!isActive(m)) return { ok: true };
    try {
      if (m === 'standard') await doc.exitPictureInPicture();
      else video.webkitSetPresentationMode('inline');
      return { ok: true };
    } catch (e) {
      return { ok: false, message: PIP_MSG.closeFail };
    }
  }

  return {
    snapshot: compute,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    enter,
    exit,
    toggle() { return isActive(mode()) ? exit() : enter(); },
    // Gọi khi dựng lại màn hình (đăng nhập, đăng xuất): đóng cửa sổ nổi và gỡ bộ theo dõi.
    destroy() {
      if (destroyed) return;
      const wasActive = isActive(mode());
      destroyed = true;   // gỡ bộ theo dõi trước, để việc đóng cửa sổ nổi không gọi ngược vào giao diện đang bị dỡ
      EVENTS.forEach((ev) => video.removeEventListener(ev, refresh));
      listeners.clear();
      if (wasActive) exit();
    },
  };
}
