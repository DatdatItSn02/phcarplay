import test from 'node:test';
import assert from 'node:assert/strict';
import { createPip, explainPipError, PIP_MSG } from '../../public/assets/js/modules/pip/pipController.js';
import { createFullscreen } from '../../public/assets/js/modules/pip/fullscreen.js';
import { bindMediaSession } from '../../public/assets/js/modules/pip/mediaSession.js';

// ---- Đối tượng giả: document và video có sự kiện như trình duyệt thật ----
function makeDoc(over = {}) {
  const d = new EventTarget();
  Object.assign(d, { pictureInPictureEnabled: true, pictureInPictureElement: null, fullscreenEnabled: true, fullscreenElement: null, pipExitCalls: 0, fsExitCalls: 0 });
  d.exitPictureInPicture = async () => {
    d.pipExitCalls += 1;
    const v = d.pictureInPictureElement;
    d.pictureInPictureElement = null;
    if (v) v.dispatchEvent(new Event('leavepictureinpicture'));
  };
  d.exitFullscreen = async () => {
    d.fsExitCalls += 1;
    d.fullscreenElement = null;
    d.dispatchEvent(new Event('fullscreenchange'));
  };
  return Object.assign(d, over);
}
function makeVideo(doc, over = {}) {
  const v = new EventTarget();
  Object.assign(v, { readyState: 4, videoWidth: 640, videoHeight: 360, paused: true, currentTime: 0, duration: 100, playbackRate: 1, controls: false, disablePictureInPicture: false, pipCalls: 0, fsCalls: 0 });
  v.requestPictureInPicture = async () => {
    v.pipCalls += 1;
    doc.pictureInPictureElement = v;
    v.dispatchEvent(new Event('enterpictureinpicture'));
    return {};
  };
  v.requestFullscreen = async () => {
    v.fsCalls += 1;
    doc.fullscreenElement = v;
    doc.dispatchEvent(new Event('fullscreenchange'));
  };
  return Object.assign(v, over);
}
const err = (name) => Object.assign(new Error(name), { name });

// ======================= Cửa sổ nổi =======================

test('pip: trình duyệt không hỗ trợ -> ẩn nút kèm gợi ý, bấm cũng không gọi API', async () => {
  const doc = makeDoc({ pictureInPictureEnabled: false });
  const video = makeVideo(doc);
  const pip = createPip({ video, doc });
  const s = pip.snapshot();
  assert.equal(s.supported, false);
  assert.equal(s.ready, false);
  assert.equal(s.hint, PIP_MSG.unsupported);
  const r = await pip.enter();
  assert.deepEqual(r, { ok: false, message: PIP_MSG.unsupported });
  assert.equal(video.pipCalls, 0);
});

test('pip: thiếu hàm requestPictureInPicture hoặc bị disablePictureInPicture cũng coi là không hỗ trợ', () => {
  const doc = makeDoc();
  const noFn = makeVideo(doc);
  delete noFn.requestPictureInPicture;
  assert.equal(createPip({ video: noFn, doc }).snapshot().supported, false);
  const off = makeVideo(doc, { disablePictureInPicture: true });
  assert.equal(createPip({ video: off, doc }).snapshot().supported, false);
});

test('pip: tài khoản không có quyền "pip" -> không cho vào và có gợi ý riêng', async () => {
  const doc = makeDoc();
  const video = makeVideo(doc);
  const pip = createPip({ video, doc, allowed: false });
  const s = pip.snapshot();
  assert.equal(s.supported, true);
  assert.equal(s.allowed, false);
  assert.equal(s.hint, PIP_MSG.denied);
  assert.equal((await pip.enter()).message, PIP_MSG.denied);
  assert.equal(video.pipCalls, 0);
});

test('pip: chưa có video -> chưa bấm được, có lý do; có hình rồi thì tự báo thay đổi', () => {
  const doc = makeDoc();
  const video = makeVideo(doc, { readyState: 0, videoWidth: 0 });
  const pip = createPip({ video, doc });
  const seen = [];
  pip.onChange((s) => seen.push(s));
  assert.equal(pip.snapshot().ready, false);
  assert.equal(pip.snapshot().reason, PIP_MSG.noMedia);
  video.readyState = 4; video.videoWidth = 640;
  video.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].ready, true);
  assert.equal(seen[0].reason, '');
  video.dispatchEvent(new Event('resize'));
  assert.equal(seen.length, 1, 'không báo lại khi trạng thái không đổi');
});

