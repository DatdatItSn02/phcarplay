// Các lệnh gọi API tài khoản. Giao diện không gọi API trực tiếp mà đi qua đây.
// Giai đoạn 14: đăng nhập bằng email hoặc số điện thoại (login), đăng ký có số điện thoại, quên/đổi mật khẩu bằng mã OTP.
export function createAuthApi(api) {
  return {
    async login(login, password) {
      const data = await api.post('/auth/login', { login, password });
      api.setCsrf(data.csrf);
      return data;
    },
    async register(name, email, password, phone) {
      const data = await api.post('/auth/register', { name, email, password, phone });
      api.setCsrf(data.csrf);
      return data;
    },
    async logout() {
      const data = await api.post('/auth/logout');
      api.setCsrf(data.csrf);
      return data;
    },
    /** Gửi mã OTP quên mật khẩu tới email (và SMS khi đã bật) của tài khoản có email/số điện thoại này. */
    forgot: (login) => api.post('/auth/forgot', { login }),
    /** Đặt mật khẩu mới bằng mã OTP. */
    resetWithCode: (login, code, password) => api.post('/auth/reset', { login, code, password }),
    /** Liên kết đặt lại kiểu cũ (thư gửi trước giai đoạn 14). */
    reset: (token, password) => api.post('/auth/reset', { token, password }),
    // ----- đang đăng nhập -----
    updatePhone: (phone) => api.put('/user/phone', { phone }),
    passwordCode: () => api.post('/user/password/code'),
    async changePassword(code, password) {
      const data = await api.post('/user/password', { code, password });
      if (data && data.csrf) api.setCsrf(data.csrf);
      return data;
    },
  };
}
