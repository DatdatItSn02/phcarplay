// Giai đoạn 13: cầu nối với ứng dụng điện thoại (vỏ Android/iOS mở chính website này trong WebView - xem thư mục mobile/).
//
// Nhận ra ứng dụng: ứng dụng thêm "PHCarPlayApp/<phiên bản> (Android|iOS)" vào cuối User-Agent.
// Website -> ứng dụng: chuỗi JSON gửi qua kênh tên PHCarPlayNative
//   Android: window.PHCarPlayNative.postMessage(chuỗi)   (androidx.webkit addWebMessageListener, chỉ mở cho đúng địa chỉ website;
//            máy có WebView quá cũ thì ứng dụng dùng addJavascriptInterface cùng tên, cùng hàm postMessage)
//   iOS:     window.webkit.messageHandlers.PHCarPlayNative.postMessage(chuỗi)   (ứng dụng chỉ nhận từ khung chính của website)
//   Tin gửi đi: { type: 'voice.start', id, lang } | { type: 'voice.stop', id } | { type: 'state', playing, title, artist, duration, position }
//               | { type: 'background', enabled }   (giai đoạn 15: người dùng bật/tắt "Phát trong nền"; ứng dụng từ bản 1.1.0)
//               | { type: 'cast.start', maxSide, quality, fps } | { type: 'cast.stop' }
//                 (giai đoạn 15 đợt 2: chiếu màn hình điện thoại lên màn hình xe; ứng dụng Android từ bản 1.2.0)
// Ứng dụng -> website: ứng dụng gọi window.__phApp.<hàm>(...) bằng evaluateJavascript ở khung chính:
//   back()           -> true nếu website đã tự xử lý nút Quay lại (đóng hộp thoại, thoát "Chỉ video", về Trang chủ),
//                       false thì ứng dụng tự xử lý (bấm 2 lần để thoát)
//   mediaKey(tên)    -> 'play' | 'pause' | 'toggle' | 'next' | 'prev' | 'forward' | 'rewind'  (nút trên vô lăng, tai nghe)
//   voice(tin)       -> { id, kind: 'partial' | 'result' | 'error', text, code }  (kết quả nhận giọng nói của máy)
//   lifecycle(tên)   -> 'hidden' | 'visible'  (ứng dụng bị che/ra nền, hoặc hiện lại)
//                       'nudge' (giai đoạn 15, iOS): vài lần ngay sau khi ra nền - iPhone tự dừng video lúc ra nền,
//                       nếu đang "Phát trong nền" thì website bấm phát lại
//   cast(tên, dữ liệu) -> 'started' { width, height } (Android đã bắt đầu chụp màn hình) | 'denied' (người dùng không cho)
//                       | 'error' { message } | 'stopped' (hệ thống/người dùng dừng chụp) | 'frame' (có ảnh mới)
//                       Ảnh JPEG mới nhất lấy bằng fetch('/__cast/frame?since=<số ảnh đã có>'): ứng dụng trả thẳng từ bộ nhớ
//                       (200 kèm header X-Cast-Seq/X-Cast-Width/X-Cast-Height, 204 = chưa có ảnh mới, 410 = không còn chụp).
// Giai đoạn 15 - phát trong nền: ứng dụng từ bản 1.1.0 giữ trang chạy khi ra nền (Android: dịch vụ nền + thông báo có nút;
//   iOS: chế độ âm thanh nền). Website chỉ dừng khi ra nền nếu người dùng tắt "Phát trong nền", ứng dụng còn bản cũ,
//   hoặc bài đang phát bằng trình phát nhúng của YouTube (YouTube không cho phát ở nền).
// Trình duyệt thường: detectApp() trả null, không cài window.__phApp, website chạy như cũ.
// Thuần JS (không dùng ?. và ??), nhận window/User-Agent/đồng hồ từ ngoài vào nên kiểm thử được bằng đối tượng giả.

export const CHANNEL = 'PHCarPlayNative';
export const MEDIA_KEYS = ['play', 'pause', 'toggle', 'next', 'prev', 'forward', 'rewind'];
const UA_RE = /PHCarPlayApp\/([0-9][0-9A-Za-z._-]*)\s*\((Android|iOS)\)/;
const VOICE_TIMEOUT_MS = 45000;
export const BACKGROUND_MIN_VERSION = '1.1.0';
export const BACKGROUND_KEY = 'carweb_bg_play';
export const CAST_MIN_VERSION = '1.2.0';      // Android: chụp màn hình để chiếu lên màn hình xe
export const CAST_EVENTS = ['started', 'denied', 'error', 'stopped', 'frame'];

