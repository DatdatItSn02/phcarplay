// Giai đoạn 17: CỬA SỔ NHẠC NỔI trên khung chiếu khi màn hình xe ở chế độ "Toàn màn hình" (giống cửa sổ nhỏ của YouTube).
//  - Thẻ: hình (tên bài + kênh hiện đè ở mép dưới hình, nút "Chia đôi" và "Thu nhỏ" ở hai góc trên), thanh tiến độ, ⏮ ⏯ ⏭.
//    "Chia đôi" trở lại chia đôi màn hình; "Thu nhỏ" thành bong bóng tròn, bấm bong bóng để mở lại. Thẻ <video> của website được CHUYỂN vào cửa sổ (không tải lại, nhạc không ngắt) và trả về
//    trình phát khi đóng. Đang phát bằng trình phát YouTube nhúng thì hiện ảnh bìa: khung YouTube mà chuyển chỗ sẽ tải lại từ đầu.
//  - Kéo đi đâu cũng được (không ra ngoài khung chiếu), thả ra thì tự dính vào góc gần nhất. Nhớ góc + thu nhỏ (carweb_cast_float).
//  - Cỡ theo khung: rộng tối đa ~1/3 khung, cả thẻ không cao quá ~45% khung; màn hình thấp (800x480) thì bỏ phần hình,
//    tên bài + 2 nút xếp thành một hàng phía trên ⏮ ⏯ ⏭ (fit()).
// castScreen.js đặt el trong khung chiếu và gọi show() / hide().
import { h, clear } from '../../core/dom.js';
import { icon } from '../../core/icons.js';

const PREF_KEY = 'carweb_cast_float';
const CORNERS = ['tl', 'tr', 'bl', 'br'];
const DRAG_PX = 8;   // dịch ít hơn chừng này là bấm, không phải kéo

/** Góc gần nhất với tâm (cx, cy) của cửa sổ, trong khung rộng w, cao hh: 'tl' | 'tr' | 'bl' | 'br'. */
export function nearestCorner(cx, cy, w, hh) {
  return (cy < hh / 2 ? 't' : 'b') + (cx < w / 2 ? 'l' : 'r');
}

/** Đọc lựa chọn đã lưu (chuỗi JSON). Sai hoặc chưa có thì dùng mặc định: góc dưới bên phải, không thu nhỏ. */
export function parseFloatPrefs(raw) {
  const d = { corner: 'br', min: false };
  try {
    const o = JSON.parse(raw || 'null');
    if (o && typeof o === 'object') {
      if (CORNERS.indexOf(o.corner) >= 0) d.corner = o.corner;
      d.min = o.min === true;
    }
  } catch (e) { /* dùng mặc định */ }
  return d;
}

/**
 * Bề rộng thẻ (px) cho khung rộng aw, cao ah: tối đa 32% bề rộng và 22rem; hình 16:9 + phần dưới hình (below px)
 * không cao quá 45% khung. Hình mà hẹp hơn 13rem thì bỏ hình (compact), thẻ chỉ còn tên bài + nút.
 */
export function floatSize(aw, ah, below, rem) {
  const max = Math.min(aw * 0.32, 22 * rem);
  const byHeight = (ah * 0.45 - below) * 16 / 9;
  if (byHeight < 13 * rem) return { width: Math.round(Math.max(14 * rem, Math.min(max, 20 * rem))), compact: true };
  return { width: Math.round(Math.max(13 * rem, Math.min(max, byHeight))), compact: false };
}

/** Độ dịch khi kéo, giữ cửa sổ (hình chữ nhật r) nằm trong khung a. */
export function clampDrag(dx, dy, r, a) {
  const lim = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  return { dx: lim(dx, a.left - r.left, a.right - r.right), dy: lim(dy, a.top - r.top, a.bottom - r.bottom) };
}

