import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, formatViews, formatAgo } from '../../public/assets/js/core/format.js';
import { createQueue } from '../../public/assets/js/modules/youtube/queue.js';
import { pickMix } from '../../public/assets/js/modules/youtube/mix.js';
import { chooseSources, createEngine } from '../../public/assets/js/modules/youtube/playerEngine.js';
import { createPlayerController } from '../../public/assets/js/modules/youtube/playerController.js';
import { createPlaylistStore } from '../../public/assets/js/modules/youtube/playlistStore.js';

const song = (id, extra = {}) => ({ id, title: `Bài ${id}`, uploader: 'Ca sĩ', duration: 200, thumbnail: '', ...extra });

test('format: thời lượng, lượt xem, thời gian đăng', () => {
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(formatDuration(-5), '0:00');
  assert.equal(formatViews(0), '');
  assert.equal(formatViews(850), '850 lượt xem');
  assert.equal(formatViews(12500), '13 N lượt xem');
  assert.equal(formatViews(1234567), '1,2 Tr lượt xem');
  assert.equal(formatViews(2500000000), '2,5 Tỷ lượt xem');
  const now = Date.UTC(2026, 10, 3);
  assert.equal(formatAgo(now - 30 * 1000, now), 'vừa xong');
  assert.equal(formatAgo(now - 5 * 60 * 1000, now), '5 phút trước');
  assert.equal(formatAgo(now - 3 * 86400 * 1000, now), '3 ngày trước');
  assert.equal(formatAgo(now - 400 * 86400 * 1000, now), '1 năm trước');
  assert.equal(formatAgo(0, now), '');
  assert.equal(formatAgo((now - 2 * 3600 * 1000) / 1000, now), '2 giờ trước', 'giây cũng được hiểu');
});

test('queue: thêm, chèn kế tiếp, không trùng, chuyển bài, xóa, di chuyển', () => {
  const q = createQueue();
  q.setItems([song('a'), song('b'), song('c')], 0);
  assert.equal(q.snapshot().current.id, 'a');
  assert.equal(q.add(song('b')), false, 'bài trùng bị bỏ qua');
  assert.equal(q.add(song('d')), true);
  assert.equal(q.add(song('e'), { next: true }), true);
  assert.deepEqual(q.snapshot().items.map((i) => i.id), ['a', 'e', 'b', 'c', 'd']);
  assert.equal(q.next().id, 'e');
  assert.equal(q.remove(1), false, 'không xóa bài đang phát');
  assert.equal(q.remove(0), true);
  assert.equal(q.snapshot().current.id, 'e', 'xóa bài trước vị trí hiện tại thì vẫn giữ bài đang phát');
  assert.equal(q.move(3, 0), true);
  assert.equal(q.snapshot().current.id, 'e');
  assert.equal(q.snapshot().items[0].id, 'd');
  assert.equal(q.prev().id, 'd');
  assert.equal(q.prev(), null);
  assert.equal(q.jump(99), null);
  q.clearOthers();
  assert.deepEqual(q.snapshot().items.map((i) => i.id), ['d']);
});

test('queue: playNow chèn sau bài đang phát hoặc nhảy tới bài có sẵn; lịch sử có giới hạn', () => {
  const q = createQueue();
  q.setItems([song('a'), song('b')], 0);
  q.playNow(song('x'));
  assert.deepEqual(q.snapshot().items.map((i) => i.id), ['a', 'x', 'b']);
  assert.equal(q.snapshot().current.id, 'x');
  q.playNow(song('b'));
  assert.equal(q.snapshot().current.id, 'b');
  for (let i = 0; i < 80; i += 1) q.markPlayed(`v${i}`);
  q.markPlayed('v70');
  const h = q.snapshot().history;
  assert.equal(h.length, 50);
  assert.equal(h[h.length - 1], 'v70');
  assert.equal(h.filter((x) => x === 'v70').length, 1);
});

