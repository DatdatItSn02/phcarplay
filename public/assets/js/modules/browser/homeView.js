import { h, clear } from '../../core/dom.js';
import { videoRow, skeletonRows, emptyState } from '../youtube/videoRow.js';
import { videoMenu } from '../youtube/videoActions.js';
import { fakeSearchBar } from './searchBar.js';
import { mergeHome, LIMIT as HOME_LIMIT } from '../youtube/playStats.js';
import { showToast } from '../../core/toast.js';

// Danh mục mặc định khi máy chủ không gửi (giống App\Services\HomeChips::DEFAULT).
export const DEFAULT_CHIPS = [
  { label: 'Nhạc Việt', q: 'nhạc Việt mới nhất' },
  { label: 'Nhạc trẻ', q: 'nhạc trẻ hay nhất' },
  { label: 'Bolero', q: 'nhạc bolero trữ tình' },
  { label: 'Lofi', q: 'nhạc lofi chill' },
  { label: 'Remix', q: 'nhạc remix sôi động' },
  { label: 'Không lời', q: 'nhạc không lời thư giãn' },
  { label: 'Podcast', q: 'podcast tiếng Việt' },
];

/**
 * Trang chủ: danh mục bấm một lần (không phải gõ) và danh sách video.
 * Khung hẹp: dòng video (ảnh bên trái); khung rộng: lưới thẻ như trang chủ YouTube.
 * Tab "Tất cả" (giai đoạn 11): bài người dùng hay nghe đứng đầu (tối đa 20), thiếu thì thêm bài gợi ý cho đủ 20.
 * ctx: { media, homeChips, openSearch(opts) }
 */
export function mountHomeView(el, ctx) {
  const { media } = ctx;
  const { youtube, controller } = media;
  const chips = [{ label: 'Tất cả', q: '' }].concat(Array.isArray(ctx.homeChips) && ctx.homeChips.length ? ctx.homeChips : (ctx.homeChips ? [] : DEFAULT_CHIPS));
  const cache = {};
  let active = 0;
  let seq = 0;
  let loading = false;

  const chipEls = chips.map((c, i) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(i === 0), onclick: () => select(i) }, c.label));
  const chipRow = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Danh mục' }, chipEls);
  const list = h('ul', { class: 'vlist can-grid', 'aria-label': 'Video' });
  const status = h('div', {});
  const moreBtn = h('button', { type: 'button', class: 'btn btn-ghost', hidden: true, onclick: () => loadMore() }, 'Tải thêm');
  const sentinel = h('div', { class: 'more-row' }, moreBtn);

  const rowFor = (item) => videoRow(item, {
    onPlay: () => controller.playNow(item),
    menu: () => videoMenu(item, media, item.frequent && media.playStats ? [{
      icon: 'close', label: 'Ẩn khỏi bài bạn hay nghe',
      onClick: async () => {
        try { await media.playStats.hide(item.id); showToast('Đã ẩn. Nếu nghe lại nhiều lần, bài sẽ hiện lại.'); } catch (e) { showToast((e && e.message) || 'Chưa ẩn được.'); }
        refreshAll();
      },
    }] : []),
  });

  // Tab "Tất cả": danh sách gợi ý (lưu đệm) + bài hay nghe (đọc mới mỗi lần, vì vừa nghe thêm bài).
  async function loadAll() {
    const [trend, top] = await Promise.all([
      cache['*'] ? Promise.resolve(cache['*'].base) : youtube.trending().then((d) => (d && d.items) || []),
      media.playStats ? media.playStats.top(HOME_LIMIT).catch(() => []) : Promise.resolve([]),
    ]);
    cache['*'] = { base: trend, items: mergeHome(top, trend, HOME_LIMIT), next: null };
    return cache['*'];
  }
  // Cập nhật nhóm bài hay nghe khi danh sách "Tất cả" ĐÃ hiện (không chen vào lần tải đầu: lỗi lần đầu phải hiện nút "Thử lại").
  async function refreshAll() {
    if (active !== 0 || !cache['*']) return;
    const mine = seq;
    try { const entry = await loadAll(); if (mine === seq && active === 0) draw(entry); } catch (e) { /* giữ danh sách đang có */ }
  }

  function draw(entry) {
    clear(list);
    clear(status);
    entry.items.forEach((it) => list.append(rowFor(it)));
    if (!entry.items.length) status.append(emptyState({ iconName: 'music', title: 'Chưa có video', text: 'Danh mục này chưa có video. Hãy thử danh mục khác hoặc tìm kiếm.' }));
    moreBtn.hidden = !entry.next;
  }

  async function select(i) {
    active = i;
    chipEls.forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
    const chip = chips[i];
    const key = chip.q || '*';
    if (cache[key] && chip.q) { draw(cache[key]); return; }
    if (cache[key]) { draw(cache[key]); refreshAll(); return; }   // "Tất cả": hiện ngay bản cũ rồi cập nhật bài hay nghe
    const mine = ++seq;
    clear(list);
    clear(status);
    list.append(...skeletonRows(6));   // append của DOM không tự trải mảng (trước đây hiện chữ "[object HTMLLIElement]")
    moreBtn.hidden = true;
    try {
      if (!chip.q) {
        const entry = await loadAll();
        if (mine !== seq) return;
        draw(entry);
        return;
      }
      const data = await youtube.search(chip.q, null);
      if (mine !== seq) return;
      cache[key] = { items: data.items || [], next: data.next || null };
      draw(cache[key]);
    } catch (e) {
      if (mine !== seq) return;
      clear(list);
      clear(status);
      status.append(emptyState({ iconName: 'error', title: 'Chưa tải được video', text: (e && e.message) || 'Kiểm tra mạng rồi thử lại.', action: { label: 'Thử lại', icon: 'refresh', onClick: () => select(i) } }));
    }
  }

  async function loadMore() {
    const chip = chips[active];
    const key = chip.q || '*';
    const entry = cache[key];
    if (loading || !entry || !entry.next || !chip.q) return;
    loading = true;
    moreBtn.disabled = true;
    const mine = seq;
    try {
      const data = await youtube.search(chip.q, entry.next);
      if (mine !== seq || chips[active] !== chip) return;
      const fresh = (data.items || []).filter((it) => !entry.items.some((x) => x.id === it.id));
      entry.items = entry.items.concat(fresh);
      entry.next = data.next || null;
      fresh.forEach((it) => list.append(rowFor(it)));
      moreBtn.hidden = !entry.next;
    } catch (e) {
      /* giữ nút "Tải thêm" để thử lại */
    } finally {
      loading = false;
      moreBtn.disabled = false;
    }
  }

  // Cuộn gần tới cuối thì tự tải thêm (trình duyệt cũ không có IntersectionObserver thì bấm nút).
  let io = null;
  if (typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver((entries) => { if (entries.some((x) => x.isIntersecting) && !moreBtn.hidden) loadMore(); }, { root: el, rootMargin: '0px 0px 240px 0px' });
    io.observe(sentinel);
  }

  el.append(
    h('header', { class: 'view-head' },
      fakeSearchBar({ onOpen: () => ctx.openSearch({ focus: true }), onVoice: (text) => ctx.openSearch({ query: text }), voice: ctx.voice || null, hold: ctx.voicePause || null }),
      chipRow),
    h('div', { class: 'view-body' }, list, status, sentinel));

  select(0);
  return {
    activate() { refreshAll(); },   // quay lại Trang chủ: cập nhật bài hay nghe
    destroy() { if (io) io.disconnect(); },
  };
}
