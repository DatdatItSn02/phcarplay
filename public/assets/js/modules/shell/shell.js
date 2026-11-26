import { h, clear } from '../../core/dom.js';
import { registerPanel, getPanel } from '../../core/panels.js';
import { createLayoutPrefs } from '../layout/layoutPrefs.js';
import { createSplitView } from '../layout/splitView.js';
import { playerPanel } from '../player/playerPanel.js';
import { createMiniBar } from '../player/miniBar.js';
import { browserPanel, VIEWS } from '../browser/browserPanel.js';
import { createMedia } from '../youtube/media.js';
import { showToast } from '../../core/toast.js';
import { createRail } from './rail.js';
import { openSettings } from '../settings/settingsDialog.js';
import { buildStartQueue } from '../youtube/startQueue.js';
import { handleMediaKey } from '../youtube/mediaKeys.js';
import { createAppLifecycle, createBackgroundPref } from '../../core/nativeApp.js';
import { createCastApi } from '../cast/castApi.js';
import { createCastScreen } from '../cast/castScreen.js';
import { createCastSender } from '../cast/castSender.js';
import { openCastSenderDialog } from '../cast/castSenderDialog.js';
import { createVoicePause } from '../browser/voicePause.js';

registerPanel(playerPanel);
registerPanel(browserPanel);

// Màn hình chính: khung trái và khung phải lấy từ sổ đăng ký panel. Đổi/thêm panel chỉ cần sửa SLOTS.
const SLOTS = { left: 'player', right: 'browser' };

function buildPanel(id, ctx) {
  const def = getPanel(id);
  const el = h('div', { class: 'panel-body' });
  const handle = def.mount(el, ctx) || {};
  return { id, title: def.title, el, handle };
}

// Khi mở web: phát video mặc định (DEFAULT_VIDEO_URL trong .env) nếu có, rồi tới playlist đã lưu gần nhất;
// không có playlist thì nhạc thịnh hành.
// Mở web: hàng đợi chỉ gồm bài hay nghe + bài trong playlist + video mặc định (cuối cùng) - xem startQueue.js.
// Hàng đợi trống: Tự phát bật thì tìm bài gợi ý (coi như đã phát hết hàng đợi); Tự phát tắt thì không phát gì.
async function autostart(media, user, defaultVideo) {
  const { playlists, controller, queue, playStats } = media;
  try { if (user) await playlists.importLocal(); } catch (e) { /* chuyển playlist của khách lên tài khoản: lỗi thì thôi */ }
  try { if (media.loadRemotePlayback) await media.loadRemotePlayback(); } catch (e) { /* dùng lựa chọn trên thiết bị */ }
  const items = await buildStartQueue({ playStats, playlists, defaultVideo });
  // Người dùng đã tự bấm phát bài khác trong lúc chờ thì không ghi đè.
  if (queue.snapshot().items.length !== 0) return;
  if (items.length) { controller.playList(items, 0, true); return; }
  if (controller.snapshot().autoMix) controller.next();
}

/**
 * Giai đoạn 13: nối khung ứng dụng với ứng dụng điện thoại (core/nativeApp.js). Không ở trong ứng dụng thì không làm gì.
 * - Quay lại (Android): thoát "Chỉ video"/"Chỉ danh sách" -> về Trang chủ -> để ứng dụng xử lý (hộp thoại đã được đóng trước đó).
 * - Phím nhạc (vô lăng, tai nghe), ra nền thì dừng / hiện lại thì phát tiếp, báo bài đang phát cho ứng dụng.
 * - Tìm bằng giọng nói của máy (dừng nhạc lúc nghe, tìm xong phát tiếp: voicePause.js trong mountShell).
 * Trả về { voice, background, isHidden, bindBack({ split, browse, select, cast }), destroy }.
 */
