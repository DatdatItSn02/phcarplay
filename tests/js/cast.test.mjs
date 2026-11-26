// Giai đoạn 15 (đợt 2): chiếu màn hình điện thoại lên màn hình xe - phần logic của website.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHUNK_BYTES, cleanCode, formatCode, encodeFrame, createFrameAssembler, fitColumnWidth, fitRowHeight, clampShare, coverOverflow, panBy, HIGH_WATER_BYTES,
} from '../../public/assets/js/modules/cast/castProtocol.js';
import { createCastLink } from '../../public/assets/js/modules/cast/castLink.js';
import { createCastReceiver } from '../../public/assets/js/modules/cast/castReceiver.js';
import { createCastSender, deviceNameFromUa, CAPTURE_OPTIONS } from '../../public/assets/js/modules/cast/castSender.js';
import { createCastApi } from '../../public/assets/js/modules/cast/castApi.js';
import { createNativeBridge } from '../../public/assets/js/core/nativeApp.js';

const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const bytesOf = (n, seed = 1) => { const u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = (i * 7 + seed) & 255; return u.buffer; };

// ---------------------------------------------------------------- castProtocol
test('mã ghép nối: chỉ giữ 6 chữ số, hiển thị tách 3-3', () => {
  assert.equal(cleanCode(' 48-29 13x9'), '482913');
  assert.equal(cleanCode(null), '');
  assert.equal(formatCode('482913'), '482 913');
  assert.equal(formatCode('48'), '48');
  assert.equal(formatCode('4829'), '482 9');
});

test('ảnh được tách thành các mảnh 16 KB và ghép lại đúng từng byte', () => {
  const src = bytesOf(CHUNK_BYTES * 2 + 123);
  const msgs = encodeFrame(7, 540, 1170, src);
  assert.equal(msgs.length, 4, '1 tin mở đầu + 3 mảnh');
  assert.deepEqual(JSON.parse(msgs[0]), { t: 'f', seq: 7, w: 540, h: 1170, size: CHUNK_BYTES * 2 + 123, parts: 3 });
  assert.equal(msgs[1].byteLength, CHUNK_BYTES);
  assert.equal(msgs[3].byteLength, 123);
  const frames = [];
  const asm = createFrameAssembler({ onFrame: (f) => frames.push(f) });
  msgs.forEach((m) => asm.push(m));
  assert.equal(frames.length, 1);
  assert.deepEqual([frames[0].seq, frames[0].w, frames[0].h], [7, 540, 1170]);
  assert.deepEqual(Array.from(frames[0].bytes), Array.from(new Uint8Array(src)));
  // ảnh nhỏ hơn một mảnh
  const small = encodeFrame(8, 2, 2, bytesOf(10));
  assert.equal(small.length, 2);
  small.forEach((m) => asm.push(m));
  assert.equal(frames.length, 2);
  assert.equal(asm.dropped(), 0);
});

test('ghép ảnh: ảnh dở bị bỏ khi ảnh mới tới; dữ liệu sai không làm hỏng ảnh sau; tin điều khiển tách riêng', () => {
  const frames = [];
  const control = [];
  const asm = createFrameAssembler({ onFrame: (f) => frames.push(f.seq), onControl: (m) => control.push(m.t), maxBytes: 100000 });
  const a = encodeFrame(1, 10, 10, bytesOf(CHUNK_BYTES + 5));
  asm.push(a[0]);
  asm.push(a[1]);                       // thiếu mảnh cuối
  const b = encodeFrame(2, 10, 10, bytesOf(50));
  b.forEach((m) => asm.push(m));
  assert.deepEqual(frames, [2]);
  assert.equal(asm.dropped(), 1);
  asm.push(bytesOf(20));                // mảnh lạc
  asm.push('không phải json');
  asm.push(JSON.stringify({ t: 'f', seq: 3, w: 10, h: 10, size: 999999999, parts: 2 }));   // quá lớn
  asm.push(bytesOf(20));
  asm.push(JSON.stringify({ t: 'f', seq: 4, w: 10, h: 10, size: 10, parts: 1 }));
  asm.push(bytesOf(11));                // thừa byte
  asm.push(JSON.stringify({ t: 'f', seq: 5, w: 0, h: 10, size: 10, parts: 1 }));           // kích thước sai
  asm.push(JSON.stringify({ t: 'hello', name: 'Máy' }));
  asm.push(JSON.stringify({ t: 'bye' }));
  const c = encodeFrame(6, 10, 10, bytesOf(30));
  asm.push(c[0]);
  asm.push(new Uint8Array(c[1]));       // nhận dạng Uint8Array cũng được
  assert.deepEqual(frames, [2, 6]);
  assert.deepEqual(control, ['hello', 'bye']);
});

