// Các lệnh gọi API quản trị. Giao diện không gọi API trực tiếp mà đi qua đây.
// hooks.onUnauthorized: phiên hết hạn/bị khóa/đổi mật khẩu ở nơi khác; hooks.onPasswordChangeRequired: đang bị buộc đổi mật khẩu.
export function createAdminApi(api, hooks = {}) {
  async function guard(promise) {
    try {
      return await promise;
    } catch (e) {
      if (e && e.code === 'UNAUTHORIZED' && hooks.onUnauthorized) hooks.onUnauthorized(e);
      else if (e && e.code === 'PASSWORD_CHANGE_REQUIRED' && hooks.onPasswordChangeRequired) hooks.onPasswordChangeRequired(e);
      throw e;
    }
  }
  const rememberCsrf = (data) => { if (data && data.csrf) api.setCsrf(data.csrf); return data; };

  // Ghép bộ lọc thành chuỗi ?a=1&b=2, bỏ giá trị rỗng.
  function qs(params) {
    const parts = [];
    Object.keys(params || {}).forEach((k) => {
      const v = params[k];
      if (v !== '' && v != null) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    });
    return parts.length ? `?${parts.join('&')}` : '';
  }

  return {
    me: () => api.init(),
    async login(email, password) { return rememberCsrf(await api.post('/auth/login', { email, password })); },
    async logout() { return rememberCsrf(await api.post('/auth/logout')); },
    forgot: (email) => api.post('/auth/forgot', { email }),
    reset: (token, password) => api.post('/auth/reset', { token, password }),
    async changePassword(currentPassword, newPassword) {
      return rememberCsrf(await guard(api.post('/account/password', { current_password: currentPassword, new_password: newPassword })));
    },

    listAdmins: (params) => guard(api.get(`/admins${qs(params || {})}`)),
    createAdmin: (body) => guard(api.post('/admins', body)),
    updateAdmin: (id, body) => guard(api.patch(`/admins/${id}`, body)),
    setAdminPassword: (id, password) => guard(api.post(`/admins/${id}/password`, { password })),
    deleteAdmin: (id) => guard(api.delete(`/admins/${id}`)),

    stats: () => guard(api.get('/stats')),
    // Giai đoạn 16 (master): cấu hình gửi email đang dùng và gửi thư thử
    mailStatus: () => guard(api.get('/mail')),
    mailTest: (email) => guard(api.post('/mail/test', { email })),

    listUsers: (params) => guard(api.get(`/users${qs(params)}`)),
    getUser: (id) => guard(api.get(`/users/${id}`)),
    updateUser: (id, body) => guard(api.patch(`/users/${id}`, body)),
    extendUser: (id, days) => guard(api.post(`/users/${id}/extend`, { days })),
    setUserPassword: (id, password) => guard(api.post(`/users/${id}/password`, { password })),
    sendUserReset: (id) => guard(api.post(`/users/${id}/send-reset`)),
    logoutUserDevice: (id) => guard(api.post(`/users/${id}/logout-device`)),
    deleteUser: (id) => guard(api.delete(`/users/${id}`)),

    listKeys: (params) => guard(api.get(`/keys${qs(params)}`)),
    createKeys: (body) => guard(api.post('/keys', body)),
    revokeKey: (id) => guard(api.post(`/keys/${id}/revoke`)),
    deleteKey: (id) => guard(api.delete(`/keys/${id}`)),
    bulkKeys: (action, ids) => guard(api.post('/keys/bulk', { action, ids })),

    listPlaylists: (params) => guard(api.get(`/playlists${qs(params)}`)),
    getPlaylist: (id) => guard(api.get(`/playlists/${id}`)),
    deletePlaylist: (id) => guard(api.delete(`/playlists/${id}`)),

    listAudit: (params) => guard(api.get(`/audit${qs(params)}`)),
  };
}