test('pip: bài chỉ có âm thanh (không có hình) -> không nổi được và nói rõ lý do', async () => {
  const doc = makeDoc();
  const video = makeVideo(doc, { videoWidth: 0 });
  const pip = createPip({ video, doc });
  assert.equal(pip.snapshot().ready, false);
  assert.equal(pip.snapshot().reason, PIP_MSG.audioOnly);
  assert.deepEqual(await pip.enter(), { ok: false, message: PIP_MSG.audioOnly });
  assert.equal(video.pipCalls, 0);
});

test('pip: vào và ra cửa sổ nổi, theo dõi sự kiện, toggle', async () => {
  const doc = makeDoc();
  const video = makeVideo(doc);
  const pip = createPip({ video, doc });
  const seen = [];
  pip.onChange((s) => seen.push(s.active));
  assert.deepEqual(await pip.toggle(), { ok: true });
  assert.equal(video.pipCalls, 1);
  assert.equal(pip.snapshot().active, true);
  assert.deepEqual((await pip.enter()), { ok: true }, 'đang nổi mà vào nữa thì không gọi lại');
  assert.equal(video.pipCalls, 1);
  assert.deepEqual(await pip.toggle(), { ok: true });
  assert.equal(doc.pipExitCalls, 1);
  assert.equal(pip.snapshot().active, false);
  assert.deepEqual(seen, [true, false]);
});

test('pip: người dùng tự đóng cửa sổ nổi bằng nút X của trình duyệt -> giao diện được báo', async () => {
  const doc = makeDoc();
  const video = makeVideo(doc);
  const pip = createPip({ video, doc });
  await pip.enter();
  const seen = [];
  pip.onChange((s) => seen.push(s.active));
  doc.pictureInPictureElement = null;
  video.dispatchEvent(new Event('leavepictureinpicture'));
  assert.deepEqual(seen, [false]);
});

test('pip: ĐỔI BÀI/Mix không làm đóng cửa sổ nổi (cùng một thẻ video, không gọi thoát)', async () => {
  const doc = makeDoc();
  const video = makeVideo(doc);
  const pip = createPip({ video, doc });
  await pip.enter();
  // mô phỏng đổi nguồn phát: video bị làm rỗng rồi nạp bài mới
  video.readyState = 0; video.videoWidth = 0;
  video.dispatchEvent(new Event('emptied'));
  assert.equal(pip.snapshot().active, true, 'giữa hai bài vẫn đang nổi');
  assert.equal(pip.snapshot().ready, true, 'đang nổi thì vẫn bấm được để đóng');
  video.readyState = 4; video.videoWidth = 640;
  video.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(doc.pipExitCalls, 0, 'mã của app không gọi exitPictureInPicture khi đổi bài');
  assert.equal(video.pipCalls, 1);
  assert.equal(pip.snapshot().active, true);
});

test('pip: lỗi của trình duyệt được đổi sang câu tiếng Việt', async () => {
  assert.equal(explainPipError(err('NotAllowedError')), PIP_MSG.gesture);
  assert.equal(explainPipError(err('InvalidStateError')), PIP_MSG.invalid);
  assert.equal(explainPipError(err('NotSupportedError')), PIP_MSG.unsupported);
  assert.equal(explainPipError(err('SecurityError')), PIP_MSG.security);
  assert.equal(explainPipError(err('Lạ')), PIP_MSG.generic);
  assert.equal(explainPipError(null), PIP_MSG.generic);
  const doc = makeDoc();
  const video = makeVideo(doc);
  video.requestPictureInPicture = async () => { throw err('NotAllowedError'); };
  const r = await createPip({ video, doc }).enter();
  assert.deepEqual(r, { ok: false, message: PIP_MSG.gesture });
});

test('pip: thoát bị lỗi thì báo, không văng ngoại lệ', async () => {
  const doc = makeDoc();
  const video = makeVideo(doc);
  const pip = createPip({ video, doc });
  await pip.enter();
  doc.exitPictureInPicture = async () => { throw err('InvalidStateError'); };
  assert.deepEqual(await pip.exit(), { ok: false, message: PIP_MSG.closeFail });
});