test('"Vừa khung": cột rộng theo tỉ lệ điện thoại, có giới hạn; màn hình xe dọc thì tính bề cao', () => {
  assert.equal(fitColumnWidth(540, 1170, 900, 524), 242, 'điện thoại dọc trên màn 1024x600');
  assert.equal(fitColumnWidth(1170, 540, 900, 524), 558, 'điện thoại ngang: tối đa 62% bề rộng');
  assert.equal(fitColumnWidth(540, 1170, 700, 400), 200, 'không hẹp hơn 200px');
  assert.equal(fitColumnWidth(540, 1170, 250, 400), 155, 'khung quá hẹp: không vượt 62%');
  assert.equal(fitColumnWidth(0, 0, 900, 524), 315, 'chưa có ảnh: tạm 35%');
  assert.equal(fitRowHeight(540, 1170, 700, 1000), 620, 'màn hình xe dọc: tối đa 62% bề cao');
  assert.equal(fitRowHeight(1170, 540, 700, 1000), 323);
  assert.equal(clampShare(0.1), 0.3);
  assert.equal(clampShare(0.9), 0.7);
  assert.equal(clampShare('abc'), 0.5, 'mặc định: đúng một nửa màn hình');
  assert.equal(clampShare(0.6), 0.6);
});

test('"Lấp đầy": tính phần hình bị thừa ra và kéo hình trong phạm vi đó', () => {
  // điện thoại dọc 540x1170 trong nửa màn hình 512x544: phóng theo bề rộng -> thừa chiều dọc
  assert.deepEqual(coverOverflow(540, 1170, 512, 544), { x: 0, y: 565 });
  // điện thoại ngang 1170x540 trong cùng khung: phóng theo bề cao -> thừa chiều ngang
  assert.deepEqual(coverOverflow(1170, 540, 512, 544), { x: 667, y: 0 });
  assert.deepEqual(coverOverflow(512, 544, 512, 544), { x: 0, y: 0 }, 'vừa khít');
  assert.deepEqual(coverOverflow(0, 0, 512, 544), { x: 0, y: 0 }, 'chưa có ảnh');
  assert.equal(panBy(0.5, -113, 565), 0.7, 'kéo hình lên 113px: thấy phần dưới nhiều hơn');
  assert.equal(panBy(0.5, 113, 565), 0.3, 'kéo hình xuống: thấy phần trên nhiều hơn');
  assert.equal(panBy(0.9, -500, 565), 1, 'không kéo quá mép dưới');
  assert.equal(panBy(0.1, 500, 565), 0, 'không kéo quá mép trên');
  assert.equal(panBy(0.4, 50, 0), 0.4, 'chiều vừa khít thì không dịch');
  assert.equal(panBy('abc', 0, 100), 0.5);
});

test('castApi: gửi khóa của máy trong header X-Cast-Token', async () => {
  const calls = [];
  const api = { get: (p, h) => { calls.push(['GET', p, h]); return Promise.resolve({}); }, post: (p, b, h) => { calls.push(['POST', p, b, h]); return Promise.resolve({}); } };
  const c = createCastApi(api);
  const s = { id: 12, token: 'abc' };
  await c.create(); await c.join('123456', 'Máy A'); await c.pull(s, 5); await c.push(s, 'ice', { a: 1 }); await c.end(s);
  assert.deepEqual(calls, [
    ['POST', '/cast/sessions', {}, undefined],
    ['POST', '/cast/join', { code: '123456', device_name: 'Máy A' }, undefined],
    ['GET', '/cast/sessions/12/signals?after=5', { 'X-Cast-Token': 'abc' }],
    ['POST', '/cast/sessions/12/signals', { kind: 'ice', payload: { a: 1 } }, { 'X-Cast-Token': 'abc' }],
    ['POST', '/cast/sessions/12/end', {}, { 'X-Cast-Token': 'abc' }],
  ]);
});