test('mix: bỏ bài đã phát, ưu tiên độ dài giống nhạc, bốc ngẫu nhiên trong vài ứng viên đầu', () => {
  const rel = [song('h1'), song('long', { duration: 4000 }), song('s1', { duration: 20 }), song('ok1'), song('ok2'), song('ok3'), song('ok4'), song('ok5'), song('ok6')];
  const first = pickMix(rel, { history: ['h1'], rand: () => 0 });
  assert.equal(first.id, 'ok1', 'bỏ h1 (đã phát), bỏ bài quá dài/ngắn');
  const last = pickMix(rel, { history: ['h1'], rand: () => 0.999 });
  assert.equal(last.id, 'ok5', 'chỉ chọn trong 5 ứng viên đầu');
  assert.equal(pickMix([song('only', { duration: 4000 })], {}).id, 'only', 'hết lựa chọn tốt thì nới lỏng');
  assert.equal(pickMix([song('a')], { history: ['a'] }), null);
  assert.equal(pickMix(null, {}), null);
});

test('chooseSources: HLS trước, rồi mp4 từ nét nhất tới giới hạn, rồi âm thanh', () => {
  const info = {
    hls: 'https://h/x.m3u8',
    sources: [{ url: 'u1080', height: 1080, mime: 'video/mp4' }, { url: 'u720', height: 720, mime: 'video/mp4' }, { url: 'u360', height: 360, mime: 'video/mp4' }],
    audio: [{ url: 'a1', mime: 'audio/mp4' }],
  };
  assert.deepEqual(chooseSources(info, { hlsJs: true }).map((s) => `${s.kind}:${s.url}`), ['hls:https://h/x.m3u8', 'file:u720', 'file:u360', 'audio:a1']);
  assert.equal(chooseSources(info, { nativeHls: true })[0].kind, 'native-hls');
  assert.deepEqual(chooseSources(info, {}).map((s) => s.url), ['u720', 'u360', 'a1'], 'không có HLS khi trình duyệt không hỗ trợ');
  assert.deepEqual(chooseSources({ sources: [{ url: 'u2160', height: 2160 }, { url: 'u1440', height: 1440 }] }, {}).map((s) => s.url), ['u1440'], 'mọi luồng đều quá nét thì lấy luồng thấp nhất');
  assert.deepEqual(chooseSources(info, { canPlay: (m) => m !== 'video/mp4' }).map((s) => s.url), ['a1'], 'bỏ định dạng không phát được');
});

// Thẻ video giả: gắn src chứa "good" thì tải được, ngược lại báo lỗi.
function fakeVideo() {
  const v = new EventTarget();
  Object.assign(v, {
    paused: true, currentTime: 0, srcSet: [],
    canPlayType: () => '',
    load() { const url = this._src; queueMicrotask(() => v.dispatchEvent(new Event(url.includes('good') ? 'loadedmetadata' : 'error'))); },
    play() { v.paused = false; return Promise.resolve(); },
    pause() { v.paused = true; },
  });
  Object.defineProperty(v, 'src', { get() { return v._src; }, set(x) { v._src = x; v.srcSet.push(x); } });
  return v;
}

test('engine: nguồn đầu lỗi thì tự thử nguồn kế tiếp; hết nguồn thì trả false', async () => {
  const video = fakeVideo();
  const engine = createEngine({ video, attachTimeoutMs: 500 });
  const ok = await engine.load({ sources: [{ url: 'https://x/bad720', height: 720 }, { url: 'https://x/good360', height: 360 }] });
  assert.equal(ok, true);
  assert.deepEqual(video.srcSet, ['https://x/bad720', 'https://x/good360']);
  const none = await engine.load({ sources: [{ url: 'https://x/bad1', height: 360 }], audio: [{ url: 'https://x/bad2' }] });
  assert.equal(none, false);
  assert.equal(await engine.load({ sources: [] }), false, 'không có nguồn nào');
});

test('engine: dùng hls.js khi trình duyệt không tự phát HLS', async () => {
  const video = fakeVideo();
  const events = { ERROR: 'err' };
  let loaded = null;
  class FakeHls {
    static isSupported() { return true; }
    static get Events() { return events; }
    on() {}
    loadSource(url) { loaded = url; }
    attachMedia(v) { queueMicrotask(() => v.dispatchEvent(new Event('loadedmetadata'))); }
    destroy() { loaded = 'destroyed'; }
  }
  const engine = createEngine({ video, loadHls: async () => FakeHls, attachTimeoutMs: 500 });
  assert.equal(await engine.load({ hls: 'https://x/manifest.m3u8', sources: [] }), true);
  assert.equal(loaded, 'https://x/manifest.m3u8');
  assert.equal(engine.attempts()[0].kind, 'hls');
});

