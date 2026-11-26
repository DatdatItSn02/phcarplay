// Tính toán thuần cho khung chia màn hình (không đụng DOM nên kiểm thử được bằng Node).
// "ratio" là phần chiều rộng (hoặc cao) dành cho khung đầu tiên: 0.5 = chia đôi.
export const GAP = 18;                          // bề rộng thanh kéo (px), khớp với CSS
export const DEFAULT_LAYOUT = { h: 0.62, v: 0.5 };   // h: màn hình ngang (trái/phải), v: màn hình dọc (trên/dưới)
export const PRESETS = [
  { label: '70/30', ratio: 0.7, title: 'Khung trái lớn' },
  { label: '50/50', ratio: 0.5, title: 'Chia đôi' },
  { label: '30/70', ratio: 0.3, title: 'Khung phải lớn' },
];

export function pickOrientation(width, height) {
  return width >= height ? 'horizontal' : 'vertical';
}

// Giữ tỉ lệ trong giới hạn để mỗi khung còn tối thiểu minPx (nhưng không bao giờ vượt 10%-90%).
export function clampRatio(ratio, sizePx, minPx = 240) {
  const r = Number.isFinite(ratio) ? ratio : 0.5;
  const usable = Math.max(sizePx - GAP, 1);
  const minR = Math.min(Math.max(minPx / usable, 0.1), 0.45);
  return Math.min(Math.max(r, minR), 1 - minR);
}

// Đổi vị trí con trỏ (px tính từ mép đầu khung chứa) thành tỉ lệ, tâm thanh kéo nằm đúng tại con trỏ.
export function ratioFromOffset(offsetPx, sizePx, minPx = 240) {
  const usable = Math.max(sizePx - GAP, 1);
  return clampRatio((offsetPx - GAP / 2) / usable, sizePx, minPx);
}

// Hít về các mốc quen thuộc khi kéo lại gần.
export function snapRatio(ratio, snaps = [0.3, 0.5, 0.7], threshold = 0.025) {
  for (const s of snaps) if (Math.abs(ratio - s) <= threshold) return s;
  return ratio;
}

// Chuẩn hóa dữ liệu bố cục đọc từ nơi lưu: thiếu hoặc sai thì dùng mặc định.
export function sanitizeLayout(value) {
  const out = { ...DEFAULT_LAYOUT };
  if (value && typeof value === 'object') {
    for (const k of ['h', 'v']) {
      const n = value[k];
      if (typeof n === 'number' && Number.isFinite(n)) out[k] = Math.min(0.9, Math.max(0.1, n));
    }
  }
  return out;
}
