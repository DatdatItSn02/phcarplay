import { h, clear } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { videoRow, skeletonRows, emptyState } from '../youtube/videoRow.js';
import { videoMenu } from '../youtube/videoActions.js';
import { createRecentSearches } from './recentSearches.js';
import { micButton } from './searchBar.js';
import { createKeyHintPolicy, keyHintBanner } from './keyHint.js';

/**
 * Mục Tìm kiếm: ô tìm lớn, tìm gần đây (bấm lại thay vì gõ), gợi ý khi gõ, tìm bằng giọng nói,
 * kết quả có ảnh/tên/kênh/lượt xem, nút ⋮ cho các thao tác, cuộn tới cuối thì tự tải thêm.
 * activate({ focus, query }): được gọi mỗi lần mở mục này.
 */
export function mountSearchTab(container, { media, recent: recentStore, keyHint = null, voice = null, voicePause = null }) {
  const { youtube, controller } = media;
  // Nhắc thêm khóa YouTube API riêng (keyHint: { isUser, openKeySettings, policy }) - null = không nhắc.
  let hintStorage = null;
  try { hintStorage = window.localStorage; } catch (e) { hintStorage = null; }
  const hintPolicy = keyHint ? (keyHint.policy || createKeyHintPolicy({ storage: hintStorage })) : null;
  const hintSlot = h('div', {});
  function maybeHint(flag) {
    if (!flag || !keyHint || !hintPolicy || hintSlot.firstChild || !hintPolicy.canShow()) return;
    hintPolicy.markShown();
    hintSlot.append(keyHintBanner({ isUser: keyHint.isUser, onAdd: () => keyHint.openKeySettings(), onLater: () => hintPolicy.snooze() }));
  }
  const recent = recentStore || createRecentSearches();
  let query = '';
  let next = null;
  let loading = false;
  let suggestTimer = null;
  let suggestSeq = 0;
  let searchSeq = 0;

  const input = h('input', { class: 'search-input', type: 'search', placeholder: 'Tìm bài hát, video...', 'aria-label': 'Tìm kiếm video', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search', maxlength: '100' });
  const clearBtn = h('button', { type: 'button', class: 'btn-icon search-clear', 'aria-label': 'Xóa chữ đã gõ', hidden: true, onclick: () => { input.value = ''; onType(); input.focus(); } }, icon('close'));
  const form = h('form', { class: 'searchbar', role: 'search', onsubmit: (e) => { e.preventDefault(); search(input.value); } },
    h('div', { class: 'search-field' }, input, clearBtn,
      h('button', { class: 'search-go', type: 'submit', 'aria-label': 'Tìm', title: 'Tìm' }, icon('search', 26))),
    micButton((text) => search(text), voice, voicePause));

  // ba vùng: tìm gần đây / gợi ý / kết quả (mỗi lúc chỉ hiện một)
  const recentBox = h('div', {});
  const suggestBox = h('ul', { class: 'suggest', role: 'listbox', 'aria-label': 'Gợi ý tìm kiếm' });
  const resultsBox = h('div', {});
  const status = h('div', { role: 'status' });
  const list = h('ul', { class: 'vlist can-grid', 'aria-label': 'Kết quả tìm kiếm' });
  const moreBtn = h('button', { type: 'button', class: 'btn btn-ghost more', hidden: true, onclick: () => run(false) }, 'Tải thêm');
  const sentinel = h('div', { class: 'more-row' }, moreBtn);
  resultsBox.append(hintSlot, status, list, sentinel);

  function showPanel(which) {
    recentBox.hidden = which !== 'recent';
    suggestBox.hidden = which !== 'suggest';
    resultsBox.hidden = which !== 'results';
  }

  function drawRecent() {
    clear(recentBox);
    const items = recent.list();
    if (!items.length) {
      recentBox.append(emptyState({ iconName: 'search', title: 'Tìm video, bài hát', text: 'Gõ vào ô tìm kiếm hoặc bấm micro để nói. Các lần tìm gần đây sẽ hiện ở đây để bấm lại.' }));
      return;
    }
    recentBox.append(
      h('div', { class: 'list-head' },
        h('h3', { class: 'list-title' }, 'Tìm kiếm gần đây'),
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { recent.clear(); drawRecent(); } }, 'Xóa tất cả')),
      h('ul', { class: 'suggest' }, items.map((q) => h('li', { class: 'recent-item' },
        h('button', { type: 'button', class: 'suggest-main', onclick: () => search(q) }, icon('history'), h('span', {}, q)),
        h('button', { type: 'button', class: 'btn-icon', 'aria-label': `Xóa "${q}" khỏi tìm kiếm gần đây`, onclick: () => { recent.remove(q); drawRecent(); } }, icon('close'))))));
  }

  const rowFor = (item) => videoRow(item, { onPlay: () => controller.playNow(item), menu: () => videoMenu(item, media) });

  async function run(fresh) {
    if (loading || !query) return;
    loading = true;
    const seq = fresh ? ++searchSeq : searchSeq;
    moreBtn.disabled = true;
    clear(status);
    if (fresh) { clear(hintSlot); clear(list); next = null; moreBtn.hidden = true; list.append(...skeletonRows(6)); }
    try {
      const data = await youtube.search(query, fresh ? null : next);
      if (seq !== searchSeq) return;
      if (fresh) clear(list);
      const have = new Set(Array.from(list.children).map((li) => li.getAttribute('data-id')));
      (data.items || []).forEach((it) => { if (!have.has(it.id)) list.append(rowFor(it)); });
      next = data.next || null;
      maybeHint(data.key_hint === true);
      if (!list.children.length) status.append(emptyState({ iconName: 'search', title: 'Không tìm thấy video nào', text: 'Hãy thử từ khóa khác.' }));
    } catch (e) {
      if (seq !== searchSeq) return;
      if (fresh) clear(list);
      maybeHint(Boolean(e && e.details && e.details.key_hint));
      status.append(emptyState({ iconName: 'error', title: 'Không tìm được', text: (e && e.message) || 'Vui lòng thử lại.', action: { label: 'Thử lại', icon: 'refresh', onClick: () => run(fresh) } }));
    } finally {
      if (seq === searchSeq) {
        loading = false;
        moreBtn.disabled = false;
        moreBtn.hidden = !next;
      }
    }
  }

  /** Trả về Promise xong khi có kết quả (hoặc báo lỗi): tìm bằng giọng nói đợi nó rồi mới phát nhạc tiếp. */
  function search(q) {
    const text = String(q || '').trim();
    if (!text) { input.focus(); return Promise.resolve(); }
    clearTimeout(suggestTimer);
    suggestSeq++;
    query = text;
    input.value = text;
    clearBtn.hidden = false;
    recent.add(text);
    showPanel('results');
    loading = false;
    const done = run(true);
    input.blur();   // ẩn bàn phím ảo để thấy kết quả
    return done;
  }

  function onType() {
    clearTimeout(suggestTimer);
    const q = input.value.trim();
    clearBtn.hidden = !input.value;
    if (!q) { suggestSeq++; drawRecent(); showPanel('recent'); return; }   // ô trống: hiện các lần tìm gần đây để bấm lại
    if (q === query) { showPanel('results'); return; }
    const mine = ++suggestSeq;
    suggestTimer = setTimeout(async () => {
      try {
        const { suggestions } = await youtube.suggest(q);
        if (mine !== suggestSeq) return;
        clear(suggestBox);
        suggestions.forEach((s) => suggestBox.append(h('li', { class: 'suggest-item' },
          h('button', { type: 'button', role: 'option', class: 'suggest-main', onclick: () => search(s) }, icon('search'), h('span', {}, s)),
          h('button', { type: 'button', class: 'btn-icon', 'aria-label': `Điền "${s}" vào ô tìm kiếm`, title: 'Điền vào ô tìm kiếm',
            onclick: () => { input.value = `${s} `; input.focus(); onType(); } }, icon('northWest')))));
        showPanel(suggestions.length ? 'suggest' : (query ? 'results' : 'recent'));
      } catch (e) { /* gợi ý lỗi thì bỏ qua, vẫn bấm Tìm được */ }
    }, 250);
  }
  input.addEventListener('input', onType);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !suggestBox.hidden) { e.preventDefault(); showPanel(query ? 'results' : 'recent'); } });

  let io = null;
  if (typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver((entries) => { if (entries.some((x) => x.isIntersecting) && !moreBtn.hidden && !loading) run(false); }, { root: container, rootMargin: '0px 0px 240px 0px' });
    io.observe(sentinel);
  }

  container.append(h('header', { class: 'view-head' }, form), h('div', { class: 'view-body' }, recentBox, suggestBox, resultsBox));
  drawRecent();
  showPanel('recent');

  return {
    activate(opts) {
      const o = opts || {};
      if (o.query) return search(o.query);
      if (!query) drawRecent();
      if (o.focus) setTimeout(() => input.focus(), 0);
    },
    destroy() { if (io) io.disconnect(); clearTimeout(suggestTimer); },
  };
}
