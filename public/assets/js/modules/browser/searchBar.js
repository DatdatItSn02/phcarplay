import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { recognitionClass, openVoiceDialog } from './voiceSearch.js';

/**
 * Nút micro: hiện khi trình duyệt nhận được giọng nói, hoặc khi ứng dụng điện thoại có nhận giọng nói (voice = { listen }).
 * onText(text) khi nói xong (trả về Promise của việc tìm thì nhạc phát lại khi tìm xong).
 * hold: tạm dừng nhạc trong lúc nghe (voicePause.js, giai đoạn 17).
 */
export function micButton(onText, voice = null, hold = null) {
  const native = voice && typeof voice.listen === 'function' ? voice : null;
  const Recognition = native ? null : recognitionClass();
  if (!native && !Recognition) return null;
  return h('button', { type: 'button', class: 'search-mic', 'aria-label': 'Tìm bằng giọng nói', title: 'Tìm bằng giọng nói',
    onclick: () => openVoiceDialog({ Recognition, listen: native ? (cb) => native.listen(cb) : null, onResult: onText, hold }) }, icon('mic', 26));
}

/** Ô tìm kiếm "giả" ở Trang chủ: bấm vào thì chuyển sang mục Tìm kiếm (nơi có ô nhập thật). */
export function fakeSearchBar({ onOpen, onVoice, voice = null, hold = null }) {
  return h('div', { class: 'searchbar' },
    h('div', { class: 'search-field' },
      h('button', { type: 'button', class: 'search-fake', onclick: () => onOpen(), 'aria-label': 'Mở ô tìm kiếm' }, 'Tìm kiếm'),
      h('button', { type: 'button', class: 'search-go', 'aria-label': 'Tìm kiếm', tabindex: '-1', onclick: () => onOpen() }, icon('search', 26))),
    micButton(onVoice, voice, hold));
}