// ---------------------------------------------------------------- castLink (WebRTC giả + máy chủ ghép nối giả)
function fakeTimers() {
  const q = new Map();
  let n = 0;
  return {
    set(fn, ms) { n += 1; q.set(n, { fn, ms }); return n; },
    clear(id) { q.delete(id); },
    /** Chạy mọi hẹn giờ có thời gian <= maxMs (một lượt). */
    fire(maxMs) { const run = []; q.forEach((v, k) => { if (v.ms <= maxMs) { run.push(v.fn); q.delete(k); } }); run.forEach((fn) => fn()); return run.length; },
    pending: () => Array.from(q.values()).map((v) => v.ms).sort((a, b) => a - b),
  };
}
function fakeRtc() {
  const peers = [];
  class Ch {
    constructor(label) { this.label = label; this.readyState = 'connecting'; this.sent = []; this.bufferedAmount = 0; }
    send(m) { if (this.readyState !== 'open') throw new Error('kênh đã đóng'); this.sent.push(m); }
    close() { this.readyState = 'closed'; }
    open() { this.readyState = 'open'; if (this.onopen) this.onopen(); }
    drop() { this.readyState = 'closed'; if (this.onclose) this.onclose(); }
  }
  class PC {
    constructor(cfg) { this.cfg = cfg; this.n = peers.length; this.connectionState = 'new'; this.remote = null; this.ice = []; this.channels = []; this.closed = false; peers.push(this); }
    createDataChannel(label) { const c = new Ch(label); this.channels.push(c); return c; }
    async createOffer() { return { type: 'offer', sdp: 'offer' + this.n }; }
    async createAnswer() { return { type: 'answer', sdp: 'answer' + this.n }; }
    async setLocalDescription(d) { this.localDescription = d; if (this.onicecandidate) this.onicecandidate({ candidate: { candidate: 'cand' + this.n, sdpMid: '0', sdpMLineIndex: 0 } }); }
    async setRemoteDescription(d) { this.remote = d; }
    async addIceCandidate(c) { this.ice.push(c.candidate); }
    close() { this.closed = true; this.connectionState = 'closed'; }
    incoming() { const c = new Ch('screen'); this.channels.push(c); this.ondatachannel({ channel: c }); return c; }
  }
  return { PC, Ch, peers };
}
function fakeServer() {
  const signals = [];
  let ended = null;
  const gone = () => Object.assign(new Error('đã kết thúc'), { code: 'CAST_ENDED', details: { ended_by: ended } });
  return {
    signals,
    apiFor(role, status = 'paired') {
      return {
        pull: async (s, after) => { if (ended) throw gone(); return { status: typeof status === 'function' ? status() : status, device_name: 'Máy thử', signals: signals.filter((x) => x.role !== role && x.id > after).map((x) => ({ id: x.id, kind: x.kind, payload: x.payload })) }; },
        push: async (s, kind, payload) => { if (ended) throw gone(); signals.push({ id: signals.length + 1, role, kind, payload }); return { id: signals.length }; },
        end: async () => { if (!ended) ended = role; return {}; },
      };
    },
    end(by) { ended = by; },
    endedBy: () => ended,
  };
}
function pair() {
  const rtc = fakeRtc();
  const server = fakeServer();
  const log = { s: [], r: [], sCh: [], rCh: [], sEnd: [], rEnd: [] };
  const ts = fakeTimers();
  const tr = fakeTimers();
  const sender = createCastLink({ role: 'sender', session: { id: 1, token: 's' }, castApi: server.apiFor('sender'), RTC: rtc.PC, timers: ts,
    onState: (x) => log.s.push(x), onChannel: (c) => log.sCh.push(c), onEnded: (by) => log.sEnd.push(by) });
  const receiver = createCastLink({ role: 'receiver', session: { id: 1, token: 'r' }, castApi: server.apiFor('receiver'), RTC: rtc.PC, timers: tr,
    onState: (x) => log.r.push(x), onChannel: (c) => log.rCh.push(c), onEnded: (by) => log.rEnd.push(by) });
  return { rtc, server, log, ts, tr, sender, receiver };
}
async function handshake(p) {
  p.sender.start();
  await settle();
  p.receiver.start();
  p.tr.fire(0); await settle();          // màn hình xe hỏi máy chủ: thấy lời mời
  p.ts.fire(1000); await settle();       // điện thoại hỏi máy chủ: thấy trả lời
  const pcS = p.rtc.peers[p.rtc.peers.length - 2];
  const pcR = p.rtc.peers[p.rtc.peers.length - 1];
  return { pcS, pcR };
}

test('castLink: điện thoại mời, màn hình xe trả lời, trao đổi ứng viên, kênh mở thì "connected"', async () => {
  const p = pair();
  const { pcS, pcR } = await handshake(p);
  assert.deepEqual(p.server.signals.map((x) => `${x.role}:${x.kind}:${x.payload.gen}`), ['sender:offer:1', 'sender:ice:1', 'receiver:ice:1', 'receiver:answer:1'], 'ứng viên của điện thoại luôn đi SAU lời mời');
  assert.deepEqual(pcR.remote, { type: 'offer', sdp: 'offer0' });
  assert.deepEqual(pcS.remote, { type: 'answer', sdp: 'answer1' });
  assert.deepEqual(pcR.ice, ['cand0']);
  assert.deepEqual(pcS.ice, ['cand1'], 'ứng viên tới trước câu trả lời được giữ lại rồi mới nạp');
  assert.equal(pcS.channels[0].label, 'screen');
  assert.deepEqual(p.log.s, ['connecting']);
  assert.deepEqual(p.log.r, ['waiting', 'connecting']);
  pcS.channels[0].open();
  const chR = pcR.incoming();
  chR.open();
  assert.deepEqual(p.log.s, ['connecting', 'connected']);
  assert.deepEqual(p.log.r, ['waiting', 'connecting', 'connected']);
  assert.equal(p.sender.channel(), pcS.channels[0]);
  assert.equal(p.receiver.channel(), chR);
  assert.equal(chR.binaryType, 'arraybuffer');
  assert.deepEqual(p.ts.pending().filter((ms) => ms === 15000).length, 0, 'đã nối: bỏ hẹn giờ chờ trả lời');
});