/** So sánh phiên bản dạng "1.2.0": true nếu version >= min (phần không phải số coi là 0). */
export function versionAtLeast(version, min) {
  const a = String(version || '').split('.');
  const b = String(min || '').split('.');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = parseInt(a[i], 10) || 0;
    const y = parseInt(b[i], 10) || 0;
    if (x !== y) return x > y;
  }
  return true;
}

/**
 * Cài đặt "Phát trong nền" (nhớ theo thiết bị, mặc định bật). storage: đối tượng kiểu localStorage.
 */
export function createBackgroundPref(storage) {
  let store = storage;
  if (store === undefined) { try { store = window.localStorage; } catch (e) { store = null; } }
  let value = true;
  try { if (store && store.getItem(BACKGROUND_KEY) === '0') value = false; } catch (e) { /* dùng mặc định */ }
  return {
    get: () => value,
    set(v) {
      value = v !== false;
      try { if (store) store.setItem(BACKGROUND_KEY, value ? '1' : '0'); } catch (e) { /* không lưu được: chỉ nhớ trong phiên này */ }
      return value;
    },
  };
}

/** { platform: 'android' | 'ios', version } nếu đang chạy trong ứng dụng, ngược lại null. */
export function detectApp(ua) {
  const m = UA_RE.exec(String(ua || ''));
  if (!m) return null;
  return { platform: m[2] === 'iOS' ? 'ios' : 'android', version: m[1] };
}

// Hàm gửi chuỗi sang ứng dụng, hoặc null nếu ứng dụng không mở kênh (bản ứng dụng cũ, lỗi cài đặt).
function channelOf(win, platform) {
  try {
    if (platform === 'android') {
      const ch = win[CHANNEL];
      if (ch && typeof ch.postMessage === 'function') return (text) => ch.postMessage(text);
    } else if (platform === 'ios') {
      const handlers = win.webkit && win.webkit.messageHandlers;
      const ch = handlers ? handlers[CHANNEL] : null;
      if (ch && typeof ch.postMessage === 'function') return (text) => ch.postMessage(text);
    }
  } catch (e) { /* coi như không có kênh */ }
  return null;
}

const noop = () => {};
const subscribe = (set) => (fn) => { set.add(fn); return () => set.delete(fn); };

/**
 * opts: { win, ua, closeDialog, voiceTimeoutMs, timers: { set(fn, ms), clear(t) } }
 *  closeDialog(): đóng hộp thoại trên cùng, trả về true nếu có hộp để đóng (core/dialog.js closeTopDialog).
 */
