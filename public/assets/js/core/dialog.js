// Hộp thoại dùng chung cho cả ứng dụng người dùng và khu vực quản trị: tiêu đề, nút đóng, phím Esc,
// giữ phím Tab trong hộp, trả focus về chỗ cũ khi đóng. Hộp thoại mở chồng lên nhau thì chỉ hộp trên cùng nhận phím.
// Không dùng innerHTML nên dữ liệu từ máy chủ không thể chèn mã vào trang.
import { h } from './dom.js';
import { icon } from './icons.js';

let uid = 0;
const stack = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * openDialog({ title, content, onClose, className, focus })
 *  content: phần tử hoặc hàm (close) => phần tử.  className: thêm lớp cho hộp (ví dụ 'sheet', 'settings').
 *  focus: 'input' (mặc định, ô nhập đầu tiên) | 'first' (nút đầu tiên trong nội dung) | 'dialog'.
 */
export function openDialog({ title, content, onClose = null, className = '', focus = 'input' }) {
  const previous = document.activeElement;
  const titleId = `dlg-${++uid}`;
  let closed = false;
  const self = {};

  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    const i = stack.indexOf(self);
    if (i >= 0) stack.splice(i, 1);
    overlay.remove();
    if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus();
    if (onClose) onClose();
  };
  const onKey = (e) => {
    if (stack[stack.length - 1] !== self) return;   // có hộp khác đang ở trên cùng
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = Array.from(dialog.querySelectorAll(FOCUSABLE)).filter((x) => x.offsetParent !== null || x === document.activeElement);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const body = typeof content === 'function' ? content(close) : content;
  const dialog = h('div', { class: `dialog ${className}`.trim(), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    h('div', { class: 'dialog-head' },
      h('h2', { id: titleId }, title),
      h('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Đóng', onclick: close }, icon('close'))),
    body);
  const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay && stack[stack.length - 1] === self) close(); } }, dialog);
  self.overlay = overlay;
  self.close = close;
  stack.push(self);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey, true);
  let target = null;
  if (focus === 'input') target = dialog.querySelector('input:not([readonly])');
  else if (focus === 'first') target = body && body.querySelector ? body.querySelector(FOCUSABLE) : null;
  (target || dialog).focus();
  return { close, el: dialog };
}

/** Đóng hộp thoại trên cùng (nút Quay lại của ứng dụng Android). Trả về true nếu có hộp để đóng. */
export function closeTopDialog() {
  const top = stack[stack.length - 1];
  if (!top || typeof top.close !== 'function') return false;
  top.close();
  return true;
}

/**
 * Hộp hỏi lại trước khi làm việc không hoàn tác được (thay cho window.confirm, vốn rất nhỏ trên màn hình xe).
 * Trả về Promise<boolean>: true nếu người dùng bấm nút xác nhận.
 */
export function confirmAction({ title, message, confirmLabel = 'Đồng ý', cancelLabel = 'Hủy', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const finish = (value, close) => { answered = true; resolve(value); close(); };
    openDialog({
      title,
      focus: 'first',
      onClose: () => { if (!answered) resolve(false); },
      content: (close) => h('div', { class: 'form' },
        message ? h('p', { class: 'dialog-text' }, message) : null,
        h('div', { class: 'dialog-actions' },
          h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => finish(false, close) }, cancelLabel),
          h('button', { type: 'button', class: danger ? 'btn btn-danger' : 'btn btn-primary', onclick: () => finish(true, close) }, confirmLabel))),
    });
  });
}

/**
 * Bảng chọn thao tác (mở từ nút ⋮): mỗi dòng là một nút lớn có biểu tượng.
 *  actions: [{ icon, label, onClick, danger, disabled }]   info: phần tử hiện ở đầu (ảnh, tên bài)
 */
export function openActionSheet({ title, info = null, actions }) {
  return openDialog({
    title,
    className: 'sheet',
    focus: 'first',
    content: (close) => h('div', {},
      info,
      h('div', { role: 'menu' }, actions.filter(Boolean).map((a) => h('button', {
        type: 'button', role: 'menuitem', class: `sheet-item${a.danger ? ' danger' : ''}`, disabled: a.disabled,
        onclick: () => { close(); a.onClick(); },
      }, icon(a.icon, 26), h('span', {}, a.label))))),
  });
}
