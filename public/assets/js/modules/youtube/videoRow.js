import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { openActionSheet } from '../../core/dialog.js';
import { formatAgo, formatDuration, formatViews } from '../../core/format.js';

function thumbBox(item, current = false) {
  const img = item.thumbnail ? h('img', { src: item.thumbnail, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }) : null;
  if (img) img.addEventListener('error', () => { img.hidden = true; });   // ảnh lỗi: để lại nền xám
  return h('span', { class: 'vthumb' },
    img,
    current ? h('span', { class: 'vnow' }, icon('equalizer', 30)) : null,
    item.duration ? h('span', { class: 'vdur' }, formatDuration(item.duration)) : null);
}

/** Phần đầu của bảng thao tác: ảnh và tên bài, để người dùng chắc mình đang chọn đúng bài. */
export function videoInfo(item) {
  return h('div', { class: 'sheet-info' },
    thumbBox(item),
    h('div', { class: 'sheet-info-text' }, h('strong', {}, item.title), h('span', {}, item.uploader || '')));
}

/**
 * Một dòng video kiểu YouTube: bấm vào cả dòng để phát; nút ⋮ mở bảng thao tác lớn (dễ bấm trên xe).
 * opts: { onPlay, current, prefix, menu: () => [{ icon, label, onClick, danger, disabled }] }
 */
export function videoRow(item, { onPlay, current = false, prefix = null, menu = null } = {}) {
  // Bài bạn hay nghe (tab "Tất cả"): dòng "Bạn hay nghe" thay cho lượt xem (không ghi số lần nghe).
  const line2 = item.frequent ? 'Bạn hay nghe' : [formatViews(item.views), formatAgo(item.uploaded_at)].filter(Boolean).join(' · ');
  const main = h('button', { type: 'button', class: 'vmain', onclick: onPlay, 'aria-label': `${current ? 'Đang phát' : 'Phát'}: ${item.title}` },
    prefix ? h('span', { class: 'vprefix' }, prefix) : null,
    thumbBox(item, current),
    h('span', { class: 'vmeta' },
      h('span', { class: 'vtitle' }, item.title),
      h('span', { class: 'vsub' }, current ? h('span', { class: 'vtag' }, 'Đang phát · ') : null, item.uploader || ''),
      line2 ? h('span', { class: item.frequent ? 'vsub vfreq' : 'vsub' }, line2) : null));
  const more = menu
    ? h('button', { type: 'button', class: 'btn-icon vmore', 'aria-label': `Tùy chọn: ${item.title}`, 'aria-haspopup': 'dialog', title: 'Tùy chọn',
        onclick: () => openActionSheet({ title: 'Tùy chọn', info: videoInfo(item), actions: menu() }) }, icon('more'))
    : null;
  // data-frequent: bài hay nghe ở tab "Tất cả" (hiện giống bài khác, chỉ dùng cho menu "Ẩn" và kiểm thử)
  return h('li', { class: `vrow${current ? ' is-current' : ''}`, 'data-id': item.id, 'data-frequent': item.frequent ? '1' : null }, main, more);
}

/** Các dòng xám nhấp nháy trong lúc chờ tải (giống YouTube). */
export function skeletonRows(n = 6) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push(h('li', { class: 'skel-row', 'aria-hidden': 'true' },
      h('span', { class: 'skel skel-thumb' }),
      h('span', { class: 'skel-lines' }, h('span', { class: 'skel skel-line' }), h('span', { class: 'skel skel-line short' }))));
  }
  return rows;
}

/** Ô trống hoặc báo lỗi có biểu tượng và nút hành động. */
export function emptyState({ iconName = 'music', title, text = '', action = null }) {
  return h('div', { class: 'empty', role: 'status' },
    icon(iconName, 48),
    title ? h('p', { class: 'empty-title' }, title) : null,
    text ? h('p', {}, text) : null,
    action ? h('button', { type: 'button', class: 'btn btn-primary', onclick: action.onClick }, action.icon ? icon(action.icon) : null, action.label) : null);
}
