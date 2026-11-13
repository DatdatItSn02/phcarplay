import {
  h, clear, field, formBox, openDialog, confirmDialog, badge, fmtDateTime, fmtDate, randomPassword, loading,
  searchInput, selectBox, pager, copyText, deletedInfo,
} from './ui.js';
import { showToast } from '../core/toast.js';
import { ApiError } from '../core/api.js';

const PASSWORD_RULE = 'Từ 6 ký tự trở lên.';

function licenseBadge(u) {
  if (u.license === 'valid') return badge(`Còn hạn đến ${fmtDate(u.expires_at)}`, 'ok');
  if (u.license === 'expired') return badge(`Hết hạn ${fmtDate(u.expires_at)}`, 'warn');
  return badge('Chưa có hạn', 'mute');
}

function statusBadge(u) {
  return u.status === 'blocked' ? badge('Đã khóa', 'warn') : badge('Hoạt động', 'ok');
}

// Mật khẩu mới vừa đặt: chỉ hiện một lần để quản trị chuyển cho người dùng.
function passwordResult({ email, password, onClose }) {
  const box = h('input', { class: 'input mono', type: 'text', readonly: true, value: password, 'aria-label': 'Mật khẩu mới', onfocus: (e) => e.target.select() });
  return h('div', { class: 'form' },
    h('div', { class: 'notice', role: 'status' }, h('p', {}, 'Đã đặt mật khẩu mới. Người dùng đã bị đăng xuất khỏi mọi thiết bị.')),
    h('div', { class: 'field' }, h('label', {}, 'Email đăng nhập'), h('p', { class: 'mono' }, email)),
    h('div', { class: 'field' }, h('label', {}, 'Mật khẩu mới (chỉ hiện một lần)'),
      h('div', { class: 'inline' }, box, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => copyText(password, 'Đã sao chép mật khẩu.') }, 'Sao chép'))),
    h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: onClose }, 'Đã chép xong')));
}