test('pip: Safari cũ dùng webkitSetPresentationMode', async () => {
  const doc = makeDoc({ pictureInPictureEnabled: undefined });
  const video = makeVideo(doc);
  delete video.requestPictureInPicture;
  video.webkitPresentationMode = 'inline';
  video.webkitSupportsPresentationMode = (m) => m === 'picture-in-picture';
  video.webkitSetPresentationMode = (m) => { video.webkitPresentationMode = m; video.dispatchEvent(new Event('webkitpresentationmodechanged')); };
  const pip = createPip({ video, doc });
  assert.equal(pip.snapshot().supported, true);
  const seen = [];
  pip.onChange((s) => seen.push(s.active));
  assert.deepEqual(await pip.toggle(), { ok: true });
  assert.equal(video.webkitPresentationMode, 'picture-in-picture');
  assert.deepEqual(await pip.toggle(), { ok: true });
  assert.equal(video.webkitPresentationMode, 'inline');
  assert.deepEqual(seen, [true, false]);
});

test('pip: destroy đóng cửa sổ nổi đang mở và gỡ mọi bộ theo dõi', async () => {
  const doc = makeDoc();
  const video = makeVideo(doc);
  const pip = createPip({ video, doc });
  await pip.enter();
  const seen = [];
  pip.onChange((s) => seen.push(s));
  pip.destroy();
  await Promise.resolve();
  assert.equal(doc.pipExitCalls, 1);
  assert.deepEqual(seen, [], 'sau destroy không báo gì nữa');
  video.dispatchEvent(new Event('loadedmetadata'));
  assert.deepEqual(seen, []);
  pip.destroy();   // gọi lần hai không lỗi, không thoát thêm
  assert.equal(doc.pipExitCalls, 1);
});

// ======================= Toàn màn hình =======================

test('fullscreen: vào thì tạm bật điều khiển của trình duyệt, thoát thì tắt lại', async () => {
  const doc = makeDoc();
  const video = makeVideo(doc);
  const fs = createFullscreen({ video, doc });
  assert.equal(fs.snapshot().supported, true);
  const seen = [];
  fs.onChange((s) => seen.push(s.active));
  assert.deepEqual(await fs.toggle(), { ok: true });
  assert.equal(doc.fullscreenElement, video);
  assert.equal(video.controls, true);
  assert.deepEqual(await fs.toggle(), { ok: true });
  assert.equal(doc.fsExitCalls, 1);
  assert.equal(video.controls, false);
  assert.deepEqual(seen, [true, false]);
});

test('fullscreen: thoát bằng nút Back của thiết bị cũng tắt điều khiển', async () => {
  const doc = makeDoc();
  const video = makeVideo(doc);
  const fs = createFullscreen({ video, doc });
  await fs.enter();
  assert.equal(video.controls, true);
  doc.fullscreenElement = null;
  doc.dispatchEvent(new Event('fullscreenchange'));
  assert.equal(video.controls, false);
  assert.equal(fs.snapshot().active, false);
});

test('fullscreen: không hỗ trợ thì báo lỗi gọn; vào bị từ chối cũng không văng', async () => {
  const doc = makeDoc({ fullscreenEnabled: false });
  const video = makeVideo(doc);
  delete video.requestFullscreen;
  const fs = createFullscreen({ video, doc });
  assert.equal(fs.snapshot().supported, false);
  assert.equal((await fs.enter()).ok, false);
  const doc2 = makeDoc();
  const video2 = makeVideo(doc2);
  video2.requestFullscreen = async () => { throw err('TypeError'); };
  assert.equal((await createFullscreen({ video: video2, doc: doc2 }).enter()).ok, false);
});

test('fullscreen: iPhone chỉ có webkitEnterFullscreen trên thẻ video', async () => {
  const doc = makeDoc({ fullscreenEnabled: undefined });
  const video = makeVideo(doc);
  delete video.requestFullscreen;
  video.webkitDisplayingFullscreen = false;
  video.webkitEnterFullscreen = () => { video.webkitDisplayingFullscreen = true; video.dispatchEvent(new Event('webkitbeginfullscreen')); };
  video.webkitExitFullscreen = () => { video.webkitDisplayingFullscreen = false; video.dispatchEvent(new Event('webkitendfullscreen')); };
  const fs = createFullscreen({ video, doc });
  assert.equal(fs.snapshot().supported, true);
  await fs.toggle();
  assert.equal(fs.snapshot().active, true);
  assert.equal(video.controls, true);
  await fs.toggle();
  assert.equal(fs.snapshot().active, false);
  assert.equal(video.controls, false);
});

