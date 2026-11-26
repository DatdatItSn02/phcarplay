// Thành phần giao diện dùng chung cho khu vực quản trị: ô nhập, form, hộp thoại, nhãn, định dạng ngày.
// Không dùng innerHTML nên dữ liệu từ máy chủ không thể chèn mã vào trang.
import { h, clear } from '../core/dom.js';
import { ApiError } from '../core/api.js';
import { openDialog } from '../core/dialog.js';
import { showToast } from '../core/toast.js';

let uid = 0;
const nextId = (prefix) => `${prefix}-${++uid}`;

export function field({ label, name, type = 'text', autocomplete, hint, required = true, value = '', readonly = false }) {
  const id = nextId('f');
  const errId = nextId('e');
  const input = h('input', { id, name, type, autocomplete, required, readonly, value, class: 'input', 'aria-describedby': errId });
  const error = h('p', { class: 'field-error', id: errId, role: 'alert' });
  const el = h('div', { class: 'field' },
    h('label', { for: id }, label),
    input,
    hint ? h('p', { class: 'hint' }, hint) : null,
    error);
  return {
    el,
    input,
    setError(msg) {
      error.textContent = msg || '';
      if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    },
  };
}

// Dựng một form: chạy submit(values) khi gửi, hiện lỗi theo từng ô và lỗi chung.
export function formBox({ fields, submitLabel, submit, onCancel = null, cancelLabel = 'Hủy', danger = false, extra = null }) {
  const formError = h('p', { class: 'form-error', role: 'alert' });
  const button = h('button', { class: danger ? 'btn btn-danger' : 'btn btn-primary', type: 'submit' }, submitLabel);
  const cancel = onCancel ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: onCancel }, cancelLabel) : null;
  const el = h('form', {
    class: 'form',
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      formError.textContent = '';
      fields.forEach((f) => f.setError(''));
      button.disabled = true;
      button.textContent = 'Đang xử lý...';
      try {
        const values = {};
        fields.forEach((f) => { values[f.input.name] = f.input.value; });
        await submit(values);
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        const byField = err.details || {};
        let shown = false;
        fields.forEach((f) => {
          if (byField[f.input.name]) { f.setError(byField[f.input.name]); shown = true; }
        });
        if (!shown) formError.textContent = err.message;
      } finally {
        button.disabled = false;
        button.textContent = submitLabel;
      }
    },
  }, fields.map((f) => f.el), extra, formError, h('div', { class: 'form-actions' }, cancel, button));
  return el;
}

// Hộp xác nhận. onConfirm có thể ném ApiError: lỗi hiện ngay trong hộp, hộp chỉ đóng khi thành công.
export function confirmDialog({ title, message, confirmLabel, danger = false, onConfirm }) {
  return openDialog({
    title,
    content: (close) => h('div', { class: 'form' },
      h('p', { class: 'dialog-text' }, message),
      formBox({ fields: [], submitLabel: confirmLabel, danger, onCancel: close, submit: async () => { await onConfirm(); close(); } })),
  });
}

export function badge(text, kind = 'mute') {
  return h('span', { class: `badge badge-${kind}` }, text);
}

// "2026-05-04 09:30:00" -> "04/05/2026 09:30". Giờ hiển thị đúng như máy chủ lưu (múi giờ cấu hình của website).
export function fmtDateTime(value) {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(value));
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : String(value);
}

// Chạy fn sau khi người dùng ngừng gõ ms mili giây (tránh gọi máy chủ sau mỗi phím).
export function debounce(fn, ms = 300) {
  let t = null;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

// Ô tìm kiếm có nhãn ẩn cho trình đọc màn hình. onChange được gọi sau khi ngừng gõ.
export function searchInput({ label, placeholder = '', value = '', onChange }) {
  const input = h('input', { class: 'input', type: 'search', placeholder, value, 'aria-label': label, autocomplete: 'off' });
  const fire = debounce(() => onChange(input.value.trim()), 300);
  input.addEventListener('input', fire);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { fire.cancel(); onChange(input.value.trim()); } });
  return { el: h('div', { class: 'tool tool-search' }, input), input, cancel: fire.cancel };
}

