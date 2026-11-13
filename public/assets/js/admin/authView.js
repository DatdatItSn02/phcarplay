import { h, clear, field, formBox, message } from './ui.js';
import { ApiError } from '../core/api.js';
import { icon } from '../core/icons.js';
import { themeToggle } from '../modules/auth/authView.js';

/**
 * Màn hình đăng nhập quản trị / quên mật khẩu / đặt mật khẩu mới.
 * ctx: { adminApi, appName, appearance, initialMode, resetToken, notice, onAuthed(session), onResetDone() }
 */
export function mountAdminAuth(root, ctx) {
  let mode = ctx.initialMode || 'login';
  const go = (next) => { mode = next; draw(); };
  const linkButton = (label, onClick) => h('button', { type: 'button', class: 'link', onclick: onClick }, label);
  const PASSWORD_HINT = 'Từ 8 ký tự trở lên.';

  function body() {
    if (mode === 'login') {
      const email = field({ label: 'Email', name: 'email', type: 'email', autocomplete: 'username' });
      const password = field({ label: 'Mật khẩu', name: 'password', type: 'password', autocomplete: 'current-password' });
      return [
        formBox({ fields: [email, password], submitLabel: 'Đăng nhập',
          submit: async (v) => ctx.onAuthed(await ctx.adminApi.login(v.email, v.password)) }),
        h('div', { class: 'row-links' }, linkButton('Quên mật khẩu?', () => go('forgot'))),
      ];
    }
    if (mode === 'forgot') {
      const email = field({ label: 'Email quản trị', name: 'email', type: 'email', autocomplete: 'username' });
      const holder = h('div', {});
      return [
        formBox({ fields: [email], submitLabel: 'Gửi liên kết đặt lại',
          submit: async (v) => {
            const data = await ctx.adminApi.forgot(v.email);
            clear(holder);
            holder.append(message(data.message, data.test_mode ? 'notice-warn' : ''));
          } }),
        holder,
        h('div', { class: 'row-links' }, linkButton('Quay lại đăng nhập', () => go('login'))),
      ];
    }
    const password = field({ label: 'Mật khẩu mới', name: 'password', type: 'password', autocomplete: 'new-password', hint: PASSWORD_HINT });
    const confirm = field({ label: 'Nhập lại mật khẩu mới', name: 'confirm', type: 'password', autocomplete: 'new-password' });
    const holder = h('div', {});
    return [
      formBox({ fields: [password, confirm], submitLabel: 'Lưu mật khẩu mới',
        submit: async (v) => {
          if (v.password !== v.confirm) {
            throw new ApiError(422, 'VALIDATION_FAILED', 'Chưa hợp lệ', { confirm: 'Hai mật khẩu chưa giống nhau.' });
          }
          const data = await ctx.adminApi.reset(ctx.resetToken, v.password);
          clear(holder);
          holder.append(h('div', { class: 'notice', role: 'status' },
            h('p', {}, data.message),
            h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.onResetDone() }, 'Đăng nhập')));
        } }),
      holder,
    ];
  }

  function draw() {
    clear(root);
    root.append(
      h('main', { class: 'auth' },
        h('header', { class: 'auth-top' },
          h('div', { class: 'brand' },
            h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, icon('shield', 26)),
            h('div', {},
              h('h1', {}, ctx.appName),
              h('p', { class: 'brand-sub' }, 'Khu vực quản trị'))),
          themeToggle(ctx.appearance)),
        ctx.notice ? h('div', { class: 'notice notice-warn auth-notice', role: 'alert' }, h('p', {}, ctx.notice)) : null,
        h('section', { class: 'card' },
          h('h2', { class: 'card-title' }, mode === 'login' ? 'Đăng nhập quản trị' : mode === 'forgot' ? 'Quên mật khẩu' : 'Đặt mật khẩu mới'),
          body())));
    const first = root.querySelector('input');
    if (first) first.focus();
  }

  draw();
}
