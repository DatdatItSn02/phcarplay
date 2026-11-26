// Giai đoạn 9: động cơ phát bằng trình phát YouTube (IFrame API) - chạy với trình phát giả.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbedEngine, explainYtError, YT_STATE } from '../../public/assets/js/modules/youtube/embedPlayer.js';

function fakeDom() {
  globalThis.document = { createElement: (tag) => ({ tag, children: [] }) };
}

function fakeYT() {
  const players = [];
  class Player {
    constructor(slot, opts) {
      this.opts = opts;
      this.state = YT_STATE.CUED;
      this.id = opts.videoId;
      this.time = 0;
      this.calls = [];
      players.push(this);
      setTimeout(() => opts.events.onReady({ target: this }), 5);
    }
    set(s) { this.state = s; this.opts.events.onStateChange({ data: s }); }
    canPlay() { return !this.blockAutoplay && !(this.blockSound && !this.muted); }
    playVideo() { this.calls.push('play'); if (this.canPlay()) setTimeout(() => this.set(YT_STATE.PLAYING), 5); }
    mute() { this.calls.push('mute'); this.muted = true; }
    unMute() { this.calls.push('unmute'); this.muted = false; }
    getVolume() { return 100; }
    pauseVideo() { this.calls.push('pause'); this.set(YT_STATE.PAUSED); }
    stopVideo() { this.calls.push('stop'); }
    cueVideoById(id) { this.calls.push('cue:' + id); this.id = id; this.state = YT_STATE.CUED; }
    loadVideoById(id) { this.calls.push('load:' + id); if (this.dropNext) { this.dropNext = false; return; } this.id = id; if (this.canPlay()) setTimeout(() => this.set(YT_STATE.PLAYING), 5); }
    getVideoData() { return { video_id: this.id, title: 'Tên thật ' + this.id, author: 'Kênh thật' }; }
    seekTo(t) { this.time = t; }
    getCurrentTime() { return this.time; }
    getDuration() { return 200; }
    destroy() { this.calls.push('destroy'); }
  }
  return { YT: { Player }, players };
}

function makeEngine(over = {}) {
  fakeDom();
  const { YT, players } = fakeYT();
  const events = [];
  const fatal = [];
  const metas = [];
  const muted = [];
  const host = { children: [], appendChild(c) { this.children.push(c); }, removeChild(c) { this.children.splice(this.children.indexOf(c), 1); }, get firstChild() { return this.children[0] || null; } };
  const engine = createEmbedEngine(Object.assign({
    host, loadApi: () => Promise.resolve(YT), origin: 'https://car.test',
    emit: (t) => events.push(t), onFatal: (m) => fatal.push(m), onMeta: (m) => metas.push(m), onMuted: (v) => muted.push(v), playWaitMs: 60, nav: null, quiet: true,
  }, over));
  return { engine, players, events, fatal, host, metas, muted };
}

test('trình phát YouTube: tạo một lần, đổi bài bằng loadVideoById (không cue trước), phát/dừng/tua, báo sự kiện như thẻ video', async () => {
  const { engine, players, events } = makeEngine();
  assert.equal(await engine.load({ id: 'aaaaaaaaaaa' }), true);
  assert.equal(players.length, 1);
  assert.equal(players[0].opts.videoId, 'aaaaaaaaaaa');
  assert.equal(players[0].opts.playerVars.playsinline, 1);
  assert.equal(players[0].opts.playerVars.origin, 'https://car.test');
  await engine.play();
  assert.equal(engine.isPaused(), false);
  assert.ok(events.includes('play'));
  engine.setTime(42);
  assert.equal(engine.getTime(), 42);
  assert.equal(engine.getDuration(), 200);
  engine.pause();
  assert.equal(engine.isPaused(), true);
  assert.ok(events.includes('pause'));
  assert.equal(await engine.load({ id: 'bbbbbbbbbbb' }), true);
  assert.equal(players.length, 1, 'đổi bài không tạo trình phát mới');
  assert.ok(!players[0].calls.some((c) => c.indexOf('cue:') === 0), 'không gửi lệnh cue (YouTube thật hay bỏ qua lệnh phát ngay sau cue)');
  await engine.play();
  assert.ok(players[0].calls.includes('load:bbbbbbbbbbb'), 'bài vừa đổi: nạp và phát luôn (loadVideoById), không cần bấm lại');
  assert.equal(engine.isPaused(), false);
  players[0].set(YT_STATE.ENDED);
  assert.equal(events[events.length - 1], 'ended');
  engine.destroy();
});

test('trình phát YouTube: chưa chạy trong thời gian chờ (quảng cáo, mạng chậm) thì báo PlayPending - giao diện không hiện lỗi', async () => {
  const { engine, players, metas } = makeEngine();
  await engine.load({ id: 'aaaaaaaaaaa' });
  players[0].blockAutoplay = true;
  await assert.rejects(engine.play(), (e) => e.name === 'PlayPending');
  players[0].set(YT_STATE.PLAYING);   // YouTube chạy muộn
  assert.equal(engine.isPaused(), false);
  assert.deepEqual(metas[metas.length - 1], { id: 'aaaaaaaaaaa', title: 'Tên thật aaaaaaaaaaa', uploader: 'Kênh thật' }, 'biết tên bài thật khi bắt đầu phát');
  engine.destroy();   // dừng bộ đếm thời gian
});

