// Giai đoạn 15: chiếu màn hình điện thoại lên màn hình xe - phần "ngôn ngữ chung" của hai máy (không đụng DOM, không đụng mạng).
//
// Hai máy nối thẳng với nhau bằng một kênh dữ liệu WebRTC (RTCDataChannel). Điện thoại gửi từng ảnh JPEG của màn hình:
//   1 tin CHỮ (JSON):  { t: 'f', seq, w, h, size, parts }     - mở đầu một ảnh
//   parts tin NHỊ PHÂN, mỗi tin tối đa CHUNK_BYTES             - các mảnh của ảnh, theo thứ tự
// Tin chữ khác: { t: 'hello', name } (điện thoại chào), { t: 'bye' } (một bên dừng chiếu).
// Vì sao gửi ảnh JPEG chứ không gửi video: ứng dụng Android đang ở nền (người dùng mở bản đồ) nên trang web trong ứng dụng
// không vẽ được gì lên màn hình để quay lại; ảnh JPEG do phần Android chụp và nén, trang web chỉ chuyển tiếp. Hai máy chung
// mạng nội bộ (wifi phát từ điện thoại hoặc dây USB) nên dung lượng không thành vấn đề, và chữ trên bản đồ luôn nét.

export const CHUNK_BYTES = 16000;                 // an toàn cho mọi trình duyệt (giới hạn chung của một tin là 16 KiB)
export const MAX_FRAME_BYTES = 4 * 1024 * 1024;   // ảnh lớn hơn thế là dữ liệu hỏng
export const HIGH_WATER_BYTES = 1024 * 1024;      // kênh còn kẹt nhiều hơn thế thì bỏ bớt ảnh (tự giảm số ảnh/giây)

/** Chỉ giữ chữ số, tối đa 6. */
export function cleanCode(value) {
  return String(value == null ? '' : value).replace(/[^0-9]/g, '').slice(0, 6);
}

/** '482913' -> '482 913' (dễ đọc trên màn hình xe). */
export function formatCode(code) {
  const c = cleanCode(code);
  return c.length > 3 ? c.slice(0, 3) + ' ' + c.slice(3) : c;
}

/** Tách một ảnh thành các tin để gửi qua kênh dữ liệu. bytes: ArrayBuffer. Trả về [chuỗi JSON, ArrayBuffer, ...]. */
export function encodeFrame(seq, w, h, bytes, chunk = CHUNK_BYTES) {
  const size = bytes.byteLength;
  const parts = Math.max(1, Math.ceil(size / chunk));
  const out = [JSON.stringify({ t: 'f', seq, w, h, size, parts })];
  for (let i = 0; i < parts; i++) out.push(bytes.slice(i * chunk, Math.min(size, (i + 1) * chunk)));
  return out;
}

/**
 * Ghép các tin nhận được thành ảnh.
 *  onFrame({ seq, w, h, bytes: Uint8Array })   onControl(obj): tin chữ khác ('hello', 'bye'...)
 * Ảnh đang ghép dở mà gặp phần mở đầu của ảnh mới thì bỏ ảnh dở. Dữ liệu sai (quá lớn, thừa mảnh) bị bỏ qua, không làm hỏng ảnh sau.
 */
