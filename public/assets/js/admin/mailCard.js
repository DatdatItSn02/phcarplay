// Giai đoạn 16 (chỉ master): thẻ "Gửi email" trên trang Tổng quan.
// Cho biết website đang gửi thư bằng cách nào, còn thiếu gì, và có nút "Gửi thư thử" để thấy ngay lỗi cụ thể
// của máy chủ thư kèm gợi ý cách sửa. Không bao giờ hiện mật khẩu SMTP (máy chủ chỉ báo "đã điền" hay "chưa điền").
import { h, clear, field, formBox, badge, loading, message } from './ui.js';
import { ApiError } from '../core/api.js';

function row(label, value) {
  return h('li', {}, h('span', {}, label), h('strong', {}, value));
}

// ctx: { adminApi, admin }
export function mailCard(ctx) {
  const info = h('div', { class: 'mail-info' }, loading());
  const result = h('div', { 'aria-live': 'polite' });
  const to = field({ label: 'Gửi thư thử tới', name: 'email', type: 'email', autocomplete: 'email', value: (ctx.admin && ctx.admin.email) || '',
    hint: 'Nên nhập một hộp thư bạn mở được ngay để kiểm tra.' });
  let alive = true;

  function drawInfo(d) {
    clear(info);
    const smtp = d.smtp;
    const problems = d.problems || [];
    info.append(
      h('ul', { class: 'plain-list' },
        row('Cách gửi', h('span', {}, badge(d.test_mode ? 'Chế độ thử' : 'Gửi thật', d.test_mode ? 'amber' : 'ok'), ' ', d.driver_label)),
        smtp ? row('Máy chủ', (smtp.host || '(chưa điền)') + (smtp.port ? ':' + smtp.port : '') + (smtp.encryption ? ' · ' + smtp.encryption.toUpperCase() : '')) : null,
        smtp ? row('Đăng nhập', (smtp.username_set ? 'đã điền tên' : 'CHƯA điền tên') + ', ' + (smtp.password_set ? 'đã điền mật khẩu' : 'CHƯA điền mật khẩu')) : null,
        row('Địa chỉ gửi', d.from_email || '(chưa điền)')));
    // Lưu ý: Element.append(null) sẽ in ra chữ "null", nên chỉ thêm khung cảnh báo khi có.
    if (problems.length) info.append(h('div', { class: 'notice notice-warn', role: 'status' }, problems.map((p) => h('p', {}, p))));
  }

  async function load() {
    try {
      const d = await ctx.adminApi.mailStatus();
      if (alive) drawInfo(d);
    } catch (e) {
      if (!alive) return;
      clear(info);
      info.append(message(e && e.message ? e.message : 'Không đọc được cấu hình gửi email.', 'notice-warn'));
    }
  }

  const form = formBox({ fields: [to], submitLabel: 'Gửi thư thử',
    submit: async (v) => {
      clear(result);
      try {
        const data = await ctx.adminApi.mailTest(v.email.trim());
        result.append(message(data.message, data.test_mode ? 'notice-warn' : ''));
        if (data.status) drawInfo(data.status);
      } catch (err) {
        if (!(err instanceof ApiError) || err.code !== 'MAIL_TEST_FAILED') throw err;
        const d = err.details || {};
        result.append(h('div', { class: 'notice notice-error', role: 'alert' },
          h('p', {}, h('strong', {}, err.message)),
          d.error ? h('p', { class: 'mail-error' }, 'Máy chủ thư báo: ' + d.error) : null,
          d.hint ? h('p', {}, 'Cách sửa: ' + d.hint) : null));
      }
    } });

  const el = h('section', { class: 'card mail-card' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Gửi email')),
    h('p', { class: 'hint' }, 'Mã quên mật khẩu của người dùng được gửi qua email. Cấu hình nằm ở các dòng MAIL_* và SMTP_* trong file .env trên máy chủ.'),
    info, form, result);
  load();
  return { el, destroy() { alive = false; } };
}
