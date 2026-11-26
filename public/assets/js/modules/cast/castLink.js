// Giai đoạn 15: đường nối thẳng giữa điện thoại và màn hình xe (WebRTC, chỉ một kênh dữ liệu), dùng chung cho cả hai vai.
//  - role 'sender' (điện thoại): tạo kết nối, mở kênh 'screen', gửi lời mời (offer); mất kết nối thì tự mời lại.
//  - role 'receiver' (màn hình xe): chờ lời mời, trả lời (answer), nhận kênh.
// Tin kết nối đi qua máy chủ (castApi.push/pull, hỏi định kỳ); mỗi lần mời có số thứ tự `gen` để bỏ qua tin của lần cũ.
// Trạng thái báo qua onState: 'waiting' (màn hình xe chờ nhập mã) | 'connecting' | 'connected' | 'reconnecting' | 'ended'.

const FAST_MS = 1000;        // đang ghép nối / đang nối lại
const SLOW_MS = 15000;       // đã nối: chỉ hỏi thưa để biết phiên còn sống (tin "dừng" đi thẳng qua kênh)
const OFFER_TIMEOUT_MS = 15000;
const DISCONNECT_GRACE_MS = 6000;
const RETRY_MS = [1500, 3000, 5000, 8000];

export function createCastLink({
  role, session, iceServers = [], castApi,
  RTC = (typeof window !== 'undefined' ? window.RTCPeerConnection : null),
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) },
  onState = () => {}, onChannel = () => {}, onInfo = () => {}, onEnded = () => {},
}) {
  let state = 'idle';
  let ended = false;
  let after = 0;
  let gen = 0;
  let pc = null;
  let channel = null;
  let remoteSet = false;
  let pendingIce = [];
  let heldIce = null;      // điện thoại: ứng viên có trước khi lời mời gửi xong thì giữ lại, gửi SAU lời mời (màn hình xe đọc theo thứ tự)
  let everConnected = false;
  let pollTimer = null;
  let offerTimer = null;
  let retryTimer = null;
  let graceTimer = null;
  let retries = 0;
  let failures = 0;
  let polling = false;

  const setState = (s) => { if (state !== s && !ended) { state = s; onState(s); } };
  const isOpen = () => Boolean(channel && channel.readyState === 'open');
  const quiet = (p) => { if (p && typeof p.catch === 'function') p.catch(() => {}); };

  function closePeer() {
    timers.clear(offerTimer);
    timers.clear(graceTimer);
    const oldCh = channel;
    const oldPc = pc;
    channel = null;
    pc = null;
    remoteSet = false;
    pendingIce = [];
    heldIce = null;
    if (oldCh) { oldCh.onopen = null; oldCh.onclose = null; oldCh.onmessage = null; try { oldCh.close(); } catch (e) { /* đã đóng */ } }
    if (oldPc) { oldPc.onicecandidate = null; oldPc.onconnectionstatechange = null; oldPc.ondatachannel = null; try { oldPc.close(); } catch (e) { /* đã đóng */ } }
  }

  function lost(g) {
    if (ended || g !== gen) return;
    const had = isOpen() || state === 'connected';
    closePeer();
    if (had) onChannel(null);
    setState(everConnected ? 'reconnecting' : 'connecting');
    schedulePoll(FAST_MS);
    if (role === 'sender') {
      timers.clear(retryTimer);
      const wait = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)];
      retries += 1;
      retryTimer = timers.set(() => { quiet(makeOffer()); }, wait);
    }
  }

  function wireChannel(ch, g) {
    channel = ch;
    ch.binaryType = 'arraybuffer';
    const opened = () => {
      if (ended || g !== gen) return;
      timers.clear(offerTimer);
      everConnected = true;
      retries = 0;
      setState('connected');
      onChannel(ch);
    };
    ch.onopen = opened;
    ch.onclose = () => lost(g);
    if (ch.readyState === 'open') opened();
  }

  function newPeer(g) {
    const p = new RTC({ iceServers });
    p.onicecandidate = (e) => {
      if (!e.candidate || ended || g !== gen) return;
      const c = e.candidate;
      const body = { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex, gen: g };
      if (heldIce) { heldIce.push(body); return; }
      quiet(castApi.push(session, 'ice', body));
    };
    p.onconnectionstatechange = () => {
      if (ended || g !== gen) return;
      const s = p.connectionState;
      if (s === 'failed' || s === 'closed') { lost(g); return; }
      timers.clear(graceTimer);
      if (s === 'disconnected') graceTimer = timers.set(() => { if (p.connectionState !== 'connected') lost(g); }, DISCONNECT_GRACE_MS);
    };
    if (role === 'receiver') p.ondatachannel = (e) => { if (!ended && g === gen) wireChannel(e.channel, g); };
    return p;
  }

  async function flushIce() {
    const list = pendingIce;
    pendingIce = [];
    for (let i = 0; i < list.length; i++) {
      try { await pc.addIceCandidate(list[i]); } catch (e) { /* ứng viên hỏng: bỏ qua */ }
    }
  }

  /** Điện thoại: mời (lại) màn hình xe. */
  async function makeOffer() {
    if (ended || role !== 'sender') return;
    timers.clear(retryTimer);
    closePeer();
    gen += 1;
    const g = gen;
    const held = [];
    heldIce = held;
    try {
      pc = newPeer(g);
      wireChannel(pc.createDataChannel('screen', { ordered: true }), g);
      const offer = await pc.createOffer();
      if (ended || g !== gen) return;
      await pc.setLocalDescription(offer);
      await castApi.push(session, 'offer', { type: 'offer', sdp: pc.localDescription.sdp, gen: g });
      if (heldIce === held) heldIce = null;
      if (!ended && g === gen) held.forEach((body) => quiet(castApi.push(session, 'ice', body)));
    } catch (e) {
      if (heldIce === held) heldIce = null;
      if (isEndError(e)) { finish(endedBy(e), false); return; }
      lost(g);
      return;
    }
    if (ended || g !== gen) return;
    setState(everConnected ? 'reconnecting' : 'connecting');
    offerTimer = timers.set(() => { if (!isOpen()) lost(g); }, OFFER_TIMEOUT_MS);
    schedulePoll(FAST_MS);
  }

  async function handle(sig) {
    const p = sig.payload || {};
    if (sig.kind === 'bye') { finish(role === 'sender' ? 'receiver' : 'sender', false); return; }
    if (sig.kind === 'offer' && role === 'receiver') {
      const g = Number(p.gen) || 0;
      if (g < gen) return;
      const had = isOpen();
      closePeer();
      if (had) onChannel(null);
      gen = g;
      setState(everConnected ? 'reconnecting' : 'connecting');
      pc = newPeer(g);
      await pc.setRemoteDescription({ type: 'offer', sdp: String(p.sdp || '') });
      if (ended || g !== gen) return;
      remoteSet = true;
      await flushIce();
      const answer = await pc.createAnswer();
      if (ended || g !== gen) return;
      await pc.setLocalDescription(answer);
      await castApi.push(session, 'answer', { type: 'answer', sdp: pc.localDescription.sdp, gen: g });
      return;
    }
    if (sig.kind === 'answer' && role === 'sender') {
      if (!pc || Number(p.gen) !== gen || remoteSet) return;
      await pc.setRemoteDescription({ type: 'answer', sdp: String(p.sdp || '') });
      remoteSet = true;
      await flushIce();
      return;
    }
    if (sig.kind === 'ice') {
      if (!pc || Number(p.gen) !== gen || !p.candidate) return;
      const cand = { candidate: String(p.candidate), sdpMid: p.sdpMid == null ? null : String(p.sdpMid), sdpMLineIndex: p.sdpMLineIndex == null ? null : Number(p.sdpMLineIndex) };
      if (!remoteSet) { pendingIce.push(cand); return; }
      try { await pc.addIceCandidate(cand); } catch (e) { /* bỏ qua */ }
    }
  }

  const isEndError = (e) => Boolean(e && (e.code === 'CAST_ENDED' || e.code === 'CAST_NOT_FOUND'));
  const endedBy = (e) => (e && e.details && e.details.ended_by) || 'gone';

  function schedulePoll(ms) {
    if (ended) return;
    timers.clear(pollTimer);
    pollTimer = timers.set(poll, ms);
  }

  async function poll() {
    if (ended || polling) return;
    polling = true;
    let delay = isOpen() ? SLOW_MS : FAST_MS;
    try {
      const data = await castApi.pull(session, after);
      if (ended) return;
      failures = 0;
      onInfo({ status: data.status, deviceName: data.device_name || '', codeExpiresIn: data.code_expires_in });
      if (role === 'receiver') {
        if (data.status === 'waiting') setState('waiting');
        else if (state === 'waiting' || state === 'idle') setState('connecting');
      }
      const list = data.signals || [];
      for (let i = 0; i < list.length; i++) {
        after = Math.max(after, Number(list[i].id) || 0);
        try { await handle(list[i]); } catch (e) {
          if (isEndError(e)) { finish(endedBy(e), false); return; }
          /* tin hỏng: bỏ qua, lần mời sau sẽ sửa */
        }
        if (ended) return;
      }
      delay = isOpen() ? SLOW_MS : FAST_MS;
    } catch (e) {
      if (isEndError(e)) { finish(endedBy(e), false); return; }
      failures += 1;
      delay = Math.min(8000, FAST_MS * Math.pow(2, Math.min(failures, 3)));
    } finally {
      polling = false;
    }
    schedulePoll(delay);
  }

  function finish(by, tellServer) {
    if (ended) return;
    const ch = channel;
    if (tellServer && ch && ch.readyState === 'open') { try { ch.send(JSON.stringify({ t: 'bye' })); } catch (e) { /* kênh vừa đóng */ } }
    const hadChannel = isOpen();
    state = 'ended';
    ended = true;
    timers.clear(pollTimer);
    timers.clear(retryTimer);
    // Cho tin "bye" kịp đi trước khi đóng kênh.
    if (tellServer && hadChannel) timers.set(closePeer, 250); else closePeer();
    if (tellServer) quiet(castApi.end(session));
    if (hadChannel) onChannel(null);
    onState('ended');
    onEnded(by);
  }

  return {
    /** Bắt đầu: điện thoại gửi lời mời ngay; màn hình xe bắt đầu chờ. */
    start() {
      if (ended || state !== 'idle') return;
      if (!RTC) { finish('unsupported', true); return; }
      if (role === 'sender') { setState('connecting'); quiet(makeOffer()); } else { setState('waiting'); schedulePoll(0); }
    },
    /** Tin "bye" nhận qua kênh dữ liệu (máy bên kia dừng chiếu). */
    peerSaidBye() { finish(role === 'sender' ? 'receiver' : 'sender', false); },
    /** Người dùng ở máy này bấm dừng. */
    stop() { finish(role, true); },
    state: () => state,
    channel: () => (isOpen() ? channel : null),
  };
}
