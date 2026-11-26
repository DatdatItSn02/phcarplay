// Thông báo nhỏ ở dưới màn hình, tự ẩn sau vài giây.
let box = null;
let timer = null;

export function showToast(message, ms = 3200) {
  if (!box) {
    box = document.createElement('div');
    box.className = 'toast';
    box.setAttribute('role', 'status');
    document.body.appendChild(box);
  }
  box.textContent = message;
  box.classList.add('on');
  clearTimeout(timer);
  timer = setTimeout(() => box.classList.remove('on'), ms);
}
