import { createYoutubeApi } from './youtubeApi.js';
import { createQueue } from './queue.js';
import { createEngine, createHlsLoader } from './playerEngine.js';
import { createEmbedEngine, createYtApiLoader } from './embedPlayer.js';
import { createPlayerController } from './playerController.js';
import { createPlaylistStore } from './playlistStore.js';
import { createPlayStats, createPlayCounter } from './playStats.js';
import { createPlaybackPrefs } from './playbackPrefs.js';
import { createPip } from '../pip/pipController.js';
import { createFullscreen } from '../pip/fullscreen.js';
import { bindMediaSession } from '../pip/mediaSession.js';
import { showToast } from '../../core/toast.js';

export const EMBED_PIP_MSG = 'Cửa sổ nổi không dùng được khi phát bằng trình phát YouTube.';
const SURFACE_EVENTS = ['timeupdate', 'loadedmetadata', 'durationchange', 'emptied', 'play', 'pause', 'ended', 'seeked', 'ratechange'];

/**
 * Gói tất cả phần phát media vào một chỗ: MỘT thẻ <video> của website, hàng đợi, điều phối, kho playlist,
 * cửa sổ nổi (pip), toàn màn hình (fullscreen) và Media Session.
 * Giai đoạn 9: khi không có luồng trực tiếp (máy chủ trả embed) hoặc luồng trực tiếp không phát được trên trình duyệt này,
 * phát bằng trình phát nhúng của YouTube (embedHost). "surface" là lớp giả thẻ video (currentTime, duration, paused,
 * sự kiện) trỏ vào nguồn đang dùng, để thanh tua, thanh phát nhỏ, Media Session không cần biết đang phát bằng gì.
 * Các panel (trình phát, tìm kiếm, playlist, hàng đợi) dùng chung đối tượng này qua ctx.media.
 * canPip: tài khoản có quyền 'pip' (EntitlementService) hay không.
 * youtubeEmbed: { embed: bool, iframeApi: string } do máy chủ gửi (boot.youtube); null = không phát nhúng.
 * pipDisabled: tắt hẳn cửa sổ nổi (trong ứng dụng điện thoại - giai đoạn 13).
 */