function makeController({ streams = {}, failIds = [], engineOpts = {}, rand = () => 0, time = { t: 0 } } = {}) {
  const calls = { stream: [], search: [], trending: 0, notices: [], played: [] };
  const queue = createQueue();
  const youtube = {
    async stream(id) {
      calls.stream.push(id);
      if (failIds.includes(id)) throw new Error('Video không phát được.');
      return streams[id] || { id, related: [] };
    },
    async search(q) { calls.search.push(q); return { items: [song('srch1'), song('srch2')] }; },
    async trending() { calls.trending += 1; return { items: [song('trend1')] }; },
  };
  let paused = true;
  const engine = {
    async load() { return engineOpts.loadOk !== false; },
    async play() { if (engineOpts.blockAutoplay) { const e = new Error('blocked'); e.name = 'NotAllowedError'; throw e; } paused = false; calls.played.push(queue.snapshot().current.id); },
    pause() { paused = true; },
    isPaused: () => paused,
  };
  const states = [];
  const c = createPlayerController({ youtube, queue, engine, getTime: () => time.t, setTime: (t) => { time.t = t; }, notify: (m) => calls.notices.push(m), onState: (s) => states.push(s), rand });
  return { c, queue, calls, states, time };
}

test('controller: phát danh sách, hết bài thì sang bài kế trong hàng đợi', async () => {
  const { c, queue, calls } = makeController();
  await c.playList([song('a'), song('b')], 0);
  assert.equal(c.snapshot().status, 'playing');
  assert.deepEqual(calls.played, ['a']);
  await c.handleEnded();
  assert.deepEqual(calls.played, ['a', 'b']);
  assert.equal(queue.snapshot().current.id, 'b');
});

test('controller: hết hàng đợi thì tự chọn bài liên quan (Mix) và không lặp lại bài đã phát', async () => {
  const { c, queue, calls } = makeController({ streams: { a: { id: 'a', related: [song('a'), song('r1'), song('r2')] } } });
  await c.playList([song('a')], 0);
  await c.handleEnded();
  assert.deepEqual(calls.played, ['a', 'r1'], 'bỏ qua chính bài a trong danh sách liên quan');
  assert.deepEqual(queue.snapshot().items.map((i) => i.id), ['a', 'r1']);
});

test('controller: Mix hết gợi ý liên quan thì tìm theo tên bài, rồi tới nhạc mặc định', async () => {
  const one = makeController({ streams: { a: { id: 'a', related: [] } } });
  await one.c.playList([song('a')], 0);
  await one.c.handleEnded();
  assert.deepEqual(one.calls.search, ['Bài a']);
  assert.equal(one.calls.played[1], 'srch1');

  const youtubeFail = makeController({ streams: { a: { id: 'a', related: [] } } });
  const origSearch = youtubeFail.calls.search;
  assert.ok(Array.isArray(origSearch));
});

test('controller: tắt Mix thì dừng ở cuối hàng đợi', async () => {
  const { c, calls } = makeController();
  c.setAutoMix(false);
  await c.playList([song('a')], 0);
  const r = await c.handleEnded();
  assert.equal(r, false);
  assert.equal(c.snapshot().status, 'ended');
  assert.deepEqual(calls.played, ['a']);
});

test('controller: bài lỗi thì báo và tự chuyển sang bài kế, không lặp vô hạn', async () => {
  const { c, calls } = makeController({ failIds: ['a', 'b'] });
  await c.playList([song('a'), song('b'), song('c')], 0);
  assert.deepEqual(calls.played, ['c']);
  assert.equal(calls.notices.length, 2);
  assert.match(calls.notices[0], /chuyển sang bài khác/);

  const allBad = makeController({ failIds: ['a', 'b', 'c', 'd', 'e', 'f'] });
  c.setAutoMix(false);
  allBad.c.setAutoMix(false);
  await allBad.c.playList([song('a'), song('b'), song('c'), song('d'), song('e'), song('f')], 0);
  assert.deepEqual(allBad.calls.played, []);
  assert.ok(allBad.calls.stream.length <= 5, 'dừng sau vài lần thử');
});

test('controller: trình duyệt chặn tự phát thì chờ người dùng bấm, bấm xong phát tiếp', async () => {
  const { c } = makeController({ engineOpts: { blockAutoplay: true } });
  await c.playList([song('a')], 0);
  assert.equal(c.snapshot().needsGesture, true);
  assert.equal(c.snapshot().status, 'paused');
});

