import { h, clear, field, formBox, openDialog, confirmDialog, badge, fmtDateTime, randomPassword, loading, selectBox, deletedInfo } from './ui.js';
import { showToast } from '../core/toast.js';

const PASSWORD_RULE = 'Từ 8 ký tự trở lên.';

// Hiện mật khẩu tạm vừa tạo để master chuyển cho người dùng (chỉ hiện ở hộp thoại này).
function secretResult({ intro, email, password, onClose }) {
  const box = h('input', { class: 'input mono', type: 'text', readonly: true, value: password, 'aria-label': 'Mật khẩu tạm', onfocus: (e) => e.target.select() });
  const copy = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: async () => {
    try {
      await navigator.clipboard.writeText(password);
      showToast('Đã sao chép mật khẩu tạm.');
    } catch (e) {
      box.focus();
      box.select();
      showToast('Hãy nhấn Ctrl+C để sao chép.');
    }
  } }, 'Sao chép');
  return h('div', { class: 'form' },
    h('div', { class: 'notice', role: 'status' }, h('p', {}, intro)),
    h('div', { class: 'field' }, h('label', {}, 'Email đăng nhập'), h('p', { class: 'mono' }, email)),
    h('div', { class: 'field' }, h('label', {}, 'Mật khẩu tạm (chỉ hiện một lần)'), h('div', { class: 'inline' }, box, copy)),
    h('p', { class: 'hint' }, 'Người này sẽ phải đổi mật khẩu ngay ở lần đăng nhập tới.'),
    h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: onClose }, 'Đã chép xong')));
}

function passwordField(label = 'Mật khẩu tạm') {
  const f = field({ label, name: 'password', type: 'text', autocomplete: 'off', hint: PASSWORD_RULE });
  const gen = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { f.input.value = randomPassword(); f.input.focus(); } }, 'Tạo mật khẩu ngẫu nhiên');
  return { f, gen };
}