// Ô chọn có nhãn ẩn. options: [[giá trị, chữ hiển thị], ...]
export function selectBox({ label, options, value = '', onChange }) {
  const sel = h('select', { class: 'input', 'aria-label': label, onchange: () => onChange(sel.value) },
    options.map(([v, t]) => h('option', { value: v }, t)));
  sel.value = value;
  return { el: h('div', { class: 'tool' }, sel), select: sel };
}

// Ô chọn ngày (YYYY-MM-DD) có nhãn hiện.
export function dateBox({ label, value = '', onChange }) {
  const id = nextId('d');
  const input = h('input', { class: 'input', type: 'date', id, value, onchange: () => onChange(input.value) });
  return { el: h('div', { class: 'tool tool-date' }, h('label', { for: id }, label), input), input };
}

// Thanh chuyển trang: "Trang 2 / 5 · 93 mục" cùng nút Trước/Sau.
export function pager({ page, perPage, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const prev = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: page <= 1, onclick: () => onPage(page - 1) }, 'Trang trước');
  const next = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: page >= pages, onclick: () => onPage(page + 1) }, 'Trang sau');
  return h('div', { class: 'pager', role: 'navigation', 'aria-label': 'Chuyển trang' },
    prev,
    h('span', { class: 'pager-info', 'aria-live': 'polite' }, `Trang ${Math.min(page, pages)} / ${pages} · ${total} mục`),
    next);
}

// "2026-05-04 09:30:00" -> "04/05/2026"
export function fmtDate(value) {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value);
}

// Sao chép chữ vào bộ nhớ tạm; nếu trình duyệt không cho thì dùng cách cũ, cuối cùng nhắc bấm Ctrl+C.
export async function copyText(text, okMessage = 'Đã sao chép.') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(okMessage);
    return true;
  } catch (e) {
    try {
      const ta = h('textarea', { 'aria-hidden': 'true', tabindex: '-1', style: 'position:fixed;top:0;left:0;opacity:0' }, text);
      document.body.append(ta);
      ta.select();
      const done = document.execCommand('copy');
      ta.remove();
      if (done) { showToast(okMessage); return true; }
    } catch (e2) { /* thử cách cuối */ }
    showToast('Không sao chép tự động được. Hãy bôi đen rồi nhấn Ctrl+C.');
    return false;
  }
}

// Tải một tệp chữ về máy (dùng cho xuất CSV). BOM giúp Excel đọc đúng tiếng Việt.
export function downloadText(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['\ufeff', text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: 'display:none' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Ô CSV: bọc trong dấu ngoặc kép khi cần và chặn công thức Excel (=, +, -, @ ở đầu ô).
export function csvCell(value) {
  let v = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(v)) v = "'" + v;
  return /[",\n\r;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

// Mật khẩu tạm ngẫu nhiên, bỏ các ký tự dễ nhầm (0/O, 1/l/I).
export function randomPassword(length = 12) {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const limit = 256 - (256 % chars.length);
  let out = '';
  while (out.length < length) {
    const bytes = new Uint8Array(length * 2);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length && out.length < length; i++) {
      if (bytes[i] < limit) out += chars[bytes[i] % chars.length];
    }
  }
  return out;
}

export function message(text, kind = '') {
  return h('div', { class: `notice ${kind}`.trim(), role: 'status' }, h('p', {}, text));
}

export function loading(text = 'Đang tải...') {
  return h('p', { class: 'placeholder', role: 'status' }, text);
}

export { h, clear, openDialog };

/** Người xóa và thời điểm xóa (mục đã xóa chỉ được đánh dấu, không mất khỏi database). */
export function deletedInfo(d) {
  if (!d) return '—';
  const who = d.by_type === 'user' ? 'Chính người dùng' : (d.by_email || (d.by_id ? `#${d.by_id}` : 'Hệ thống'));
  return h('div', { class: 'who' }, h('span', {}, who), h('span', { class: 'sub' }, fmtDateTime(d.at)));
}
