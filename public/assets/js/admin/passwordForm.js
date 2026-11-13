import { field, formBox } from './ui.js';
import { ApiError } from '../core/api.js';

// Form đổi mật khẩu của chính mình, dùng ở màn hình bắt buộc đổi mật khẩu và ở mục "Tài khoản của tôi".
// onChanged(sessionPayload) được gọi sau khi đổi thành công.
export function passwordChangeForm({ adminApi, onChanged, submitLabel = 'Đổi mật khẩu', currentLabel = 'Mật khẩu hiện tại' }) {
  const current = field({ label: currentLabel, name: 'current_password', type: 'password', autocomplete: 'current-password' });
  const next = field({ label: 'Mật khẩu mới', name: 'new_password', type: 'password', autocomplete: 'new-password', hint: 'Từ 8 ký tự trở lên, khác mật khẩu hiện tại.' });
  const confirm = field({ label: 'Nhập lại mật khẩu mới', name: 'confirm', type: 'password', autocomplete: 'new-password' });
  return formBox({
    fields: [current, next, confirm],
    submitLabel,
    submit: async (v) => {
      if (v.new_password !== v.confirm) {
        throw new ApiError(422, 'VALIDATION_FAILED', 'Chưa hợp lệ', { confirm: 'Hai mật khẩu chưa giống nhau.' });
      }
      const payload = await adminApi.changePassword(v.current_password, v.new_password);
      onChanged(payload);
    },
  });
}
