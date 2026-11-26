// Giai đoạn 9: phát bằng trình phát nhúng chính thức của YouTube (IFrame Player API) khi máy chủ không lấy được
// luồng trực tiếp (Piped/Invidious hỏng) hoặc luồng trực tiếp không phát được trên trình duyệt này.
// Các nút của website (phát/dừng, trước/sau, tua, tự chuyển bài, Mix) vẫn điều khiển được qua API này.
// Không dùng ?. và ?? để chạy được trên trình duyệt cũ của màn hình xe.

export const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

// Mã lỗi của trình phát YouTube -> câu tiếng Việt.
export function explainYtError(code) {
  if (code === 101 || code === 150 || code === 152) return 'Chủ video không cho phát trên website khác.';
  if (code === 100) return 'Video không còn tồn tại hoặc đang ở chế độ riêng tư.';
  if (code === 2) return 'Mã video không hợp lệ.';
  if (code === 5) return 'Trình duyệt này không phát được video YouTube.';
  return 'Trình phát YouTube báo lỗi.';
}

// Nạp thư viện trình phát YouTube (iframe_api) một lần. Trả null nếu không nạp được (mất mạng, bị chặn).
export function createYtApiLoader(src, timeoutMs = 15000) {
  let promise = null;
  return function loadYt() {
    const w = typeof window !== 'undefined' ? window : {};
    if (w.YT && typeof w.YT.Player === 'function') return Promise.resolve(w.YT);
    if (!promise) {
      promise = new Promise((resolve) => {
        let done = false;
        const finish = (v) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (!v) promise = null;   // lần sau thử nạp lại
          resolve(v);
        };
        const prev = w.onYouTubeIframeAPIReady;
        w.onYouTubeIframeAPIReady = () => {
          if (typeof prev === 'function') { try { prev(); } catch (e) { /* bỏ qua */ } }
          finish(w.YT && typeof w.YT.Player === 'function' ? w.YT : null);
        };
        const timer = setTimeout(() => finish(w.YT && typeof w.YT.Player === 'function' ? w.YT : null), timeoutMs);
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onerror = () => finish(null);
        document.head.appendChild(s);
      });
    }
    return promise;
  };
}

/**
 * Động cơ phát bằng trình phát YouTube, cùng giao diện với động cơ <video>: load(info), play(), pause(), isPaused(),
 * thêm getTime(), setTime(t), getDuration(), stop(), destroy().
 * host: phần tử chứa khung trình phát. emit(type): báo sự kiện kiểu thẻ video ('play', 'pause', 'ended', 'timeupdate',
 * 'durationchange', 'loadedmetadata', 'emptied'). onFatal(message): video không phát được (bị cấm nhúng, đã xóa...).
 */