export function createNativeBridge(opts) {
  const o = opts || {};
  const w = o.win || (typeof window !== 'undefined' ? window : {});
  const nav = w.navigator || {};
  const info = detectApp(o.ua !== undefined ? o.ua : nav.userAgent);
  const post = info ? channelOf(w, info.platform) : null;
  const closeDialog = typeof o.closeDialog === 'function' ? o.closeDialog : () => false;
  const voiceTimeoutMs = o.voiceTimeoutMs > 0 ? o.voiceTimeoutMs : VOICE_TIMEOUT_MS;
  const timers = o.timers || { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) };

  const backHandlers = [];
  const keyHandlers = new Set();
  const lifeHandlers = new Set();
  const castHandlers = new Set();
  let voiceSeq = 0;
  let voice = null;        // { id, cb, timer } đang nghe
  let lastState = '';

  function send(msg) {
    if (!post) return false;
    try { post(JSON.stringify(msg)); return true; } catch (e) { return false; }
  }

  function endVoice() {
    const v = voice;
    voice = null;
    if (v && v.timer) timers.clear(v.timer);
    return v;
  }

  // Các hàm ứng dụng gọi vào (window.__phApp). Luôn trả về giá trị đơn giản, không ném lỗi ra ngoài.
  const handlers = {
    back() {
      try { if (closeDialog() === true) return true; } catch (e) { /* bỏ qua */ }
      for (let i = backHandlers.length - 1; i >= 0; i--) {
        try { if (backHandlers[i]() === true) return true; } catch (e) { /* bỏ qua */ }
      }
      return false;
    },
    mediaKey(name) {
      const key = String(name || '');
      if (MEDIA_KEYS.indexOf(key) < 0) return false;
      let handled = false;
      keyHandlers.forEach((fn) => { try { if (fn(key) === true) handled = true; } catch (e) { /* bỏ qua */ } });
      return handled;
    },
    voice(raw) {
      let m = raw;
      if (typeof m === 'string') { try { m = JSON.parse(m); } catch (e) { return false; } }
      if (!m || !voice || Number(m.id) !== voice.id) return false;   // tin cũ / của lần nghe khác
      const text = typeof m.text === 'string' ? m.text.trim() : '';
      if (m.kind === 'partial') { if (text) voice.cb.onPartial(text); return true; }
      const v = endVoice();
      if (m.kind === 'result' && text) v.cb.onResult(text);
      else v.cb.onError(m.kind === 'result' ? 'no-speech' : String(m.code || 'other'));
      v.cb.onEnd();
      return true;
    },
    lifecycle(state) {
      const s = state === 'hidden' || state === 'nudge' ? state : 'visible';
      lifeHandlers.forEach((fn) => { try { fn(s); } catch (e) { /* bỏ qua */ } });
      return true;
    },
  };

  handlers.cast = (event, data) => {
    const name = String(event || '');
    if (CAST_EVENTS.indexOf(name) < 0) return false;
    const d = data && typeof data === 'object' ? data : {};
    castHandlers.forEach((fn) => { try { fn(name, d); } catch (e) { /* bỏ qua */ } });
    return true;
  };

  /**
   * Nghe một câu bằng nhận giọng nói của máy (cùng kiểu với listenOnce trong voiceSearch.js).
   * cb: { onPartial, onResult, onError(code), onEnd, lang }. Trả về { stop } để hủy.
   */
  function listen(cb) {
    const c = cb || {};
    const callbacks = { onPartial: c.onPartial || noop, onResult: c.onResult || noop, onError: c.onError || noop, onEnd: c.onEnd || noop };
    const prev = endVoice();
    if (prev) send({ type: 'voice.stop', id: prev.id });
    const id = ++voiceSeq;
    const ok = send({ type: 'voice.start', id, lang: c.lang || 'vi-VN' });
    if (!ok) { callbacks.onError('not-available'); callbacks.onEnd(); return { stop: noop }; }
    voice = { id, cb: callbacks, timer: null };
    // Ứng dụng không trả lời (bản cũ, lỗi): sau một lúc thì coi như không nghe thấy gì, để hộp "Đang nghe..." không treo mãi.
    voice.timer = timers.set(() => { handlers.voice({ id, kind: 'error', code: 'no-speech' }); }, voiceTimeoutMs);
    return {
      stop() {
        if (!voice || voice.id !== id) return;
        endVoice();
        send({ type: 'voice.stop', id });
      },
    };
  }

  /** Báo trạng thái phát cho ứng dụng (Android hiện tên bài lên màn hình xe qua Bluetooth, nhận nút vô lăng đúng lúc). */
  function reportState(s, force) {
    if (!post || !s) return false;
    const playing = s.playing === true;
    const title = String(s.title || '').slice(0, 200);
    const artist = String(s.artist || '').slice(0, 200);
    const duration = Number.isFinite(s.duration) && s.duration > 0 ? Math.round(s.duration) : 0;
    const position = Number.isFinite(s.position) && s.position > 0 ? Math.round(s.position * 10) / 10 : 0;
    const key = [playing, title, artist, duration].join('\u0001');
    if (key === lastState && !force) return false;
    lastState = key;
    return send({ type: 'state', playing, title, artist, duration, position });
  }

  return {
    info,
    inApp: Boolean(info),
    platform: info ? info.platform : '',
    canVoice: () => Boolean(post),
    canSend: () => Boolean(post),
    /** Ứng dụng này có giữ nhạc chạy khi ra nền được không (từ bản 1.1.0, và có kênh để báo cài đặt). */
    supportsBackground: () => Boolean(post) && Boolean(info) && versionAtLeast(info.version, BACKGROUND_MIN_VERSION),
    /** Báo cho ứng dụng: người dùng bật/tắt "Phát trong nền". */
    setBackground: (enabled) => send({ type: 'background', enabled: enabled === true }),
    /** Ứng dụng này chụp được màn hình điện thoại để chiếu lên màn hình xe không (Android từ bản 1.2.0). */
    supportsCast: () => Boolean(post) && Boolean(info) && info.platform === 'android' && versionAtLeast(info.version, CAST_MIN_VERSION),
    /** Bảo ứng dụng bắt đầu chụp màn hình (Android sẽ hỏi quyền). Kết quả về qua onCast: 'started' | 'denied' | 'error'. */
    castStart(opts) {
      const o = opts || {};
      const num = (v, min, max, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
      return send({ type: 'cast.start', maxSide: num(o.maxSide, 480, 1920, 1280), quality: num(o.quality, 30, 95, 70), fps: num(o.fps, 1, 30, 12) });
    },
    castStop: () => send({ type: 'cast.stop' }),
    onCast: subscribe(castHandlers),
    listen,
    reportState,
    onBack(fn) { backHandlers.push(fn); return () => { const i = backHandlers.indexOf(fn); if (i >= 0) backHandlers.splice(i, 1); }; },
    onMediaKey: subscribe(keyHandlers),
    onLifecycle: subscribe(lifeHandlers),
    handlers,
    /** Cài window.__phApp và thuộc tính data-app="android|ios" trên <html>. Trình duyệt thường thì không làm gì. */
    install() {
      if (!info) return false;
      try { w.__phApp = handlers; } catch (e) { return false; }
      try {
        const de = w.document && w.document.documentElement;
        if (de && de.setAttribute) de.setAttribute('data-app', info.platform);
      } catch (e) { /* bỏ qua */ }
      return true;
    },
  };
}