test('castLink: đứt kết nối -> điện thoại tự mời lại (gen 2), màn hình xe thay kết nối cũ, không báo kết thúc', async () => {
  const p = pair();
  const { pcS, pcR } = await handshake(p);
  pcS.channels[0].open();
  pcR.incoming().open();
  pcS.channels[0].drop();
  assert.deepEqual(p.log.s.slice(-1), ['reconnecting']);
  assert.equal(p.log.sCh.slice(-1)[0], null, 'báo kênh đã mất');
  assert.equal(pcS.closed, true);
  assert.equal(p.sender.channel(), null);
  p.ts.fire(1500); await settle();        // hết thời gian chờ -> mời lại
  assert.equal(p.server.signals.filter((x) => x.kind === 'offer').pop().payload.gen, 2);
  pcR.channels[0].drop();                 // màn hình xe cũng thấy kênh đóng
  assert.deepEqual(p.log.r.slice(-1), ['reconnecting']);
  p.tr.fire(1000); await settle();
  const pcR2 = p.rtc.peers[p.rtc.peers.length - 1];
  assert.equal(pcR.closed, true);
  assert.deepEqual(pcR2.remote, { type: 'offer', sdp: 'offer2' });
  p.ts.fire(1000); await settle();
  const pcS2 = p.rtc.peers[2];
  assert.deepEqual(pcS2.remote, { type: 'answer', sdp: 'answer3' });
  pcS2.channels[0].open();
  pcR2.incoming().open();
  assert.deepEqual(p.log.s.slice(-1), ['connected']);
  assert.deepEqual(p.log.r.slice(-1), ['connected']);
  assert.deepEqual([p.log.sEnd, p.log.rEnd], [[], []]);
  // tin của lần mời cũ (gen 1) tới muộn thì bị bỏ qua
  p.server.signals.push({ id: p.server.signals.length + 1, role: 'receiver', kind: 'answer', payload: { type: 'answer', sdp: 'cũ', gen: 1 } });
  p.ts.fire(15000); await settle();
  assert.deepEqual(pcS2.remote, { type: 'answer', sdp: 'answer3' });
});

test('castLink: không ai trả lời trong 15 giây thì mời lại; trạng thái mạng "failed" cũng mời lại', async () => {
  const p = pair();
  p.sender.start();
  await settle();
  assert.ok(p.ts.pending().includes(15000));
  p.ts.fire(15000); await settle();       // hết giờ chờ (kèm lượt hỏi máy chủ)
  p.ts.fire(1500); await settle();
  assert.equal(p.server.signals.filter((x) => x.kind === 'offer').length, 2);
  const pc = p.rtc.peers[p.rtc.peers.length - 1];
  pc.connectionState = 'failed';
  pc.onconnectionstatechange();
  p.ts.fire(3000); await settle();
  assert.equal(p.server.signals.filter((x) => x.kind === 'offer').length, 3);
  assert.deepEqual(p.log.sEnd, []);
});

test('castLink: màn hình xe bấm dừng -> báo qua kênh ("bye") và máy chủ; điện thoại biết phiên đã kết thúc', async () => {
  const p = pair();
  const { pcS, pcR } = await handshake(p);
  pcS.channels[0].open();
  const chR = pcR.incoming();
  chR.open();
  p.receiver.stop();
  assert.deepEqual(chR.sent, ['{"t":"bye"}']);
  assert.deepEqual(p.log.rEnd, ['receiver']);
  assert.equal(p.receiver.state(), 'ended');
  await settle();
  assert.equal(p.server.endedBy(), 'receiver');
  // cách 1: điện thoại nhận "bye" qua kênh
  p.sender.peerSaidBye();
  assert.deepEqual(p.log.sEnd, ['receiver']);
  assert.equal(pcS.closed, true);
  p.sender.stop();
  assert.deepEqual(p.log.sEnd, ['receiver'], 'dừng lần nữa không báo lại');
  // cách 2: kênh đã đứt, điện thoại biết qua máy chủ (410)
  const q = pair();
  await handshake(q);
  q.server.end('receiver');
  q.ts.fire(15000); await settle();
  assert.deepEqual(q.log.sEnd, ['receiver']);
  assert.deepEqual(q.log.s.slice(-1), ['ended']);
  assert.equal(q.ts.pending().length, 0, 'không còn hẹn giờ nào');
});

