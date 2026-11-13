import { h, clear } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { openDialog } from '../../core/dialog.js';

// Tìm bằng giọng nói qua Web Speech API (Chrome, Android). Trình duyệt không hỗ trợ thì nút micro bị ẩn.
// Nhận dạng giọng nói của Chrome chạy trên máy chủ của Google nên cần Internet.
// Giai đoạn 13: trong ứng dụng điện thoại thì dùng nhận giọng nói của máy (core/nativeApp.js) qua tham số listen.

export const VOICE_MSG = {
  'not-allowed': 'Trình duyệt chưa cho dùng micro. Hãy cho phép micro cho trang này trong cài đặt trình duyệt.',
  'service-not-allowed': 'Trình duyệt chưa cho dùng micro. Hãy cho phép micro cho trang này trong cài đặt trình duyệt.',
  'no-speech': 'Chưa nghe thấy gì. Hãy bấm thử lại rồi nói tên bài hát.',
  'audio-capture': 'Không tìm thấy micro trên thiết bị này.',
  network: 'Tìm bằng giọng nói cần có Internet. Hãy kiểm tra mạng rồi thử lại.',
  'language-not-supported': 'Trình duyệt chưa hỗ trợ nhận giọng nói tiếng Việt.',
  'app-denied': 'Ứng dụng chưa được phép dùng micro. Hãy mở Cài đặt của máy, chọn ứng dụng này, bật Micro (iPhone bật thêm Nhận dạng giọng nói) rồi thử lại.',
  'not-available': 'Máy này chưa có dịch vụ nhận giọng nói (máy Android cần có ứng dụng Google). Bạn có thể gõ tên bài vào ô tìm kiếm.',
  busy: 'Micro đang được dùng ở nơi khác. Hãy thử lại sau giây lát.',
  other: 'Chưa nhận được giọng nói. Hãy thử lại.',
};

export function voiceMessage(code) {
  return Object.prototype.hasOwnProperty.call(VOICE_MSG, code) ? VOICE_MSG[code] : VOICE_MSG.other;
}

/** Lớp nhận dạng giọng nói của trình duyệt, hoặc null nếu không có. */
export function recognitionClass(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w) return null;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/**
 * Nghe một câu. Gọi lại: onPartial(text) khi đang nói, onResult(text) khi xong, onError(code), onEnd().
 * Trả về { stop } để hủy.
 */
export function listenOnce({ Recognition, lang = 'vi-VN', onPartial = () => {}, onResult = () => {}, onError = () => {}, onEnd = () => {} }) {
  const rec = new Recognition();
  rec.lang = lang;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.continuous = false;
  let done = false;
  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex || 0; i < e.results.length; i++) {
      const r = e.results[i];
      const text = r[0] && r[0].transcript ? r[0].transcript : '';
      if (r.isFinal) finalText += text; else interim += text;
    }
    if (finalText.trim()) {
      done = true;
      onResult(finalText.trim());
      try { rec.stop(); } catch (err) { /* đã dừng */ }
    } else if (interim.trim()) onPartial(interim.trim());
  };
  rec.onerror = (e) => {
    if (done) return;
    done = true;
    onError(e && e.error ? e.error : 'other');
  };
  rec.onend = () => {
    if (!done) { done = true; onError('no-speech'); }
    onEnd();
  };
  try { rec.start(); } catch (err) { done = true; onError('other'); onEnd(); }
  return { stop() { done = true; try { rec.abort(); } catch (err) { /* đã dừng */ } } };
}

/**
 * Hộp "Đang nghe..." với micro lớn. Nói xong thì đóng hộp và gọi onResult(text).
 * listen(cb) -> { stop }: cách nghe khác (nhận giọng nói của ứng dụng điện thoại); không có thì dùng Web Speech (Recognition).
 * Người dùng tự đóng màn hình nhận giọng nói của máy (lỗi 'aborted') thì đóng luôn hộp này.
 */
export function openVoiceDialog({ Recognition = null, listen = null, onResult }) {
  const begin = typeof listen === 'function' ? listen : (cb) => listenOnce(Object.assign({ Recognition }, cb));
  let session = null;
  const text = h('p', { class: 'voice-text', 'aria-live': 'polite' });
  const hint = h('p', { class: 'hint' });
  const mic = h('div', { class: 'voice-mic', 'aria-hidden': 'true' }, icon('mic', 44));
  const retry = h('button', { type: 'button', class: 'btn btn-primary', hidden: true, onclick: () => start() }, icon('mic'), 'Thử lại');
  let dlg = null;

  function start() {
    retry.hidden = true;
    mic.style.animationPlayState = 'running';
    text.textContent = 'Đang nghe...';
    hint.textContent = 'Hãy nói tên bài hát, ca sĩ hoặc video bạn muốn tìm.';
    session = begin({
      onPartial: (t) => { text.textContent = t; },
      onResult: (t) => { text.textContent = t; if (dlg) dlg.close(); onResult(t); },
      onError: (code) => {
        if (code === 'aborted' && listen) { if (dlg) dlg.close(); return; }
        mic.style.animationPlayState = 'paused';
        text.textContent = 'Chưa tìm được';
        hint.textContent = voiceMessage(code);
        retry.hidden = false;
      },
    });
  }

  dlg = openDialog({
    title: 'Tìm bằng giọng nói',
    focus: 'dialog',
    onClose: () => { if (session) session.stop(); },
    content: h('div', { class: 'voice' }, mic, text, hint, retry),
  });
  clear(text);
  start();
  return dlg;
}
