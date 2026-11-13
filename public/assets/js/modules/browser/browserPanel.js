import { h } from '../../core/dom.js';
import { observeSize } from '../../core/observeSize.js';
import { mountHomeView } from './homeView.js';
import { mountSearchTab } from './searchTab.js';
import { mountPlaylistsTab } from './playlistsTab.js';
import { mountQueueTab } from './queueTab.js';
import { createRecentSearches } from './recentSearches.js';

export const VIEWS = [
  { id: 'home', label: 'Trang chủ', icon: 'home' },
  { id: 'search', label: 'Tìm kiếm', icon: 'search' },
  { id: 'playlists', label: 'Playlist', icon: 'library' },
  { id: 'queue', label: 'Hàng đợi', icon: 'queue' },
];

// Bề rộng khung (đơn vị rem) -> kiểu danh sách: xs rất hẹp, s hẹp, m vừa, l rộng (lưới).
export function widthClass(rem) {
  if (rem < 21) return 'xs';
  if (rem < 28) return 's';
  return rem >= 47 ? 'l' : 'm';
}

// Khung bên phải: bốn mục (Trang chủ, Tìm kiếm, Playlist, Hàng đợi) chọn từ thanh điều hướng.
// Mỗi mục dựng một lần rồi chỉ ẩn/hiện, nên kết quả tìm kiếm và vị trí cuộn còn nguyên khi chuyển mục.
// mount() trả về { show(id, opts), current(), onChange(fn), destroy() }.
export const browserPanel = {
  id: 'browser',
  title: 'Danh sách',
  mount(container, ctx) {
    const root = h('div', { class: 'browse' });
    const views = {};
    const handles = {};
    const listeners = [];
    let active = null;
    const recent = createRecentSearches();

    VIEWS.forEach((v) => {
      views[v.id] = h('section', { class: 'view', 'data-view': v.id, 'aria-label': v.label, hidden: true });
      root.append(views[v.id]);
    });
    container.append(root);

    // Bề rộng khung (tính theo rem để chế độ Chữ lớn cũng đúng) quyết định kiểu danh sách: s / m / l (xem app.css).
    const stopSize = observeSize(root, (w) => {
      if (!w) return;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const r = w / rem;
      root.setAttribute('data-w', widthClass(r));
    });

    function show(id, opts) {
      const target = views[id] ? id : 'home';
      active = target;
      VIEWS.forEach((v) => { views[v.id].hidden = v.id !== target; });
      const hd = handles[target];
      if (hd && hd.activate) hd.activate(opts || {});
      listeners.slice().forEach((fn) => fn(target));
    }

    const viewCtx = Object.assign({}, ctx, { recent, openSearch: (opts) => show('search', opts) });
    handles.home = mountHomeView(views.home, viewCtx);
    handles.search = mountSearchTab(views.search, viewCtx);
    handles.playlists = mountPlaylistsTab(views.playlists, viewCtx);
    handles.queue = mountQueueTab(views.queue, viewCtx);
    show('home');

    return {
      show,
      current: () => active,
      refreshHome() { if (handles.home && handles.home.activate) handles.home.activate(); },   // vừa xóa danh sách hay nghe
      onChange(fn) { listeners.push(fn); },
      destroy() { stopSize(); Object.keys(handles).forEach((k) => { if (handles[k] && handles[k].destroy) handles[k].destroy(); }); },
    };
  },
};
