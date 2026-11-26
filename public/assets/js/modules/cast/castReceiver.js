// Giai đoạn 15: phía MÀN HÌNH XE của chức năng chiếu màn hình điện thoại (chỉ có logic, không vẽ giao diện).
// open() -> xin mã 6 số, chờ điện thoại nhập mã, nối thẳng với điện thoại, nhận từng ảnh màn hình.
// Giai đoạn 17 (đợt 2): có khóa thiết bị (device) thì mã kèm khóa -> điện thoại nhập mã xong thành CẶP GHÉP ĐÔI
// (onPaired(pairId)); lần sau điện thoại bấm "Chia sẻ", castIncoming.js nhận lời mời và gọi accept(lời mời) - nối luôn,
// không cần mã.
// Trạng thái (snapshot().phase):
//   'off' | 'loading' (đang xin mã) | 'code' (đang hiện mã) | 'connecting' (điện thoại đã nhập mã / đã bấm Chia sẻ, đang nối)
//   | 'live' (đang chiếu) | 'reconnecting' (mất kết nối, đang nối lại) | 'error'
// snapshot().via: 'code' (nhập mã) | 'share' (điện thoại đã ghép đôi bấm "Chia sẻ").
import { createCastLink } from './castLink.js';
import { createFrameAssembler } from './castProtocol.js';

const MAX_AUTO_RENEW = 6;   // mã hết hạn (5 phút) thì tự lấy mã mới, tối đa 6 lần (~30 phút) rồi chờ người dùng bấm

export function createCastReceiver({
  castApi, makeLink = createCastLink, now = () => Date.now(),
  device = null, name = '',
  onChange = () => {}, onFrame = () => {}, onEnded = () => {}, onPaired = () => {},
}) {
  let phase = 'off';
  let code = '';
  let codeExpiresAt = 0;
  let deviceName = '';
  let message = '';
  let notice = '';       // dòng nhắc kèm mã mới (ví dụ "Điện thoại đã hủy")
  let link = null;
  let session = null;
  let run = 0;           // tăng mỗi lần open/stop để bỏ qua kết quả của lần trước
  let renews = 0;
  let everLive = false;
  let frames = 0;
  let via = 'code';
  let pairSeen = 0;      // cặp ghép đôi đã báo của phiên này (mỗi phiên chỉ báo một lần)

  const snapshot = () => ({ phase, code, codeExpiresAt, deviceName, message, notice, frames, via });
  const set = (p, extra = {}) => {
    phase = p;
    if (extra.message !== undefined) message = extra.message;
    if (extra.notice !== undefined) notice = extra.notice;
    onChange(snapshot());
  };

  const assembler = createFrameAssembler({
    onFrame: (f) => { frames += 1; onFrame(f); },
    onControl: (msg) => {
      if (msg.t === 'bye' && link) link.peerSaidBye();
      if (msg.t === 'hello' && typeof msg.name === 'string' && msg.name) { deviceName = msg.name.slice(0, 60); onChange(snapshot()); }
    },
  });

  function dropLink() {
    const l = link;
    link = null;
    session = null;
    return l;
  }

  /** Bỏ phiên cũ (nếu có) trước khi bắt đầu phiên mới. */
  function reset() {
    const old = dropLink();
    if (old) old.stop();
    everLive = false;
    frames = 0;
    deviceName = '';
    pairSeen = 0;
    assembler.reset();
  }

  /** Nối với điện thoại trong phiên sess (dùng chung cho phiên nhập mã và phiên "Chia sẻ"). */
  function attach(my, sess, iceServers) {
    session = sess;
    link = makeLink({
      role: 'receiver', session: sess, iceServers, castApi,
      onState: (s) => {
        if (my !== run) return;
        if (s === 'waiting') set(via === 'share' ? 'connecting' : 'code');
        else if (s === 'connecting') set('connecting');
        else if (s === 'connected') { everLive = true; set('live'); }
        else if (s === 'reconnecting') set('reconnecting');
      },
      onInfo: (info) => {
        if (my !== run) return;
        if (info.deviceName && info.deviceName !== deviceName) { deviceName = info.deviceName; onChange(snapshot()); }
        if (info.pairId > 0 && info.pairId !== pairSeen) { pairSeen = info.pairId; onPaired(info.pairId); }
      },
      onChannel: (ch) => {
        if (my !== run) return;
        assembler.reset();
        if (ch) ch.onmessage = (e) => assembler.push(e.data);
      },
      onEnded: (by) => {
        if (my !== run) return;
        const wasLive = everLive;
        dropLink();
        if (by === 'receiver') return;   // chính máy này dừng: stop() đã lo
        if (!wasLive && via === 'share') {   // điện thoại hủy / không nối được trước khi có hình: thôi, không hiện mã
          run += 1;
          set('off', { message: '' });
          onEnded(by, false);
          return;
        }
        if (!wasLive && by === 'expired' && renews < MAX_AUTO_RENEW) { renews += 1; begin(true); return; }
        if (!wasLive && by === 'sender') { notice = 'Điện thoại đã hủy. Hãy nhập mã mới này.'; begin(true); return; }
        if (!wasLive) {
          set('error', { message: by === 'expired' ? 'Mã đã hết hạn.' : (by === 'unsupported' ? 'Trình duyệt này chưa hỗ trợ nhận hình chiếu.' : 'Phiên ghép nối đã kết thúc.') });
          return;
        }
        run += 1;
        set('off', { message: '' });
        onEnded(by, true);
      },
    });
    link.start();
  }

  async function begin(auto) {
    const my = ++run;
    reset();
    via = 'code';
    if (!auto) { renews = 0; notice = ''; }
    set('loading', { message: '' });
    const key = device ? device.key() : '';
    let data;
    try {
      data = await castApi.create(key, name);
    } catch (e) {
      if (my !== run) return;
      set('error', { message: (e && e.message) || 'Không lấy được mã. Kiểm tra mạng rồi thử lại.' });
      return;
    }
    const token = data.token || key;   // máy có khóa thiết bị: dùng chính khóa đó cho phiên
    if (my !== run) { castApi.end({ id: data.id, token }).catch(() => {}); return; }
    code = String(data.code || '');
    codeExpiresAt = now() + (Number(data.expires_in) || 300) * 1000;
    attach(my, { id: data.id, token }, data.ice_servers || []);
  }

  return {
    snapshot,
    /** Mở chức năng: lấy mã và chờ điện thoại. */
    open() { return begin(false); },
    /** Lấy mã mới (người dùng bấm). */
    renew() { return begin(false); },
    /**
     * Giai đoạn 17: điện thoại đã ghép đôi vừa bấm "Chia sẻ" (lời mời do castIncoming.js nhận được): nối luôn, không mã.
     * Đang hiện mã thì bỏ mã. Đang chiếu thì không nhận (trả về false).
     */
    accept(incoming, iceServers = []) {
      if (!device || !incoming || !(Number(incoming.id) > 0)) return false;
      if (phase === 'live' || phase === 'reconnecting') return false;
      const my = ++run;
      reset();
      via = 'share';
      code = '';
      notice = '';
      deviceName = String(incoming.device_name || '').slice(0, 60);
      set('connecting', { message: '' });
      attach(my, { id: Number(incoming.id), token: device.key() }, iceServers || []);
      return true;
    },
    /** Dừng chiếu / đóng hộp ghép nối. */
    stop() {
      run += 1;
      const l = dropLink();
      if (l) l.stop();
      if (phase !== 'off') set('off', { message: '', notice: '' });
    },
    isActive: () => phase !== 'off',
    isLive: () => phase === 'live' || phase === 'reconnecting',
  };
}