test('fullscreen: destroy thoát toàn màn hình đang mở, tắt điều khiển, gỡ bộ theo dõi', async () => {
  const doc = makeDoc();
  const video = makeVideo(doc);
  const fs = createFullscreen({ video, doc });
  await fs.enter();
  const seen = [];
  fs.onChange((s) => seen.push(s));
  fs.destroy();
  await Promise.resolve();
  assert.equal(doc.fsExitCalls, 1);
  assert.equal(video.controls, false);
  doc.dispatchEvent(new Event('fullscreenchange'));
  assert.deepEqual(seen, []);
});

// ======================= Media Session =======================

class Meta { constructor(init) { Object.assign(this, init); } }
function makeSession({ unsupported = [] } = {}) {
  const s = { metadata: null, playbackState: 'none', handlers: {}, positions: [] };
  s.setActionHandler = (name, fn) => { if (unsupported.includes(name)) throw new TypeError('Không hỗ trợ ' + name); s.handlers[name] = fn; };
  s.setPositionState = (st) => { s.positions.push(st); };
  return s;
}
function makeController(initial) {
  let state = { status: 'idle', current: null, ...initial };
  const calls = [];
  return {
    calls,
    set(next) { state = { ...state, ...next }; },
    snapshot: () => ({ ...state }),
    toggle: async () => { calls.push('toggle'); return true; },
    next: async () => { calls.push('next'); },
    prev: async () => { calls.push('prev'); },
  };
}
function makeBus() {
  const set = new Set();
  return { onState: (fn) => { set.add(fn); return () => set.delete(fn); }, emit: (s) => set.forEach((fn) => fn(s)), size: () => set.size };
}
const song = (id) => ({ id, title: `Bài ${id}`, uploader: 'Ca sĩ', thumbnail: `https://img/${id}.jpg` });

function setup(over = {}) {
  const session = makeSession(over.session);
  const doc = makeDoc();
  const video = makeVideo(doc, { duration: 200, currentTime: 50, paused: false });
  const controller = makeController(over.state);
  const bus = makeBus();
  const binding = bindMediaSession({ session, MetadataCtor: Meta, video, controller, onState: bus.onState });
  return { session, video, controller, bus, binding };
}

test('mediaSession: tên bài, kênh, ảnh bìa hiện khi đổi bài và xóa khi hết bài', () => {
  const { session, controller, bus } = setup();
  assert.equal(session.metadata, null);
  assert.equal(session.playbackState, 'none');
  controller.set({ status: 'playing', current: song('a') });
  bus.emit(controller.snapshot());
  assert.equal(session.metadata.title, 'Bài a');
  assert.equal(session.metadata.artist, 'Ca sĩ');
  assert.deepEqual(session.metadata.artwork, [{ src: 'https://img/a.jpg', sizes: '480x360' }]);
  assert.equal(session.playbackState, 'playing');
  const first = session.metadata;
  controller.set({ status: 'paused' });
  bus.emit(controller.snapshot());
  assert.equal(session.metadata, first, 'cùng một bài thì không tạo lại metadata');
  assert.equal(session.playbackState, 'paused');
  controller.set({ current: song('b') });
  bus.emit(controller.snapshot());
  assert.equal(session.metadata.title, 'Bài b');
  controller.set({ current: null, status: 'idle' });
  bus.emit(controller.snapshot());
  assert.equal(session.metadata, null);
  assert.equal(session.playbackState, 'none');
});

test('mediaSession: bài chưa có ảnh bìa vẫn tạo metadata (artwork rỗng)', () => {
  const { session, controller, bus } = setup();
  controller.set({ status: 'playing', current: { id: 'x', title: 'Không ảnh', uploader: '' } });
  bus.emit(controller.snapshot());
  assert.deepEqual(session.metadata.artwork, []);
});

test('mediaSession: bài đã đang phát sẵn lúc gắn thì metadata có ngay', () => {
  const session = makeSession();
  const video = makeVideo(makeDoc());
  const controller = makeController({ status: 'playing', current: song('z') });
  bindMediaSession({ session, MetadataCtor: Meta, video, controller, onState: makeBus().onState });
  assert.equal(session.metadata.title, 'Bài z');
  assert.equal(session.playbackState, 'playing');
});

