import { h, clear } from '../../core/dom.js';
import { ApiError } from '../../core/api.js';
import { openDialog } from '../../core/dialog.js';
import { showToast } from '../../core/toast.js';
import { CODE_INPUT, cleanCode, countdownButton } from '../auth/otpParts.js';

// "Số điện thoại đăng nhập" trong Cài đặt > Tài khoản (giai đoạn 14): thêm / đổi số điện thoại đăng nhập.
// Giai đoạn 16: mục "Đổi mật khẩu" (mã 6 số gửi qua email) được ẨN theo yêu cầu - người dùng đổi mật khẩu bằng
// "Quên mật khẩu?" ở màn hình đăng nhập. Mã nguồn và API (/user/password/code, /user/password) vẫn giữ nguyên:
// muốn hiện lại chỉ cần đổi SHOW_CHANGE_PASSWORD thành true.
// ctx: { authApi, session, onPhone(phone) }. Trả về { close }.
const SHOW_CHANGE_PASSWORD = false;

function inputField({ id, label, hint = '', attrs = {} }) {
  const input = h('input', Object.assign({ id, class: 'input', 'aria-describedby': `${id}-err` }, attrs));
  const error = h('p', { class: 'field-error', id: `${id}-err`, role: 'alert' });
  return {
    input,
    el: h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('p', { class: 'hint' }, hint) : null, error),
    setError(msg) { error.textContent = msg || ''; input.toggleAttribute('aria-invalid', Boolean(msg)); },
  };
}

async function busy(button, label, work) {
  const old = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try { return await work(); } finally { button.disabled = false; button.textContent = old; }
}

export function openSecurityDialog({ authApi, session, onPhone = null, showPassword = SHOW_CHANGE_PASSWORD }) {
  const user = session.user;

  // ----- số điện thoại -----
  const phone = inputField({ id: 'sec-phone', label: 'Số điện thoại đăng nhập', hint: 'Số di động 10 số, ví dụ 0912345678. Dùng số này hoặc email để đăng nhập.',
    attrs: { type: 'tel', inputmode: 'tel', autocomplete: 'tel', value: user.phone || '' } });
  const phoneBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, user.phone ? 'Lưu số mới' : 'Thêm số điện thoại');
  const phoneForm = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    phone.setError('');
    await busy(phoneBtn, 'Đang lưu...', async () => {
      try {
        const data = await authApi.updatePhone(phone.input.value);
        const saved = data.user ? data.user.phone : null;
        user.phone = saved;
        phone.input.value = saved || '';
        phoneBtn.textContent = 'Lưu số mới';
        if (onPhone) onPhone(saved);
        showToast('Đã lưu số điện thoại.');
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        phone.setError((err.details && err.details.phone) || err.message);
      }
    });
  } }, phone.el, phoneBtn);

  if (!showPassword) {
    return openDialog({
      title: 'Số điện thoại đăng nhập',
      content: h('div', { class: 'form security' }, phoneForm,
        h('p', { class: 'hint' }, 'Muốn đổi mật khẩu: đăng xuất rồi bấm "Quên mật khẩu?" ở màn hình đăng nhập.')),
    });
  }

  // ----- đổi mật khẩu (đang ẩn, xem SHOW_CHANGE_PASSWORD) -----
  const pwBox = h('div', { class: 'form' });
  const status = h('div', { 'aria-live': 'polite' });
  const sendBtn = h('button', { class: 'btn', type: 'button' }, 'Gửi mã đổi mật khẩu');
  let resend = null;

  async function requestCode(button) {
    clear(status);
    try {
      const data = await authApi.passwordCode();
      status.append(h('div', { class: data.test_mode ? 'notice notice-warn' : 'notice', role: 'status' }, h('p', {}, data.message || 'Đã gửi mã.')));
      showCodeForm();
      resend.start(data.resend_after || 60);
      const c = pwBox.querySelector('#sec-code');
      if (c) c.focus();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      if (err.code === 'OTP_TOO_SOON') {
        showCodeForm();
        resend.start((err.details && err.details.retry_after) || 60);
      }
      status.append(h('p', { class: 'form-error', role: 'alert' }, err.message));
    }
    return button;
  }

  let codeForm = null;
  function showCodeForm() {
    if (codeForm) return;
    sendBtn.hidden = true;
    const code = inputField({ id: 'sec-code', label: 'Mã 6 số trong email', attrs: CODE_INPUT });
    code.input.addEventListener('input', () => { const c = cleanCode(code.input.value); if (c !== code.input.value) code.input.value = c; });
    const pw = inputField({ id: 'sec-pw', label: 'Mật khẩu mới', hint: 'Từ 6 ký tự trở lên.', attrs: { type: 'password', autocomplete: 'new-password' } });
    const pw2 = inputField({ id: 'sec-pw2', label: 'Nhập lại mật khẩu mới', attrs: { type: 'password', autocomplete: 'new-password' } });
    const formError = h('p', { class: 'form-error', role: 'alert' });
    const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Đổi mật khẩu');
    resend = countdownButton({ onClick: () => requestCode() });
    codeForm = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      [code, pw, pw2].forEach((f) => f.setError(''));
      formError.textContent = '';
      if (pw.input.value !== pw2.input.value) { pw2.setError('Hai mật khẩu chưa giống nhau.'); return; }
      await busy(save, 'Đang đổi...', async () => {
        try {
          await authApi.changePassword(cleanCode(code.input.value), pw.input.value);
          clear(status);
          status.append(h('div', { class: 'notice', role: 'status' }, h('p', {}, 'Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.')));
          codeForm.hidden = true;
          showToast('Đã đổi mật khẩu.');
        } catch (err) {
          if (!(err instanceof ApiError)) throw err;
          const d = err.details || {};
          if (d.code) code.setError(err.code === 'OTP_WRONG' ? err.message : d.code);
          else if (d.password) pw.setError(d.password);
          else formError.textContent = err.message;
        }
      });
    } }, code.el, pw.el, pw2.el, formError, save, h('div', { class: 'row-links' }, resend.el));
    pwBox.append(codeForm);
  }
  sendBtn.addEventListener('click', () => busy(sendBtn, 'Đang gửi...', () => requestCode(sendBtn)));
  pwBox.append(h('p', { class: 'hint' }, 'Mã 6 số sẽ được gửi tới email của tài khoản.'), status, sendBtn);

  return openDialog({
    title: 'Số điện thoại và mật khẩu',
    content: h('div', { class: 'form security' },
      h('h3', { class: 'set-title' }, 'Số điện thoại'), phoneForm,
      h('h3', { class: 'set-title' }, 'Đổi mật khẩu'), pwBox),
  });
}
