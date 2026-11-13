import { h, clear } from '../../core/dom.js';
import { ApiError } from '../../core/api.js';
import { icon } from '../../core/icons.js';
import { CODE_INPUT, cleanCode, countdownButton } from './otpParts.js';

const TABS = [['login', 'Đăng nhập'], ['register', 'Tạo tài khoản']];

/** Nút đổi sáng/tối nhỏ ở góc màn hình đăng nhập (và trang quản trị). appearance có thể là null. */
export function themeToggle(appearance, cls = 'btn-icon') {
  if (!appearance) return null;
  const btn = h('button', { type: 'button', class: cls, onclick: () => appearance.toggleTheme() });
  const draw = (v) => {
    clear(btn);
    btn.append(icon(v.theme === 'dark' ? 'sun' : 'moon'));
    btn.setAttribute('aria-label', v.theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối');
    btn.title = btn.getAttribute('aria-label');
  };
  draw(appearance.get());
  // Màn hình được dựng lại thì nút cũ bị gỡ khỏi trang: tự hủy theo dõi để không tích tụ.
  const off = appearance.onChange((v) => { if (!btn.isConnected) { off(); return; } draw(v); });
  return btn;
}

/**
 * Màn hình đăng nhập / đăng ký / quên mật khẩu / đặt mật khẩu mới.
 * Giai đoạn 14: đăng nhập bằng email hoặc số điện thoại; đăng ký bắt buộc số điện thoại; quên mật khẩu bằng mã OTP 6 số.
 * ctx: { authApi, appName, initialMode, resetToken, notice, appearance, onAuthed(session), onGuest(), onResetDone() }
 */
export function mountAuth(root, ctx) {
  let mode = ctx.initialMode || 'login';
  let lastLogin = '';   // email/số vừa dùng ở bước quên mật khẩu, điền sẵn khi quay lại đăng nhập

  let tabsEl = null;
  let bodyEl = null;

  function go(next) {
    const tabbed = (m) => m === 'login' || m === 'register';
    if (tabsEl && bodyEl && tabsEl.isConnected && tabbed(mode) && tabbed(next)) {
      // Đổi qua lại giữa hai thẻ: chỉ thay phần form, giữ nguyên khung và nút chuyển để viên trượt chạy mượt.
      mode = next;
      tabsEl.dataset.active = mode;
      for (const b of tabsEl.querySelectorAll('[role="tab"]')) b.setAttribute('aria-selected', String(b.dataset.key === mode));
      clear(bodyEl);
      const parts = body();
      bodyEl.append(...(Array.isArray(parts) ? parts : [parts]));
      focusFirst();
      return;
    }
    mode = next;
    draw();
  }

  function focusFirst() {
    const first = root.querySelector('input');
    if (first && window.matchMedia && !window.matchMedia('(pointer: coarse)').matches) first.focus();
  }

  function field({ label, name, type = 'text', autocomplete, hint, required = true, value = '', attrs = null }) {
    const input = h('input', Object.assign({ id: `f-${name}`, name, type, autocomplete, required, class: 'input', 'aria-describedby': `e-${name}` }, attrs || {}));
    if (value) input.value = value;
    const error = h('p', { class: 'field-error', id: `e-${name}`, role: 'alert' });
    const el = h('div', { class: 'field' },
      h('label', { for: `f-${name}` }, label),
      input,
      hint ? h('p', { class: 'hint' }, hint) : null,
      error);
    return { el, input, setError(msg) { error.textContent = msg || ''; input.toggleAttribute('aria-invalid', !!msg); } };
  }

  // Dựng một form: chạy submit(values) khi gửi, tự hiện lỗi theo từng ô và lỗi chung.
  function form({ fields, submitLabel, submit }) {
    const formError = h('p', { class: 'form-error', role: 'alert' });
    const button = h('button', { class: 'btn btn-primary', type: 'submit' }, submitLabel);
    const el = h('form', { class: 'form', novalidate: true,
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
          fields.forEach((f) => { if (byField[f.input.name]) { f.setError(byField[f.input.name]); shown = true; } });
          if (!shown) formError.textContent = err.message;
        } finally {
          button.disabled = false;
          button.textContent = submitLabel;
        }
      } },
      fields.map((f) => f.el), formError, button);
    return el;
  }

  function message(text, actions = []) {
    return h('div', { class: 'notice', role: 'status' }, h('p', {}, text), actions);
  }

  function linkButton(label, onClick) {
    return h('button', { type: 'button', class: 'link', onclick: onClick }, label);
  }

  function passwordPair() {
    return [
      field({ label: 'Mật khẩu mới', name: 'password', type: 'password', autocomplete: 'new-password', hint: 'Từ 6 ký tự trở lên.' }),
      field({ label: 'Nhập lại mật khẩu mới', name: 'confirm', type: 'password', autocomplete: 'new-password' }),
    ];
  }

  function checkConfirm(v) {
    if (v.password !== v.confirm) {
      throw new ApiError(422, 'VALIDATION_FAILED', 'Chưa hợp lệ', { confirm: 'Hai mật khẩu chưa giống nhau.' });
    }
  }

  // Quên mật khẩu, bước 2: nhập mã 6 số và mật khẩu mới (gửi lại mã sau 60 giây).
  function codeStep(login, sent) {
    const info = h('div', { 'aria-live': 'polite' }, sent ? message(sent.message) : null);
    const code = field({ label: 'Mã 6 số trong email', name: 'code', autocomplete: 'one-time-code', attrs: CODE_INPUT });
    code.input.addEventListener('input', () => { const c = cleanCode(code.input.value); if (c !== code.input.value) code.input.value = c; });
    const [password, confirm] = passwordPair();
    const resend = countdownButton({ onClick: async () => {
      try {
        const data = await ctx.authApi.forgot(login);
        clear(info);
        info.append(message('Đã gửi mã mới. ' + data.message));
        resend.start(data.resend_after || 60);
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        clear(info);
        info.append(h('p', { class: 'form-error', role: 'alert' }, err.message));
      }
    } });
    resend.start(sent ? (sent.resend_after || 60) : 0);
    const done = h('div', {});
    const f = form({ fields: [code, password, confirm], submitLabel: 'Đặt mật khẩu mới',
      submit: async (v) => {
        checkConfirm(v);
        const data = await ctx.authApi.resetWithCode(login, cleanCode(v.code), v.password);
        clear(done);
        lastLogin = login;
        f.hidden = true;
        done.append(message(data.message, [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go('login') }, 'Đăng nhập')]));
      } });
    return [
      h('p', { class: 'hint otp-for' }, 'Tài khoản: ', h('strong', {}, login)),
      info, f, done,
      h('div', { class: 'row-links' }, resend.el, linkButton('Dùng email/số khác', () => go('forgot'))),
    ];
  }

  function body() {
    if (mode === 'login') {
      const login = field({ label: 'Email hoặc số điện thoại', name: 'login', type: 'text', autocomplete: 'username', value: lastLogin,
        attrs: { autocapitalize: 'off', spellcheck: 'false' } });
      const password = field({ label: 'Mật khẩu', name: 'password', type: 'password', autocomplete: 'current-password' });
      return [
        form({ fields: [login, password], submitLabel: 'Đăng nhập',
          submit: async (v) => ctx.onAuthed(await ctx.authApi.login(v.login.trim(), v.password)) }),
        h('div', { class: 'row-links' }, linkButton('Quên mật khẩu?', () => go('forgot'))),
      ];
    }
    if (mode === 'register') {
      const name = field({ label: 'Tên hiển thị', name: 'name', autocomplete: 'name', required: false });
      const phone = field({ label: 'Số điện thoại', name: 'phone', type: 'tel', autocomplete: 'tel', hint: 'Dùng để đăng nhập nhanh trên màn hình xe, ví dụ 0912345678.',
        attrs: { inputmode: 'tel' } });
      const email = field({ label: 'Email', name: 'email', type: 'email', autocomplete: 'email', hint: 'Để nhận mã khi quên hoặc đổi mật khẩu.' });
      const password = field({ label: 'Mật khẩu', name: 'password', type: 'password', autocomplete: 'new-password', hint: 'Từ 6 ký tự trở lên.' });
      return form({ fields: [name, phone, email, password], submitLabel: 'Tạo tài khoản',
        submit: async (v) => ctx.onAuthed(await ctx.authApi.register(v.name, v.email, v.password, v.phone)) });
    }
    if (mode === 'forgot') {
      const login = field({ label: 'Email hoặc số điện thoại đã đăng ký', name: 'login', type: 'text', autocomplete: 'username', value: lastLogin,
        attrs: { autocapitalize: 'off', spellcheck: 'false' } });
      const step = h('div', {});
      const askCode = form({ fields: [login], submitLabel: 'Gửi mã',
        submit: async (v) => {
          const id = v.login.trim();
          const data = await ctx.authApi.forgot(id);
          lastLogin = id;
          showCodeStep(id, data);
        } });
      function showCodeStep(id, data) {
        askCode.hidden = true;
        haveCode.hidden = true;
        clear(step);
        step.append(...codeStep(id, data));
        const c = step.querySelector('input[name="code"]');
        if (c) c.focus();
      }
      const haveCode = h('div', { class: 'row-links' },
        linkButton('Đã có mã trong email? Nhập mã', () => {
          const id = login.input.value.trim();
          if (!id) { login.setError('Hãy nhập email hoặc số điện thoại trước.'); login.input.focus(); return; }
          lastLogin = id;
          showCodeStep(id, null);
        }),
        linkButton('Quay lại đăng nhập', () => go('login')));
      return [h('p', { class: 'hint' }, 'Mã 6 số sẽ được gửi tới email của tài khoản.'), askCode, haveCode, step];
    }
    // mode === 'reset'
    const password = field({ label: 'Mật khẩu mới', name: 'password', type: 'password', autocomplete: 'new-password', hint: 'Từ 6 ký tự trở lên.' });
    const confirm = field({ label: 'Nhập lại mật khẩu mới', name: 'confirm', type: 'password', autocomplete: 'new-password' });
    const holder = h('div', {});
    return [form({ fields: [password, confirm], submitLabel: 'Lưu mật khẩu mới',
      submit: async (v) => {
        checkConfirm(v);
        const data = await ctx.authApi.reset(ctx.resetToken, v.password);
        clear(holder);
        holder.append(message(data.message, [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.onResetDone() }, 'Đăng nhập')]));
      } }), holder];
  }

  function draw() {
    clear(root);
    const showTabs = mode === 'login' || mode === 'register';
    root.append(
      h('main', { class: 'auth' },
        h('header', { class: 'auth-top' },
          h('div', { class: 'brand' },
            h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, icon('car', 26)),
            h('div', {},
              h('h1', {}, ctx.appName),
              h('p', { class: 'brand-sub' }, 'Xem video, nghe nhạc trên màn hình xe'))),
          themeToggle(ctx.appearance)),
        ctx.notice ? h('div', { class: 'notice notice-warn auth-notice', role: 'alert' }, h('p', {}, ctx.notice)) : null,
        h('section', { class: 'card' },
          tabsEl = showTabs
            ? h('div', { class: 'tabs', role: 'tablist', 'data-active': mode }, TABS.map(([key, label]) =>
                h('button', { type: 'button', role: 'tab', class: 'tab', 'data-key': key, 'aria-selected': String(mode === key), onclick: () => { if (mode !== key) go(key); } }, label)))
            : null,
          showTabs ? null : h('h2', { class: 'card-title' }, mode === 'forgot' ? 'Quên mật khẩu' : 'Đặt mật khẩu mới'),
          bodyEl = h('div', { class: 'auth-body' }, body())),
        mode === 'reset' ? null : h('div', { class: 'trial' },
          h('div', { class: 'or' }, 'hoặc'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-big', onclick: () => ctx.onGuest() }, 'Dùng thử, không cần tài khoản'),
          h('p', { class: 'hint' }, 'Playlist sẽ chỉ lưu trên thiết bị này cho đến khi bạn đăng ký.'))));
    focusFirst();
  }

  draw();
}
