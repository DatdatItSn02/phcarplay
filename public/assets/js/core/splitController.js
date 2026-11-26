import { DEFAULT_LAYOUT, clampRatio, pickOrientation, ratioFromOffset, sanitizeLayout, snapRatio } from './layoutMath.js';

/**
 * Bộ não của khung chia màn hình: giữ trạng thái và quy tắc, không đụng DOM.
 *  onUpdate(snapshot): gọi mỗi khi cần vẽ lại.   onCommit({h, v}): gọi khi người dùng chốt một tỉ lệ (để lưu).
 */
export function createSplitController({ layout, minPx = 240, onUpdate = () => {}, onCommit = () => {} } = {}) {
  const saved = sanitizeLayout(layout);
  const state = { h: saved.h, v: saved.v, width: 0, height: 0, focus: null };

  const orientation = () => pickOrientation(state.width, state.height);
  const axisSize = () => (orientation() === 'horizontal' ? state.width : state.height);
  const key = () => (orientation() === 'horizontal' ? 'h' : 'v');

  function snapshot() {
    return {
      orientation: orientation(),
      ratio: clampRatio(state[key()], axisSize(), minPx),
      focus: state.focus,
      layout: { h: state.h, v: state.v },
    };
  }
  const emit = () => onUpdate(snapshot());
  const commit = () => onCommit({ h: state.h, v: state.v });
  function set(ratio) {
    state[key()] = clampRatio(ratio, axisSize(), minPx);
    emit();
  }

  return {
    snapshot,
    setSize(width, height) { state.width = width; state.height = height; emit(); },
    // Đang kéo: offsetPx là vị trí con trỏ tính từ mép đầu khung chứa theo chiều đang chia.
    dragTo(offsetPx) { state[key()] = snapRatio(ratioFromOffset(offsetPx, axisSize(), minPx)); emit(); },
    nudge(delta) { set(snapshot().ratio + delta); commit(); },
    setRatio(ratio) { set(ratio); commit(); },
    reset() { set(DEFAULT_LAYOUT[key()]); commit(); },
    commit,
    // Áp dụng bố cục đọc từ máy chủ (không kích hoạt lưu lại).
    setLayout(next) { const s = sanitizeLayout(next); state.h = s.h; state.v = s.v; emit(); },
    toggleFocus(side) { state.focus = state.focus === side ? null : side; emit(); },
    // Phóng to hẳn một khung ('left' | 'right') hoặc trả về chia đôi (null).
    setFocus(side) { state.focus = side === 'left' || side === 'right' ? side : null; emit(); },
  };
}
