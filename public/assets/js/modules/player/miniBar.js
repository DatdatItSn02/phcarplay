import { h, clear } from '../../core/dom.js';
import { icon } from '../../core/icons.js';

/**
 * Thanh phát nhỏ ở dưới khung danh sách (khi chọn "Chỉ danh sách"), giống thanh phát của YouTube Music:
 * luôn thấy bài đang phát và bấm được phát/dừng, bài trước/sau. Bấm vào tên bài để hiện lại trình phát.
 */
export function createMiniBar({ media, onExpand }) {
  const { controller } = media;
  const video = media.surface || media.video;   // thẻ video hoặc trình phát YouTube
  const fill = h('div', { class: 'minibar-fill' });
  const thumb = h('span', { class: 'minibar-thumb' });
  const title = h('span', { class: 'minibar-title' });
  const sub = h('span', { class: 'minibar-sub' });
  const main = h('button', { type: 'button', class: 'minibar-main', onclick: () => onExpand() }, thumb, h('span', { class: 'minibar-text' }, title, sub));
  const playBtn = h('button', { type: 'button', class: 'ctl ctl-main', onclick: () => controller.toggle() });
  const prevBtn = h('button', { type: 'button', class: 'ctl', 'aria-label': 'Bài trước', onclick: () => controller.prev() }, icon('prev', 26));
  const nextBtn = h('button', { type: 'button', class: 'ctl', 'aria-label': 'Bài kế tiếp', onclick: () => controller.next() }, icon('next', 26));
  const expandBtn = h('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Hiện lại trình phát', title: 'Hiện lại trình phát', onclick: () => onExpand() }, icon('expand', 22));
  const el = h('div', { class: 'minibar', role: 'region', 'aria-label': 'Đang phát', hidden: true },
    h('div', { class: 'minibar-progress', 'aria-hidden': 'true' }, fill), main, prevBtn, playBtn, nextBtn, expandBtn);

  let lastThumb = null;
  function render(s) {
    const cur = s.current;
    title.textContent = cur ? cur.title : 'Chưa có bài nào';
    sub.textContent = cur ? (cur.uploader || '') : 'Chọn một video để phát';
    main.setAttribute('aria-label', cur ? `Mở trình phát: ${cur.title}` : 'Mở trình phát');
    const src = cur && cur.thumbnail ? cur.thumbnail : null;
    if (src !== lastThumb) {
      lastThumb = src;
      clear(thumb);
      if (src) thumb.append(h('img', { src, alt: '', referrerpolicy: 'no-referrer' }));
    }
    const playing = s.status === 'playing';
    clear(playBtn);
    playBtn.append(icon(playing ? 'pause' : 'play', 32));
    playBtn.setAttribute('aria-label', playing ? 'Tạm dừng' : 'Phát');
    prevBtn.disabled = !cur;
    nextBtn.disabled = !cur;
  }
  const progress = () => {
    const d = video.duration;
    fill.style.width = Number.isFinite(d) && d > 0 ? `${Math.min(100, (video.currentTime / d) * 100)}%` : '0%';
  };
  video.addEventListener('timeupdate', progress);
  video.addEventListener('emptied', progress);
  media.onState(render);
  render(controller.snapshot());

  return {
    el,
    setVisible(on) {
      el.hidden = !on;
      if (on) { render(controller.snapshot()); progress(); }
    },
  };
}