export function createCastFloat({ media, onSplit }) {
  const { controller } = media;
  const surface = media.surface || media.video;   // thời gian/sự kiện của nguồn đang phát (thẻ video hoặc trình phát YouTube)
  const video = media.video || null;               // thẻ <video> thật của website
  let prefs = parseFloatPrefs(null);
  try { prefs = parseFloatPrefs(window.localStorage.getItem(PREF_KEY)); } catch (e) { /* không đọc được: dùng mặc định */ }
  const save = () => { try { window.localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* không lưu được */ } };

  const art = h('img', { class: 'cast-float-art', alt: '', draggable: 'false', referrerpolicy: 'no-referrer', hidden: true });
  const noArt = h('span', { class: 'cast-float-noart', 'aria-hidden': 'true' }, icon('music', 40));
  const splitBtn = h('button', { type: 'button', class: 'cast-float-btn cast-float-split', 'aria-label': 'Chia đôi', title: 'Chia đôi màn hình', onclick: () => onSplit() }, icon('splitScreen', 22));
  const minBtn = h('button', { type: 'button', class: 'cast-float-btn cast-float-min', 'aria-label': 'Thu nhỏ', title: 'Thu nhỏ', onclick: () => setMin(true) }, icon('down', 28));
  const title = h('span', { class: 'cast-float-title' });
  const sub = h('span', { class: 'cast-float-sub' });
  const info = h('div', { class: 'cast-float-info' }, title, sub);
  const box = h('div', { class: 'cast-float-media' }, noArt, art, info, splitBtn, minBtn);
  const head = h('div', { class: 'cast-float-head', hidden: true });   // chỉ dùng khi bỏ phần hình (màn hình thấp)
  const fill = h('div', { class: 'cast-float-fill' });
  const prevBtn = h('button', { type: 'button', class: 'ctl', 'aria-label': 'Bài trước', onclick: () => controller.prev() }, icon('prev', 26));
  const playBtn = h('button', { type: 'button', class: 'ctl ctl-main', onclick: () => controller.toggle() });
  const nextBtn = h('button', { type: 'button', class: 'ctl', 'aria-label': 'Bài kế tiếp', onclick: () => controller.next() }, icon('next', 26));
  const card = h('div', { class: 'cast-float-card' },
    box,
    h('div', { class: 'cast-float-progress', 'aria-hidden': 'true' }, fill),
    head,
    h('div', { class: 'cast-float-ctl' }, prevBtn, playBtn, nextBtn));
  const bubbleArt = h('img', { alt: '', draggable: 'false', referrerpolicy: 'no-referrer', hidden: true });
  const bubbleNote = icon('music', 30);
  const badge = h('span', { class: 'cast-float-badge', 'aria-hidden': 'true' });
  let dragged = false;   // lần chạm vừa rồi là kéo (đừng coi là bấm)
  const bubble = h('button', { type: 'button', class: 'cast-float-bubble', hidden: true, onclick: () => { if (dragged) { dragged = false; return; } setMin(false); } }, bubbleNote, bubbleArt, badge);
  const el = h('div', { class: 'cast-float', role: 'region', 'aria-label': 'Nhạc đang phát', hidden: true }, card, bubble);
  el.dataset.corner = prefs.corner;

  // ----- nội dung -----
  let lastArt = null;
  function render(s) {
    const cur = s.current;
    title.textContent = cur ? cur.title : 'Chưa có bài nào';
    sub.textContent = cur ? (cur.uploader || '') : 'Bấm "Chia đôi" để chọn bài';
    const src = cur && cur.thumbnail ? cur.thumbnail : '';
    if (src !== lastArt) {
      lastArt = src;
      [art, bubbleArt].forEach((img) => {
        if (src) img.setAttribute('src', src); else img.removeAttribute('src');
        img.hidden = !src;
      });
      noArt.hidden = Boolean(src);
      bubbleNote.style.display = src ? 'none' : '';
    }
    const playing = s.status === 'playing';
    clear(playBtn);
    playBtn.append(icon(playing ? 'pause' : 'play', 32));
    playBtn.setAttribute('aria-label', playing ? 'Tạm dừng' : 'Phát');
    prevBtn.disabled = !cur;
    nextBtn.disabled = !cur;
    clear(badge);
    badge.append(icon(playing ? 'equalizer' : 'pause', 16));
    bubble.setAttribute('aria-label', cur ? `Mở cửa sổ nhạc: ${cur.title}` : 'Mở cửa sổ nhạc');
    bubble.title = cur ? cur.title : 'Mở cửa sổ nhạc';
    paintKind();
  }
  // Có hình video thật để xem (thẻ video đang ở đây, không phát bằng YouTube nhúng, bài có hình) thì giấu ảnh bìa.
  function paintKind() {
    const own = Boolean(video && video.parentNode === box);
    const isVideo = own && !(media.mode && media.mode() === 'embed') && video.videoWidth > 0;
    el.dataset.kind = isVideo ? 'video' : 'art';
  }
  const progress = () => {
    if (el.hidden) return;
    const d = surface.duration;
    fill.style.width = Number.isFinite(d) && d > 0 ? `${Math.min(100, (surface.currentTime / d) * 100)}%` : '0%';
  };

  // ----- chuyển thẻ video vào/ra (cùng một thẻ nên không tải lại) -----
  let home = null;   // { parent, next }: chỗ của thẻ video trong trình phát
  const resume = () => { try { const p = video.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* bỏ qua */ } };
  function adopt() {
    if (!video || home || !video.parentNode) return;
    if (document.pictureInPictureElement && document.pictureInPictureElement === video) return;   // đang nổi ngoài trình duyệt: để yên
    home = { parent: video.parentNode, next: video.nextSibling };
    const wasPlaying = !video.paused;
    box.insertBefore(video, box.firstChild);
    if (wasPlaying && video.paused) resume();   // trình duyệt cũ dừng video khi chuyển chỗ
  }
  function release() {
    const hm = home;
    home = null;
    if (!hm || !video || video.parentNode !== box) return;
    const wasPlaying = !video.paused;
    if (hm.next && hm.next.parentNode === hm.parent) hm.parent.insertBefore(video, hm.next);
    else hm.parent.insertBefore(video, hm.parent.firstChild);
    if (wasPlaying && video.paused) resume();
  }

  // ----- cỡ theo khung chiếu -----
  function fit() {
    if (el.hidden || !el.parentElement) return;
    if (prefs.min) { el.style.width = ''; return; }
    const a = el.parentElement.getBoundingClientRect();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    // phần dưới hình: thanh tiến độ + hàng nút ⏮ ⏯ ⏭ (tên bài nằm đè lên hình nên không tính)
    const below = card.offsetHeight - (box.hidden ? 0 : box.offsetHeight) - (head.hidden ? 0 : head.offsetHeight);
    const f = floatSize(a.width, a.height, below, rem);
    el.style.width = `${f.width}px`;
    box.hidden = f.compact;
    head.hidden = !f.compact;
    if (f.compact) el.setAttribute('data-compact', ''); else el.removeAttribute('data-compact');
    // không có phần hình: tên bài và hai nút "Chia đôi", "Thu nhỏ" xếp thành một hàng
    if (f.compact) { if (info.parentNode !== head) head.append(info, splitBtn, minBtn); }
    else if (info.parentNode !== box) box.append(info, splitBtn, minBtn);
  }

  // ----- thu nhỏ thành bong bóng -----
  function paintMin() {
    card.hidden = prefs.min;
    bubble.hidden = !prefs.min;
    if (prefs.min) el.setAttribute('data-min', ''); else el.removeAttribute('data-min');
    fit();
  }
  function setMin(on) {
    if (prefs.min === on) return;
    prefs.min = on;
    save();
    paintMin();
    try { (on ? bubble : minBtn).focus({ preventScroll: true }); } catch (e) { /* bỏ qua */ }
  }
  paintMin();

  // ----- kéo + dính vào góc gần nhất -----
  let drag = null;
  const reduced = () => Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // Đổi sang góc mới rồi trượt từ chỗ vừa thả về góc đó.
  function snap() {
    const before = el.getBoundingClientRect();
    el.style.transform = '';
    el.dataset.corner = prefs.corner;
    const after = el.getBoundingClientRect();
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    if ((!dx && !dy) || reduced()) return;
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    void el.offsetWidth;   // để trình duyệt ghi nhận chỗ bắt đầu trước khi trượt
    el.style.transition = '';
    el.style.transform = '';
  }
  // Kéo được bằng mọi chỗ trên thẻ trừ các nút; khi thu nhỏ thì kéo chính bong bóng.
  const handleOf = (t) => Boolean(t && t.closest && (t.closest('.cast-float-bubble') || !t.closest('button')));
  function onMove(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dx) < DRAG_PX && Math.abs(dy) < DRAG_PX) return;
      drag.on = true;
      dragged = true;
      el.setAttribute('data-dragging', '');
    }
    if (ev.cancelable) ev.preventDefault();
    const c = clampDrag(dx, dy, drag.r, drag.a);
    drag.dx = c.dx;
    drag.dy = c.dy;
    el.style.transform = `translate(${c.dx}px, ${c.dy}px)`;
  }
  function onUp(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    el.removeAttribute('data-dragging');
    if (!d.on) return;
    const cx = d.r.left + d.dx + d.r.width / 2 - d.a.left;
    const cy = d.r.top + d.dy + d.r.height / 2 - d.a.top;
    prefs.corner = nearestCorner(cx, cy, d.a.width, d.a.height);
    save();
    snap();
  }
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();   // không kéo bản đồ ở dưới
    dragged = false;
    if ((e.button !== undefined && e.button > 0) || drag || !handleOf(e.target) || !el.parentElement) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, a: el.parentElement.getBoundingClientRect(), r: el.getBoundingClientRect(), dx: 0, dy: 0, on: false };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });

  const offState = media.onState(render);
  const offMode = media.onMode ? media.onMode(paintKind) : null;
  ['timeupdate', 'emptied', 'durationchange'].forEach((ev) => surface.addEventListener(ev, progress));
  if (video) ['loadedmetadata', 'emptied', 'resize'].forEach((ev) => video.addEventListener(ev, paintKind));
  render(controller.snapshot());

  function hide() {
    if (drag) onUp({ pointerId: drag.id });
    release();
    el.hidden = true;
  }
  return {
    el,
    isShown: () => !el.hidden,
    show() {
      if (el.hidden) {
        el.hidden = false;
        el.dataset.corner = prefs.corner;
        adopt();
        render(controller.snapshot());
        progress();
      }
      fit();
    },
    hide,
    /** Khung chiếu đổi cỡ (xoay màn hình, đổi cỡ chữ): tính lại cỡ thẻ. */
    fit,
    destroy() {
      hide();
      if (offState) offState();
      if (offMode) offMode();
      ['timeupdate', 'emptied', 'durationchange'].forEach((ev) => surface.removeEventListener(ev, progress));
      if (video) ['loadedmetadata', 'emptied', 'resize'].forEach((ev) => video.removeEventListener(ev, paintKind));
    },
  };
}
