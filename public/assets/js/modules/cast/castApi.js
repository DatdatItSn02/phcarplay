// Các lệnh gọi API ghép nối chiếu màn hình (giai đoạn 15). Mỗi máy chứng minh mình bằng khóa nhận lúc tạo/nhập mã.
// session: { id, token }
// Giai đoạn 17: máy có KHÓA THIẾT BỊ (castDevice.js) gửi kèm lúc tạo/nhập mã và dùng chính nó làm token của phiên;
// các API ghép đôi gửi khóa trong header X-Cast-Device.
export function createCastApi(api) {
  const key = (s) => ({ 'X-Cast-Token': s.token });
  const dev = (k) => ({ 'X-Cast-Device': k });
  return {
    /** Màn hình xe: tạo phiên chờ -> { id, code, token? (máy không gửi khóa thiết bị), expires_in, ice_servers }. */
    create: (deviceKey = '', deviceName = '') => api.post('/cast/sessions', deviceKey ? { device_key: deviceKey, device_name: deviceName || '' } : {}),
    /** Điện thoại: nhập mã đang hiện trên màn hình xe -> { id, token?, ice_servers, pair: { id, name } | null }. */
    join: (code, deviceName, deviceKey = '') => api.post('/cast/join', deviceKey
      ? { code, device_name: deviceName || '', device_key: deviceKey }
      : { code, device_name: deviceName || '' }),
    /** Tin của máy bên kia gửi sau tin số `after` -> { status, device_name, pair_id?, picked?, signals: [{ id, kind, payload }] }. */
    pull: (s, after) => api.get(`/cast/sessions/${s.id}/signals?after=${Number(after) || 0}`, key(s)),
    push: (s, kind, payload) => api.post(`/cast/sessions/${s.id}/signals`, { kind, payload }, key(s)),
    end: (s) => api.post(`/cast/sessions/${s.id}/end`, {}, key(s)),
    // ----- giai đoạn 17: ghép đôi một lần -----
    /** Máy đã ghép đôi với máy này -> { pairs: [{ id, role, name, created_at, last_used_at }], poll_seconds }. */
    pairs: (deviceKey) => api.get('/cast/pairs', dev(deviceKey)),
    /** Điện thoại bấm "Chia sẻ" tới màn hình xe đã ghép đôi -> { id, role: 'sender', ice_servers, pair: { id, name } }. */
    share: (pairId, deviceKey, deviceName) => api.post(`/cast/pairs/${Number(pairId)}/share`, { device_name: deviceName || '' }, dev(deviceKey)),
    /** Màn hình xe hỏi có lời mời không -> { pairs, incoming: { id, device_name, pair_id } | null, ice_servers, poll_seconds }. */
    incoming: (deviceKey) => api.get('/cast/incoming', dev(deviceKey)),
    /** "Quên thiết bị" (làm ở máy nào cũng được). */
    forget: (pairId, deviceKey) => api.post(`/cast/pairs/${Number(pairId)}/forget`, {}, dev(deviceKey)),
  };
}
