// Giai đoạn 17 (đợt 2): KHÓA THIẾT BỊ cho chức năng ghép đôi chiếu màn hình.
// Mỗi máy (điện thoại / màn hình xe) có một khóa bí mật ngẫu nhiên 48 ký tự hex, tạo một lần và lưu trên chính máy này
// (localStorage). Máy chủ chỉ lưu bản băm. Khóa dùng để: ghép đôi lần đầu (kèm mã 6 số), "Chia sẻ" lần sau không cần mã,
// "Quên thiết bị". Xóa dữ liệu trình duyệt / cài lại ứng dụng = máy mới: phải ghép đôi lại bằng mã.

const KEY = 'carweb_cast_device';
const PAIRED_KEY = 'carweb_cast_paired';   // màn hình xe: đã có điện thoại ghép đôi (chỉ khi đó mới hỏi lời mời)

const isKey = (v) => typeof v === 'string' && /^[a-f0-9]{48}$/.test(v);

function randomKey(cryptoObj) {
  const c = cryptoObj || (typeof crypto !== 'undefined' ? crypto : null);
  const bytes = new Uint8Array(24);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);   // máy quá cũ (không có crypto)
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return s;
}

/**
 * Khóa thiết bị của máy này (tạo mới nếu chưa có). Không lưu được (chế độ ẩn danh, bộ nhớ đầy) thì dùng khóa tạm của
 * phiên trang này: vẫn chiếu được bằng mã nhưng lần sau không nhớ.
 */
export function createCastDevice({ storage = null, cryptoObj = null } = {}) {
  const store = storage || (() => { try { return window.localStorage; } catch (e) { return null; } })();
  let key = '';
  const read = (k) => { try { return store ? store.getItem(k) : null; } catch (e) { return null; } };
  const write = (k, v) => { try { if (store) { if (v === null) store.removeItem(k); else store.setItem(k, v); } } catch (e) { /* không lưu được */ } };
  return {
    key() {
      if (isKey(key)) return key;
      const saved = read(KEY);
      if (isKey(saved)) { key = saved; return key; }
      key = randomKey(cryptoObj);
      write(KEY, key);
      return key;
    },
    /** Màn hình xe: có điện thoại đã ghép đôi chưa (để biết có cần hỏi lời mời "Chia sẻ" không). */
    isPaired: () => read(PAIRED_KEY) === '1',
    setPaired(on) { write(PAIRED_KEY, on ? '1' : null); },
  };
}

/** Tên màn hình xe để hiện bên điện thoại: tên máy trong User-Agent (đầu xe Android thường có), không có thì "Màn hình xe". */
export function receiverNameFromUa(ua) {
  const m = /Android [0-9.]+; ([^;)]+?)(?: Build\/[^;)]*)?[;)]/.exec(String(ua || ''));
  const name = m ? m[1].trim() : '';
  const bad = !name || /^(k|wv|linux|mobile|tablet)$/i.test(name);
  return bad ? 'Màn hình xe' : name.slice(0, 60);
}
