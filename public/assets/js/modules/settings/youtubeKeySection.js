import { h, clear } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { ApiError } from '../../core/api.js';
import { showToast } from '../../core/toast.js';

// Giai đoạn 10: khóa YouTube Data API riêng của người dùng (không bắt buộc), trong Cài đặt.
// Máy chủ không bao giờ trả khóa đầy đủ, chỉ 4 ký tự cuối (last4/key_hint).

const STATE_TEXT = {
  ok: 'Đang dùng được. Tìm kiếm của bạn đi thẳng qua khóa này.',
  quota: 'Khóa đã hết lượt hôm nay. Website tạm tìm bằng cách khác, khoảng 14–15 giờ chiều (giờ Việt Nam) khóa dùng lại được.',
  invalid: 'Google báo khóa này không dùng được. Hãy kiểm tra lại hoặc nhập khóa khác.',
  unreadable: 'Website vừa đổi mã bảo mật nên không đọc được khóa cũ. Hãy nhập lại khóa.',
};

// Trang của Google mở thẳng tới đúng chỗ (đỡ phải tìm trong menu).
export const GOOGLE_API_PAGE = 'https://console.cloud.google.com/apis/library/youtube.googleapis.com';
export const GOOGLE_KEY_PAGE = 'https://console.cloud.google.com/apis/credentials';

const b = (t) => h('b', {}, t);
const link = (href, text) => h('a', { class: 'btn ykey-link', href, target: '_blank', rel: 'noopener noreferrer' }, text, ' ↗');

// Hướng dẫn 3 bước. Tên nút ghi cả tiếng Việt lẫn tiếng Anh vì trang Google hiện theo ngôn ngữ của tài khoản.
function guideSteps() {
  return h('ol', { class: 'ykey-steps' },
    h('li', {},
      h('strong', {}, 'Bật YouTube trên Google'),
      h('p', {}, 'Bấm nút dưới, đăng nhập Gmail. Nếu Google bảo chọn dự án: bấm ', b('Tạo dự án'), ' (Create project), đặt tên gì cũng được (ví dụ "xe-cua-toi") rồi bấm ', b('Tạo'), '. Sau đó bấm nút xanh ', b('Bật'), ' (Enable).'),
      link(GOOGLE_API_PAGE, 'Mở trang YouTube Data API')),
    h('li', {},
      h('strong', {}, 'Tạo khóa'),
      link(GOOGLE_KEY_PAGE, 'Mở trang tạo khóa'),
      h('ol', { class: 'ykey-sub' },
        h('li', {}, 'Nhìn ô tên dự án ở thanh trên cùng: phải là dự án vừa tạo ở bước 1 (nếu không, bấm vào đó để chọn lại).'),
        h('li', {}, 'Bấm ', b('+ Tạo thông tin xác thực'), ' (Create credentials) ở phía trên → chọn ', b('Khóa API'), ' (API key). Google mở bảng ', b('Tạo khóa API'), ' (Create API key).'),
        h('li', {}, 'Trong bảng đó:',
          h('ul', {},
            h('li', {}, 'Ô ', b('Tên'), ' (Name), nếu có: gõ gì cũng được.'),
            h('li', {}, b('Giới hạn ứng dụng'), ' (Application restrictions): chọn ', b('Không có'), ' (None). ', h('span', { class: 'ykey-warn' }, 'Đừng chọn "Trang web" (Websites): khóa sẽ không dùng được với website này.')),
            h('li', {}, b('Giới hạn API'), ' (API restrictions): chọn ', b('Hạn chế khóa'), ' (Restrict key), rồi trong danh sách chỉ tích ', b('YouTube Data API v3'), '.'),
            h('li', {}, b('Không'), ' tích ô "Xác thực lệnh gọi API thông qua tài khoản dịch vụ" (Authenticate API calls through a service account).'))),
        h('li', {}, 'Bấm ', b('Tạo'), ' (Create). Hộp ', b('Đã tạo khóa API'), ' (API key created) hiện khóa bắt đầu bằng ', h('span', { class: 'mono' }, 'AIza'), '. Bấm biểu tượng sao chép (hai ô vuông chồng nhau) bên cạnh khóa, rồi bấm ', b('Đóng'), ' (Close).'),
        h('li', {}, 'Lỡ đóng mà chưa sao chép: ở trang đó, mục ', b('Khóa API'), ' (API Keys), bấm ', b('Hiện khóa'), ' (Show key) ở dòng khóa vừa tạo rồi sao chép.'))),
    h('li', {},
      h('strong', {}, 'Dán vào đây'),
      h('p', {}, 'Dán khóa vào ô ', b('Dán khóa YouTube'), ' rồi bấm ', b('Kiểm tra và lưu'), '. Xong!')));
}