function connectApp(nativeApp, media) {
  if (!nativeApp || !nativeApp.inApp) return { voice: null, background: null, isHidden: () => false, bindBack() {}, destroy() {} };
  const { controller, surface } = media;
  const offs = [];
  offs.push(nativeApp.onMediaKey((key) => handleMediaKey(key, { controller, surface })));

  // Giai đoạn 15: phát trong nền (ứng dụng từ bản 1.1.0). Trình phát nhúng của YouTube không được phát ở nền.
  const bgPref = createBackgroundPref();
  const bgSupported = typeof nativeApp.supportsBackground === 'function' && nativeApp.supportsBackground();
  const bgOn = () => bgSupported && bgPref.get();
  const tellApp = () => { if (bgSupported) nativeApp.setBackground(bgPref.get()); };
  tellApp();
  const background = {
    supported: bgSupported,
    get: () => bgPref.get(),
    set(v) { bgPref.set(v); tellApp(); },
  };

  const life = createAppLifecycle({ controller, surface, keepPlaying: () => bgOn() && !(media.mode && media.mode() === 'embed') });
  const tick = () => life.tick();
  ['timeupdate', 'play', 'pause'].forEach((ev) => surface.addEventListener(ev, tick));
  offs.push(() => ['timeupdate', 'play', 'pause'].forEach((ev) => surface.removeEventListener(ev, tick)));
  offs.push(nativeApp.onLifecycle((st) => life.set(st)));
  const onVis = () => { life.set(document.visibilityState === 'hidden' ? 'hidden' : 'visible'); };
  document.addEventListener('visibilitychange', onVis);
  offs.push(() => document.removeEventListener('visibilitychange', onVis));

  const report = (force) => {
    tick();
    life.check();
    const s = controller.snapshot();
    const cur = s.current;
    nativeApp.reportState({ playing: s.status === 'playing', title: cur ? cur.title : '', artist: cur ? cur.uploader : '',
      duration: surface.duration, position: surface.currentTime }, force === true);
  };
  offs.push(media.onState(() => report(false)));
  const onSeek = () => report(true);
  surface.addEventListener('durationchange', onSeek);
  surface.addEventListener('seeked', onSeek);
  offs.push(() => { surface.removeEventListener('durationchange', onSeek); surface.removeEventListener('seeked', onSeek); });

  // Giai đoạn 17: dừng nhạc lúc nghe / phát lại sau khi tìm xong do voicePause.js lo (chung với micro của trình duyệt).
  const voice = nativeApp.canVoice() ? { listen: (cb) => nativeApp.listen(cb || {}) } : null;
  return {
    voice,
    background,
    isHidden: () => life.isHidden(),
    bindBack({ split, browse, select, cast }) {
      offs.push(nativeApp.onBack(() => {
        if (cast && cast.leaveFull()) return true;   // đang "Toàn màn hình" (chiếu điện thoại): trở lại chia đôi
        if (split.controller.snapshot().focus) { split.controller.setFocus(null); return true; }
        if (browse.current() !== 'home') { select('home'); return true; }
        return false;
      }));
    },
    destroy() { offs.forEach((off) => { try { off(); } catch (e) { /* bỏ qua */ } }); },
  };
}

const controllerOf = (media) => media.controller;
const surfaceOf = (media) => media.surface || media.video;

const PHONE_QUERY = '(max-width: 599px)';
const TYPING_RESTORE_MS = 150;

function createTypingMode(split) {
  const doc = document.documentElement;
  let active = false;
  let prevFocus = null;
  let timer = 0;
  const isSearch = (el) => Boolean(el && el.classList && el.classList.contains('search-input'));
  const isPhone = () => Boolean(window.matchMedia && window.matchMedia(PHONE_QUERY).matches)
    && split.controller.snapshot().orientation !== 'horizontal';
  function enter() {
    clearTimeout(timer);
    if (active || !isPhone()) return;
    active = true;
    prevFocus = split.controller.snapshot().focus || null;
    doc.setAttribute('data-typing', '');
    if (prevFocus !== 'right') split.controller.setFocus('right');
  }
  function leave() {
    if (!active) return;
    active = false;
    doc.removeAttribute('data-typing');
    if (split.controller.snapshot().focus === 'right' && prevFocus !== 'right') split.controller.setFocus(prevFocus);
  }
  const onIn = (e) => { if (isSearch(e.target)) enter(); };
  // Chờ một chút: bấm vào gợi ý cũng làm ô tìm kiếm mất tiêu điểm, đừng để giao diện nhảy trước khi bấm xong.
  const onOut = (e) => {
    if (!isSearch(e.target)) return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (!isSearch(document.activeElement)) leave(); }, TYPING_RESTORE_MS);
  };
  document.addEventListener('focusin', onIn);
  document.addEventListener('focusout', onOut);
  return {
    destroy() {
      clearTimeout(timer);
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
      doc.removeAttribute('data-typing');
    },
  };
}