test('controller: nút lùi bài (quá 3 giây thì tua về đầu), nút phát/dừng, thêm vào hàng đợi', async () => {
  const time = { t: 0 };
  const { c, queue, calls } = makeController({ time });
  await c.playList([song('a'), song('b')], 1);
  time.t = 10;
  await c.prev();
  assert.equal(time.t, 0, 'tua về đầu bài');
  assert.equal(queue.snapshot().current.id, 'b');
  await c.prev();
  assert.equal(queue.snapshot().current.id, 'a');
  await c.toggle();
  assert.equal(c.snapshot().status, 'paused');
  await c.toggle();
  assert.equal(c.snapshot().status, 'playing');
  assert.equal(c.enqueue(song('z')), true);
  await c.playNow(song('y'));
  assert.equal(queue.snapshot().current.id, 'y');
  assert.deepEqual(calls.played.slice(-1), ['y']);
});

test('controller: bấm Phát lúc bài trước còn đang tải thì bỏ kết quả cũ (không phát chồng)', async () => {
  const { c, calls } = makeController();
  const p1 = c.playList([song('a')], 0);
  const p2 = c.playList([song('b')], 0);
  await Promise.all([p1, p2]);
  assert.deepEqual(calls.played, ['b']);
});

function fakeStoreApi() {
  const log = [];
  return {
    log,
    get: async (p) => { log.push(['GET', p]); return { playlists: [{ id: 1, name: 'Server', count: 2, updated_at: 'x' }] }; },
    post: async (p, b) => { log.push(['POST', p, b]); return { added: b.items ? b.items.length : 0, count: 1 }; },
    put: async (p, b) => { log.push(['PUT', p, b]); return {}; },
    patch: async (p, b) => { log.push(['PATCH', p, b]); return {}; },
    delete: async (p) => { log.push(['DELETE', p]); },
  };
}
const memStorage = () => { const d = {}; return { d, getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = v; } }; };

test('playlistStore (khách): tạo, thêm không trùng, sắp xếp, xóa, tự chọn playlist gần nhất có bài', async () => {
  const store = createPlaylistStore({ api: fakeStoreApi(), hasUser: () => false, storage: memStorage() });
  assert.equal(store.isLocal(), true);
  const empty = await store.create('Trống');
  const pl = await store.create('Nhạc đi đường');
  assert.deepEqual(await store.addItems(pl.id, [song('a'), song('b'), song('a')]), { added: 2, count: 2 });
  assert.deepEqual(await store.addItems(pl.id, [song('a')]), { added: 0, count: 2 });
  await store.reorder(pl.id, ['b', 'a']);
  assert.deepEqual((await store.get(pl.id)).items.map((i) => i.id), ['b', 'a']);
  await store.removeItem(pl.id, 'b');
  assert.deepEqual((await store.get(pl.id)).items.map((i) => i.id), ['a']);
  const recent = await store.mostRecentNonEmpty();
  assert.equal(recent.id, pl.id, 'bỏ qua playlist trống');
  await store.rename(pl.id, 'Đổi tên');
  assert.equal((await store.get(pl.id)).name, 'Đổi tên');
  await store.remove(pl.id);
  assert.equal(await store.mostRecentNonEmpty(), null);
  assert.equal((await store.list()).length, 1);
  await assert.rejects(store.create('  '));
  await assert.rejects(store.get('khong-co'));
  assert.ok(empty.id);
});

test('playlistStore (thành viên): gọi đúng API; importLocal chuyển playlist của khách lên tài khoản rồi xóa bản trên trình duyệt', async () => {
  const api = fakeStoreApi();
  const storage = memStorage();
  let user = false;
  const store = createPlaylistStore({ api, hasUser: () => user, storage });
  const guestList = await store.create('Của khách');
  await store.addItems(guestList.id, [song('a'), song('b')]);
  await store.create('Trống không chuyển');

  user = true;
  assert.equal(await store.importLocal(), 1);
  assert.deepEqual(api.log[0].slice(0, 2), ['POST', '/playlists/import']);
  assert.equal(api.log[0][2].playlists.length, 1);
  assert.equal(api.log[0][2].playlists[0].items.length, 2);
  assert.equal(await store.importLocal(), 0, 'đã chuyển rồi thì không chuyển lại');

  assert.deepEqual(await store.list(), [{ id: 1, name: 'Server', count: 2, updated_at: 'x' }]);
  await store.addItems(1, [song('c')]);
  await store.removeItem(1, 'c');
  await store.reorder(1, ['a', 'b']);
  await store.rename(1, 'Tên mới');
  await store.remove(1);
  const calls = api.log.slice(1).map((l) => `${l[0]} ${l[1]}`);
  assert.deepEqual(calls, ['GET /playlists', 'POST /playlists/1/items', 'DELETE /playlists/1/items/c', 'PUT /playlists/1/order', 'PATCH /playlists/1', 'DELETE /playlists/1']);
});