// Trình duyệt chỉ cho TỰ PHÁT CÓ TIẾNG khi người dùng đã chạm vào trang; chưa chạm (mở web, tải lại trang) thì YouTube
// không chạy. Khi đó tắt tiếng rồi phát (trình duyệt luôn cho phát khi tắt tiếng), báo onMuted(true) để giao diện hiện
// nút "Bật tiếng"; lần chạm đầu tiên vào website sẽ tự bật tiếng lại (unmute).
export function createEmbedEngine({ host, loadApi, origin = '', emit = () => {}, onFatal = () => {}, onMeta = () => {}, onMuted = () => {}, readyTimeoutMs = 15000, playWaitMs = 10000, quiet = false, nav = (typeof navigator !== 'undefined' ? navigator : null) }) {
  let player = null;
  let readyPromise = null;
  let state = YT_STATE.UNSTARTED;
  let token = 0;
  let active = false;
  let tick = null;
  let lastDuration = 0;
  let pendingId = null;   // bài đã chọn nhưng chưa nạp vào trình phát (play() sẽ "nạp và phát luôn")
  let targetId = null;    // bài đang muốn phát (để bỏ qua sự kiện trễ của bài cũ)
  const stateWaiters = new Set();
  let autoMuted = false;   // đang tắt tiếng vì trình duyệt chặn tự phát có tiếng
  let volPct = 100;        // âm lượng người dùng chọn (0-100)
  let userMuted = false;   // người dùng tự tắt tiếng
  let silenced = false;    // trình phát đang bị website tắt tiếng theo lựa chọn âm lượng
  function applyVolume() {
    if (!player) return;
    try {
      if (typeof player.setVolume === 'function') player.setVolume(volPct);
      const want = userMuted || volPct === 0;
      if (want && !silenced) { player.mute(); silenced = true; }
      else if (!want && silenced) { silenced = false; if (!autoMuted) player.unMute(); }
    } catch (e) { /* bỏ qua */ }
  }

  function muteForAutoplay() {
    if (!player || autoMuted) return;
    try { player.mute(); } catch (e) { return; }
    autoMuted = true;
    onMuted(true);
  }
  const isPlayingState = (s) => s === YT_STATE.PLAYING || s === YT_STATE.BUFFERING;

  function startTick() {
    if (tick) return;
    tick = setInterval(() => {
      emit('timeupdate');
      const d = getDuration();
      if (d > 0 && d !== lastDuration) { lastDuration = d; emit('durationchange'); emit('loadedmetadata'); }
    }, 250);
  }
  function stopTick() { if (tick) { clearInterval(tick); tick = null; } }

  // Ghi nhật ký ngắn ra Console (F12) để dò lỗi tự phát trên trình duyệt thật.
  const log = (...a) => { try { if (typeof console !== 'undefined' && console.info && !quiet) console.info('[carweb-yt]', ...a); } catch (e) { /* bỏ qua */ } };
  function currentVideoId() {
    try { const d = player && typeof player.getVideoData === 'function' ? player.getVideoData() : null; return d && d.video_id ? String(d.video_id) : ''; } catch (e) { return ''; }
  }

  function onState(s) {
    log('trạng thái', s, currentVideoId());
    state = s;
    stateWaiters.forEach((fn) => fn(s));
    if (!active) return;
    if (s === YT_STATE.PLAYING) {
      startTick();
      emit('play');
      try {
        const d = player && typeof player.getVideoData === 'function' ? player.getVideoData() : null;
        if (d && d.title) onMeta({ id: d.video_id || '', title: String(d.title), uploader: String(d.author || '') });
      } catch (e) { /* bỏ qua */ }
    }
    else if (s === YT_STATE.PAUSED) { stopTick(); emit('timeupdate'); emit('pause'); }
    else if (s === YT_STATE.ENDED) { stopTick(); emit('timeupdate'); emit('ended'); }
  }

  function onError(code) {
    if (!active) return;
    stopTick();
    onFatal(explainYtError(code));
  }

  function create(YT, videoId) {
    if (readyPromise) return readyPromise;
    readyPromise = new Promise((resolve) => {
      let done = false;
      const finish = (ok) => { if (!done) { done = true; clearTimeout(timer); if (!ok) { readyPromise = null; } resolve(ok); } };
      const timer = setTimeout(() => finish(false), readyTimeoutMs);
      const slot = document.createElement('div');
      host.appendChild(slot);
      try {
        player = new YT.Player(slot, {
          width: '100%', height: '100%', videoId,
          playerVars: { playsinline: 1, rel: 0, iv_load_policy: 3, controls: 1, fs: 1, enablejsapi: 1, origin: origin || undefined },
          events: {
            onReady: () => { applyVolume(); finish(true); },
            onStateChange: (e) => onState(e && typeof e.data === 'number' ? e.data : YT_STATE.UNSTARTED),
            onError: (e) => onError(e ? e.data : 0),
            // YouTube báo trình duyệt chặn tự phát có tiếng: tắt tiếng rồi phát lại ngay
            onAutoplayBlocked: () => { if (active && !autoMuted) { muteForAutoplay(); try { player.playVideo(); } catch (e) { /* bỏ qua */ } } },
          },
        });
      } catch (e) {
        player = null;
        finish(false);
      }
    });
    return readyPromise;
  }

  function waitState(accept, ms) {
    return new Promise((resolve) => {
      if (accept(state)) { resolve(true); return; }
      const fn = (s) => { if (accept(s)) { done(true); } };
      const timer = setTimeout(() => done(false), ms);
      function done(v) { clearTimeout(timer); stateWaiters.delete(fn); resolve(v); }
      stateWaiters.add(fn);
    });
  }

  function getDuration() {
    try { const d = player ? Number(player.getDuration()) : 0; return d > 0 ? d : 0; } catch (e) { return 0; }
  }

  return {
    // Trả true khi trình phát đã sẵn sàng với video này.
    async load(info) {
      token += 1;
      const my = token;
      active = true;
      stopTick();
      lastDuration = 0;
      state = YT_STATE.UNSTARTED;
      emit('emptied');
      const YT = await loadApi();
      if (my !== token) return false;
      if (!YT) return false;
      const fresh = !player;
      const ok = await create(YT, info.id);
      if (my !== token || !ok || !player) return false;
      // Bài mới chỉ được ghi nhớ; play() sẽ "nạp và phát luôn" bằng loadVideoById. (Không gọi cueVideoById ở đây:
      // YouTube thật hay bỏ qua lệnh phát gửi ngay sau lệnh cue, khiến bài mới đứng yên chờ bấm.)
      pendingId = fresh ? null : info.id;
      targetId = info.id;
      return true;
    },
    // Phát. Bài vừa đổi thì dùng loadVideoById ("nạp và phát luôn") - gọi playVideo ngay sau cueVideoById hay bị
    // YouTube bỏ qua. Chờ tối đa playWaitMs; YouTube chưa chạy (quảng cáo, mạng chậm) thì báo PlayPending:
    // giao diện để trạng thái "dừng" mà KHÔNG hiện thông báo lỗi; khi YouTube chạy thật, sự kiện 'play' cập nhật lại.
    async play() {
      if (!player) throw new Error('Chưa có trình phát');
      // Chưa từng chạm vào trang: chắc chắn bị chặn nếu có tiếng -> tắt tiếng trước cho phát được ngay.
      const act = nav && nav.userActivation;
      if (act && act.hasBeenActive === false) muteForAutoplay();
      const want = targetId;
      // Chỉ tính là "đang phát" khi đúng bài muốn phát (sự kiện của bài cũ có thể đến trễ).
      const playingWanted = (s) => isPlayingState(s) && (!want || !currentVideoId() || currentVideoId() === want);
      const command = () => {
        try {
          if (pendingId || (want && currentVideoId() && currentVideoId() !== want)) {
            const id = pendingId || want;
            pendingId = null;
            log('nạp và phát', id);
            player.loadVideoById(id);
          } else {
            log('phát', want);
            player.playVideo();
          }
        } catch (e) { /* thử lại ở bước sau */ }
      };
      if (pendingId) state = YT_STATE.UNSTARTED;
      command();
      const quick = Math.min(1500, Math.floor(playWaitMs / 4));
      let ok = await waitState(playingWanted, quick);
      if (!ok) { log('chưa chạy, gửi lại lệnh phát'); command(); ok = await waitState(playingWanted, quick); }   // lệnh có thể bị bỏ qua
      if (!ok && !autoMuted) {
        // vẫn chưa chạy: thường là trình duyệt chặn tự phát có tiếng -> tắt tiếng và phát lại
        log('có thể bị chặn tự phát có tiếng -> tắt tiếng');
        muteForAutoplay();
        command();
      }
      if (!ok) ok = await waitState(playingWanted, playWaitMs - 2 * quick);
      if (!ok) { log('hết thời gian chờ, trạng thái', state); const err = new Error('Trình phát YouTube chưa bắt đầu'); err.name = 'PlayPending'; throw err; }
    },
    isAutoMuted: () => autoMuted,
    // Âm lượng của website (thanh âm lượng dưới hàng nút). Người dùng đổi âm lượng = cũng là bật tiếng nếu đang tắt vì chặn tự phát.
    setVolume(pct, muted) {
      volPct = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
      userMuted = Boolean(muted);
      if (!userMuted && volPct > 0 && autoMuted) { autoMuted = false; onMuted(false); }
      applyVolume();
    },
    // Bật tiếng lại (gọi trong lúc người dùng chạm/bấm để trình duyệt cho phép).
    unmute() {
      if (!autoMuted) return;
      autoMuted = false;
      if (player) {
        try { player.unMute(); if (typeof player.getVolume === 'function' && Number(player.getVolume()) === 0) player.setVolume(100); } catch (e) { /* bỏ qua */ }
      }
      onMuted(false);
    },
    pause() { if (player) { try { player.pauseVideo(); } catch (e) { /* bỏ qua */ } } },
    isPaused: () => state !== YT_STATE.PLAYING && state !== YT_STATE.BUFFERING,
    isEnded: () => state === YT_STATE.ENDED,
    getTime() { try { return player ? Number(player.getCurrentTime()) || 0 : 0; } catch (e) { return 0; } },
    setTime(t) { if (player) { try { player.seekTo(Math.max(0, Number(t) || 0), true); } catch (e) { /* bỏ qua */ } emit('timeupdate'); } },
    getDuration,
    // Ngừng phát và rời chế độ YouTube (chuyển về thẻ video của website).
    stop() {
      token += 1;
      active = false;
      stopTick();
      if (player) { try { player.stopVideo(); } catch (e) { /* bỏ qua */ } }
    },
    destroy() {
      token += 1;
      active = false;
      stopTick();
      stateWaiters.clear();
      if (player) { try { player.destroy(); } catch (e) { /* bỏ qua */ } }
      player = null;
      readyPromise = null;
      while (host.firstChild) host.removeChild(host.firstChild);
    },
  };
}
