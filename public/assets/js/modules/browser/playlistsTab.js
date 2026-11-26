import { h, clear } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { openDialog, openActionSheet, confirmAction } from '../../core/dialog.js';
import { showToast } from '../../core/toast.js';
import { videoRow, skeletonRows, emptyState } from '../youtube/videoRow.js';
import { videoMenu } from '../youtube/videoActions.js';

// Mục Playlist: danh sách playlist (tạo, phát, đổi tên, xóa) và chi tiết một playlist (phát, sắp xếp, xóa bài).
export function mountPlaylistsTab(container, { media }) {
  const { playlists: store, controller } = media;
  const root = h('div', { class: 'view-inner' });
  container.append(root);
  let view = { mode: 'list', id: null };

  const fail = (e) => showToast((e && e.message) || 'Có lỗi xảy ra. Vui lòng thử lại.');

  function openRename(p, done) {
    openDialog({
      title: 'Đổi tên playlist',
      content: (close) => {
        const input = h('input', { class: 'input', type: 'text', maxlength: '100', value: p.name, 'aria-label': 'Tên playlist', enterkeyhint: 'done' });
        const err = h('p', { class: 'form-error', role: 'alert' });
        return h('form', { class: 'form', onsubmit: async (e) => {
          e.preventDefault();
          try { await store.rename(p.id, input.value); close(); showToast('Đã đổi tên playlist.'); done(); } catch (x) { err.textContent = (x && x.message) || 'Không đổi được tên.'; }
        } }, input, err, h('div', { class: 'dialog-actions' },
          h('button', { type: 'button', class: 'btn btn-ghost', onclick: close }, 'Hủy'),
          h('button', { type: 'submit', class: 'btn btn-primary' }, 'Lưu')));
      },
    });
  }

  async function askDelete(p, done) {
    const ok = await confirmAction({ title: 'Xóa playlist?', message: `Xóa playlist "${p.name}" và các bài trong đó. Không thể hoàn tác.`, confirmLabel: 'Xóa playlist', danger: true });
    if (!ok) return;
    try { await store.remove(p.id); showToast('Đã xóa playlist.'); done(); } catch (err) { fail(err); }
  }

  async function playAll(p, startAt = 0) {
    try { const full = await store.get(p.id); if (full.items.length) controller.playList(full.items, startAt); else showToast('Playlist này chưa có bài nào.'); } catch (err) { fail(err); }
  }
  async function queueAll(p) {
    try {
      const full = await store.get(p.id);
      let n = 0;
      full.items.forEach((i) => { if (controller.enqueue(i)) n++; });
      showToast(n ? `Đã thêm ${n} bài vào hàng đợi.` : 'Các bài này đã có trong hàng đợi.');
    } catch (err) { fail(err); }
  }

  async function drawList() {
    view = { mode: 'list', id: null };
    clear(root);
    const nameInput = h('input', { class: 'input', type: 'text', maxlength: '100', placeholder: 'Tên playlist mới', 'aria-label': 'Tên playlist mới', enterkeyhint: 'done' });
    const createForm = h('form', { class: 'inline-form', hidden: true, onsubmit: async (e) => {
      e.preventDefault();
      try { await store.create(nameInput.value); nameInput.value = ''; showToast('Đã tạo playlist.'); drawList(); } catch (err) { fail(err); }
    } }, nameInput, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Tạo'));
    const list = h('ul', { class: 'vlist' }, skeletonRows(3));
    root.append(
      h('header', { class: 'view-head' },
        h('div', { class: 'view-titlebar' },
          h('h2', { class: 'view-title' }, 'Playlist'),
          h('button', { type: 'button', class: 'btn', onclick: () => { createForm.hidden = !createForm.hidden; if (!createForm.hidden) nameInput.focus(); } }, icon('plus'), 'Tạo mới')),
        createForm),
      h('div', { class: 'view-body' },
        store.isLocal() ? h('p', { class: 'hint' }, 'Bạn đang dùng thử: playlist lưu trên thiết bị này. Đăng nhập để lưu trên tài khoản và dùng ở mọi thiết bị.') : null,
        list));
    try {
      const lists = await store.list();
      if (view.mode !== 'list') return;
      clear(list);
      if (!lists.length) {
        list.append(h('li', {}, emptyState({ iconName: 'library', title: 'Chưa có playlist nào', text: 'Bấm "Tạo mới", hoặc bấm ⋮ ở một video rồi chọn "Lưu vào playlist".' })));
      }
      lists.forEach((p) => list.append(h('li', { class: 'prow' },
        h('button', { type: 'button', class: 'prow-main', onclick: () => drawDetail(p.id), 'aria-label': `Mở playlist ${p.name}` },
          h('span', { class: 'ptile', 'aria-hidden': 'true' }, icon('library', 26)),
          h('span', { class: 'prow-text' }, h('strong', {}, p.name), h('span', {}, `${p.count} bài`))),
        h('button', { type: 'button', class: 'btn-icon prow-play', title: 'Phát tất cả', 'aria-label': `Phát tất cả: ${p.name}`, disabled: p.count === 0, onclick: () => playAll(p) }, icon('play')),
        h('button', { type: 'button', class: 'btn-icon', title: 'Tùy chọn', 'aria-label': `Tùy chọn playlist: ${p.name}`, 'aria-haspopup': 'dialog', onclick: () => openActionSheet({
          title: p.name,
          actions: [
            { icon: 'play', label: 'Phát tất cả', disabled: p.count === 0, onClick: () => playAll(p) },
            { icon: 'addQueue', label: 'Thêm tất cả vào hàng đợi', disabled: p.count === 0, onClick: () => queueAll(p) },
            { icon: 'edit', label: 'Đổi tên', onClick: () => openRename(p, drawList) },
            { icon: 'trash', label: 'Xóa playlist', danger: true, onClick: () => askDelete(p, drawList) },
          ],
        }) }, icon('more')))));
    } catch (e) {
      clear(list);
      list.append(h('li', {}, emptyState({ iconName: 'error', title: 'Không tải được danh sách playlist', text: (e && e.message) || '', action: { label: 'Thử lại', icon: 'refresh', onClick: drawList } })));
    }
  }

  async function drawDetail(id) {
    view = { mode: 'detail', id };
    let data;
    try { data = await store.get(id); } catch (e) { fail(e); return drawList(); }
    if (view.mode !== 'detail' || view.id !== id) return;
    clear(root);

    const reload = () => drawDetail(id);
    const ids = () => data.items.map((i) => i.id);
    const move = async (idx, to) => { const o = ids(); const [x] = o.splice(idx, 1); o.splice(to, 0, x); try { await store.reorder(id, o); reload(); } catch (e) { fail(e); } };
    const list = h('ul', { class: 'vlist' });
    data.items.forEach((item, idx) => list.append(videoRow(item, {
      prefix: String(idx + 1),
      onPlay: () => controller.playList(data.items, idx),
      menu: () => [
        { icon: 'play', label: 'Phát từ bài này', onClick: () => controller.playList(data.items, idx) },
      ].concat(videoMenu(item, media).slice(1), [
        { icon: 'up', label: 'Đưa lên', disabled: idx === 0, onClick: () => move(idx, idx - 1) },
        { icon: 'down', label: 'Đưa xuống', disabled: idx === data.items.length - 1, onClick: () => move(idx, idx + 1) },
        { icon: 'trash', label: 'Xóa khỏi playlist', danger: true, onClick: async () => { try { await store.removeItem(id, item.id); reload(); } catch (e) { fail(e); } } },
      ]),
    })));
    if (!data.items.length) list.append(h('li', {}, emptyState({ iconName: 'music', title: 'Playlist này chưa có bài nào', text: 'Bấm ⋮ ở một video rồi chọn "Lưu vào playlist".' })));

    const p = { id, name: data.name };
    root.append(
      h('header', { class: 'view-head' },
        h('div', { class: 'view-titlebar detail-head' },
          h('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Quay lại danh sách playlist', title: 'Quay lại', onclick: drawList }, icon('back')),
          h('h2', { class: 'view-title detail-title' }, data.name),
          h('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Đổi tên playlist', title: 'Đổi tên', onclick: () => openRename(p, reload) }, icon('edit')),
          h('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Xóa playlist', title: 'Xóa playlist', onclick: () => askDelete(p, drawList) }, icon('trash'))),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-primary', disabled: !data.items.length, onclick: () => controller.playList(data.items, 0) }, icon('play'), 'Phát tất cả'),
          h('button', { type: 'button', class: 'btn', disabled: !data.items.length, onclick: () => queueAll(p) }, icon('addQueue'), 'Thêm vào hàng đợi'),
          h('span', { class: 'hint', style: 'align-self:center' }, `${data.items.length} bài`))),
      h('div', { class: 'view-body' }, list));
  }

  drawList();
  return {
    activate: () => (view.mode === 'detail' ? drawDetail(view.id) : drawList()),
    refresh: () => (view.mode === 'detail' ? drawDetail(view.id) : drawList()),
  };
}
