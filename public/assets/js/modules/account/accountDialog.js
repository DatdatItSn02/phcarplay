import { h, clear } from '../../core/dom.js';
import { ApiError } from '../../core/api.js';
import { openDialog } from '../../core/dialog.js';
import { showToast } from '../../core/toast.js';

// "2026-05-04 23:59:59" -> "04/05/2026"
export function formatDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

// Dòng mô tả tình trạng dùng của tài khoản, từ dữ liệu /auth/me hoặc kết quả nhập key.
export function describePlan(info) {
  const until = formatDate(info.expires_at);
  const expired = info.expires_at && new Date(String(info.expires_at).replace(' ', 'T')).getTime() <= Date.now();
  if (info.expires_at && !expired) return `Thành viên, hạn dùng đến ${until}.`;
  if (info.expires_at && expired) return `Đã hết hạn dùng từ ${until}. Nhập key mới để dùng tiếp.`;
  return info.plan === 'trial' ? 'Đang dùng thử. Nhập key kích hoạt để dùng đủ tính năng.' : 'Chưa có hạn dùng. Có key kích hoạt thì nhập bên dưới.';
}

// Hộp thoại tài khoản: thông tin cơ bản và nhập key kích hoạt để gia hạn.
// ctx: { api, session, onChange(info) }  (onChange được gọi sau khi nhập key thành công, để màn hình phía sau cập nhật). Trả về { close }.
export function openAccountDialog({ api, session, onChange = null }) {
  const user = session.user;
  const info = { plan: session.plan, expires_at: user.expires_at || session.expires_at || null };
  const planLine = h('p', { class: 'account-plan', role: 'status' }, describePlan(info));
  const result = h('div', { 'aria-live': 'polite' });
  const input = h('input', {
    id: 'key-input', class: 'input mono', name: 'code', type: 'text', autocomplete: 'off', autocapitalize: 'characters',
    spellcheck: 'false', placeholder: 'ABCD-EFGH-JKMN-PQRS', 'aria-describedby': 'key-err', maxlength: '32',
  });
  const error = h('p', { class: 'field-error', id: 'key-err', role: 'alert' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Kích hoạt');

  const form = h('form', {
    class: 'form', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      error.textContent = '';
      input.removeAttribute('aria-invalid');
      clear(result);
      submit.disabled = true;
      submit.textContent = 'Đang kiểm tra...';
      try {
        const data = await api.post('/user/license/redeem', { code: input.value });
        info.plan = data.plan;
        info.expires_at = data.expires_at;
        planLine.textContent = describePlan(info);
        if (onChange) onChange({ plan: info.plan, expires_at: info.expires_at });
        input.value = '';
        result.append(h('div', { class: 'notice', role: 'status' },
          h('p', {}, `Đã cộng ${data.days_added} ngày. Hạn dùng mới đến ${formatDate(data.expires_at)}.`)));
        showToast('Kích hoạt thành công.');
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        const msg = (err.details && err.details.code) || err.message;
        error.textContent = msg;
        input.setAttribute('aria-invalid', 'true');
      } finally {
        submit.disabled = false;
        submit.textContent = 'Kích hoạt';
      }
    },
  },
  h('div', { class: 'field' },
    h('label', { for: 'key-input' }, 'Key kích hoạt'),
    input,
    h('p', { class: 'hint' }, 'Gồm 16 ký tự chữ và số, gõ chữ thường cũng được.'),
    error),
  result,
  submit);

  return openDialog({
    title: 'Tài khoản',
    content: h('div', { class: 'form' },
      h('dl', { class: 'account-info' },
        h('dt', {}, 'Email'), h('dd', {}, user.email),
        h('dt', {}, 'Tên'), h('dd', {}, user.name || '(chưa đặt)')),
      planLine,
      form),
  });
}