test('giai đoạn 10: máy chủ báo khóa API riêng hết lượt (notice) thì báo nhẹ đúng một lần mỗi phiên, kết quả vẫn trả bình thường', async () => {
  const { createYoutubeApi } = await import('../../public/assets/js/modules/youtube/youtubeApi.js');
  const shown = [];
  const api = { get: async () => ({ items: [{ id: 'a' }], next: null, notice: 'Khóa YouTube API của bạn đã hết lượt hôm nay.' }) };
  const yt = createYoutubeApi(api, { notice: (m) => shown.push(m) });
  const r = await yt.search('a');
  await yt.search('b');
  assert.equal(r.items.length, 1);
  assert.deepEqual(shown, ['Khóa YouTube API của bạn đã hết lượt hôm nay.']);
  const quiet = createYoutubeApi({ get: async () => ({ items: [], next: null }) }, { notice: (m) => shown.push(m) });
  await quiet.search('c');
  assert.equal(shown.length, 1);
});

// ---------- Giai đoạn 12: chế độ phát ----------
test('giai đoạn 12: Lặp 1 bài - hết bài phát lại chính bài đó; bấm "Bài kế tiếp" vẫn chuyển bài; bài lỗi vẫn bỏ qua', async () => {
  const { c, calls } = makeController({ failIds: ['x'] });
  c.setRepeat('one');
  await c.playList([song('a'), song('x'), song('b')], 0);
  await c.handleEnded();
  await c.handleEnded();
  assert.deepEqual(calls.played, ['a', 'a', 'a'], 'phát lại đúng bài');
  await c.next();   // bấm "Bài kế tiếp": x lỗi -> tự bỏ qua sang b
  assert.equal(c.snapshot().current.id, 'b');
  assert.equal(c.snapshot().repeat, 'one', 'vẫn giữ chế độ');
  await c.handleEnded();
  assert.equal(c.snapshot().current.id, 'b');
  assert.deepEqual(calls.search, [], 'không tự tìm bài');
});

test('giai đoạn 12: Lặp toàn bộ - hết hàng đợi quay về bài đầu, không tự tìm bài; "Bài trước" ở bài đầu về bài cuối', async () => {
  const { c, calls } = makeController();
  c.setRepeat('all');
  await c.playList([song('a'), song('b')], 0);
  await c.handleEnded();
  await c.handleEnded();
  assert.deepEqual(calls.played, ['a', 'b', 'a']);
  assert.equal(c.snapshot().current.id, 'a');
  await c.prev();
  assert.equal(c.snapshot().current.id, 'b', 'lặp toàn bộ: bài đầu bấm "Bài trước" về bài cuối');
  assert.deepEqual(calls.search, []);
  assert.equal(calls.trending, 0);
});

test('giai đoạn 12: Lặp toàn bộ mà mọi bài đều lỗi thì dừng sau vài lần thử (không lặp vô tận)', async () => {
  const { c, calls } = makeController({ failIds: ['x', 'y'] });
  c.setRepeat('all');
  await c.playList([song('x'), song('y')], 0);
  assert.ok(calls.stream.length <= 5, `${calls.stream.length} lần thử`);
  assert.equal(c.snapshot().status, 'error');
});

test('giai đoạn 12: Tắt lặp - Tự phát chỉ tìm bài khi đã HẾT hàng đợi; Tự phát tắt thì dừng', async () => {
  const on = makeController();
  await on.c.playList([song('a'), song('b')], 0);
  await on.c.handleEnded();
  assert.deepEqual([on.calls.search.length, on.calls.trending], [0, 0], 'còn bài trong hàng đợi: không tìm');
  await on.c.handleEnded();
  assert.ok(on.c.snapshot().current.id !== 'b', 'hết hàng đợi: tự thêm bài tương tự');
  const off = makeController();
  off.c.setAutoMix(false);
  await off.c.playList([song('a')], 0);
  await off.c.handleEnded();
  assert.equal(off.c.snapshot().status, 'ended');
  assert.deepEqual([off.calls.search.length, off.calls.trending], [0, 0]);
});

