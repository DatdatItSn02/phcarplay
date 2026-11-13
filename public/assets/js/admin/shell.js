import { h, clear, badge } from './ui.js';
import { icon } from '../core/icons.js';
import { avatar } from '../core/avatar.js';
import { themeToggle } from '../modules/auth/authView.js';
import { mountDashboard } from './dashboardView.js';
import { mountUsers } from './usersView.js';
import { mountKeys } from './keysView.js';
import { mountPlaylists } from './playlistsView.js';
import { mountAudit } from './auditView.js';
import { mountAdmins } from './adminsView.js';
import { mountAccount } from './accountView.js';

/**
 * Khung trang quản trị: thanh bên trái (màn rộng) hoặc thanh trên (màn hẹp) có tên, nút đổi sáng/tối, đăng xuất và các mục,
 * cùng vùng nội dung. Mục chọn được lấy từ địa chỉ trang
 * (/admin/users, /admin/keys...) nên tải lại trang hoặc nút Back vẫn đúng chỗ.
 * Mỗi mục là một hàm mount(el, ctx) trả về hàm dọn dẹp; ctx của mục có thêm navigate(path) để chuyển sang mục khác.
 * ctx: { appName, admin, adminApi, basePath, appearance, onLogout, onProfileChanged(view), onPasswordChanged(payload) }
 */
export function mountAdminShell(root, ctx) {
  const prefix = (ctx.basePath || '') + '/admin';
  const isMaster = ctx.admin.role === 'master';
  const sections = [
    { path: '/dashboard', label: 'Tổng quan', icon: 'dashboard', mount: mountDashboard },
    { path: '/users', label: 'Người dùng', icon: 'people', mount: mountUsers },
    { path: '/keys', label: 'Key kích hoạt', icon: 'key', mount: mountKeys },
    { path: '/playlists', label: 'Playlist', icon: 'library', mount: mountPlaylists },
    { path: '/audit', label: 'Nhật ký', icon: 'receipt', masterOnly: true, mount: mountAudit },
    { path: '/admins', label: 'Quản trị viên', icon: 'shield', masterOnly: true, mount: mountAdmins },
    { path: '/account', label: 'Tài khoản của tôi', icon: 'person', mount: mountAccount },
  ].filter((s) => !s.masterOnly || isMaster);
  const sectionCtx = { ...ctx, navigate: (path) => go(path, false) };

  const main = h('main', { class: 'adm-main', id: 'adm-main', tabindex: '-1' });
  const links = sections.map((s) => h('a', {
    href: prefix + s.path,
    'data-path': s.path,
    onclick: (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      go(s.path, false);
    },
  }, icon(s.icon, 22), s.label));
  let stopSection = null;

  function currentPath() {
    let p = location.pathname;
    if (p.indexOf(prefix) === 0) p = p.slice(prefix.length);
    return '/' + p.replace(/^\/+|\/+$/g, '');
  }

  function show(path) {
    if (stopSection) { stopSection(); stopSection = null; }
    let section = sections.find((s) => s.path === path);
    if (!section) {
      section = sections[0];
      history.replaceState(null, '', prefix + section.path);
    }
    links.forEach((a) => {
      if (a.getAttribute('data-path') === section.path) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    clear(main);
    stopSection = section.mount(main, sectionCtx) || null;
  }

  function go(path, replace) {
    history[replace ? 'replaceState' : 'pushState'](null, '', prefix + path);
    show(path);
    window.scrollTo(0, 0);
  }

  const onPop = () => show(currentPath());
  window.addEventListener('popstate', onPop);

  const who = ctx.admin.name || ctx.admin.email;
  clear(root);
  root.append(
    h('div', { class: 'adm' },
      h('aside', { class: 'adm-side' },
        h('div', { class: 'adm-brand' },
          h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, icon('shield', 24)),
          h('div', { class: 'adm-brand-text' }, h('strong', {}, ctx.appName), h('span', { class: 'adm-tag' }, 'Quản trị'))),
        h('nav', { class: 'adm-nav', 'aria-label': 'Mục quản trị' }, links),
        h('div', { class: 'adm-foot' },
          h('div', { class: 'adm-who' },
            avatar(who),
            h('span', { class: 'adm-name' }, who),
            isMaster ? badge('Master', 'amber') : null),
          h('div', { class: 'adm-actions' },
            themeToggle(ctx.appearance),
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: ctx.onLogout }, icon('logout', 20), 'Đăng xuất')))),
      main));
  show(currentPath());

  return () => {
    window.removeEventListener('popstate', onPop);
    if (stopSection) stopSection();
  };
}