/**
 * Khung ứng dụng: thanh điều hướng phía tài xế + hai khung (trình phát | danh sách) + thanh phát nhỏ.
 * Trả về hàm dọn dẹp: dừng phát và gỡ các bộ theo dõi khi màn hình bị dựng lại (đăng nhập, đăng xuất).
 */
export function mountShell(root, { appName, session, api, appearance, homeChips, hlsJs, youtubeEmbed = null, nativeApp = null, onLogin, onLogout }) {
  clear(root);
  const user = session.user;
  const features = session.features || [];
  const inApp = Boolean(nativeApp && nativeApp.inApp);
  const media = createMedia({ api, hasUser: () => Boolean(user), canPip: features.indexOf('pip') >= 0, pipDisabled: inApp, hlsJs, youtubeEmbed });
  const prefs = createLayoutPrefs({ api, hasUser: () => Boolean(user) });
  const canLayout = features.indexOf('layout') >= 0;

  // Khung trình phát cần biết/đổi chế độ "Chỉ video": cung cấp qua ctx.layout (khung chia được tạo ngay sau).
  let split = null;
  const layoutListeners = [];
  const layout = {
    focus: () => (split ? split.controller.snapshot().focus : null),
    setFocus: (side) => { if (split) split.controller.setFocus(side); },
    onChange: (fn) => { layoutListeners.push(fn); },
  };
  const openSettingsDlg = (opts = {}) => openSettings(Object.assign({ session, api, appearance, split, canLayout, onLogin, onLogout, playStats: media.playStats, background: app.background, cast: castPhone, onPlaysCleared: () => { if (browse && browse.refreshHome) browse.refreshHome(); } }, opts));
  // Dòng nhắc thêm khóa YouTube ở mục Tìm kiếm: người đã đăng nhập mở thẳng mục khóa trong Cài đặt, khách thì đăng nhập trước.
  const keyHint = {
    isUser: Boolean(session && session.user),
    openKeySettings: () => (session && session.user ? openSettingsDlg({ focusKey: true }) : onLogin()),
  };
  const app = connectApp(nativeApp, media);
  // Giai đoạn 17: tìm bằng giọng nói thì tạm dừng nhạc, tìm xong phát tiếp.
  const voicePause = createVoicePause({ controller: media.controller, onState: media.onState, canResume: () => !app.isHidden() });
  const ctx = { api, session, media, appearance, homeChips, layout, keyHint, voice: app.voice, voicePause };

  const left = buildPanel(SLOTS.left, ctx);
  const right = buildPanel(SLOTS.right, ctx);
  split = createSplitView({
    left, right,
    layout: prefs.loadLocal(),
    draggable: canLayout,
    onCommit: (l) => prefs.save(l),
  });
  // Đã đăng nhập: lấy tỉ lệ đã lưu trên tài khoản (có thể do thiết bị khác đặt) rồi áp dụng.
  prefs.loadRemote().then((l) => { if (l) split.applyLayout(l); });

  const browse = right.handle;
  const miniBar = createMiniBar({ media, onExpand: () => split.controller.setFocus(null) });

  function select(id) {
    if (split.controller.snapshot().focus === 'left') split.controller.setFocus(null);   // đang "Chỉ video" thì hiện lại danh sách
    browse.show(id, id === 'search' ? { focus: true } : {});
  }

  // ----- Giai đoạn 15 (đợt 2): chiếu màn hình điện thoại -----
  // Màn hình này NHẬN hình (máy nào cũng được): nút "Chiếu ĐT" -> hộp mã 6 số -> khi điện thoại nối xong thì CHIA HẲN màn hình
  // làm 2 bên: bản đồ chiếm trọn một bên (phía tài xế), cả ứng dụng nghe nhạc dồn sang bên kia và thu gọn thành
  // danh sách + thanh phát nhỏ (bấm thanh nhỏ để hiện lại video).
  // Giai đoạn 17: "Toàn màn hình" -> html[data-cast-full] ẩn cả .app, nhạc thành cửa sổ nổi trong khung chiếu (castFloat.js).
  const castApi = createCastApi(api);
  const doc = document.documentElement;
  let castOn = false;
  let focusBeforeCast = null;
  const cast = createCastScreen({
    castApi,
    media,
    onLayout: (l) => {
      if (l.active) {
        doc.setAttribute('data-cast', l.stacked ? 'stacked' : 'side');
        doc.setAttribute('data-cast-side', l.side);
        if (l.full) doc.setAttribute('data-cast-full', ''); else doc.removeAttribute('data-cast-full');
      } else {
        doc.removeAttribute('data-cast');
        doc.removeAttribute('data-cast-side');
        doc.removeAttribute('data-cast-full');
      }
      if (l.active === castOn) return;
      castOn = l.active;
      rail.setCasting(castOn);
      if (castOn) {
        focusBeforeCast = split.controller.snapshot().focus || null;
        if (focusBeforeCast !== 'right') split.controller.setFocus('right');
      } else if (split.controller.snapshot().focus === 'right' && focusBeforeCast !== 'right') {
        split.controller.setFocus(focusBeforeCast);
      }
    },
  });
  // Điện thoại PHÁT hình: chỉ trong ứng dụng Android từ bản 1.2.0 (mở từ Cài đặt > "Chiếu lên màn hình xe").
  let castPhone = null;
  let castSender = null;
  if (nativeApp && typeof nativeApp.supportsCast === 'function' && nativeApp.supportsCast()) {
    const watchers = new Set();
    castSender = createCastSender({
      castApi,
      nativeApp,
      onChange: (st) => watchers.forEach((fn) => { try { fn(st); } catch (e) { /* bỏ qua */ } }),
      // Điện thoại đang chiếu bản đồ thì không tự phát nhạc nữa (nhạc phát ở màn hình xe).
      onBeforeLive: () => { if (controllerOf(media).snapshot().current && !surfaceOf(media).paused) { const p = controllerOf(media).toggle(); if (p && p.catch) p.catch(() => {}); } },
    });
    castPhone = {
      isActive: () => castSender.isActive(),
      open: () => openCastSenderDialog({ sender: castSender, subscribe: (fn) => { watchers.add(fn); return () => watchers.delete(fn); } }),
    };
  }

  const rail = createRail({
    items: VIEWS,
    onSelect: select,
    appearance,
    user,
    onSettings: () => openSettingsDlg(),
    onCast: () => { if (!cast.open() && cast.isLive()) showToast('Đang chiếu. Bấm "Dừng chiếu" ở khung bản đồ để dừng.'); },
  });
  browse.onChange((id) => rail.setActive(id));
  rail.setActive(browse.current());
  app.bindBack({ split, browse, select, cast });

  let lastFocus = '';
  const offSplit = split.onChange((s) => {
    const f = s.focus || '';
    miniBar.setVisible(f === 'right');
    if (f === 'right') document.documentElement.setAttribute('data-minibar', ''); else document.documentElement.removeAttribute('data-minibar');
    if (f !== lastFocus) { lastFocus = f; layoutListeners.slice().forEach((fn) => fn(f)); }
  });

  // Giai đoạn 14: điện thoại dọc, bấm vào ô tìm kiếm (bàn phím ảo hiện lên) -> tạm chuyển sang "chỉ danh sách" + thanh phát
  // nhỏ, ẩn thanh mục dưới cùng, để ô tìm kiếm và gợi ý không đè lên video/nút. Rời ô (đóng bàn phím, bấm Tìm) thì trở lại.
  const typing = createTypingMode(split);

  // .screen = [khung chiếu điện thoại (chỉ hiện khi đang chiếu, chiếm hẳn một bên màn hình)] + [.app: toàn bộ ứng dụng nghe nhạc]
  root.append(
    h('div', { class: 'screen' },
      cast.el,
      h('div', { class: 'app' },
        rail.el,
        h('main', { id: 'workspace', class: 'workspace', 'aria-label': appName },
          h('div', { class: 'work-music' }, split.el, miniBar.el)))));

  autostart(media, user, youtubeEmbed && youtubeEmbed.defaultVideo ? youtubeEmbed.defaultVideo : null);
  return () => {
    voicePause.destroy();
    app.destroy();
    cast.destroy();
    if (castSender) castSender.destroy();
    ['data-cast', 'data-cast-side', 'data-cast-full'].forEach((a) => doc.removeAttribute(a));
    typing.destroy();
    offSplit();
    rail.destroy();
    if (browse.destroy) browse.destroy();
    if (left.handle.destroy) left.handle.destroy();
    split.destroy();
    media.destroy();
    document.documentElement.removeAttribute('data-minibar');
  };
}
