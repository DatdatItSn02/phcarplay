// Giai đoạn 15: phía ĐIỆN THOẠI của chức năng chiếu màn hình (chạy trong ứng dụng Android từ bản 1.2.0; chỉ có logic).
// start(mã) -> nhập mã với máy chủ -> bảo ứng dụng chụp màn hình (Android hỏi quyền) -> nối thẳng với màn hình xe
//           -> lấy từng ảnh JPEG ứng dụng vừa chụp (fetch '/__cast/frame') và gửi qua kênh dữ liệu.
// Trạng thái (snapshot().phase): 'idle' | 'joining' | 'permission' | 'connecting' | 'live' | 'reconnecting' | 'error'
import { createCastLink } from './castLink.js';
import { cleanCode, encodeFrame, HIGH_WATER_BYTES } from './castProtocol.js';

const PERMISSION_TIMEOUT_MS = 90000;   // người dùng đọc hộp hỏi quyền của Android
const IDLE_WAIT_MS = 250;              // chưa có ảnh mới: chờ ứng dụng báo 'frame' hoặc hết chừng này thì hỏi lại
const BUSY_WAIT_MS = 40;               // kênh đang kẹt: chờ rồi thử lại (bỏ bớt ảnh)
export const CAPTURE_OPTIONS = { maxSide: 1280, quality: 70, fps: 12 };

/** Tên máy lấy từ User-Agent ("... Android 14; Pixel 7 Build/...") để hiện bên màn hình xe. */
export function deviceNameFromUa(ua) {
  const m = /Android [0-9.]+; ([^;)]+?)(?: Build\/[^;)]*)?[;)]/.exec(String(ua || ''));
  const name = m ? m[1].trim() : '';
  return name && name.toLowerCase() !== 'k' && name.toLowerCase() !== 'wv' ? name.slice(0, 60) : 'Điện thoại Android';
}