test('castLink: màn hình xe đang chờ nhập mã ("waiting") rồi mã hết hạn; trình duyệt không có WebRTC', async () => {
  const server = fakeServer();
  const t = fakeTimers();
  const states = [];
  const ended = [];
  const infos = [];
  let status = 'waiting';
  const link = createCastLink({ role: 'receiver', session: { id: 1, token: 'r' }, castApi: server.apiFor('receiver', () => status), RTC: fakeRtc().PC, timers: t,
    onState: (s) => states.push(s), onEnded: (by) => ended.push(by), onInfo: (i) => infos.push(i.status) });
  link.start();
  t.fire(0); await settle();
  t.fire(1000); await settle();
  assert.deepEqual(states, ['waiting']);
  status = 'paired';
  t.fire(1000); await settle();
  assert.deepEqual(states, ['waiting', 'connecting']);
  assert.deepEqual(infos, ['waiting', 'waiting', 'paired']);
  server.end('expired');
  t.fire(1000); await settle();
  assert.deepEqual(ended, ['expired']);

  const none = [];
  const l2 = createCastLink({ role: 'sender', session: { id: 1, token: 's' }, castApi: fakeServer().apiFor('sender'), RTC: null, timers: fakeTimers(), onEnded: (by) => none.push(by) });
  l2.start();
  assert.deepEqual(none, ['unsupported']);
});

// ---------------------------------------------------------------- castReceiver (màn hình xe)
function fakeLinkFactory() {
  const made = [];
  const makeLink = (opts) => {
    const l = { opts, started: false, stopped: false, byes: 0, start() { l.started = true; }, stop() { l.stopped = true; }, peerSaidBye() { l.byes += 1; }, channel: () => l.ch || null };
    made.push(l);
    return l;
  };
  return { made, makeLink };
}

test('màn hình xe: lấy mã -> điện thoại nhập mã -> đang chiếu -> nhận ảnh -> điện thoại dừng', async () => {
  const f = fakeLinkFactory();
  const phases = [];
  const frames = [];
  const ended = [];
  let created = 0;
  const ends = [];
  const castApi = { create: async () => { created += 1; return { id: created, code: '48291' + created, token: 't' + created, expires_in: 300, ice_servers: [{ urls: ['stun:x'] }] }; }, end: async (s) => { ends.push(s.id); } };
  const r = createCastReceiver({ castApi, makeLink: f.makeLink, now: () => 1000, onChange: (s) => phases.push(s.phase), onFrame: (fr) => frames.push(fr.seq), onEnded: (by) => ended.push(by) });
  assert.equal(r.isActive(), false);
  r.open();
  assert.deepEqual(phases, ['loading']);
  await settle();
  const link = f.made[0];
  assert.equal(link.started, true);
  assert.equal(link.opts.role, 'receiver');
  assert.deepEqual(link.opts.session, { id: 1, token: 't1' });
  assert.deepEqual(link.opts.iceServers, [{ urls: ['stun:x'] }]);
  link.opts.onState('waiting');
  assert.equal(r.snapshot().code, '482911');
  assert.equal(r.snapshot().codeExpiresAt, 301000);
  link.opts.onInfo({ deviceName: 'Pixel 7' });
  link.opts.onState('connecting');
  link.opts.onState('connected');
  assert.deepEqual(phases, ['loading', 'code', 'code', 'connecting', 'live']);
  assert.equal(r.isLive(), true);
  assert.equal(r.snapshot().deviceName, 'Pixel 7');
  const ch = {};
  link.opts.onChannel(ch);
  encodeFrame(3, 4, 4, bytesOf(40)).forEach((m) => ch.onmessage({ data: m }));
  ch.onmessage({ data: JSON.stringify({ t: 'hello', name: 'Máy của Lan' }) });
  assert.deepEqual(frames, [3]);
  assert.equal(r.snapshot().deviceName, 'Máy của Lan');
  assert.equal(r.snapshot().frames, 1);
  link.opts.onState('reconnecting');
  assert.equal(r.isLive(), true);
  ch.onmessage({ data: JSON.stringify({ t: 'bye' }) });
  assert.equal(link.byes, 1, 'nhận "bye" qua kênh thì báo cho đường nối');
  link.opts.onEnded('sender');
  assert.deepEqual(ended, ['sender']);
  assert.equal(r.snapshot().phase, 'off');
  assert.equal(r.isActive(), false);
});

