import { h, clear, openDialog, confirmDialog, fmtDateTime, loading, searchInput, selectBox, pager, deletedInfo } from './ui.js';
import { showToast } from '../core/toast.js';
import { formatDuration } from '../core/format.js';

// Xem và gỡ playlist của người dùng. ctx: { adminApi }
export function mountPlaylists(el, ctx) {
  const api = ctx.adminApi;
  const state = { q: '', deleted: '', page: 1, perPage: 20 };
  const body = h('div', { class: 'adm-body' });
  let seq = 0;
  let firstLoad = true;

  async function load() {
    const mine = ++seq;
    if (firstLoad) { clear(body); body.append(loading()); }
    try {
      const data = await api.listPlaylists({ q: state.q, deleted: state.deleted, page: state.page, per_page: state.perPage });
      if (mine !== seq) return;
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

  function confirmDelete(p, afterClose) {
    confirmDialog({
      title: 'Xóa playlist?',
      message: `Xóa playlist "${p.name}" của ${p.user_email || 'người dùng đã xóa'} cùng ${p.count === undefined ? 'các' : p.count} bài trong đó. Hệ thống vẫn lưu người xóa và thời điểm (xem ở "Đã xóa").`,
      confirmLabel: 'Xóa playlist', danger: true,
      onConfirm: async () => { await api.deletePlaylist(p.id); showToast('Đã xóa playlist.'); if (afterClose) afterClose(); load(); },
    });
  }

  function openView(p) {
    const holder = h('div', {}, loading());
    const dlg = openDialog({ title: p.name, content: holder });
    dlg.el.classList.add('dialog-wide');
    api.getPlaylist(p.id).then((d) => {
      clear(holder);
      holder.append(
        h('p', { class: 'hint' }, `Của ${d.user_email || 'người dùng đã xóa'} · cập nhật ${fmtDateTime(d.updated_at)} · ${d.items.length} bài`),
        d.items.length
          ? h('ol', { class: 'plain-list numbered' }, d.items.map((it) => h('li', {},
              h('span', { class: 'track' }, h('strong', {}, it.title), it.uploader ? h('span', { class: 'sub' }, it.uploader) : null),
              h('span', { class: 'hint' }, formatDuration(it.duration)))))
          : h('p', { class: 'hint' }, 'Playlist này chưa có bài nào.'),
        h('div', { class: 'form-actions' },
          h('button', { type: 'button', class: 'btn btn-ghost btn-danger-text', onclick: () => confirmDelete(p, dlg.close) }, 'Xóa playlist này'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: dlg.close }, 'Đóng')));
    }).catch((e) => {
      clear(holder);
      holder.append(h('div', { class: 'notice notice-warn', role: 'alert' }, h('p', {}, e && e.message ? e.message : 'Không tải được playlist.')));
    });
  }

  function row(p) {
    const btn = (label, onClick, cls = 'btn btn-ghost btn-sm') => h('button', { type: 'button', class: cls, onclick: onClick }, label);
    return h('tr', {},
      h('td', { 'data-label': 'Playlist' }, h('strong', {}, p.name)),
      h('td', { 'data-label': 'Chủ playlist' }, h('div', { class: 'who' }, h('span', {}, p.user_email || '(đã xóa)'), p.user_name ? h('span', { class: 'sub' }, p.user_name) : null)),
      h('td', { 'data-label': 'Số bài' }, String(p.count)),
      p.deleted
        ? h('td', { 'data-label': 'Người xóa' }, deletedInfo(p.deleted))
        : h('td', { 'data-label': 'Cập nhật' }, fmtDateTime(p.updated_at)),
      h('td', { class: 'acts' }, p.deleted ? null : h('div', { class: 'acts-row' }, btn('Xem', () => openView(p)), btn('Xóa', () => confirmDelete(p, null), 'btn btn-ghost btn-sm btn-danger-text'))));
  }

  function draw(data) {
    clear(body);
    if (!data.items.length) {
      body.append(h('p', { class: 'placeholder' }, state.deleted ? 'Chưa có playlist nào bị xóa.' : (state.q ? 'Không có playlist nào khớp.' : 'Chưa có playlist nào được lưu trên tài khoản.')));
      return;
    }
    body.append(
      h('div', { class: 'table-wrap' },
        h('table', { class: 'adm-table' },
          h('thead', {}, h('tr', {}, ['Playlist', 'Chủ playlist', 'Số bài', state.deleted ? 'Người xóa' : 'Cập nhật', ''].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, data.items.map(row)))),
      pager({ page: data.page, perPage: data.per_page, total: data.total, onPage: (p) => { state.page = p; load(); window.scrollTo(0, 0); } }));
  }

  const search = searchInput({ label: 'Tìm playlist theo tên hoặc email chủ', placeholder: 'Tìm theo tên playlist hoặc email', onChange: (v) => { state.q = v; state.page = 1; load(); } });
  const show = selectBox({ label: 'Xem playlist đang dùng hoặc đã xóa', value: '', onChange: (v) => { state.deleted = v; state.page = 1; load(); }, options: [['', 'Đang dùng'], ['1', 'Đã xóa']] });
  el.append(
    h('div', { class: 'adm-head' }, h('h1', {}, 'Playlist')),
    h('p', { class: 'hint' }, 'Playlist người dùng lưu trên tài khoản (không gồm playlist khách lưu trên trình duyệt). Gỡ khi cần, mọi lần xóa đều được ghi vào nhật ký.'),
    h('div', { class: 'toolbar' }, search.el, show.el),
    body);
  load();
  return () => { search.cancel(); seq++; };
}
