// Theo dõi kích thước một phần tử (dùng ResizeObserver, trình duyệt cũ thì nghe sự kiện resize của cửa sổ).
// cb(width, height) được gọi ngay khi bắt đầu và mỗi lần đổi cỡ. Trả về hàm ngừng theo dõi.
export function observeSize(el, cb) {
  const run = () => cb(el.clientWidth, el.clientHeight);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(run);
    ro.observe(el);
    return () => ro.disconnect();
  }
  window.addEventListener('resize', run);
  setTimeout(run, 0);
  return () => window.removeEventListener('resize', run);
}