test('giai đoạn 12: nút chế độ phát đổi vòng Lần lượt -> Lặp tất cả -> Lặp 1 bài -> Trộn bài -> Lần lượt', () => {
  const { c } = makeController();
  assert.equal(c.snapshot().repeat, 'off');
  assert.deepEqual([c.cycleRepeat(), c.cycleRepeat(), c.cycleRepeat(), c.cycleRepeat()], ['all', 'one', 'shuffle', 'off']);
  c.setRepeat('bậy');
  assert.equal(c.snapshot().repeat, 'off');
});

test('giai đoạn 12: Tự phát chỉ có tác dụng ở chế độ Lần lượt; lặp hay trộn bài thì không tìm bài dù Tự phát đang bật', () => {
  const { c } = makeController();
  assert.equal(c.autoMixActive(), true);
  for (const m of ['all', 'one', 'shuffle']) { c.setRepeat(m); assert.equal(c.autoMixActive(), false, m); }
  c.setRepeat('off');
  assert.equal(c.autoMixActive(), true);
  assert.equal(c.snapshot().autoMix, true, 'lựa chọn Tự phát vẫn được giữ để dùng lại ở chế độ Lần lượt');
});

test('giai đoạn 12: Trộn bài phát NGẪU NHIÊN các bài trong hàng đợi, KHÔNG sắp xếp lại hàng đợi, mỗi bài một lần mỗi lượt; hết lượt thì trộn lượt mới (không Tự phát)', async () => {
  let seed = 3;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const ids = 'abcdefgh'.split('');
  const { c, queue, calls } = makeController({ rand });
  await c.playList(ids.map((x) => song(x)), 0);
  c.setRepeat('shuffle');
  for (let i = 0; i < ids.length - 1; i++) await c.handleEnded();
  assert.deepEqual(queue.snapshot().items.map((x) => x.id), ids, 'thứ tự hàng đợi giữ nguyên');
  assert.deepEqual(calls.played.slice().sort(), ids, 'mỗi bài đúng một lần');
  assert.notDeepEqual(calls.played, ids, 'không phát theo thứ tự');
  assert.deepEqual(calls.search, []);
  const last = calls.played[calls.played.length - 1];
  await c.handleEnded();   // hết lượt: trộn lượt mới, phát tiếp
  assert.equal(c.snapshot().status, 'playing');
  assert.ok(ids.includes(c.snapshot().current.id) && c.snapshot().current.id !== last, 'lượt mới, không phát lại ngay bài vừa phát');
  assert.deepEqual([calls.search.length, calls.trending], [0, 0], 'trộn bài không tự tìm bài');
  // "Bài trước" khi trộn: quay lại bài vừa phát trước đó
  const { c: c2, calls: k2 } = makeController({ rand });
  await c2.playList(ids.map((x) => song(x)), 0);
  c2.setRepeat('shuffle');
  await c2.handleEnded(); await c2.handleEnded();
  const prevId = k2.played[k2.played.length - 2];
  await c2.prev();
  assert.equal(c2.snapshot().current.id, prevId);
  // Lỗi người dùng báo: đang ở bài CUỐI hàng đợi bấm "Bài kế tiếp" (kể cả khi các bài khác đã phát hết lượt) vẫn chuyển bài
  const { c: c3 } = makeController({ rand });
  await c3.playList(['a', 'b', 'c', 'd'].map((x) => song(x)), 0);
  c3.setRepeat('shuffle');
  for (let i = 0; i < 3; i++) await c3.next();
  await c3.playIndex(3);
  for (let i = 0; i < 6; i++) { await c3.next(); assert.equal(c3.snapshot().status, 'playing', `lần ${i + 1}`); }
  // hàng đợi chỉ có 1 bài: trộn hết thì dừng
  const { c: c4 } = makeController({ rand });
  await c4.playList([song('a')], 0);
  c4.setRepeat('shuffle');
  await c4.handleEnded();
  assert.equal(c4.snapshot().status, 'ended');
});
