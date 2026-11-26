import { h, clear } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { openDialog } from '../../core/dialog.js';
import { showToast } from '../../core/toast.js';

/** Hộp thoại "Lưu vào playlist": chọn một playlist có sẵn hoặc tạo playlist mới rồi thêm các bài vào. */
export function openPlaylistPicker({ store, items }) {
  const listBox = h('div', { class: 'picker-list' });
  const error = h('p', { class: 'form-error', role: 'alert' });
  const input = h('input', { class: 'input', type: 'text', placeholder: 'Tên playlist mới', maxlength: '100', 'aria-label': 'Tên playlist mới', enterkeyhint: 'done' });
  let dlg = null;

  async function addTo(playlist) {
    error.textContent = '';
    try {
      const r = await store.addItems(playlist.id, items);
      showToast(r.added > 0 ? `Đã thêm ${r.added} bài vào "${playlist.name}".` : `Bài này đã có trong "${playlist.name}".`);
      dlg.close();
    } catch (e) {
      error.textContent = e.message || 'Không lưu được. Vui lòng thử lại.';
    }
  }

  async function draw() {
    clear(listBox);
    try {
      const lists = await store.list();
      if (!lists.length) listBox.append(h('p', { class: 'placeholder' }, 'Chưa có playlist nào. Hãy tạo playlist đầu tiên bên dưới.'));
      lists.forEach((p) => listBox.append(h('button', { type: 'button', class: 'picker-item', onclick: () => addTo(p) },
        h('span', { class: 'ptile', 'aria-hidden': 'true', style: 'width:3.5rem' }, icon('library', 22)),
        h('span', { class: 'picker-name' }, p.name), h('span', { class: 'vsub-inline' }, `${p.count} bài`))));
    } catch (e) {
      listBox.append(h('p', { class: 'form-error' }, e.message || 'Không tải được danh sách playlist.'));
    }
  }

  const form = h('form', { class: 'picker-new', onsubmit: async (e) => {
    e.preventDefault();
    error.textContent = '';
    try { await addTo(await store.create(input.value)); } catch (err) { error.textContent = err.message || 'Không tạo được playlist.'; }
  } }, input, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Tạo và lưu'));

  dlg = openDialog({
    title: items.length > 1 ? `Lưu ${items.length} bài vào playlist` : 'Lưu vào playlist',
    focus: 'dialog',
    content: h('div', { class: 'form' },
      store.isLocal() ? h('p', { class: 'hint' }, 'Bạn đang dùng thử: playlist lưu trên thiết bị này. Đăng ký hoặc đăng nhập để lưu trên tài khoản.') : null,
      listBox, form, error),
  });
  draw().then(() => { const first = listBox.querySelector('.picker-item'); if (first) first.focus(); });
  return dlg;
}