// Quản lý người dùng. ctx: { adminApi }
export function mountUsers(el, ctx) {
  const api = ctx.adminApi;
  const state = { q: '', status: '', license: '', page: 1, perPage: 20 };
  const body = h('div', { class: 'adm-body' });
  let seq = 0;
  let firstLoad = true;

  async function load() {
    const mine = ++seq;
    if (firstLoad) { clear(body); body.append(loading()); }
    try {
      const data = await api.listUsers(state.status === 'deleted'
        ? { q: state.q, deleted: '1', page: state.page, per_page: state.perPage }
        : { q: state.q, status: state.status, license: state.license, page: state.page, per_page: state.perPage });
      if (mine !== seq) return;   // đã có yêu cầu mới hơn
      firstLoad = false;
      draw(data);
    } catch (e) {
      if (mine !== seq) return;
      clear(body);
      body.append(h('div', { class: 'notice notice-warn', role: 'alert' },
        h('p', {}, e && e.message ? e.message : 'Không tải được danh sách.'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { firstLoad = true; load(); } }, 'Thử lại')));
    }
  }

  function setFilter(key, value) {
    state[key] = value;
    state.page = 1;
    load();
  }

  // ----- hộp thoại chi tiết và các thao tác -----

  function openEdit(u, done) {
    openDialog({
      title: 'Sửa thông tin người dùng',
      content: (close) => {
        const name = field({ label: 'Tên hiển thị', name: 'name', value: u.name, required: false, autocomplete: 'off' });
        const email = field({ label: 'Email đăng nhập', name: 'email', type: 'email', value: u.email, autocomplete: 'off' });
        const phone = field({ label: 'Số điện thoại đăng nhập', name: 'phone', type: 'tel', value: u.phone || '', required: false, autocomplete: 'off',
          hint: 'Số di động 10 số. Để trống = bỏ số điện thoại.' });
        return formBox({
          fields: [name, email, phone], submitLabel: 'Lưu', onCancel: close,
          submit: async (v) => { await api.updateUser(u.id, { name: v.name, email: v.email, phone: v.phone }); showToast('Đã lưu.'); close(); done(); },
        });
      },
    });
  }

  function openExpiry(u, done) {
    openDialog({
      title: `Hạn dùng của ${u.name || u.email}`,
      content: (close) => {
        const now = u.expires_at ? (u.license === 'valid' ? `Hiện còn hạn đến ${fmtDate(u.expires_at)}.` : `Đã hết hạn ngày ${fmtDate(u.expires_at)}.`) : 'Hiện chưa có hạn dùng.';
        const quick = (days) => h('button', {
          type: 'button', class: 'btn btn-ghost',
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            try { await api.extendUser(u.id, days); showToast(`Đã cộng ${days} ngày.`); close(); done(); } catch (err) { e.currentTarget.disabled = false; showToast(err.message || 'Không gia hạn được.'); }
          },
        }, `+${days} ngày`);
        const date = field({ label: 'Hoặc đặt ngày hết hạn cụ thể', name: 'expires_at', type: 'date', value: u.expires_at ? String(u.expires_at).slice(0, 10) : '', required: false, hint: 'Hạn dùng tính đến hết ngày này.' });
        const clearBtn = h('button', {
          type: 'button', class: 'btn btn-ghost btn-danger-text',
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            try { await api.updateUser(u.id, { expires_at: null }); showToast('Đã xóa hạn dùng.'); close(); done(); } catch (err) { e.currentTarget.disabled = false; showToast(err.message || 'Không xóa được hạn.'); }
          },
        }, 'Xóa hạn dùng');
        return h('div', { class: 'form' },
          h('p', { class: 'dialog-text' }, now),
          h('div', { class: 'btn-row' }, quick(30), quick(90), quick(365)),
          formBox({
            fields: [date], submitLabel: 'Đặt ngày hết hạn', onCancel: close,
            extra: u.expires_at ? h('div', { class: 'inline-actions' }, clearBtn) : null,
            submit: async (v) => {
              if (!v.expires_at) throw new ApiError(422, 'VALIDATION_FAILED', 'Chưa chọn ngày', { expires_at: 'Hãy chọn ngày hết hạn.' });
              await api.updateUser(u.id, { expires_at: v.expires_at });
              showToast('Đã đặt hạn dùng.');
              close();
              done();
            },
          }));
      },
    });
  }

  function openPassword(u, done) {
    openDialog({
      title: `Mật khẩu mới cho ${u.name || u.email}`,
      content: (close) => {
        const holder = h('div', {});
        const pw = field({ label: 'Mật khẩu mới', name: 'password', type: 'text', autocomplete: 'off', hint: PASSWORD_RULE });
        const gen = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { pw.input.value = randomPassword(); pw.input.focus(); } }, 'Tạo mật khẩu ngẫu nhiên');
        holder.append(h('p', { class: 'dialog-text' }, 'Người dùng sẽ bị đăng xuất khỏi mọi thiết bị và dùng mật khẩu này để đăng nhập lại. Họ có thể dùng "Quên mật khẩu" để tự đổi.'));
        holder.append(formBox({
          fields: [pw], extra: h('div', { class: 'inline-actions' }, gen), submitLabel: 'Đặt mật khẩu', onCancel: close,
          submit: async (v) => {
            await api.setUserPassword(u.id, v.password);
            clear(holder);
            holder.append(passwordResult({ email: u.email, password: v.password, onClose: () => { close(); done(); } }));
          },
        }));
        return holder;
      },
    });
  }

  function confirmBlock(u, done) {
    confirmDialog({
      title: 'Khóa tài khoản?',
      message: `${u.name || u.email} (${u.email}) sẽ bị đăng xuất và không đăng nhập được cho tới khi bạn mở khóa.`,
      confirmLabel: 'Khóa tài khoản', danger: true,
      onConfirm: async () => { await api.updateUser(u.id, { status: 'blocked' }); showToast('Đã khóa tài khoản.'); done(); },
    });
  }

  function confirmSimple({ title, message, label, action, okMsg, danger = false }, done) {
    confirmDialog({
      title, message, confirmLabel: label, danger,
      onConfirm: async () => { await action(); showToast(okMsg); done(); },
    });
  }

  function openDetail(id) {
    let detailClose = null;
    const holder = h('div', { class: 'user-detail' }, loading());

    async function reload() {
      try {
        const u = await api.getUser(id);
        draw(u);
      } catch (e) {
        clear(holder);
        if (e && e.status === 404) {
          holder.append(h('div', { class: 'notice notice-warn', role: 'alert' }, h('p', {}, 'Người dùng này không còn tồn tại.')));
          load();
        } else {
          holder.append(h('div', { class: 'notice notice-warn', role: 'alert' }, h('p', {}, e && e.message ? e.message : 'Không tải được.')));
        }
      }
    }
    const changed = () => { reload(); load(); };

    function draw(u) {
      clear(holder);
      const btn = (label, onClick, cls = 'btn btn-ghost') => h('button', { type: 'button', class: cls, onclick: onClick }, label);
      const closeAndRefresh = () => { if (detailClose) detailClose(); load(); };
      holder.append(
        h('dl', { class: 'info' },
          h('dt', {}, 'Email'), h('dd', {}, u.email),
          h('dt', {}, 'Số điện thoại'), h('dd', {}, u.phone || '(chưa có)'),
          h('dt', {}, 'Tên'), h('dd', {}, u.name || '(chưa đặt)'),
          h('dt', {}, 'Trạng thái'), h('dd', {}, statusBadge(u)),
          h('dt', {}, 'Hạn dùng'), h('dd', {}, licenseBadge(u)),
          h('dt', {}, 'Thiết bị'), h('dd', {}, u.device ? `${u.device.label || 'Không rõ'} · ${u.device.ip || ''} · từ ${fmtDateTime(u.device.since)}` : 'Không có thiết bị đang đăng nhập'),
          h('dt', {}, 'Đăng ký'), h('dd', {}, fmtDateTime(u.created_at) || ''),
          h('dt', {}, 'Đăng nhập gần nhất'), h('dd', {}, fmtDateTime(u.last_login_at) || 'Chưa đăng nhập')),
        h('div', { class: 'btn-row' },
          btn('Sửa thông tin', () => openEdit(u, changed)),
          btn('Hạn dùng', () => openExpiry(u, changed)),
          u.status === 'blocked'
            ? btn('Mở khóa', () => confirmSimple({ title: 'Mở khóa tài khoản?', message: `${u.email} sẽ đăng nhập lại được.`, label: 'Mở khóa', action: () => api.updateUser(u.id, { status: 'active' }), okMsg: 'Đã mở khóa tài khoản.' }, changed))
            : btn('Khóa', () => confirmBlock(u, changed)),
          btn('Mật khẩu mới', () => openPassword(u, changed)),
          u.status === 'active' ? btn('Gửi mã đặt lại mật khẩu', () => confirmSimple({ title: 'Gửi mã đặt lại mật khẩu?', message: `Mã 6 số (hiệu lực 10 phút) sẽ được gửi tới ${u.email}. Người dùng mở "Quên mật khẩu" trong ứng dụng, chọn "Đã có mã" rồi nhập mã và mật khẩu mới.`, label: 'Gửi mã', action: () => api.sendUserReset(u.id), okMsg: 'Đã gửi mã đặt lại mật khẩu.' }, changed)) : null,
          u.device ? btn('Đăng xuất thiết bị', () => confirmSimple({ title: 'Đăng xuất thiết bị?', message: 'Thiết bị đang đăng nhập sẽ bị đăng xuất. Người dùng vẫn đăng nhập lại được.', label: 'Đăng xuất thiết bị', action: () => api.logoutUserDevice(u.id), okMsg: 'Đã đăng xuất thiết bị.' }, changed)) : null,
          btn('Xóa người dùng', () => confirmDialog({
            title: 'Xóa người dùng?',
            message: `Xóa ${u.email} cùng ${u.playlist_count} playlist của họ: tài khoản không đăng nhập được nữa và bị ẩn khỏi danh sách. Hệ thống vẫn lưu người xóa và thời điểm (xem ở bộ lọc "Đã xóa"). Key họ đã nhập vẫn được giữ trong lịch sử.`,
            confirmLabel: 'Xóa vĩnh viễn', danger: true,
            onConfirm: async () => { await api.deleteUser(u.id); showToast('Đã xóa người dùng.'); closeAndRefresh(); },
          }), 'btn btn-ghost btn-danger-text')),
        h('section', { class: 'sub-block' },
          h('h3', {}, `Playlist (${u.playlists.length})`),
          u.playlists.length
            ? h('ul', { class: 'plain-list' }, u.playlists.map((p) => h('li', {}, h('span', {}, p.name), h('span', { class: 'hint' }, `${p.count} bài · ${fmtDate(p.updated_at)}`))))
            : h('p', { class: 'hint' }, 'Chưa có playlist nào.')),
        h('section', { class: 'sub-block' },
          h('h3', {}, `Key đã nhập (${u.keys.length})`),
          u.keys.length
            ? h('ul', { class: 'plain-list' }, u.keys.map((k) => h('li', {}, h('span', { class: 'mono' }, k.code), h('span', { class: 'hint' }, `+${k.days} ngày · ${fmtDate(k.used_at)}`))))
            : h('p', { class: 'hint' }, 'Chưa nhập key nào.')));
    }

    const dlg = openDialog({ title: 'Người dùng', content: holder });
    detailClose = dlg.close;
    dlg.el.classList.add('dialog-wide');
    reload();
  }

  // ----- bảng -----

  function row(u) {
    if (u.deleted) {
      return h('tr', { class: 'is-blocked' },
        h('td', { 'data-label': 'Người dùng' }, h('div', { class: 'who' }, h('strong', {}, u.name || u.email), u.name ? h('span', { class: 'sub' }, u.email) : null, u.phone ? h('span', { class: 'sub' }, u.phone) : null)),
        h('td', { 'data-label': 'Trạng thái' }, badge('Đã xóa', 'warn')),
        h('td', { 'data-label': 'Hạn dùng' }, licenseBadge(u)),
        h('td', { 'data-label': 'Người xóa' }, deletedInfo(u.deleted)),
        h('td', { 'data-label': 'Đăng nhập gần nhất' }, fmtDateTime(u.last_login_at) || 'Chưa đăng nhập'),
        h('td', { class: 'acts' }));
    }
    return h('tr', { class: u.status === 'blocked' ? 'is-blocked' : '' },
      h('td', { 'data-label': 'Người dùng' }, h('div', { class: 'who' }, h('strong', {}, u.name || u.email), u.name ? h('span', { class: 'sub' }, u.email) : null, u.phone ? h('span', { class: 'sub' }, u.phone) : null)),
      h('td', { 'data-label': 'Trạng thái' }, statusBadge(u)),
      h('td', { 'data-label': 'Hạn dùng' }, licenseBadge(u)),
      h('td', { 'data-label': 'Thiết bị' }, u.device ? (u.device.label || 'Đang đăng nhập') : '—'),
      h('td', { 'data-label': 'Đăng nhập gần nhất' }, fmtDateTime(u.last_login_at) || 'Chưa đăng nhập'),
      h('td', { class: 'acts' }, h('div', { class: 'acts-row' }, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => openDetail(u.id) }, 'Quản lý'))));
  }

  function draw(data) {
    clear(body);
    if (!data.items.length) {
      body.append(h('p', { class: 'placeholder' }, state.q || state.status || state.license ? 'Không có người dùng nào khớp bộ lọc.' : 'Chưa có người dùng nào đăng ký.'));
      return;
    }
    body.append(
      h('div', { class: 'table-wrap' },
        h('table', { class: 'adm-table' },
          h('thead', {}, h('tr', {}, ['Người dùng', 'Trạng thái', 'Hạn dùng', state.status === 'deleted' ? 'Người xóa' : 'Thiết bị', 'Đăng nhập gần nhất', ''].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, data.items.map(row)))),
      pager({ page: data.page, perPage: data.per_page, total: data.total, onPage: (p) => { state.page = p; load(); window.scrollTo(0, 0); } }));
  }

  const search = searchInput({ label: 'Tìm người dùng theo email, tên hoặc số điện thoại', placeholder: 'Tìm theo email, tên hoặc SĐT', onChange: (v) => setFilter('q', v) });
  const status = selectBox({ label: 'Lọc theo trạng thái', value: '', onChange: (v) => setFilter('status', v), options: [['', 'Mọi trạng thái'], ['active', 'Hoạt động'], ['blocked', 'Đã khóa'], ['deleted', 'Đã xóa']] });
  const license = selectBox({ label: 'Lọc theo hạn dùng', value: '', onChange: (v) => setFilter('license', v), options: [['', 'Mọi hạn dùng'], ['valid', 'Còn hạn'], ['expired', 'Hết hạn'], ['none', 'Chưa có hạn']] });

  el.append(
    h('div', { class: 'adm-head' }, h('h1', {}, 'Người dùng')),
    h('p', { class: 'hint' }, 'Người dùng tự đăng ký trên trang chính. Ở đây bạn khóa, gia hạn, đặt lại mật khẩu hoặc xóa tài khoản. Mọi thao tác đều được ghi vào nhật ký.'),
    h('div', { class: 'toolbar' }, search.el, status.el, license.el),
    body);
  load();
  return () => { search.cancel(); seq++; };
}