test('màn hình xe: mã hết hạn thì tự lấy mã mới (tối đa 6 lần); điện thoại hủy thì hiện mã mới kèm lời nhắc', async () => {
  const f = fakeLinkFactory();
  let created = 0;
  const castApi = { create: async () => { created += 1; return { id: created, code: String(100000 + created), token: 't', expires_in: 300 }; }, end: async () => {} };
  const r = createCastReceiver({ castApi, makeLink: f.makeLink });
  r.open(); await settle();
  for (let i = 0; i < 6; i++) { f.made[i].opts.onState('waiting'); f.made[i].opts.onEnded('expired'); await settle(); }
  assert.equal(created, 7);
  assert.equal(r.snapshot().phase, 'loading');
  f.made[6].opts.onState('waiting');
  assert.equal(r.snapshot().code, '100007');
  f.made[6].opts.onEnded('expired');
  await settle();
  assert.equal(created, 7, 'hết 6 lần tự lấy: chờ người dùng bấm');
  assert.deepEqual([r.snapshot().phase, r.snapshot().message], ['error', 'Mã đã hết hạn.']);
  r.renew(); await settle();
  assert.equal(created, 8);
  f.made[7].opts.onState('waiting');
  f.made[7].opts.onState('connecting');
  f.made[7].opts.onEnded('sender');       // điện thoại không cho ghi màn hình
  await settle();
  assert.equal(created, 9);
  assert.match(r.snapshot().notice, /Điện thoại đã hủy/);
  // tin của đường nối cũ tới muộn không làm rối trạng thái
  f.made[7].opts.onState('connected');
  assert.equal(r.snapshot().phase, 'loading');
});

test('màn hình xe: đóng hộp ghép nối / bấm dừng thì hủy phiên; lỗi mạng lúc lấy mã', async () => {
  const f = fakeLinkFactory();
  let fail = true;
  const castApi = { create: async () => { if (fail) throw new Error('Mất mạng'); return { id: 1, code: '123456', token: 't', expires_in: 300 }; }, end: async () => {} };
  const r = createCastReceiver({ castApi, makeLink: f.makeLink });
  r.open(); await settle();
  assert.deepEqual([r.snapshot().phase, r.snapshot().message], ['error', 'Mất mạng']);
  fail = false;
  r.open(); await settle();
  f.made[0].opts.onState('waiting');
  r.stop();
  assert.equal(f.made[0].stopped, true);
  assert.equal(r.snapshot().phase, 'off');
  f.made[0].opts.onState('connected');
  assert.equal(r.snapshot().phase, 'off', 'đã dừng thì bỏ qua tin tới muộn');
  // dừng ngay trong lúc đang xin mã: phiên vừa tạo được hủy luôn
  const ended = [];
  let release;
  const slow = { create: () => new Promise((res) => { release = () => res({ id: 9, code: '999999', token: 'z', expires_in: 300 }); }), end: async (s) => { ended.push(s.id); } };
  const r2 = createCastReceiver({ castApi: slow, makeLink: f.makeLink });
  r2.open();
  r2.stop();
  release(); await settle();
  assert.deepEqual(ended, [9]);
  assert.equal(r2.snapshot().phase, 'off');
});

// ---------------------------------------------------------------- castSender (điện thoại)
function fakeNative() {
  const sent = [];
  const subs = new Set();
  return { sent, castStart: (o) => { sent.push(['start', o]); return true; }, castStop: () => { sent.push(['stop']); return true; }, onCast: (fn) => { subs.add(fn); return () => subs.delete(fn); }, emit: (e, d) => subs.forEach((fn) => fn(e, d || {})) };
}
function frameResponse(seq, w, h, n) {
  return { status: 200, headers: { get: (k) => ({ 'X-Cast-Seq': String(seq), 'X-Cast-Width': String(w), 'X-Cast-Height': String(h) })[k] || null }, arrayBuffer: async () => bytesOf(n, seq) };
}
function senderRig({ join, responses }) {
  const f = fakeLinkFactory();
  const native = fakeNative();
  const timers = fakeTimers();
  const phases = [];
  const urls = [];
  const queue = responses || [];
  const fetchImpl = async (url) => { urls.push(url); return queue.length ? queue.shift() : { status: 204, headers: { get: () => null } }; };
  const ends = [];
  const castApi = { join: join || (async () => ({ id: 5, token: 'tok', ice_servers: [{ urls: ['stun:y'] }] })), end: async (s) => { ends.push(s.id); } };
  let paused = 0;
  const sender = createCastSender({ castApi, nativeApp: native, makeLink: f.makeLink, fetchImpl, frameUrl: () => 'https://xe.test/__cast/frame', deviceName: () => 'Máy thử', timers,
    onChange: (s) => phases.push(s.phase), onBeforeLive: () => { paused += 1; } });
  return { f, native, timers, phases, urls, queue, ends, sender, paused: () => paused };
}

