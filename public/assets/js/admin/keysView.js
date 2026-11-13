import {
  h, clear, field, formBox, openDialog, confirmDialog, badge, fmtDateTime, fmtDate, loading,
  searchInput, selectBox, pager, copyText, downloadText, csvCell, deletedInfo,
} from './ui.js';
import { showToast } from '../core/toast.js';

const STATUS = { unused: ['Chưa dùng', 'mint'], used: ['Đã dùng', 'ok'], revoked: ['Đã thu hồi', 'warn'] };

function statusBadge(k) {
  const s = STATUS[k.status] || [k.status, 'mute'];
  return badge(s[0], s[1]);
}

function keysToCsv(items) {
  const head = ['Key', 'Số ngày', 'Ghi chú', 'Trạng thái', 'Người dùng', 'Ngày dùng', 'Ngày tạo'];
  const rows = items.map((k) => [k.code, k.days, k.note, (STATUS[k.status] || [k.status])[0], k.used_by_email || '', fmtDateTime(k.used_at), fmtDateTime(k.created_at)]);
  return [head].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n');
}

// Hộp kết quả sau khi tạo: key chỉ cần xem lại ở danh sách, nhưng đây là lúc tiện nhất để sao chép cả lô.
function createdResult(items, days, onClose) {
  const text = items.map((k) => k.code).join('\n');
  return h('div', { class: 'form' },
    h('div', { class: 'notice', role: 'status' }, h('p', {}, `Đã tạo ${items.length} key, mỗi key cộng ${days} ngày dùng. Mỗi key chỉ dùng được một lần.`)),
    h('textarea', { class: 'input mono keybox', readonly: true, rows: Math.min(10, items.length + 1), 'aria-label': 'Danh sách key vừa tạo', onfocus: (e) => e.target.select() }, text),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => copyText(text, `Đã sao chép ${items.length} key.`) }, 'Sao chép tất cả'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => downloadText(`key-kich-hoat-${new Date().toISOString().slice(0, 10)}.csv`, keysToCsv(items)) }, 'Tải CSV')),
    h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: onClose }, 'Xong')));
}