// Quản lý tài khoản quản trị (chỉ master). ctx: { admin (người đang đăng nhập), adminApi }
export function mountAdmins(el, ctx) {
  const api = ctx.adminApi;
  const body = h('div', { class: 'adm-body' });
  let items = [];
  let showDeleted = false;
  let firstLoad = true;

  async function load() {
    if (firstLoad) { clear(body); body.append(loading()); }
    try {
      const data = await api.listAdmins(showDeleted ? { deleted: '1' } : {});
      items = data.items;
      firstLoad = false;
      draw();
    } catch (e) {
      clear(body);
      body.append(h('div', { class: 'notice notice-warn', role: 'alert' },
        h('p', {}, e && e.message ? e.message : 'Không tải được danh sách.'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { firstLoad = true; load(); } }, 'Thử lại')));
    }
  }

  function openCreate() {
    openDialog({
      title: 'Thêm quản trị viên',
      content: (close) => {
        const holder = h('div', {});
        const name = field({ label: 'Tên hiển thị', name: 'name', autocomplete: 'off' });
        const email = field({ label: 'Email đăng nhập', name: 'email', type: 'email', autocomplete: 'off' });
        const pw = passwordField();
        holder.append(formBox({
          fields: [name, email, pw.f],
          extra: h('div', { class: 'inline-actions' }, pw.gen),
          submitLabel: 'Tạo tài khoản',
          onCancel: close,
          submit: async (v) => {
            const created = await api.createAdmin({ name: v.name, email: v.email, password: v.password });
            showToast('Đã tạo tài khoản quản trị.');
            clear(holder);
            holder.append(secretResult({ intro: `Đã tạo tài khoản cho ${created.name || created.email}.`, email: created.email, password: v.password, onClose: close }));
            load();
          },
        }));
        return holder;
      },
    });
  }

  function openEdit(a) {
    openDialog({
      title: 'Sửa thông tin',
      content: (close) => {
        const name = field({ label: 'Tên hiển thị', name: 'name', value: a.name, autocomplete: 'off' });
        const email = field({ label: 'Email đăng nhập', name: 'email', type: 'email', value: a.email, autocomplete: 'off' });
        return formBox({
          fields: [name, email],
          submitLabel: 'Lưu',
          onCancel: close,
          submit: async (v) => {
            const view = await api.updateAdmin(a.id, { name: v.name, email: v.email });
            if (view.id === ctx.admin.id) ctx.onProfileChanged(view);
            showToast('Đã lưu.');
            close();
            load();
          },
        });
      },
    });
  }

  function openTempPassword(a) {
    openDialog({
      title: `Mật khẩu tạm cho ${a.name || a.email}`,
      content: (close) => {
        const holder = h('div', {});
        const pw = passwordField('Mật khẩu tạm mới');
        holder.append(h('p', { class: 'dialog-text' }, 'Mọi phiên đang đăng nhập của người này sẽ bị đăng xuất và họ phải đổi mật khẩu ở lần đăng nhập tới.'));
        holder.append(formBox({
          fields: [pw.f],
          extra: h('div', { class: 'inline-actions' }, pw.gen),
          submitLabel: 'Đặt mật khẩu tạm',
          onCancel: close,
          submit: async (v) => {
            await api.setAdminPassword(a.id, v.password);
            showToast('Đã đặt mật khẩu tạm.');
            clear(holder);
            holder.append(secretResult({ intro: `Đã đặt mật khẩu tạm cho ${a.name || a.email}.`, email: a.email, password: v.password, onClose: close }));
            load();
          },
        }));
        return holder;
      },
    });
  }

  function confirmBlock(a) {
    confirmDialog({
      title: 'Khóa tài khoản?',
      message: `${a.name || a.email} (${a.email}) sẽ bị đăng xuất ngay và không đăng nhập được cho tới khi bạn mở khóa.`,
      confirmLabel: 'Khóa tài khoản',
      danger: true,
      onConfirm: async () => { await api.updateAdmin(a.id, { status: 'blocked' }); showToast('Đã khóa tài khoản.'); load(); },
    });
  }

  async function unblock(a, button) {
    button.disabled = true;
    try {
      await api.updateAdmin(a.id, { status: 'active' });
      showToast('Đã mở khóa tài khoản.');
      load();
    } catch (e) {
      button.disabled = false;
      showToast(e && e.message ? e.message : 'Không mở khóa được.');
    }
  }

  function confirmDelete(a) {
    confirmDialog({
      title: 'Xóa quản trị viên?',
      message: `Xóa tài khoản ${a.email}: không đăng nhập được nữa, email này có thể dùng để tạo tài khoản mới. Hệ thống vẫn lưu người xóa và thời điểm (xem ở "Đã xóa"), lịch sử thao tác trong nhật ký được giữ lại.`,
      confirmLabel: 'Xóa vĩnh viễn',
      danger: true,
      onConfirm: async () => { await api.deleteAdmin(a.id); showToast('Đã xóa tài khoản.'); load(); },
    });
  }

  function actions(a) {
    const btn = (label, onClick, cls = 'btn btn-ghost btn-sm') => h('button', { type: 'button', class: cls, onclick: onClick }, label);
    if (a.role === 'master') {
      return [btn('Sửa', () => openEdit(a)), h('span', { class: 'hint' }, 'Tài khoản master được bảo vệ')];
    }
    return [
      btn('Sửa', () => openEdit(a)),
      a.status === 'blocked' ? btn('Mở khóa', (e) => unblock(a, e.currentTarget)) : btn('Khóa', () => confirmBlock(a)),
      btn('Mật khẩu tạm', () => openTempPassword(a)),
      btn('Xóa', () => confirmDelete(a), 'btn btn-ghost btn-sm btn-danger-text'),
    ];
  }

  function row(a) {
    if (a.deleted) {
      return h('tr', { class: 'is-blocked' },
        h('td', { 'data-label': 'Quản trị viên' }, h('div', { class: 'who' }, h('strong', {}, a.name || a.email), h('span', { class: 'sub' }, a.email))),
        h('td', { 'data-label': 'Vai trò' }, badge('Quản trị viên', 'mint')),
        h('td', { 'data-label': 'Trạng thái' }, badge('Đã xóa', 'warn')),
        h('td', { 'data-label': 'Người xóa' }, deletedInfo(a.deleted)),
        h('td', { class: 'acts' }));
    }
    return h('tr', { class: a.status === 'blocked' ? 'is-blocked' : '' },
      h('td', { 'data-label': 'Quản trị viên' }, h('div', { class: 'who' }, h('strong', {}, a.name || a.email), h('span', { class: 'sub' }, a.email))),
      h('td', { 'data-label': 'Vai trò' }, a.role === 'master' ? badge('Master', 'amber') : badge('Quản trị viên', 'mint')),
      h('td', { 'data-label': 'Trạng thái' }, h('div', { class: 'badges' },
        a.status === 'blocked' ? badge('Đã khóa', 'warn') : badge('Hoạt động', 'ok'),
        a.must_change_password ? badge('Chờ đổi mật khẩu', 'amber') : null)),
      h('td', { 'data-label': 'Đăng nhập gần nhất' }, fmtDateTime(a.last_login_at) || 'Chưa đăng nhập'),
      h('td', { class: 'acts' }, h('div', { class: 'acts-row' }, actions(a))));
  }

  function draw() {
    clear(body);
    if (!items.length) {
      body.append(h('p', { class: 'placeholder' }, showDeleted ? 'Chưa có quản trị viên nào bị xóa.' : 'Chưa có quản trị viên.'));
      return;
    }
    body.append(h('div', { class: 'table-wrap' },
      h('table', { class: 'adm-table' },
        h('thead', {}, h('tr', {},
          ['Quản trị viên', 'Vai trò', 'Trạng thái', showDeleted ? 'Người xóa' : 'Đăng nhập gần nhất', ''].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, items.map(row)))));
  }

  el.append(
    h('div', { class: 'adm-head' },
      h('h1', {}, 'Quản trị viên'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: openCreate }, 'Thêm quản trị viên')),
    h('p', { class: 'hint' }, 'Chỉ tài khoản master thấy mục này. Quản trị viên mới được cấp mật khẩu tạm và phải tự đổi ở lần đăng nhập đầu.'),
    h('div', { class: 'toolbar' }, selectBox({ label: 'Xem quản trị viên đang dùng hoặc đã xóa', value: '', onChange: (v) => { showDeleted = v === '1'; firstLoad = true; load(); }, options: [['', 'Đang dùng'], ['1', 'Đã xóa']] }).el),
    body);
  load();
  return () => {};
}
