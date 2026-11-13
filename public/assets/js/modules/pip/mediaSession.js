// Media Session: tên bài, ảnh bìa và các nút phát/dừng/trước/sau/tua trên cửa sổ nổi, thanh thông báo, màn hình khóa, tai nghe.
// Thuần JS: session (navigator.mediaSession), MetadataCtor (MediaMetadata), video và controller đều truyền từ ngoài vào.
// Không có Media Session thì không làm gì cả (trả về đối tượng rỗng).

const POSITION_EVENTS = ['loadedmetadata', 'durationchange', 'seeked', 'ratechange', 'play', 'pause'];
const ACTIONS = ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'seekto'];

// Các hàm điều khiển trả về Promise; nuốt lỗi để không sinh lỗi "unhandled" ngoài ý muốn.
function quiet(result) {
  if (result && typeof result.catch === 'function') result.catch(() => {});
}

/**
 * @param {{session: object|null, MetadataCtor: Function|null, video: HTMLVideoElement,
 *          controller: object, onState: Function, seekStep?: number}} deps
 * onState(fn) đăng ký nghe trạng thái của controller và trả về hàm hủy đăng ký.
 */
export function bindMediaSession({ session, MetadataCtor, video, controller, onState, seekStep = 10 }) {
  if (!session) return { destroy() {} };
  let lastId = null;

  function setHandler(name, fn) {
    try { session.setActionHandler(name, fn); } catch (e) { /* trình duyệt không có hành động này, bỏ qua */ }
  }

  function seekTo(seconds, fast) {
    const dur = video.duration;
    let target = Math.max(0, seconds);
    if (Number.isFinite(dur) && dur > 0) target = Math.min(target, dur);
    try {
      if (fast && typeof video.fastSeek === 'function') video.fastSeek(target);
      else video.currentTime = target;
    } catch (e) { /* bỏ qua */ }
  }
  const seekBy = (delta) => seekTo((video.currentTime || 0) + delta, false);

  const handlers = {
    play: () => { if (video.paused) quiet(controller.toggle()); },
    pause: () => { if (!video.paused) quiet(controller.toggle()); },
    previoustrack: () => quiet(controller.prev()),
    nexttrack: () => quiet(controller.next()),
    seekbackward: (d) => seekBy(-((d && d.seekOffset) || seekStep)),
    seekforward: (d) => seekBy((d && d.seekOffset) || seekStep),
    seekto: (d) => { if (d && Number.isFinite(d.seekTime)) seekTo(d.seekTime, Boolean(d.fastSeek)); },
  };

  function sync(s) {
    const cur = s.current;
    if (!cur) {
      if (lastId !== null) { try { session.metadata = null; } catch (e) { /* bỏ qua */ } lastId = null; }
    } else if (cur.id !== lastId && MetadataCtor) {
      try {
        session.metadata = new MetadataCtor({
          title: cur.title || '',
          artist: cur.uploader || '',
          artwork: cur.thumbnail ? [{ src: cur.thumbnail, sizes: '480x360' }] : [],
        });
        lastId = cur.id;
      } catch (e) { /* bỏ qua */ }
    }
    try { session.playbackState = s.status === 'playing' ? 'playing' : (cur ? 'paused' : 'none'); } catch (e) { /* bỏ qua */ }
  }

  // Cho thanh tiến trình trên thông báo/cửa sổ nổi. Chrome tự ngoại suy theo thời gian nên chỉ cập nhật khi có sự kiện đổi.
  function updatePosition() {
    if (typeof session.setPositionState !== 'function') return;
    const dur = video.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    const position = Math.min(Math.max(video.currentTime || 0, 0), dur);
    try { session.setPositionState({ duration: dur, playbackRate: video.playbackRate || 1, position }); } catch (e) { /* bỏ qua */ }
  }

  ACTIONS.forEach((name) => setHandler(name, handlers[name]));
  POSITION_EVENTS.forEach((ev) => video.addEventListener(ev, updatePosition));
  const unsubscribe = onState(sync);
  sync(controller.snapshot());

  return {
    destroy() {
      if (typeof unsubscribe === 'function') unsubscribe();
      POSITION_EVENTS.forEach((ev) => video.removeEventListener(ev, updatePosition));
      ACTIONS.forEach((name) => setHandler(name, null));
      try { session.metadata = null; session.playbackState = 'none'; } catch (e) { /* bỏ qua */ }
      lastId = null;
    },
  };
}
