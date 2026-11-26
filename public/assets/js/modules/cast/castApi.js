// Các lệnh gọi API ghép nối chiếu màn hình (giai đoạn 15). Mỗi máy chứng minh mình bằng khóa nhận lúc tạo/nhập mã.
// session: { id, token }
export function createCastApi(api) {
  const key = (s) => ({ 'X-Cast-Token': s.token });
  return {
    /** Màn hình xe: tạo phiên chờ -> { id, code, token, expires_in, ice_servers }. */
    create: () => api.post('/cast/sessions', {}),
    /** Điện thoại: nhập mã đang hiện trên màn hình xe -> { id, token, ice_servers }. */
    join: (code, deviceName) => api.post('/cast/join', { code, device_name: deviceName || '' }),
    /** Tin của máy bên kia gửi sau tin số `after` -> { status, device_name, signals: [{ id, kind, payload }] }. */
    pull: (s, after) => api.get(`/cast/sessions/${s.id}/signals?after=${Number(after) || 0}`, key(s)),
    push: (s, kind, payload) => api.post(`/cast/sessions/${s.id}/signals`, { kind, payload }, key(s)),
    end: (s) => api.post(`/cast/sessions/${s.id}/end`, {}, key(s)),
  };
}
