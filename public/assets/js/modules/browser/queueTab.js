import { h, clear } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { videoRow, emptyState } from '../youtube/videoRow.js';
import { openPlaylistPicker } from '../youtube/playlistPicker.js';
import { showToast } from '../../core/toast.js';

// Mục Hàng đợi: các bài sắp phát, bài đang phát được đánh dấu; bấm để phát; nút ⋮ để đưa lên/xuống, xóa, lưu.
export function mountQueueTab(container, { media }) {
  const { queue, controller } = media;
  const list = h('ul', { class: 'vlist' });
  const count = h('span', { class: 'hint' });
  const clearBtn = h('button', { type: 'button', class: 'pill', onclick: () => queue.clearOthers() }, icon('clearAll', 22), h('span', {}, 'Xóa các bài còn lại'));
  const mixBtn = h('button', { type: 'button', class: 'pill', onclick: () => {
    const st = controller.snapshot();
    if (st.repeat !== 'off') { showToast('Tự phát chỉ dùng được ở chế độ Lần lượt.'); return; }
    controller.setAutoMix(!st.autoMix);
  } }, icon('mix', 22), h('span', {}, 'Tự phát'));
  const saveAllBtn = h('button', { type: 'button', class: 'pill', onclick: () => { const s = queue.snapshot(); if (s.items.length) openPlaylistPicker({ store: media.playlists, items: s.items }); } }, icon('playlistAdd', 22), h('span', {}, 'Lưu cả hàng đợi'));
  const hint = h('p', { class: 'hint' });
  function drawHint() {
    const st = controller.snapshot();
    const locked = st.repeat !== 'off';
    const end = st.autoMix ? 'Phát hết thì Tự phát chọn bài tương tự để phát tiếp.' : 'Phát hết thì dừng (Tự phát đang tắt).';
    hint.textContent = st.repeat === 'one' ? 'Đang lặp 1 bài: hết bài thì phát lại bài đó. Bấm "Bài kế tiếp" vẫn chuyển bài. Tự phát tạm tắt.'
      : st.repeat === 'all' ? 'Đang lặp tất cả: hết hàng đợi thì quay lại bài đầu. Tự phát tạm tắt.'
        : st.repeat === 'shuffle' ? 'Đang trộn bài: phát ngẫu nhiên các bài trong hàng đợi, mỗi bài một lần mỗi lượt; hết lượt thì tự trộn lượt mới. Tự phát tạm tắt.'
          : `Đang phát lần lượt. ${end}`;
    mixBtn.setAttribute('aria-pressed', String(st.autoMix && !locked));
    mixBtn.setAttribute('aria-disabled', String(locked));
    mixBtn.classList.toggle('is-idle', locked);
  }

  function draw() {
    const s = queue.snapshot();
    clear(list);
    s.items.forEach((item, i) => list.append(videoRow(item, {
      current: i === s.index,
      prefix: i === s.index ? null : String(i + 1),
      onPlay: () => controller.playIndex(i),
      menu: () => [
        { icon: 'play', label: i === s.index ? 'Đang phát' : 'Phát bài này', disabled: i === s.index, onClick: () => controller.playIndex(i) },
        { icon: 'up', label: 'Đưa lên', disabled: i === 0, onClick: () => queue.move(i, i - 1) },
        { icon: 'down', label: 'Đưa xuống', disabled: i === s.items.length - 1, onClick: () => queue.move(i, i + 1) },
        { icon: 'playlistAdd', label: 'Lưu vào playlist', onClick: () => openPlaylistPicker({ store: media.playlists, items: [item] }) },
        { icon: 'trash', label: 'Xóa khỏi hàng đợi', danger: true, disabled: i === s.index, onClick: () => queue.remove(i) },
      ],
    })));
    if (!s.items.length) list.append(h('li', {}, emptyState({ iconName: 'queue', title: 'Hàng đợi đang trống', text: 'Bấm ⋮ ở một video rồi chọn "Thêm vào hàng đợi" hoặc "Phát tiếp theo".' })));
    count.textContent = s.items.length ? `${s.items.length} bài${s.index >= 0 ? ` · đang phát bài ${s.index + 1}` : ''}` : '';
    clearBtn.disabled = s.items.length <= 1;
    saveAllBtn.disabled = !s.items.length;
    drawHint();
  }

  function scrollToCurrent() {
    const cur = list.querySelector('.vrow.is-current');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }

  media.onQueue(draw);
  media.onState(drawHint);
  draw();
  container.append(
    h('header', { class: 'view-head' },
      h('div', { class: 'view-titlebar' }, h('h2', { class: 'view-title' }, 'Hàng đợi'), count),
      h('div', { class: 'chip-row' }, mixBtn, saveAllBtn, clearBtn)),
    h('div', { class: 'view-body' }, hint, list));
  return { activate: () => { draw(); setTimeout(scrollToCurrent, 0); }, refresh: draw };
}
