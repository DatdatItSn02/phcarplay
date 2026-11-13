// Giai đoạn 15: phía MÀN HÌNH XE của chức năng chiếu màn hình điện thoại (chỉ có logic, không vẽ giao diện).
// open() -> xin mã 6 số, chờ điện thoại nhập mã, nối thẳng với điện thoại, nhận từng ảnh màn hình.
// Trạng thái (snapshot().phase):
//   'off' | 'loading' (đang xin mã) | 'code' (đang hiện mã) | 'connecting' (điện thoại đã nhập mã, đang nối)
//   | 'live' (đang chiếu) | 'reconnecting' (mất kết nối, đang nối lại) | 'error'
import { createCastLink } from './castLink.js';
import { createFrameAssembler } from './castProtocol.js';

const MAX_AUTO_RENEW = 6;   // mã hết hạn (5 phút) thì tự lấy mã mới, tối đa 6 lần (~30 phút) rồi chờ người dùng bấm

export function createCastReceiver({
  castApi, makeLink = createCastLink, now = () => Date.now(),
  onChange = () => {}, onFrame = () => {}, onEnded = () => {},
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

  const snapshot = () => ({ phase, code, codeExpiresAt, deviceName, message, notice, frames });
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

  async function begin(auto) {
    const my = ++run;
    const old = dropLink();
    if (old) old.stop();
    everLive = false;
    frames = 0;
    deviceName = '';
    assembler.reset();
    if (!auto) { renews = 0; notice = ''; }
    set('loading', { message: '' });
    let data;
    try {
      data = await castApi.create();
    } catch (e) {
      if (my !== run) return;
      set('error', { message: (e && e.message) || 'Không lấy được mã. Kiểm tra mạng rồi thử lại.' });
      return;
    }
    if (my !== run) { castApi.end({ id: data.id, token: data.token }).catch(() => {}); return; }
    session = { id: data.id, token: data.token };
    code = String(data.code || '');
    codeExpiresAt = now() + (Number(data.expires_in) || 300) * 1000;
    link = makeLink({
      role: 'receiver', session, iceServers: data.ice_servers || [], castApi,
      onState: (s) => {
        if (my !== run) return;
        if (s === 'waiting') set('code');
        else if (s === 'connecting') set('connecting');
        else if (s === 'connected') { everLive = true; set('live'); }
        else if (s === 'reconnecting') set('reconnecting');
      },
      onInfo: (info) => {
        if (my !== run) return;
        if (info.deviceName && info.deviceName !== deviceName) { deviceName = info.deviceName; onChange(snapshot()); }
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
        if (!wasLive && by === 'expired' && renews < MAX_AUTO_RENEW) { renews += 1; begin(true); return; }
        if (!wasLive && by === 'sender') { notice = 'Điện thoại đã hủy. Hãy nhập mã mới này.'; begin(true); return; }
        if (!wasLive) {
          set('error', { message: by === 'expired' ? 'Mã đã hết hạn.' : (by === 'unsupported' ? 'Trình duyệt này chưa hỗ trợ nhận hình chiếu.' : 'Phiên ghép nối đã kết thúc.') });
          return;
        }
        run += 1;
        set('off', { message: '' });
        onEnded(by);
      },
    });
    link.start();
  }

  return {
    snapshot,
    /** Mở chức năng: lấy mã và chờ điện thoại. */
    open() { return begin(false); },
    /** Lấy mã mới (người dùng bấm). */
    renew() { return begin(false); },
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
