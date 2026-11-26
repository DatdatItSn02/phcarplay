import { h, clear, fmtDateTime, loading, searchInput, selectBox, dateBox, pager, badge } from './ui.js';
import { actionLabel, targetLabel } from './labels.js';

// Nhật ký thao tác (chỉ master). ctx: { adminApi }
export function mountAudit(el, ctx) {
  const api = ctx.adminApi;
  const state = { q: '', action: '', from: '', to: '', page: 1, perPage: 30 };
  const body = h('div', { class: 'adm-body' });
  const actionHolder = h('div', { class: 'tool-slot' });
  let actionSelect = null;
  let seq = 0;
  let firstLoad = true;

  async function load() {
    const mine = ++seq;
    if (firstLoad) { clear(body); body.append(loading()); }
    try {
      const data = await api.listAudit({ q: state.q, action: state.action, from: state.from, to: state.to, page: state.page, per_page: state.perPage });
      if (mine !== seq) return;
      firstLoad = false;
      drawActions(data.actions || []);
      draw(data);
    } catch (e) {
      if (mine !== seq) return;
      clear(body);
      body.append(h('div', { class: 'notice notice-warn', role: 'alert' },
        h('p', {}, e && e.message ? e.message : 'Không tải được nhật ký.'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { firstLoad = true; load(); } }, 'Thử lại')));
    }
  }

  function setFilter(key, value) {
    state[key] = value;
    state.page = 1;
    load();
  }

  // Ô lọc hành động được dựng lại khi danh sách hành động có thêm mục mới, giữ nguyên lựa chọn hiện tại.
  let lastActions = '';
  function drawActions(actions) {
    const sig = actions.join('|');
    if (sig === lastActions && actionSelect) return;
    lastActions = sig;
    const options = [['', 'Mọi hành động']].concat(actions.map((a) => [a, actionLabel(a)]));
    actionSelect = selectBox({ label: 'Lọc theo hành động', value: state.action, onChange: (v) => setFilter('action', v), options });
    clear(actionHolder);
    actionHolder.append(actionSelect.el);
  }

  function row(r) {
    return h('tr', {},
      h('td', { 'data-label': 'Thời gian' }, fmtDateTime(r.created_at)),
      h('td', { 'data-label': 'Người làm' }, r.admin_email || badge('Hệ thống', 'mute')),
      h('td', { 'data-label': 'Hành động' }, h('div', { class: 'who' }, h('strong', {}, actionLabel(r.action)), h('span', { class: 'sub mono' }, r.action))),
      h('td', { 'data-label': 'Đối tượng' }, targetLabel(r.target_type, r.target_id) || '—'),
      h('td', { 'data-label': 'Chi tiết', class: 'detail-cell' }, r.detail || '—'),
      h('td', { 'data-label': 'Địa chỉ IP' }, h('span', { class: 'mono' }, r.ip || '—')));
  }

  function draw(data) {
    clear(body);
    if (!data.items.length) {
      body.append(h('p', { class: 'placeholder' }, state.q || state.action || state.from || state.to ? 'Không có dòng nhật ký nào khớp bộ lọc.' : 'Nhật ký còn trống.'));
      return;
    }
    body.append(
      h('div', { class: 'table-wrap' },
        h('table', { class: 'adm-table' },
          h('thead', {}, h('tr', {}, ['Thời gian', 'Người làm', 'Hành động', 'Đối tượng', 'Chi tiết', 'Địa chỉ IP'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, data.items.map(row)))),
      pager({ page: data.page, perPage: data.per_page, total: data.total, onPage: (p) => { state.page = p; load(); window.scrollTo(0, 0); } }));
  }

  const search = searchInput({ label: 'Tìm trong nhật ký theo email người làm hoặc chi tiết', placeholder: 'Tìm theo email hoặc chi tiết', onChange: (v) => setFilter('q', v) });
  const from = dateBox({ label: 'Từ ngày', onChange: (v) => setFilter('from', v) });
  const to = dateBox({ label: 'Đến ngày', onChange: (v) => setFilter('to', v) });

  el.append(
    h('div', { class: 'adm-head' }, h('h1', {}, 'Nhật ký thao tác')),
    h('p', { class: 'hint' }, 'Ai đã làm gì, lúc nào, từ địa chỉ IP nào. Nhật ký chỉ thêm, không sửa hay xóa được và không bao giờ chứa mật khẩu. Chỉ tài khoản master thấy mục này.'),
    h('div', { class: 'toolbar' }, search.el, actionHolder, from.el, to.el),
    body);
  load();
  return () => { search.cancel(); seq++; };
}
