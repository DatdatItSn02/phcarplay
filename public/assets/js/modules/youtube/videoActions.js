import { showToast } from '../../core/toast.js';
import { openPlaylistPicker } from './playlistPicker.js';

/**
 * Các thao tác chung cho một video (dùng trong bảng ⋮ của Trang chủ, Tìm kiếm...).
 * extra: thao tác riêng của từng nơi (đưa lên/xuống, xóa khỏi playlist...).
 */
export function videoMenu(item, media, extra = []) {
  const { controller, queue } = media;
  return [
    { icon: 'play', label: 'Phát ngay', onClick: () => controller.playNow(item) },
    { icon: 'playNext', label: 'Phát tiếp theo', onClick: () => {
      if (!controller.snapshot().current) { controller.playNow(item); return; }
      showToast(queue.add(item, { next: true }) ? 'Bài này sẽ phát ngay sau bài hiện tại.' : 'Bài này đã có trong hàng đợi.');
    } },
    { icon: 'addQueue', label: 'Thêm vào hàng đợi', onClick: () => showToast(controller.enqueue(item) ? 'Đã thêm vào hàng đợi.' : 'Bài này đã có trong hàng đợi.') },
    { icon: 'playlistAdd', label: 'Lưu vào playlist', onClick: () => openPlaylistPicker({ store: media.playlists, items: [item] }) },
  ].concat(extra);
}