export function createMedia({ api, hasUser, canPip = true, pipDisabled = false, hlsJs = null, youtubeEmbed = null, ytLoader = null }) {
  const video = document.createElement('video');
  video.className = 'media-video';
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.preload = 'auto';
  video.controls = false;

  const embedHost = document.createElement('div');
  embedHost.className = 'media-embed';
  embedHost.hidden = true;
  const embedAllowed = Boolean(youtubeEmbed && youtubeEmbed.embed && youtubeEmbed.iframeApi);

  const youtube = createYoutubeApi(api, { notice: (m) => showToast(m) });
  const queueListeners = new Set();
  const stateListeners = new Set();
  const modeListeners = new Set();
  const soundListeners = new Set();
  const surfaceListeners = {};
  SURFACE_EVENTS.forEach((ev) => { surfaceListeners[ev] = new Set(); });
  const queue = createQueue({ onChange: (s) => queueListeners.forEach((fn) => fn(s)) });
  let controller = null;
  let mode = 'video';   // 'video' | 'embed'
  let currentInfo = null;
  let loadToken = 0;

  const fire = (type) => { const set = surfaceListeners[type]; if (set) set.forEach((fn) => { try { fn({ type }); } catch (e) { /* bỏ qua */ } }); };
  SURFACE_EVENTS.forEach((ev) => video.addEventListener(ev, () => { if (mode === 'video') fire(ev); }));

  const videoEngine = createEngine({
    video,
    loadHls: createHlsLoader(hlsJs && hlsJs.src, hlsJs && hlsJs.integrity),
    onFatal: () => { fallbackMidPlay(); },
  });
  const embed = createEmbedEngine({
    host: embedHost,
    loadApi: ytLoader || createYtApiLoader(embedAllowed ? youtubeEmbed.iframeApi : ''),
    origin: typeof location !== 'undefined' ? location.origin : '',
    emit: (type) => { if (mode === 'embed') fire(type); },
    onFatal: (message) => { if (mode === 'embed') controller.handleFatal(message); },
    onMuted: (on) => soundListeners.forEach((fn) => fn(on)),
    onMeta: (m) => { const cur = controller.snapshot().current; if (cur) controller.updateMeta(cur.id, m); },
  });

  function setMode(next) {
    if (mode === next) return;
    mode = next;
    if (next === 'embed') {
      pipCore.exit();
      fullscreenCore.exit();
      video.pause();
      video.removeAttribute('src');
      try { video.load(); } catch (e) { /* bỏ qua */ }
    } else {
      embed.stop();
    }
    embedHost.hidden = next !== 'embed';
    video.hidden = next === 'embed';
    modeListeners.forEach((fn) => fn(mode));
    fire('emptied');
  }

  // Luồng trực tiếp đang phát thì hỏng hẳn (hết nguồn dự phòng): chuyển sang trình phát YouTube, phát tiếp từ chỗ cũ.
  async function fallbackMidPlay() {
    if (!embedAllowed || !currentInfo || mode !== 'video') { controller.handleFatal(); return; }
    const at = video.currentTime || 0;
    const my = ++loadToken;
    setMode('embed');
    const ok = await embed.load(currentInfo);
    if (my !== loadToken) return;
    if (!ok) { controller.handleFatal(); return; }
    embed.setTime(at);
    try { await embed.play(); controller.syncPlaying(true); } catch (e) { controller.syncPlaying(false); }
  }

  // Động cơ ghép: máy chủ trả embed -> trình phát YouTube; có luồng -> thẻ video, không phát được thì thử trình phát YouTube.
  const engine = {
    async load(info) {
      const my = ++loadToken;
      currentInfo = info;
      if (info && info.embed) {
        if (!embedAllowed) return false;
        setMode('embed');
        const ok = await embed.load(info);
        return my === loadToken && ok;
      }
      setMode('video');
      const ok = await videoEngine.load(info);
      if (my !== loadToken) return false;
      if (ok || !embedAllowed || !info || !info.id) return ok;
      setMode('embed');
      const ok2 = await embed.load(info);
      return my === loadToken && ok2;
    },
    play: () => (mode === 'embed' ? embed.play() : videoEngine.play()),
    pause: () => (mode === 'embed' ? embed.pause() : videoEngine.pause()),
    isPaused: () => (mode === 'embed' ? embed.isPaused() : videoEngine.isPaused()),
    destroy() { loadToken += 1; videoEngine.destroy(); embed.destroy(); },
  };

  // Đang tắt tiếng vì trình duyệt chặn tự phát: lần chạm/bấm phím đầu tiên vào website thì bật tiếng lại.
  const unmuteOnGesture = () => { if (embed.isAutoMuted()) embed.unmute(); };
  ['pointerdown', 'touchstart', 'keydown'].forEach((ev) => document.addEventListener(ev, unmuteOnGesture, true));

  // Giai đoạn 12.2: âm lượng (thanh dưới hàng nút), áp dụng cho cả thẻ video lẫn trình phát YouTube, nhớ trên thiết bị.
  const VOL_KEY = 'carweb_volume';
  let vol = { level: 1, muted: false };
  try { const v = JSON.parse(window.localStorage.getItem(VOL_KEY) || 'null'); if (v && typeof v.level === 'number') vol = { level: Math.max(0, Math.min(1, v.level)), muted: v.muted === true }; } catch (e) { /* bỏ qua */ }
  const volListeners = new Set();
  function applyVolume() {
    try { video.volume = vol.level; } catch (e) { /* iPhone/iPad không cho web đổi âm lượng thẻ video */ }
    video.muted = vol.muted || vol.level === 0;
    embed.setVolume(vol.level * 100, vol.muted);
    volListeners.forEach((fn) => fn(Object.assign({}, vol)));
  }
  function setVolumeState(next) {
    vol = { level: Math.max(0, Math.min(1, Number(next.level))), muted: Boolean(next.muted) };
    try { window.localStorage.setItem(VOL_KEY, JSON.stringify(vol)); } catch (e) { /* bỏ qua */ }
    applyVolume();
  }
  const volume = {
    get: () => Object.assign({}, vol),
    set: (level) => setVolumeState({ level, muted: false }),   // kéo thanh âm lượng: bật tiếng luôn
    toggleMute: () => setVolumeState({ level: vol.level === 0 ? 0.5 : vol.level, muted: !(vol.muted || vol.level === 0) }),
    onChange: (fn) => { volListeners.add(fn); return () => volListeners.delete(fn); },
  };
  applyVolume();

  // Lớp giả thẻ video trỏ vào nguồn đang dùng.
  const surface = {
    get currentTime() { return mode === 'embed' ? embed.getTime() : (video.currentTime || 0); },
    set currentTime(t) { if (mode === 'embed') embed.setTime(t); else video.currentTime = t; },
    get duration() { if (mode === 'embed') { const d = embed.getDuration(); return d > 0 ? d : NaN; } return video.duration; },
    get paused() { return mode === 'embed' ? embed.isPaused() : video.paused; },
    get ended() { return mode === 'embed' ? embed.isEnded() : video.ended; },
    get playbackRate() { return mode === 'embed' ? 1 : (video.playbackRate || 1); },
    set poster(v) { video.poster = v; },
    get poster() { return video.poster; },
    addEventListener(type, fn) { if (surfaceListeners[type]) surfaceListeners[type].add(fn); },
    removeEventListener(type, fn) { if (surfaceListeners[type]) surfaceListeners[type].delete(fn); },
  };

  controller = createPlayerController({
    youtube, queue, engine,
    getTime: () => surface.currentTime,
    setTime: (t) => { try { surface.currentTime = t; } catch (e) { /* bỏ qua */ } },
    notify: (m) => showToast(m),
    onState: (s) => stateListeners.forEach((fn) => fn(s)),
  });

  surface.addEventListener('ended', () => controller.handleEnded());
  surface.addEventListener('play', () => controller.syncPlaying(true));
  surface.addEventListener('pause', () => { if (!surface.ended) controller.syncPlaying(false); });

  const playlists = createPlaylistStore({ api, hasUser });

  // Giai đoạn 11: đếm lượt nghe (nghe từ 30 giây) cho "bài bạn hay nghe" ở tab "Tất cả".
  let playStorage = null;
  try { playStorage = window.localStorage; } catch (e) { playStorage = null; }
  const playStats = createPlayStats({ api, hasUser, storage: playStorage });
  const counter = createPlayCounter({
    getCurrent: () => controller.snapshot().current,
    getTime: () => surface.currentTime,
    getDuration: () => surface.duration,
    onCount: (item) => playStats.record(item),
  });
  surface.addEventListener('timeupdate', () => counter.tick());
  // Giai đoạn 12: nhớ chế độ phát (Lần lượt / Lặp tất cả / Lặp 1 bài / Trộn bài) và Tự phát.
  const playbackPrefs = createPlaybackPrefs({ api, hasUser });
  function applyPlayback(pb) {
    controller.setAutoMix(pb.autoMix);
    controller.setRepeat(pb.repeat);
  }
  applyPlayback(playbackPrefs.loadLocal());
  let savedPb = JSON.stringify(playbackPrefs.loadLocal());
  stateListeners.add((st) => {
    const pb = { repeat: st.repeat, autoMix: st.autoMix };
    const key = JSON.stringify(pb);
    if (key !== savedPb) { savedPb = key; playbackPrefs.save(pb); }
  });
  // Đã đăng nhập: áp dụng lựa chọn lưu trên tài khoản (gọi trước khi tự phát lúc mở web).
  async function loadRemotePlayback() {
    const pb = await playbackPrefs.loadRemote();
    if (pb) { savedPb = JSON.stringify(pb); applyPlayback(pb); }
  }

  // mỗi lần điều phối bắt đầu nạp một bài (kể cả phát lại cùng bài) là một lần nghe mới; đổi nguồn giữa chừng thì không
  stateListeners.add((st) => { if (st.status === 'loading') counter.reset(); });
  const subscribe = (set) => (fn) => { set.add(fn); return () => set.delete(fn); };
  const onState = subscribe(stateListeners);

  // Cửa sổ nổi, toàn màn hình và Media Session dùng thẻ video của website (đổi bài/Mix không làm đóng cửa sổ nổi).
  // Khi đang phát bằng trình phát YouTube: không có cửa sổ nổi; toàn màn hình áp dụng cho khung trình phát YouTube.
  const pipCore = createPip({ video, doc: document, allowed: canPip, disabled: pipDisabled });
  const fullscreenCore = createFullscreen({ video, doc: document });
  const pip = {
    snapshot() {
      const s = pipCore.snapshot();
      return mode === 'embed' && !s.active ? Object.assign({}, s, { ready: false, reason: EMBED_PIP_MSG }) : s;
    },
    onChange(fn) {
      const off1 = pipCore.onChange(fn);
      const f2 = () => fn(pip.snapshot());
      modeListeners.add(f2);
      return () => { off1(); modeListeners.delete(f2); };
    },
    enter: () => (mode === 'embed' ? Promise.resolve({ ok: false, message: EMBED_PIP_MSG }) : pipCore.enter()),
    exit: () => pipCore.exit(),
    toggle: () => (mode === 'embed' ? Promise.resolve({ ok: false, message: EMBED_PIP_MSG }) : pipCore.toggle()),
    destroy: () => pipCore.destroy(),
  };
  const doc = document;
  const embedFsActive = () => doc.fullscreenElement === embedHost || doc.webkitFullscreenElement === embedHost;
  const fullscreen = {
    snapshot() {
      const s = fullscreenCore.snapshot();
      if (mode !== 'embed') return s;
      const supported = typeof embedHost.requestFullscreen === 'function' || typeof embedHost.webkitRequestFullscreen === 'function';
      return { supported, active: embedFsActive() };
    },
    onChange(fn) {
      const off1 = fullscreenCore.onChange(fn);
      const f2 = () => fn(fullscreen.snapshot());
      modeListeners.add(f2);
      doc.addEventListener('fullscreenchange', f2);
      doc.addEventListener('webkitfullscreenchange', f2);
      return () => { off1(); modeListeners.delete(f2); doc.removeEventListener('fullscreenchange', f2); doc.removeEventListener('webkitfullscreenchange', f2); };
    },
    async toggle() {
      if (mode !== 'embed') return fullscreenCore.toggle();
      try {
        if (embedFsActive()) {
          if (doc.exitFullscreen) await doc.exitFullscreen(); else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
        } else if (embedHost.requestFullscreen) await embedHost.requestFullscreen();
        else if (embedHost.webkitRequestFullscreen) embedHost.webkitRequestFullscreen();
        else return { ok: false, message: 'Trình duyệt này chưa hỗ trợ toàn màn hình.' };
        return { ok: true };
      } catch (e) {
        return { ok: false, message: 'Không mở được toàn màn hình.' };
      }
    },
    exit: () => fullscreenCore.exit(),
    destroy: () => fullscreenCore.destroy(),
  };
  const mediaSession = bindMediaSession({
    session: typeof navigator !== 'undefined' && navigator.mediaSession ? navigator.mediaSession : null,
    MetadataCtor: typeof MediaMetadata !== 'undefined' ? MediaMetadata : null,
    video: surface, controller, onState,
  });

  return {
    video, embedHost, surface, youtube, queue, controller, playlists, playStats, loadRemotePlayback, volume, pip, fullscreen,
    embedAllowed,
    mode: () => mode,
    onMode: subscribe(modeListeners),
    sound: { autoMuted: () => embed.isAutoMuted(), unmute: () => embed.unmute(), onChange: subscribe(soundListeners) },
    onQueue: subscribe(queueListeners),
    onState,
    destroy() {
      mediaSession.destroy();
      fullscreen.destroy();
      pip.destroy();   // đóng cửa sổ nổi trước khi gỡ nguồn phát
      engine.destroy();
      queueListeners.clear();
      stateListeners.clear();
      modeListeners.clear();
      soundListeners.clear();
      ['pointerdown', 'touchstart', 'keydown'].forEach((ev) => document.removeEventListener(ev, unmuteOnGesture, true));
    },
  };
}
