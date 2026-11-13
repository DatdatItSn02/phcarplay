import { h } from '../../core/dom.js';

// Giai đoạn 14: phần dùng chung của các form nhập mã OTP (quên mật khẩu, đổi mật khẩu).

/** Ô nhập mã 6 số: bàn phím số trên điện thoại, máy tự gợi ý mã từ tin nhắn (one-time-code). */
export const CODE_INPUT = { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', pattern: '[0-9]*' };

/** Chỉ giữ chữ số, tối đa 6 (dán "123 456" vẫn được). */
export function cleanCode(value) {
  return String(value || '').replace(/[^0-9]/g, '').slice(0, 6);
}

/**
 * Nút "Gửi lại mã" đếm ngược: start(giây) khóa nút và hiện "Gửi lại mã (59 giây)".
 * timers truyền vào để kiểm thử; mặc định setInterval/clearInterval.
 */
export function countdownButton({ label = 'Gửi lại mã', onClick, timers = null }) {
  const t = timers || { set: (fn, ms) => setInterval(fn, ms), clear: (id) => clearInterval(id) };
  const btn = h('button', { type: 'button', class: 'link', onclick: () => { if (!btn.disabled) onClick(); } }, label);
  let left = 0;
  let timer = null;
  function paint() {
    btn.disabled = left > 0;
    btn.textContent = left > 0 ? `${label} (${left} giây)` : label;
  }
  return {
    el: btn,
    start(seconds) {
      if (timer !== null) t.clear(timer);
      left = Math.max(0, Math.round(Number(seconds) || 0));
      paint();
      if (left > 0) {
        timer = t.set(() => {
          left -= 1;
          if (left <= 0) { t.clear(timer); timer = null; left = 0; }
          if (!btn.isConnected && left > 0) { t.clear(timer); timer = null; return; }
          paint();
        }, 1000);
      }
    },
  };
}
