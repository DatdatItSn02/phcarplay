import { h, clear, fmtDateTime, loading } from './ui.js';
import { actionLabel, targetLabel } from './labels.js';
import { mailCard } from './mailCard.js';

function stat(label, value, hint = '', kind = '') {
  return h('div', { class: `stat ${kind}`.trim() },
    h('div', { class: 'stat-value' }, String(value)),
    h('div', { class: 'stat-label' }, label),
    hint ? h('div', { class: 'hint' }, hint) : null);
}

// Trang Tổng quan: số liệu chính và (với master) các thao tác gần đây. ctx: { adminApi, admin, navigate }
export function mountDashboard(el, ctx) {
  const body = h('div', { class: 'adm-body' }, loading());
  let alive = true;
  // Giai đoạn 16: thẻ kiểm tra gửi email (chỉ master). Dựng một lần, không vẽ lại khi bấm "Làm mới" để giữ kết quả gửi thử.
  const mail = ctx.admin && ctx.admin.role === 'master' ? mailCard(ctx) : null;

  function card(title, tiles, link) {
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', { class: 'card-title' }, title),
        link ? h('button', { type: 'button', class: 'link', onclick: () => ctx.navigate(link.path) }, link.label) : null),
      h('div', { class: 'stat-grid' }, tiles));
  }

  function draw(d) {
    clear(body);
    body.append(
      h('div', { class: 'adm-cols' },
        card('Người dùng', [
          stat('Tổng số', d.users.total),
          stat('Đang hoạt động', d.users.active),
          stat('Đã khóa', d.users.blocked, '', d.users.blocked ? 'warn' : ''),
          stat('Đăng ký 7 ngày qua', d.users.new_7d),
        ], { path: '/users', label: 'Xem người dùng' }),
        card('Hạn dùng', [
          stat('Còn hạn', d.users.license_valid, '', 'ok'),
          stat('Đã hết hạn', d.users.license_expired, '', d.users.license_expired ? 'warn' : ''),
          stat('Chưa có hạn', d.users.license_none),
        ]),
        card('Key kích hoạt', [
          stat('Chưa dùng', d.keys.unused, '', 'ok'),
          stat('Đã dùng', d.keys.used),
          stat('Đã thu hồi', d.keys.revoked),
        ], { path: '/keys', label: 'Quản lý key' }),
        card('Nội dung và quản trị', [
          stat('Playlist', d.playlists.playlists),
          stat('Bài trong playlist', d.playlists.items),
          stat('Quản trị viên', d.admins.total),
        ], { path: '/playlists', label: 'Xem playlist' })),
      mail ? mail.el : null,
      d.recent ? recent(d.recent) : null);
  }

  function recent(items) {
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', { class: 'card-title' }, 'Thao tác gần đây'),
        h('button', { type: 'button', class: 'link', onclick: () => ctx.navigate('/audit') }, 'Xem toàn bộ nhật ký')),
      items.length
        ? h('ul', { class: 'plain-list recent' }, items.map((r) => h('li', {},
            h('span', { class: 'track' },
              h('strong', {}, actionLabel(r.action)),
              h('span', { class: 'sub' }, [targetLabel(r.target_type, r.target_id), r.admin_email || 'Hệ thống'].filter(Boolean).join(' · '))),
            h('span', { class: 'hint' }, fmtDateTime(r.created_at)))))
        : h('p', { class: 'hint' }, 'Chưa có thao tác nào.'));
  }

  async function load() {
    try {
      const d = await ctx.adminApi.stats();
      if (alive) draw(d);
    } catch (e) {
      if (!alive) return;
      clear(body);
      body.append(h('div', { class: 'notice notice-warn', role: 'alert' },
        h('p', {}, e && e.message ? e.message : 'Không tải được số liệu.'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { clear(body); body.append(loading()); load(); } }, 'Thử lại')));
    }
  }

  el.append(
    h('div', { class: 'adm-head' },
      h('h1', {}, 'Tổng quan'),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { clear(body); body.append(loading()); load(); } }, 'Làm mới')),
    body);
  load();
  return () => { alive = false; if (mail) mail.destroy(); };
}