test('tên máy lấy từ User-Agent của ứng dụng Android', () => {
  assert.equal(deviceNameFromUa('Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36'), 'SM-A546E');
  assert.equal(deviceNameFromUa('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36'), 'Pixel 7');
  assert.equal(deviceNameFromUa('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36'), 'Điện thoại Android');
  assert.equal(deviceNameFromUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)'), 'Điện thoại Android');
});

test('điện thoại: nhập mã -> xin quyền ghi màn hình -> nối -> gửi ảnh qua kênh; kênh kẹt thì bỏ bớt ảnh', async () => {
  const rig = senderRig({ responses: [frameResponse(1, 540, 1170, CHUNK_BYTES + 10), frameResponse(2, 540, 1170, 100)] });
  assert.equal(await rig.sender.start('12 34'), false);
  assert.deepEqual([rig.sender.snapshot().phase, rig.sender.snapshot().message], ['error', 'Hãy nhập đủ 6 số của mã trên màn hình xe.']);
  assert.equal(await rig.sender.start('482 913'), true);
  assert.deepEqual(rig.phases.slice(-2), ['joining', 'permission']);
  assert.deepEqual(rig.native.sent, [['start', CAPTURE_OPTIONS]]);
  assert.equal(rig.f.made.length, 0, 'chưa được phép thì chưa nối');
  rig.native.emit('frame');
  rig.native.emit('started', { width: 540, height: 1170 });
  assert.equal(rig.paused(), 1, 'điện thoại dừng nhạc của mình');
  const link = rig.f.made[0];
  assert.equal(link.opts.role, 'sender');
  assert.deepEqual(link.opts.session.id, 5);
  assert.deepEqual(link.opts.iceServers, [{ urls: ['stun:y'] }]);
  assert.equal(link.started, true);
  const ch = { sent: [], bufferedAmount: 0, send(m) { this.sent.push(m); } };
  link.ch = ch;
  link.opts.onState('connected');
  link.opts.onChannel(ch);
  assert.deepEqual(JSON.parse(ch.sent[0]), { t: 'hello', name: 'Máy thử' });
  await settle(12);
  assert.equal(rig.sender.snapshot().phase, 'live');
  assert.deepEqual(rig.urls.slice(0, 3), ['https://xe.test/__cast/frame?since=0', 'https://xe.test/__cast/frame?since=1', 'https://xe.test/__cast/frame?since=2']);
  const texts = ch.sent.filter((m) => typeof m === 'string').map((m) => JSON.parse(m));
  assert.deepEqual(texts.slice(1), [{ t: 'f', seq: 1, w: 540, h: 1170, size: CHUNK_BYTES + 10, parts: 2 }, { t: 'f', seq: 2, w: 540, h: 1170, size: 100, parts: 1 }]);
  assert.equal(ch.sent.filter((m) => typeof m !== 'string').length, 3);
  assert.equal(rig.sender.snapshot().sent, 2);
  // kênh kẹt: không lấy thêm ảnh cho tới khi thông
  ch.bufferedAmount = HIGH_WATER_BYTES + 1;
  rig.native.emit('frame'); await settle();
  const n = rig.urls.length;
  rig.queue.push(frameResponse(9, 540, 1170, 50));
  rig.native.emit('frame'); await settle();
  assert.equal(rig.urls.length, n, 'đang kẹt thì không hỏi ảnh');
  ch.bufferedAmount = 0;
  rig.native.emit('frame'); await settle();
  assert.equal(texts.length + 1, ch.sent.filter((m) => typeof m === 'string').length, 'thông rồi thì gửi ảnh mới nhất');
  // màn hình xe bấm "bye"
  ch.onmessage({ data: JSON.stringify({ t: 'bye' }) });
  assert.equal(link.byes, 1);
});