/**
 * Ra nền / hiện lại.
 * keepPlaying() trả true (giai đoạn 15: ứng dụng phát được ở nền, người dùng đang bật, bài không phát bằng trình phát YouTube)
 *   -> ra nền không làm gì, nhạc chạy tiếp.
 * Ngược lại: ẩn đi lúc đang phát thì dừng, hiện lại thì phát tiếp. Hệ điều hành có thể dừng trình phát trước khi website kịp
 * nghe tin, nên "đang phát" tính cả trường hợp vừa phát trong 2 giây trước đó (tick() được gọi mỗi khi đang phát),
 * trừ khi lần dừng đó là do người dùng bấm (controller.snapshot().userPaused).
 * check(): gọi mỗi khi trạng thái phát đổi; đang ở nền mà bài mới lại không được phát ở nền (chuyển sang trình phát YouTube)
 *   thì dừng, hiện lại sẽ phát tiếp.
 */
export function createAppLifecycle({ controller, surface, now = () => Date.now(), graceMs = 2000, keepPlaying = () => false }) {
  let hidden = false;
  let resume = false;      // đã tự dừng lúc ra nền -> hiện lại thì phát tiếp
  let bgResume = false;    // ra nền lúc đang phát, ở chế độ phát trong nền (iPhone có thể tự dừng -> nudge() phát lại)
  let nudged = false;
  let lastPlaying = -Infinity;
  const quiet = (p) => { if (p && typeof p.catch === 'function') p.catch(() => {}); };
  const keep = () => { try { return keepPlaying() === true; } catch (e) { return false; } };
  const life = {
    tick() { if (!surface.paused) lastPlaying = now(); },
    set(state) {
      if (state === 'nudge') return life.nudge();
      const h = state === 'hidden';
      if (h === hidden) return false;
      hidden = h;
      const snap = controller.snapshot();
      const cur = snap.current;
      if (h) {
        const wasPlaying = Boolean(cur) && (!surface.paused || (!snap.userPaused && now() - lastPlaying < graceMs));
        nudged = false;
        if (keep()) { resume = false; bgResume = wasPlaying; return true; }
        bgResume = false;
        resume = wasPlaying;
        if (cur && !surface.paused) quiet(controller.toggle());
      } else {
        // bgResume + nudged: đã thử phát lại ở nền mà máy vẫn dừng (iPhone không cho) -> hiện lại thì phát tiếp
        const again = resume || (bgResume && nudged && !snap.userPaused);
        if (again && cur && surface.paused) quiet(controller.toggle());
        resume = false;
        bgResume = false;
        nudged = false;
      }
      return true;
    },
    /** iOS gọi vài lần ngay sau khi ra nền: máy đã tự dừng video thì phát lại (chỉ khi không phải người dùng bấm dừng). */
    nudge() {
      if (!hidden || !bgResume || !keep()) return false;
      nudged = true;
      const snap = controller.snapshot();
      if (!snap.current || snap.userPaused || !surface.paused) return false;
      quiet(controller.toggle());
      return true;
    },
    check() {
      if (!hidden || keep() || surface.paused) return false;
      if (!controller.snapshot().current) return false;
      resume = true;
      bgResume = false;
      quiet(controller.toggle());
      return true;
    },
    isHidden: () => hidden,
  };
  return life;
}