export function createCastSender({
  castApi, nativeApp, makeLink = createCastLink,
  fetchImpl = (...a) => fetch(...a),
  frameUrl = () => new URL('/__cast/frame', window.location.origin).toString(),
  deviceName = () => deviceNameFromUa(typeof navigator !== 'undefined' ? navigator.userAgent : ''),
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) },
  onChange = () => {}, onBeforeLive = () => {},
}) {
  let phase = 'idle';
  let message = '';
  let run = 0;
  let link = null;
  let session = null;
  let capturing = false;
  let sent = 0;
  let size = { width: 0, height: 0 };
  let permissionTimer = null;
  let frameWaiter = null;     // hàm đánh thức vòng lấy ảnh khi ứng dụng báo có ảnh mới
  let pumping = false;

  const snapshot = () => ({ phase, message, sent, width: size.width, height: size.height });
  const set = (p, msg = '') => { phase = p; message = msg; onChange(snapshot()); };
  const active = () => phase !== 'idle' && phase !== 'error';

  function wake() { const w = frameWaiter; frameWaiter = null; if (w) w(); }
  const sleep = (ms) => new Promise((resolve) => {
    const t = timers.set(() => { if (frameWaiter === done) frameWaiter = null; resolve(); }, ms);
    function done() { timers.clear(t); resolve(); }
    frameWaiter = done;
  });

  function teardown(tellPeer) {
    run += 1;
    timers.clear(permissionTimer);
    const l = link;
    const s = session;
    link = null;
    session = null;
    if (l) { if (tellPeer) l.stop(); else l.peerSaidBye(); } else if (s && tellPeer) castApi.end(s).catch(() => {});
    if (capturing || phase === 'permission') { capturing = false; nativeApp.castStop(); }   // kể cả khi hộp hỏi quyền còn mở
    wake();
  }

  function fail(msg) { teardown(true); set('error', msg); }

  /** Vòng lấy ảnh: chạy suốt lúc đang chiếu. Kênh kẹt thì bỏ ảnh (màn hình xe luôn nhận ảnh mới nhất). */
  async function pump(my) {
    if (pumping) return;
    pumping = true;
    let lastSeq = 0;
    let errors = 0;
    try {
      while (my === run) {
        const ch = link ? link.channel() : null;
        if (!ch) { await sleep(IDLE_WAIT_MS); continue; }
        if (ch.bufferedAmount > HIGH_WATER_BYTES) { await sleep(BUSY_WAIT_MS); continue; }
        let res;
        try {
          res = await fetchImpl(frameUrl() + '?since=' + lastSeq, { cache: 'no-store', credentials: 'omit' });
        } catch (e) {
          errors += 1;
          if (errors > 20) { if (my === run) fail('Không lấy được hình từ ứng dụng. Hãy thử chiếu lại.'); return; }
          await sleep(IDLE_WAIT_MS);
          continue;
        }
        if (my !== run) return;
        if (res.status === 204) { errors = 0; await sleep(IDLE_WAIT_MS); continue; }
        if (res.status !== 200) {
          errors += 1;
          // 410: ứng dụng không còn chụp (người dùng dừng từ thông báo của Android) - sự kiện 'stopped' sẽ tới ngay sau.
          if (errors > 20) { if (my === run) fail('Ứng dụng đã ngừng chụp màn hình. Hãy thử chiếu lại.'); return; }
          await sleep(IDLE_WAIT_MS);
          continue;
        }
        errors = 0;
        const seq = Number(res.headers.get('X-Cast-Seq')) || (lastSeq + 1);
        const w = Number(res.headers.get('X-Cast-Width')) || size.width;
        const h = Number(res.headers.get('X-Cast-Height')) || size.height;
        const bytes = await res.arrayBuffer();
        if (my !== run) return;
        lastSeq = seq;
        const live = link ? link.channel() : null;
        if (!live || !bytes.byteLength) continue;
        try {
          const msgs = encodeFrame(seq, w, h, bytes);
          for (let i = 0; i < msgs.length; i++) live.send(msgs[i]);
          sent += 1;
          if (sent === 1 || sent % 30 === 0) onChange(snapshot());
        } catch (e) { /* kênh vừa đóng: castLink sẽ nối lại */ }
      }
    } finally {
      pumping = false;
    }
  }

  function connect(my, ice) {
    link = makeLink({
      role: 'sender', session, iceServers: ice, castApi,
      onState: (s) => {
        if (my !== run) return;
        if (s === 'connected') set('live');
        else if (s === 'reconnecting') set('reconnecting');
        else if (s === 'connecting') set('connecting');
      },
      onChannel: (ch) => {
        if (my !== run || !ch) return;
        try { ch.send(JSON.stringify({ t: 'hello', name: deviceName() })); } catch (e) { /* bỏ qua */ }
        ch.onmessage = (e) => {
          if (typeof e.data !== 'string') return;
          try { if (JSON.parse(e.data).t === 'bye' && link) link.peerSaidBye(); } catch (err) { /* bỏ qua */ }
        };
        wake();
      },
      onEnded: (by) => {
        if (my !== run) return;
        link = null;
        session = null;
        run += 1;
        if (capturing) { capturing = false; nativeApp.castStop(); }
        wake();
        if (by === 'sender') { set('idle'); return; }
        set('error', by === 'receiver' ? 'Màn hình xe đã dừng chiếu.' : (by === 'unsupported' ? 'Ứng dụng này chưa hỗ trợ kết nối trực tiếp (WebView quá cũ).' : 'Phiên chiếu đã kết thúc. Hãy lấy mã mới trên màn hình xe.'));
      },
    });
    link.start();
    pump(my);
  }

  const offCast = nativeApp.onCast((event, data) => {
    if (event === 'frame') { wake(); return; }
    if (event === 'started') {
      if (phase !== 'permission') return;
      timers.clear(permissionTimer);
      capturing = true;
      size = { width: Number(data.width) || 0, height: Number(data.height) || 0 };
      const my = run;
      const ice = session.ice || [];
      onBeforeLive();
      set('connecting');
      connect(my, ice);
      return;
    }
    if (event === 'denied') { if (phase === 'permission') fail('Bạn chưa cho phép ghi màn hình. Bấm "Kết nối" để thử lại và chọn "Bắt đầu".'); return; }
    if (event === 'error') { if (active()) fail((data && data.message) || 'Ứng dụng không chụp được màn hình.'); return; }
    if (event === 'stopped') {
      if (!active()) return;
      capturing = false;
      teardown(true);
      set('idle');
    }
  });

  return {
    snapshot,
    /** Người dùng nhập mã đang hiện trên màn hình xe rồi bấm "Kết nối". */
    async start(rawCode) {
      if (active()) return false;
      const code = cleanCode(rawCode);
      if (code.length !== 6) { set('error', 'Hãy nhập đủ 6 số của mã trên màn hình xe.'); return false; }
      const my = ++run;
      sent = 0;
      set('joining');
      let data;
      try {
        data = await castApi.join(code, deviceName());
      } catch (e) {
        if (my === run) set('error', (e && e.message) || 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.');
        return false;
      }
      if (my !== run) { castApi.end({ id: data.id, token: data.token }).catch(() => {}); return false; }
      session = { id: data.id, token: data.token, ice: data.ice_servers || [] };
      set('permission');
      if (!nativeApp.castStart(CAPTURE_OPTIONS)) { fail('Ứng dụng không nhận được lệnh chụp màn hình.'); return false; }
      permissionTimer = timers.set(() => { if (my === run && phase === 'permission') fail('Chưa thấy bạn cho phép ghi màn hình. Bấm "Kết nối" để thử lại.'); }, PERMISSION_TIMEOUT_MS);
      return true;
    },
    /** Người dùng bấm "Dừng chiếu" trên điện thoại. */
    stop() {
      if (!active()) { if (phase === 'error') set('idle'); return; }
      teardown(true);
      set('idle');
    },
    isActive: active,
    destroy() { offCast(); if (active()) teardown(true); },
  };
}