test('mediaSession: nút phát/dừng chỉ đổi trạng thái khi cần; trước/sau gọi controller', () => {
  const { session, video, controller } = setup();
  video.paused = false;
  session.handlers.play();
  assert.deepEqual(controller.calls, [], 'đang phát mà bấm phát thì không làm gì');
  session.handlers.pause();
  assert.deepEqual(controller.calls, ['toggle']);
  video.paused = true;
  session.handlers.pause();
  assert.deepEqual(controller.calls, ['toggle'], 'đang dừng mà bấm dừng thì không làm gì');
  session.handlers.play();
  session.handlers.nexttrack();
  session.handlers.previoustrack();
  assert.deepEqual(controller.calls, ['toggle', 'toggle', 'next', 'prev']);
});

test('mediaSession: tua lùi/tới/đến vị trí, kẹp trong [0, độ dài]', () => {
  const { session, video } = setup();
  video.currentTime = 50;
  session.handlers.seekforward({});
  assert.equal(video.currentTime, 60, 'mặc định 10 giây');
  session.handlers.seekbackward({ seekOffset: 15 });
  assert.equal(video.currentTime, 45);
  session.handlers.seekbackward({ seekOffset: 999 });
  assert.equal(video.currentTime, 0, 'không xuống dưới 0');
  session.handlers.seekforward({ seekOffset: 999 });
  assert.equal(video.currentTime, 200, 'không vượt quá độ dài');
  session.handlers.seekto({ seekTime: 33 });
  assert.equal(video.currentTime, 33);
  session.handlers.seekto({});
  assert.equal(video.currentTime, 33, 'thiếu seekTime thì bỏ qua');
  let fast = null;
  video.fastSeek = (t) => { fast = t; };
  session.handlers.seekto({ seekTime: 70, fastSeek: true });
  assert.equal(fast, 70);
});

test('mediaSession: một hành động không được hỗ trợ không làm hỏng các hành động khác', () => {
  const { session } = setup({ session: { unsupported: ['seekto'] } });
  assert.equal(typeof session.handlers.play, 'function');
  assert.equal(typeof session.handlers.nexttrack, 'function');
  assert.equal(session.handlers.seekto, undefined);
});

test('mediaSession: cập nhật vị trí phát cho thanh tiến trình khi có sự kiện; bỏ qua khi chưa biết độ dài', () => {
  const { session, video } = setup();
  video.currentTime = 12;
  video.dispatchEvent(new Event('seeked'));
  assert.deepEqual(session.positions.at(-1), { duration: 200, playbackRate: 1, position: 12 });
  const n = session.positions.length;
  video.duration = NaN;
  video.dispatchEvent(new Event('durationchange'));
  video.duration = Infinity;
  video.dispatchEvent(new Event('durationchange'));
  assert.equal(session.positions.length, n);
  video.duration = 200; video.currentTime = 500; video.playbackRate = 0;
  video.dispatchEvent(new Event('ratechange'));
  assert.deepEqual(session.positions.at(-1), { duration: 200, playbackRate: 1, position: 200 }, 'vị trí kẹp theo độ dài, tốc độ 0 đổi thành 1');
  session.setPositionState = () => { throw new TypeError('sai'); };
  video.dispatchEvent(new Event('seeked'));   // không văng lỗi
});

test('mediaSession: destroy gỡ hành động, xóa metadata và ngừng nghe', () => {
  const { session, video, controller, bus, binding } = setup();
  controller.set({ status: 'playing', current: song('a') });
  bus.emit(controller.snapshot());
  assert.equal(bus.size(), 1);
  binding.destroy();
  assert.equal(bus.size(), 0);
  assert.equal(session.metadata, null);
  assert.equal(session.playbackState, 'none');
  assert.ok(Object.values(session.handlers).every((fn) => fn === null), 'mọi hành động được gỡ');
  const n = session.positions.length;
  video.dispatchEvent(new Event('seeked'));
  assert.equal(session.positions.length, n);
});

test('mediaSession: trình duyệt không có Media Session thì không làm gì và không lỗi', () => {
  const b = bindMediaSession({ session: null, MetadataCtor: null, video: makeVideo(makeDoc()), controller: makeController(), onState: makeBus().onState });
  b.destroy();
  const session = makeSession();
  const noMeta = bindMediaSession({ session, MetadataCtor: null, video: makeVideo(makeDoc()), controller: makeController({ status: 'playing', current: song('q') }), onState: makeBus().onState });
  assert.equal(session.metadata, null, 'thiếu MediaMetadata thì bỏ qua phần metadata');
  noMeta.destroy();
});