export function createFrameAssembler({ onFrame, onControl = () => {}, maxBytes = MAX_FRAME_BYTES }) {
  let head = null;
  let buf = null;
  let filled = 0;
  let left = 0;
  let dropped = 0;
  const reset = () => { head = null; buf = null; filled = 0; left = 0; };
  return {
    push(data) {
      if (typeof data === 'string') {
        let msg = null;
        try { msg = JSON.parse(data); } catch (e) { return; }
        if (!msg || typeof msg !== 'object') return;
        if (msg.t !== 'f') { onControl(msg); return; }
        if (head) dropped += 1;
        reset();
        const size = Number(msg.size);
        const parts = Number(msg.parts);
        const ok = Number.isInteger(size) && size > 0 && size <= maxBytes && Number.isInteger(parts) && parts > 0 && parts <= Math.ceil(size / 1) && Number(msg.w) > 0 && Number(msg.h) > 0;
        if (!ok) { dropped += 1; return; }
        head = { seq: Number(msg.seq) || 0, w: Number(msg.w), h: Number(msg.h), size };
        buf = new Uint8Array(size);
        left = parts;
        return;
      }
      if (!head || !data) return;   // mảnh lạc (ảnh trước đã bị bỏ)
      const part = data instanceof ArrayBuffer ? new Uint8Array(data) : (ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null);
      if (!part || filled + part.byteLength > head.size) { dropped += 1; reset(); return; }
      buf.set(part, filled);
      filled += part.byteLength;
      left -= 1;
      if (left === 0) {
        const done = filled === head.size ? { seq: head.seq, w: head.w, h: head.h, bytes: buf } : null;
        if (!done) dropped += 1;
        reset();
        if (done) onFrame(done);
      }
    },
    dropped: () => dropped,
    reset,
  };
}

/**
 * Bề rộng (px) của cột chiếu khi chọn "Vừa khung": cao hết khung, rộng theo đúng tỉ lệ màn hình điện thoại,
 * nhưng không quá maxShare bề rộng (điện thoại xoay ngang) và không hẹp hơn minPx.
 */
export function fitColumnWidth(frameW, frameH, boxW, boxH, maxShare = 0.62, minPx = 200) {
  if (!(frameW > 0) || !(frameH > 0) || !(boxW > 0) || !(boxH > 0)) return Math.round(Math.max(minPx, boxW * 0.35));
  const ideal = boxH * (frameW / frameH);
  return Math.round(Math.max(Math.min(minPx, boxW * maxShare), Math.min(ideal, boxW * maxShare)));
}

/** Bề cao (px) của khung chiếu khi màn hình xe đặt dọc (khung chiếu nằm trên, nhạc nằm dưới). */
export function fitRowHeight(frameW, frameH, boxW, boxH, maxShare = 0.62, minPx = 200) {
  if (!(frameW > 0) || !(frameH > 0) || !(boxW > 0) || !(boxH > 0)) return Math.round(Math.max(minPx, boxH * 0.5));
  const ideal = boxW * (frameH / frameW);
  return Math.round(Math.max(Math.min(minPx, boxH * maxShare), Math.min(ideal, boxH * maxShare)));
}

/** Giới hạn phần màn hình dành cho bản đồ khi người dùng kéo vạch chia ở chế độ "Lấp đầy" (mặc định: đúng một nửa). */
export function clampShare(value, min = 0.3, max = 0.7) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(max, Math.max(min, n));
}

/**
 * "Lấp đầy": hình được phóng to cho kín khung nên bị thừa ra ở một chiều. Trả về số px thừa mỗi chiều { x, y }
 * (0 = chiều đó vừa khít). Người dùng kéo hình trong phạm vi này để chọn phần muốn xem.
 */
export function coverOverflow(frameW, frameH, boxW, boxH) {
  if (!(frameW > 0) || !(frameH > 0) || !(boxW > 0) || !(boxH > 0)) return { x: 0, y: 0 };
  const scale = Math.max(boxW / frameW, boxH / frameH);
  return { x: Math.max(0, Math.round(frameW * scale - boxW)), y: Math.max(0, Math.round(frameH * scale - boxH)) };
}

/**
 * Vị trí hình trong khung, 0..1 (0 = thấy mép đầu, 1 = thấy mép cuối, 0.5 = giữa).
 * Kéo ngón tay deltaPx (dương = kéo xuống/sang phải) thì hình đi theo ngón tay, tức là thấy phần phía trước nhiều hơn.
 */
export function panBy(pan, deltaPx, overflowPx) {
  const p = Number.isFinite(Number(pan)) ? Math.min(1, Math.max(0, Number(pan))) : 0.5;
  if (!(overflowPx > 0)) return p;
  return Math.min(1, Math.max(0, p - deltaPx / overflowPx));
}
