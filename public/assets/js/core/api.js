// Máy khách API: gửi JSON, tự gắn CSRF token cho các yêu cầu ghi, và chuẩn hóa lỗi thành ApiError.
export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details || {};
  }
}

// onSessionReplaced: được gọi khi máy chủ báo tài khoản đã đăng nhập ở thiết bị khác (mã SESSION_REPLACED).
export function createApi({ baseUrl = '/api', fetchImpl = (...args) => fetch(...args), onSessionReplaced = null } = {}) {
  let csrf = null;

  // extra: header thêm cho riêng yêu cầu này (ví dụ X-Cast-Token của phiên chiếu màn hình).
  async function request(method, path, body, canRetry = true, extra = null) {
    const headers = Object.assign({ Accept: 'application/json' }, extra || {});
    const init = { method, headers, credentials: 'same-origin' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;

    let res;
    try {
      res = await fetchImpl(baseUrl + path, init);
    } catch (e) {
      throw new ApiError(0, 'NETWORK', 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.');
    }

    let json = null;
    try {
      json = await res.json();
    } catch (e) {
      /* phản hồi không phải JSON */
    }
    if (res.ok && json && json.ok) return json.data;

    const err = (json && json.error) || {};
    // Token CSRF hết hiệu lực (ví dụ phiên mới): lấy token mới rồi thử lại đúng một lần.
    if (canRetry && res.status === 403 && err.code === 'CSRF_INVALID') {
      await init_();
      return request(method, path, body, false, extra);
    }
    if (err.code === 'SESSION_REPLACED' && onSessionReplaced) onSessionReplaced();
    throw new ApiError(res.status, err.code || `HTTP_${res.status}`, err.message || 'Có lỗi xảy ra. Vui lòng thử lại.', err.details);
  }

  // Lấy trạng thái phiên (kèm CSRF token). Gọi một lần khi mở trang.
  async function init_() {
    const data = await request('GET', '/auth/me', undefined, false);
    csrf = data.csrf;
    return data;
  }

  return {
    init: init_,
    setCsrf: (token) => { csrf = token; },
    get: (path, headers = null) => request('GET', path, undefined, true, headers),
    post: (path, body = {}, headers = null) => request('POST', path, body, true, headers),
    put: (path, body = {}) => request('PUT', path, body),
    patch: (path, body = {}) => request('PATCH', path, body),
    delete: (path) => request('DELETE', path),
  };
}
