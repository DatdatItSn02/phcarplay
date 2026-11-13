import { h, field, formBox, badge, fmtDateTime } from './ui.js';
import { passwordChangeForm } from './passwordForm.js';
import { showToast } from '../core/toast.js';

// Mục "Tài khoản của tôi": xem thông tin, đổi mật khẩu; master còn sửa được tên và email của mình.
// ctx: { admin, adminApi, onProfileChanged(view), onPasswordChanged(payload) }
export function mountAccount(el, ctx) {
  const a = ctx.admin;
  const isMaster = a.role === 'master';

  const info = h('dl', { class: 'info' },
    h('dt', {}, 'Email'), h('dd', {}, a.email),
    h('dt', {}, 'Tên hiển thị'), h('dd', {}, a.name || '(chưa đặt)'),
    h('dt', {}, 'Vai trò'), h('dd', {}, isMaster ? badge('Master', 'amber') : badge('Quản trị viên', 'mint')),
    h('dt', {}, 'Đăng nhập gần nhất'), h('dd', {}, fmtDateTime(a.last_login_at) || 'Lần đầu'));

  let profile = null;
  if (isMaster) {
    const name = field({ label: 'Tên hiển thị', name: 'name', value: a.name, autocomplete: 'name' });
    const email = field({ label: 'Email', name: 'email', type: 'email', value: a.email, autocomplete: 'username' });
    profile = h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, 'Sửa thông tin'),
      formBox({
        fields: [name, email],
        submitLabel: 'Lưu thông tin',
        submit: async (v) => {
          const view = await ctx.adminApi.updateAdmin(a.id, { name: v.name, email: v.email });
          showToast('Đã lưu thông tin.');
          ctx.onProfileChanged(view);
        },
      }));
  }

  el.append(
    h('div', { class: 'adm-head' }, h('h1', {}, 'Tài khoản của tôi')),
    h('div', { class: 'adm-cols' },
      h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Thông tin'), info),
      profile,
      h('section', { class: 'card' },
        h('h2', { class: 'card-title' }, 'Đổi mật khẩu'),
        passwordChangeForm({
          adminApi: ctx.adminApi,
          onChanged: (payload) => { showToast('Đã đổi mật khẩu.'); ctx.onPasswordChanged(payload); },
        }))));
  return () => {};
}