test('điện thoại: sai mã, từ chối quyền, Android tự ngừng chụp, màn hình xe dừng, người dùng dừng', async () => {
  // sai mã
  const bad = senderRig({ join: async () => { throw Object.assign(new Error('Mã không đúng hoặc đã hết hạn.'), { code: 'CAST_CODE_INVALID' }); } });
  assert.equal(await bad.sender.start('000000'), false);
  assert.deepEqual([bad.sender.snapshot().phase, bad.sender.snapshot().message], ['error', 'Mã không đúng hoặc đã hết hạn.']);
  assert.deepEqual(bad.native.sent, [], 'sai mã thì không xin quyền');

  // từ chối quyền: hủy phiên để màn hình xe hiện mã mới
  const deny = senderRig({});
  await deny.sender.start('123456');
  deny.native.emit('denied');
  assert.equal(deny.sender.snapshot().phase, 'error');
  assert.match(deny.sender.snapshot().message, /chưa cho phép ghi màn hình/);
  await settle();
  assert.deepEqual(deny.ends, [5]);
  assert.equal(deny.sender.isActive(), false);
  assert.equal(await deny.sender.start('123456'), true, 'thử lại được');

  // không trả lời hộp hỏi quyền
  const slow = senderRig({});
  await slow.sender.start('123456');
  slow.timers.fire(90000);
  assert.match(slow.sender.snapshot().message, /Chưa thấy bạn cho phép/);
  assert.deepEqual(slow.native.sent.map((x) => x[0]), ['start', 'stop']);

  // Android tự ngừng chụp (người dùng bấm "Dừng chiếu" trong thông báo)
  const sys = senderRig({});
  await sys.sender.start('123456');
  sys.native.emit('started', { width: 100, height: 200 });
  sys.f.made[0].opts.onState('connected');
  sys.native.emit('stopped');
  assert.equal(sys.sender.snapshot().phase, 'idle');
  assert.equal(sys.f.made[0].stopped, true, 'báo cho màn hình xe');

  // màn hình xe dừng
  const car = senderRig({});
  await car.sender.start('123456');
  car.native.emit('started', { width: 100, height: 200 });
  car.f.made[0].opts.onState('connected');
  car.f.made[0].opts.onEnded('receiver');
  assert.deepEqual([car.sender.snapshot().phase, car.sender.snapshot().message], ['error', 'Màn hình xe đã dừng chiếu.']);
  assert.deepEqual(car.native.sent.map((x) => x[0]), ['start', 'stop'], 'bảo ứng dụng ngừng chụp');
  car.sender.stop();
  assert.equal(car.sender.snapshot().phase, 'idle', 'bấm lần nữa để xóa lỗi');

  // người dùng bấm "Dừng chiếu" trên điện thoại
  const me = senderRig({});
  await me.sender.start('123456');
  me.native.emit('started', { width: 100, height: 200 });
  me.f.made[0].opts.onState('connected');
  me.sender.stop();
  assert.equal(me.sender.snapshot().phase, 'idle');
  assert.equal(me.f.made[0].stopped, true);
  assert.deepEqual(me.native.sent.map((x) => x[0]), ['start', 'stop']);
  me.native.emit('started', { width: 1, height: 1 });
  assert.equal(me.f.made.length, 1, 'tin "started" tới muộn không mở lại');
});

// ---------------------------------------------------------------- cầu nối với ứng dụng
test('cầu nối: chỉ ứng dụng Android từ 1.2.0 chiếu được; lệnh chụp được kẹp trong giới hạn; nhận sự kiện từ ứng dụng', () => {
  const UA = (v, os) => `Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36 PHCarPlayApp/${v} (${os})`;
  const win = (ios) => {
    const sent = [];
    const w = { document: { documentElement: { setAttribute() {} } } };
    if (ios) w.webkit = { messageHandlers: { PHCarPlayNative: { postMessage: (m) => sent.push(JSON.parse(m)) } } };
    else w.PHCarPlayNative = { postMessage: (m) => sent.push(JSON.parse(m)) };
    return { w, sent };
  };
  const a = win(false);
  const app = createNativeBridge({ win: a.w, ua: UA('1.2.0', 'Android') });
  assert.equal(app.supportsCast(), true);
  assert.equal(app.castStart({ maxSide: 99999, quality: 5, fps: 'x' }), true);
  assert.equal(app.castStart(), true);
  assert.equal(app.castStop(), true);
  assert.deepEqual(a.sent, [{ type: 'cast.start', maxSide: 1920, quality: 30, fps: 12 }, { type: 'cast.start', maxSide: 1280, quality: 70, fps: 12 }, { type: 'cast.stop' }]);
  const seen = [];
  const off = app.onCast((e, d) => seen.push([e, d]));
  assert.equal(app.handlers.cast('started', { width: 540, height: 1170 }), true);
  assert.equal(app.handlers.cast('frame'), true);
  assert.equal(app.handlers.cast('hack', {}), false);
  assert.equal(app.handlers.cast('error', 'chuỗi'), true);
  off();
  app.handlers.cast('stopped');
  assert.deepEqual(seen, [['started', { width: 540, height: 1170 }], ['frame', {}], ['error', {}]]);

  assert.equal(createNativeBridge({ win: win(false).w, ua: UA('1.1.0', 'Android') }).supportsCast(), false, 'bản 1.1.0');
  assert.equal(createNativeBridge({ win: win(true).w, ua: UA('1.2.0', 'iOS').replace('Linux; Android 14', 'iPhone') }).supportsCast(), false, 'iPhone chưa chiếu được');
  assert.equal(createNativeBridge({ win: { document: { documentElement: { setAttribute() {} } } }, ua: 'Mozilla/5.0 Chrome/130' }).supportsCast(), false, 'trình duyệt thường');
});
