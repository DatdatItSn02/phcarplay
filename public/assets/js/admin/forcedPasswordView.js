import { h, clear } from './ui.js';
import { passwordChangeForm } from './passwordForm.js';
import { icon } from '../core/icons.js';
import { themeToggle } from '../modules/auth/authView.js';

// Màn hình bắt buộc đổi mật khẩu tạm trước khi dùng các chức năng khác.
export function mountForcedPassword(root, ctx) {
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
      h('section', { class: 'card' },
        h('h2', { class: 'card-title' }, 'Đặt mật khẩu mới'),
        h('div', { class: 'notice notice-warn', role: 'status' },
          h('p', {}, `Xin chào ${ctx.admin.name || ctx.admin.email}. Bạn đang dùng mật khẩu tạm do quản trị viên master cấp. Hãy đặt mật khẩu riêng của bạn để tiếp tục.`)),
        passwordChangeForm({
          adminApi: ctx.adminApi,
          currentLabel: 'Mật khẩu tạm hiện tại',
          submitLabel: 'Lưu mật khẩu mới',
          onChanged: ctx.onChanged,
        }),
        h('div', { class: 'row-links' },
          h('button', { type: 'button', class: 'link', onclick: ctx.onLogout }, 'Đăng xuất')))));
  const first = root.querySelector('input');
  if (first) first.focus();
}
