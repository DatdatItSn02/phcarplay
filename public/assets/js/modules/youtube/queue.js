const HISTORY_MAX = 50;

/**
 * Hàng đợi phát: danh sách bài, vị trí bài đang phát, và lịch sử các bài đã phát (để chế độ Mix không lặp lại).
 * Thuần logic, không đụng DOM.
 */
export function createQueue({ onChange = () => {} } = {}) {
  let items = [];
  let index = -1;
  let history = [];

  const snapshot = () => ({ items: items.slice(), index, current: index >= 0 ? items[index] || null : null, history: history.slice() });
  const emit = () => onChange(snapshot());
  const indexOf = (id) => items.findIndex((i) => i.id === id);
  function dedupe(list) {
    const seen = new Set();
    return list.filter((i) => i && i.id && !seen.has(i.id) && seen.add(i.id));
  }

  return {
    snapshot,
    // Lặp tất cả: hết hàng đợi thì quay về bài đầu.
    restart() {
      if (!items.length) return null;
      index = 0;
      emit();
      return items[0];
    },
    last() {
      if (!items.length) return null;
      index = items.length - 1;
      emit();
      return items[index];
    },
    hasNext: () => index + 1 < items.length,
    // Bổ sung tên bài/kênh cho bài chưa biết tên (video mặc định trong .env). Trả bài đã cập nhật hoặc null.
    updateMeta(id, meta) {
      const i = indexOf(id);
      if (i < 0) return null;
      items[i] = Object.assign({}, items[i], meta);
      emit();
      return items[i];
    },

    // Thay cả hàng đợi (ví dụ "Phát tất cả" một playlist), bắt đầu từ vị trí start.
    setItems(list, start = 0) {
      items = dedupe(list);
      index = items.length ? Math.min(Math.max(start, 0), items.length - 1) : -1;
      emit();
    },

    // Thêm vào cuối, hoặc chèn ngay sau bài đang phát khi next = true. Trả false nếu bài đã có sẵn.
    add(item, { next = false } = {}) {
      if (!item || !item.id || indexOf(item.id) >= 0) return false;
      if (next && index >= 0) items.splice(index + 1, 0, item);
      else items.push(item);
      emit();
      return true;
    },

    // Chèn bài (nếu chưa có) ngay sau bài đang phát rồi chuyển sang đó.
    playNow(item) {
      const at = indexOf(item.id);
      if (at >= 0) index = at;
      else {
        items.splice(index + 1, 0, item);
        index = index + 1;
      }
      emit();
      return item;
    },

    // Thêm bài vào cuối và chọn luôn (dùng cho Mix tự chọn bài kế tiếp).
    appendAndSelect(item) {
      const at = indexOf(item.id);
      if (at >= 0) index = at;
      else { items.push(item); index = items.length - 1; }
      emit();
      return items[index];
    },

    next() {
      if (index + 1 >= items.length) return null;
      index += 1;
      emit();
      return items[index];
    },
    prev() {
      if (index <= 0) return null;
      index -= 1;
      emit();
      return items[index];
    },
    jump(i) {
      if (i < 0 || i >= items.length) return null;
      index = i;
      emit();
      return items[index];
    },

    // Không xóa được bài đang phát. Trả true nếu đã xóa.
    remove(i) {
      if (i < 0 || i >= items.length || i === index) return false;
      items.splice(i, 1);
      if (i < index) index -= 1;
      emit();
      return true;
    },

    // Chuyển bài từ vị trí `from` sang `to`, vẫn giữ nguyên bài đang phát.
    move(from, to) {
      if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return false;
      const playingId = index >= 0 ? items[index].id : null;
      const [it] = items.splice(from, 1);
      items.splice(to, 0, it);
      if (playingId) index = indexOf(playingId);
      emit();
      return true;
    },

    // Xóa mọi bài trừ bài đang phát.
    clearOthers() {
      if (index >= 0) { items = [items[index]]; index = 0; } else { items = []; }
      emit();
    },

    markPlayed(id) {
      history = history.filter((x) => x !== id);
      history.push(id);
      if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
    },
  };
}