function guideFaq() {
  return h('details', { class: 'ykey-faq' },
    h('summary', {}, 'Câu hỏi thường gặp'),
    h('dl', {},
      h('dt', {}, 'Có mất tiền không?'),
      h('dd', {}, 'Không. Không cần thẻ ngân hàng. Google cho miễn phí khoảng 100 lần tìm mỗi ngày; hết thì website tạm tìm bằng cách khác, hôm sau dùng lại được.'),
      h('dt', {}, 'Khóa có an toàn không?'),
      h('dd', {}, 'Khóa chỉ dùng cho tìm kiếm của chính bạn, được mã hóa khi lưu và không bao giờ hiện lại đầy đủ. Bạn có thể bỏ khóa bất cứ lúc nào.'),
      h('dt', {}, 'Bấm lưu mà website báo lỗi?'),
      h('dd', {}, 'Website sẽ nói rõ cần sửa chỗ nào (chưa bật ở bước 1, chọn sai giới hạn ở bước 2, dán thiếu ký tự...). Sửa trên trang Google xong, đợi vài phút rồi bấm lưu lại.'),
      h('dt', {}, 'Không có khóa thì sao?'),
      h('dd', {}, 'Website vẫn tìm được bằng cách khác, nhưng có lúc chậm hoặc báo "chưa tìm được".')));
}

/** Phần "Khóa YouTube API của bạn" trong Cài đặt. Trả phần tử <div> (tự tải trạng thái từ máy chủ). */
export function youtubeKeySection({ api }) {
  const body = h('div', { class: 'ykey', 'aria-live': 'polite' }, h('p', { class: 'hint' }, 'Đang tải...'));


  function form(onCancel) {
    const input = h('input', {
      id: 'ykey-input', class: 'input mono', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      placeholder: 'AIza...', maxlength: '100', 'aria-describedby': 'ykey-err',
    });
    const error = h('p', { class: 'field-error', id: 'ykey-err', role: 'alert' });
    const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Kiểm tra và lưu');
    return h('form', {
      class: 'form', novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        error.textContent = '';
        input.removeAttribute('aria-invalid');
        submit.disabled = true;
        submit.textContent = 'Đang kiểm tra khóa...';
        try {
          const st = await api.put('/user/youtube-key', { key: input.value });
          input.value = '';
          if (st.checked === 'quota') showToast('Đã lưu khóa. Khóa này đang hết lượt hôm nay, mai dùng lại được.');
          else if (st.checked === 'error') showToast('Đã lưu khóa, nhưng chưa kiểm tra được do lỗi mạng.');
          else showToast('Đã lưu khóa YouTube API của bạn.');
          draw(st);
        } catch (err) {
          if (!(err instanceof ApiError)) throw err;
          error.textContent = (err.details && err.details.key) || err.message;
          input.setAttribute('aria-invalid', 'true');
          submit.disabled = false;
          submit.textContent = 'Kiểm tra và lưu';
        }
      },
    },
    h('div', { class: 'field' },
      h('label', { for: 'ykey-input' }, 'Dán khóa YouTube'),
      input,
      error),
    h('div', { class: 'btn-row' }, submit, onCancel ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: onCancel }, 'Hủy') : null));
  }

  function draw(st) {
    clear(body);
    if (!st.enabled) {
      body.append(h('p', { class: 'hint' }, st.reason || 'Tính năng này đang tắt.'));
      return;
    }
    if (st.has_key) {
      const removeBtn = h('button', {
        type: 'button', class: 'btn btn-ghost',
        onclick: async () => {
          removeBtn.disabled = true;
          try { draw(await api.delete('/user/youtube-key')); showToast('Đã bỏ khóa YouTube API của bạn.'); } catch (e) { removeBtn.disabled = false; showToast(e.message || 'Không bỏ được khóa.'); }
        },
      }, icon('trash'), 'Bỏ khóa');
      const changeBtn = h('button', { type: 'button', class: 'btn', onclick: () => { clear(actions); actions.append(form(() => draw(st))); } }, icon('edit'), 'Thay khóa');
      const actions = h('div', { class: 'btn-row' }, changeBtn, removeBtn);
      body.append(
        h('div', { class: `ykey-status ykey-${st.state || 'ok'}` },
          h('strong', {}, 'Khóa đang dùng: ', h('span', { class: 'mono' }, `••••${st.last4 || ''}`)),
          h('span', {}, STATE_TEXT[st.state] || STATE_TEXT.ok)),
        actions,
        h('details', { class: 'ykey-guide' }, h('summary', {}, 'Xem lại cách lấy khóa'), guideSteps()),
        guideFaq());
    } else {
      body.append(
        h('p', { class: 'ykey-why' }, 'Thêm khóa riêng để tìm video ', b('nhanh và ổn định hơn'), '. Miễn phí, làm một lần khoảng 5 phút. Không bắt buộc.'),
        guideSteps(),
        form(null),
        guideFaq());
    }
  }

  api.get('/user/youtube-key').then(draw).catch((e) => {
    clear(body);
    body.append(h('p', { class: 'field-error' }, (e && e.message) || 'Không tải được.'));
  });
  return body;
}