test('trình phát YouTube: lỗi bị cấm nhúng/video đã xóa báo đúng câu; không nạp được thư viện thì load() trả false', async () => {
  const { engine, players, fatal } = makeEngine();
  await engine.load({ id: 'aaaaaaaaaaa' });
  players[0].opts.events.onError({ data: 150 });
  assert.deepEqual(fatal, ['Chủ video không cho phát trên website khác.']);
  engine.stop();
  players[0].opts.events.onError({ data: 100 });
  assert.equal(fatal.length, 1, 'đã rời chế độ YouTube thì bỏ qua lỗi');
  assert.equal(explainYtError(100), 'Video không còn tồn tại hoặc đang ở chế độ riêng tư.');
  assert.equal(explainYtError(101), explainYtError(150));

  const off = makeEngine({ loadApi: () => Promise.resolve(null) });
  assert.equal(await off.engine.load({ id: 'aaaaaaaaaaa' }), false);
});

test('trình phát YouTube: đổi bài nhanh liên tiếp thì chỉ lần cuối được tính', async () => {
  const { engine } = makeEngine();
  const a = engine.load({ id: 'aaaaaaaaaaa' });
  const b = engine.load({ id: 'bbbbbbbbbbb' });
  assert.equal(await a, false);
  assert.equal(await b, true);
});

test('trình phát YouTube: trình duyệt chặn tự phát CÓ TIẾNG thì tắt tiếng rồi phát, báo để hiện nút "Bật tiếng"; bật tiếng lại được', async () => {
  const { engine, players, muted } = makeEngine();
  await engine.load({ id: 'aaaaaaaaaaa' });
  players[0].blockSound = true;
  await engine.play();
  assert.equal(engine.isPaused(), false, 'vẫn phát (đang tắt tiếng)');
  assert.ok(players[0].calls.includes('mute'));
  assert.deepEqual(muted, [true]);
  assert.equal(engine.isAutoMuted(), true);
  engine.unmute();
  assert.ok(players[0].calls.includes('unmute'));
  assert.deepEqual(muted, [true, false]);
  engine.unmute();
  assert.deepEqual(muted, [true, false], 'gọi lại không báo thừa');
  engine.destroy();
});

test('trình phát YouTube: chưa từng chạm vào trang (mở web/tải lại) thì tắt tiếng TRƯỚC khi phát; YouTube báo onAutoplayBlocked cũng tắt tiếng và phát lại', async () => {
  const a = makeEngine({ nav: { userActivation: { hasBeenActive: false } } });
  await a.engine.load({ id: 'aaaaaaaaaaa' });
  a.players[0].blockSound = true;
  await a.engine.play();
  assert.deepEqual(a.players[0].calls.slice(0, 2), ['mute', 'play'], 'tắt tiếng trước rồi mới phát');
  assert.equal(a.engine.isPaused(), false);
  a.engine.destroy();

  const b = makeEngine({ nav: { userActivation: { hasBeenActive: true } } });
  await b.engine.load({ id: 'aaaaaaaaaaa' });
  b.players[0].opts.events.onAutoplayBlocked({});
  assert.deepEqual(b.players[0].calls, ['mute', 'play']);
  assert.deepEqual(b.muted, [true]);
  b.engine.destroy();
});

test('trình phát YouTube: lệnh "nạp và phát" bị YouTube bỏ qua thì tự gửi lại, bài mới vẫn tự phát', async () => {
  const { engine, players, muted } = makeEngine();
  await engine.load({ id: 'aaaaaaaaaaa' });
  await engine.play();
  await engine.load({ id: 'bbbbbbbbbbb' });
  players[0].dropNext = true;
  await engine.play();
  assert.equal(players[0].calls.filter((c) => c === 'load:bbbbbbbbbbb').length, 2, 'gửi lại lệnh');
  assert.equal(players[0].id, 'bbbbbbbbbbb');
  assert.equal(engine.isPaused(), false);
  assert.deepEqual(muted, [], 'không cần tắt tiếng');
  engine.destroy();
});

test('giai đoạn 12.2: âm lượng của website áp vào trình phát YouTube; tắt tiếng/bật tiếng; kéo âm lượng thì bỏ tắt tiếng do chặn tự phát', async () => {
  const { engine, players, muted } = makeEngine();
  await engine.load({ id: 'aaaaaaaaaaa' });
  const p = players[0];
  p.vols = [];
  p.setVolume = (v) => { p.vols.push(v); };
  engine.setVolume(40, false);
  assert.deepEqual(p.vols, [40]);
  assert.ok(!p.calls.includes('mute'), 'âm lượng > 0: không tắt tiếng');
  engine.setVolume(40, true);
  assert.equal(p.calls.filter((c) => c === 'mute').length, 1);
  engine.setVolume(60, false);
  assert.ok(p.calls.includes('unmute'));
  p.blockSound = true;
  await engine.load({ id: 'bbbbbbbbbbb' });
  await engine.play();   // bị chặn tự phát có tiếng -> tắt tiếng để phát
  assert.equal(engine.isAutoMuted(), true);
  engine.setVolume(70, false);   // người dùng kéo âm lượng = bật tiếng
  assert.equal(engine.isAutoMuted(), false);
  assert.deepEqual(muted.slice(-1), [false]);
  engine.destroy();
});
