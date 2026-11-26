// Giai đoạn 15: hộp "Chiếu lên màn hình xe" trên ĐIỆN THOẠI (trong ứng dụng Android). Nhập mã -> cho phép ghi màn hình -> đang chiếu.
// Đóng hộp không làm dừng chiếu; mở lại từ Cài đặt để xem trạng thái hoặc bấm "Dừng chiếu".
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { openDialog } from '../../core/dialog.js';
import { cleanCode } from './castProtocol.js';

const BUSY = { joining: 'Đang kiểm tra mã...', permission: 'Android đang hỏi quyền ghi màn hình. Hãy chọn "Bắt đầu" (hoặc "Toàn bộ màn hình" > "Bắt đầu").', connecting: 'Đang nối với màn hình xe...' };

export function openCastSenderDialog({ sender, subscribe }) {
  const input = h('input', { id: 'cast-code', class: 'input cast-code-input', type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '7', placeholder: '000 000', 'aria-label': 'Mã 6 số trên màn hình xe' });
  input.addEventListener('input', () => {
    const c = cleanCode(input.value);
    input.value = c.length > 3 ? c.slice(0, 3) + ' ' + c.slice(3) : c;
  });
  const status = h('p', { class: 'cast-status', role: 'status' });
  const goBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, icon('cast', 22), 'Kết nối');
  const form = h('form', { class: 'form cast-join', novalidate: true, onsubmit: (e) => { e.preventDefault(); sender.start(input.value); } },
    h('p', { class: 'dialog-text' }, 'Trên màn hình xe bấm ', h('strong', {}, 'Chiếu ĐT'), ' để lấy mã 6 số, rồi nhập vào đây.'),
    input, goBtn,
    h('p', { class: 'hint' }, 'Hai máy cần chung mạng: cắm dây vào xe và bật "Chia sẻ kết nối qua USB", hoặc cho màn hình xe dùng Wi-Fi phát từ điện thoại này.'));
  const liveText = h('p', { class: 'cast-live-title' });
  const stopBtn = h('button', { type: 'button', class: 'btn btn-danger', onclick: () => sender.stop() }, icon('stop', 22), 'Dừng chiếu');
  const live = h('div', { class: 'cast-live' },
    liveText,
    h('ul', { class: 'cast-tips' },
      h('li', {}, 'Bây giờ hãy mở ', h('strong', {}, 'bản đồ'), ' trên điện thoại: màn hình xe sẽ hiện đúng những gì điện thoại đang hiện.'),
      h('li', {}, 'Giữ điện thoại sáng màn hình. Tin nhắn và thông báo hiện trên điện thoại cũng sẽ hiện trên màn hình xe.'),
      h('li', {}, 'Dừng chiếu: bấm nút dưới đây, hoặc nút "Dừng chiếu" trong thông báo của ứng dụng.')),
    stopBtn);

  function paint(s) {
    const isLive = s.phase === 'live' || s.phase === 'reconnecting';
    const busy = Boolean(BUSY[s.phase]);
    form.hidden = isLive;
    live.hidden = !isLive;
    input.disabled = busy;
    goBtn.disabled = busy;
    status.textContent = s.phase === 'error' ? s.message : (BUSY[s.phase] || '');
    status.hidden = !status.textContent;
    status.classList.toggle('error', s.phase === 'error');
    liveText.textContent = s.phase === 'reconnecting' ? 'Mất kết nối với màn hình xe. Đang nối lại...' : 'Đang chiếu lên màn hình xe';
  }
  const off = subscribe(paint);
  paint(sender.snapshot());
  return openDialog({
    title: 'Chiếu lên màn hình xe',
    className: 'cast-dialog',
    focus: 'input',
    content: h('div', { class: 'cast-send' }, form, status, live),
    onClose: off,
  });
}