// Quản lý key kích hoạt. ctx: { adminApi }
// Chọn nhiều key bằng ô tích (trong trang đang xem) để thu hồi, xóa, sao chép hoặc tải CSV một lần.
export function mountKeys(el, ctx) {
  const api = ctx.adminApi;
  const state = { q: '', status: '', page: 1, perPage: 20 };
  const body = h('div', { class: 'adm-body' });
  const summary = h('div', { class: 'badges', 'aria-live': 'polite' });
  const bulkBar = h('div', { class: 'bulkbar', role: 'region', 'aria-label': 'Thao tác với các key đã chọn', hidden: true });
  const selected = new Map();   // id -> key, chỉ trong trang đang xem
  let pageItems = [];
  let headCheck = null;
  let seq = 0;
  let firstLoad = true;
  const deletedView = () => state.status === 'deleted';

  async function load() {
    const mine = ++seq;
    if (firstLoad) { clear(body); body.append(loading()); }
    try {
      const filter = deletedView() ? { deleted: '1' } : { status: state.status };
      const data = await api.listKeys(Object.assign({ q: state.q, page: state.page, per_page: state.perPage }, filter));
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

  function setFilter(key, value) {
    state[key] = value;
    state.page = 1;
    load();
  }

  function openCreate() {
    openDialog({
      title: 'Tạo key kích hoạt',
      content: (close) => {
        const holder = h('div', {});
        const count = field({ label: 'Số lượng key', name: 'count', type: 'number', value: '10', hint: 'Từ 1 đến 100 key mỗi lần.' });
        const days = field({ label: 'Mỗi key cộng bao nhiêu ngày', name: 'days', type: 'number', value: '30', hint: 'Ví dụ 30, 90, 365.' });
        const note = field({ label: 'Ghi chú (không bắt buộc)', name: 'note', required: false, autocomplete: 'off', hint: 'Ví dụ tên khách hoặc lô bán hàng, để tìm lại sau.' });
        holder.append(formBox({
          fields: [count, days, note], submitLabel: 'Tạo key', onCancel: close,
          submit: async (v) => {
            const made = await api.createKeys({ count: Number(v.count), days: Number(v.days), note: v.note });
            clear(holder);
            holder.append(createdResult(made.items, made.items[0].days, close));
            state.page = 1;
            load();
          },
        }));
        return holder;
      },
    });
  }

  function confirmRevoke(k) {
    confirmDialog({
      title: 'Thu hồi key?',
      message: `Key ${k.code} sẽ không còn nhập được nữa. Không thể hoàn tác.`,
      confirmLabel: 'Thu hồi key', danger: true,
      onConfirm: async () => { await api.revokeKey(k.id); showToast('Đã thu hồi key.'); load(); },
    });
  }

  function confirmDelete(k) {
    confirmDialog({
      title: 'Xóa key?',
      message: `Key ${k.code} sẽ bị ẩn khỏi danh sách và không nhập được nữa. Hệ thống vẫn lưu người xóa và thời điểm (xem ở bộ lọc "Đã xóa").`,
      confirmLabel: 'Xóa key', danger: true,
      onConfirm: async () => { await api.deleteKey(k.id); showToast('Đã xóa key.'); load(); },
    });
  }

  // ---------- chọn nhiều ----------

  function syncSelection() {
    const n = selected.size;
    if (headCheck) {
      headCheck.checked = n > 0 && n === pageItems.length;
      headCheck.indeterminate = n > 0 && n < pageItems.length;
    }
    for (const box of body.querySelectorAll('input[data-key-id]')) {
      const on = selected.has(Number(box.dataset.keyId));
      box.checked = on;
      box.closest('tr').classList.toggle('is-selected', on);
    }
    drawBulkBar();
  }

  function toggle(k, on) {
    if (on) selected.set(k.id, k); else selected.delete(k.id);
    syncSelection();
  }

  function toggleAll(on) {
    selected.clear();
    if (on) for (const k of pageItems) selected.set(k.id, k);
    syncSelection();
  }

  function runBulk(action) {
    const keys = Array.from(selected.values());
    const ok = keys.filter((k) => (action === 'revoke' ? k.status === 'unused' : k.status !== 'used'));
    const skip = keys.length - ok.length;
    const verb = action === 'revoke' ? 'Thu hồi' : 'Xóa';
    if (!ok.length) {
      showToast(action === 'revoke' ? 'Không có key "Chưa dùng" nào trong các key đã chọn.' : 'Key đã dùng được giữ làm lịch sử, không xóa được.');
      return;
    }
    confirmDialog({
      title: `${verb} ${ok.length} key?`,
      message: (action === 'revoke'
        ? `${ok.length} key sẽ không còn nhập được nữa. Không thể hoàn tác.`
        : `${ok.length} key sẽ bị ẩn khỏi danh sách và không nhập được nữa. Hệ thống vẫn lưu người xóa và thời điểm.`)
        + (skip ? ` Bỏ qua ${skip} key ${action === 'revoke' ? 'đã dùng hoặc đã thu hồi' : 'đã dùng'}.` : ''),
      confirmLabel: `${verb} ${ok.length} key`, danger: true,
      onConfirm: async () => {
        const r = await api.bulkKeys(action, ok.map((k) => k.id));
        const skipped = r.skipped.length + skip;
        showToast(`Đã ${verb.toLowerCase()} ${r.done.length} key${skipped ? `, bỏ qua ${skipped} key` : ''}.`);
        load();
      },
    });
  }

  function drawBulkBar() {
    clear(bulkBar);
    const keys = Array.from(selected.values());
    bulkBar.hidden = keys.length === 0;
    if (!keys.length) return;
    const btn = (label, onClick, cls = 'btn btn-ghost btn-sm') => h('button', { type: 'button', class: cls, onclick: onClick }, label);
    const text = keys.map((k) => k.code).join('\n');
    const acts = [];
    if (!deletedView()) {
      acts.push(btn(`Thu hồi (${keys.filter((k) => k.status === 'unused').length})`, () => runBulk('revoke')));
      acts.push(btn(`Xóa (${keys.filter((k) => k.status !== 'used').length})`, () => runBulk('delete'), 'btn btn-ghost btn-sm btn-danger-text'));
    }
    acts.push(btn('Sao chép mã', () => copyText(text, `Đã sao chép ${keys.length} key.`)));
    acts.push(btn('Tải CSV', () => downloadText(`key-da-chon-${new Date().toISOString().slice(0, 10)}.csv`, keysToCsv(keys))));
    acts.push(btn('Bỏ chọn', () => toggleAll(false)));
    bulkBar.append(h('strong', { class: 'bulk-count' }, `Đã chọn ${keys.length} key`), h('div', { class: 'acts-row' }, acts));
  }

  function checkCell(k) {
    const box = h('input', { type: 'checkbox', class: 'check', 'data-key-id': k.id, 'aria-label': `Chọn key ${k.code}`, onchange: (e) => toggle(k, e.target.checked) });
    return h('td', { class: 'check-cell', 'data-label': 'Chọn' }, h('label', { class: 'check-hit' }, box));
  }

  function row(k, i) {
    const btn = (label, onClick, cls = 'btn btn-ghost btn-sm') => h('button', { type: 'button', class: cls, onclick: onClick }, label);
    const acts = [btn('Sao chép', () => copyText(k.code, 'Đã sao chép key.'))];
    if (!k.deleted && k.status === 'unused') acts.push(btn('Thu hồi', () => confirmRevoke(k)));
    if (!k.deleted && k.status !== 'used') acts.push(btn('Xóa', () => confirmDelete(k), 'btn btn-ghost btn-sm btn-danger-text'));
    return h('tr', { class: k.status === 'unused' && !k.deleted ? '' : 'is-blocked' },
      checkCell(k),
      h('td', { class: 'num', 'data-label': 'STT' }, String((state.page - 1) * state.perPage + i + 1)),
      h('td', { 'data-label': 'Key' }, h('span', { class: 'mono keycode' }, k.code)),
      h('td', { 'data-label': 'Số ngày' }, `${k.days} ngày`),
      h('td', { 'data-label': 'Trạng thái' }, statusBadge(k)),
      h('td', { 'data-label': 'Ghi chú' }, k.note || '—'),
      h('td', { 'data-label': 'Người dùng' }, k.status === 'used' ? h('div', { class: 'who' }, h('span', {}, k.used_by_email || `#${k.used_by}`), h('span', { class: 'sub' }, fmtDateTime(k.used_at))) : '—'),
      h('td', { 'data-label': 'Tạo lúc' }, h('div', { class: 'who' }, h('span', {}, fmtDate(k.created_at)), k.created_by_email ? h('span', { class: 'sub' }, k.created_by_email) : null)),
      deletedView() ? h('td', { 'data-label': 'Người xóa' }, deletedInfo(k.deleted)) : null,
      h('td', { class: 'acts' }, h('div', { class: 'acts-row' }, acts)));
  }

  function draw(data) {
    clear(summary);
    const c = data.counts || {};
    summary.append(badge(`Chưa dùng: ${c.unused || 0}`, 'mint'), badge(`Đã dùng: ${c.used || 0}`, 'ok'), badge(`Đã thu hồi: ${c.revoked || 0}`, 'warn'));
    clear(body);
    selected.clear();
    pageItems = data.items;
    state.perPage = data.per_page || state.perPage;
    headCheck = null;
    drawBulkBar();
    if (!data.items.length) {
      body.append(h('p', { class: 'placeholder' }, deletedView() ? 'Chưa có key nào bị xóa.' : (state.q || state.status ? 'Không có key nào khớp bộ lọc.' : 'Chưa có key nào. Bấm "Tạo key" để tạo.')));
      return;
    }
    headCheck = h('input', { type: 'checkbox', class: 'check', 'aria-label': 'Chọn tất cả key trong trang này', onchange: (e) => toggleAll(e.target.checked) });
    const cols = ['Key', 'Số ngày', 'Trạng thái', 'Ghi chú', 'Người dùng', 'Tạo lúc'].concat(deletedView() ? ['Người xóa'] : []).concat(['']);
    body.append(
      h('div', { class: 'table-wrap' },
        h('table', { class: 'adm-table' },
          h('thead', {}, h('tr', {},
            h('th', { scope: 'col', class: 'check-cell' }, h('label', { class: 'check-hit' }, headCheck)),
            h('th', { scope: 'col', class: 'num' }, 'STT'),
            cols.map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, data.items.map(row)))),
      pager({ page: data.page, perPage: data.per_page, total: data.total, onPage: (p) => { state.page = p; load(); window.scrollTo(0, 0); } }));
  }

  const search = searchInput({ label: 'Tìm key theo mã, ghi chú hoặc email người dùng', placeholder: 'Tìm theo mã, ghi chú, email', onChange: (v) => setFilter('q', v) });
  const status = selectBox({ label: 'Lọc theo trạng thái key', value: '', onChange: (v) => setFilter('status', v), options: [['', 'Mọi trạng thái'], ['unused', 'Chưa dùng'], ['used', 'Đã dùng'], ['revoked', 'Đã thu hồi'], ['deleted', 'Đã xóa']] });

  el.append(
    h('div', { class: 'adm-head' },
      h('h1', {}, 'Key kích hoạt'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: openCreate }, 'Tạo key')),
    h('p', { class: 'hint' }, 'Mỗi key dùng một lần, cộng thêm số ngày đã định vào tài khoản của người nhập. Người dùng nhập key ở Cài đặt > Nhập key kích hoạt trên trang chính.'),
    summary,
    h('div', { class: 'toolbar' }, search.el, status.el),
    body,
    bulkBar);
  load();
  return () => { search.cancel(); seq++; };
}
