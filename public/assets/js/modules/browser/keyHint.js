import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';

// Giai đoạn 10.2: nhắc nhẹ thêm khóa YouTube API riêng khi tìm kiếm phải dùng cách dự phòng hoặc lỗi
// (máy chủ gắn key_hint vào kết quả/lỗi). Không làm phiền: tối đa 1 lần mỗi ngày, bấm "Để sau" thì 7 ngày không nhắc.
// Chỉ nhớ trên thiết bị này (localStorage); trình duyệt không cho lưu thì vẫn chạy, chỉ là nhắc theo phiên.

const STORE = 'carweb.keyHint';
const DAY = 86400000;
export const SNOOZE_DAYS = 7;

function dayOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Quy tắc hiện/ẩn. storage: đối tượng kiểu localStorage (có thể null). */
export function createKeyHintPolicy({ storage = null, now = () => Date.now() } = {}) {
  let mem = { lastShown: 0, snoozeUntil: 0 };
  function load() {
    try { const v = storage ? JSON.parse(storage.getItem(STORE) || 'null') : null; if (v && typeof v === 'object') mem = Object.assign(mem, v); } catch (e) { /* bỏ qua */ }
    return mem;
  }
  function save() {
    try { if (storage) storage.setItem(STORE, JSON.stringify(mem)); } catch (e) { /* bỏ qua */ }
  }
  return {
    canShow() {
      const s = load();
      const t = now();
      return t >= (s.snoozeUntil || 0) && (!s.lastShown || dayOf(s.lastShown) !== dayOf(t));
    },
    markShown() { load(); mem.lastShown = now(); save(); },
    snooze() { load(); mem.snoozeUntil = now() + SNOOZE_DAYS * DAY; save(); },
  };
}

/**
 * Dòng nhắc. isUser: đã đăng nhập (có nút "Thêm khóa") hay khách (nút "Đăng nhập để thêm khóa").
 * onAdd(): mở mục khóa trong Cài đặt (hoặc đăng nhập). onLater(): bấm "Để sau".
 */
export function keyHintBanner({ isUser, onAdd, onLater }) {
  const el = h('div', { class: 'key-hint', role: 'note' },
    icon('key', 22),
    h('p', {}, h('b', {}, 'Tìm kiếm đang chậm?'), isUser ? ' Thêm khóa YouTube miễn phí để tìm nhanh và ổn định hơn.' : ' Đăng nhập rồi thêm khóa YouTube miễn phí để tìm nhanh và ổn định hơn.'),
    h('div', { class: 'key-hint-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { el.remove(); onAdd(); } }, isUser ? 'Thêm khóa' : 'Đăng nhập'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { el.remove(); onLater(); } }, 'Để sau')));
  return el;
}
