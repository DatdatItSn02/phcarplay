/* Chạy NGAY trong <head> (public/index.php chèn nguyên văn file này) để trang hiện ra đúng màu ngay từ đầu, không nháy.
   Phép tính phải giống resolveTheme() trong core/appearance.js (có kiểm thử so sánh hai bên).
   Viết kiểu cũ (var, function) để chạy được cả trên trình duyệt rất cũ của màn hình xe. */
(function () {
  var root = document.documentElement;
  function read(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  var mode = read('carweb_theme');
  if (mode !== 'auto' && mode !== 'light' && mode !== 'dark' && mode !== 'time') mode = 'dark';
  var dark = true;
  if (mode === 'light') dark = false;
  else if (mode === 'auto') dark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  else if (mode === 'time') { var hour = new Date().getHours(); dark = hour >= 18 || hour < 6; }
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  if (read('carweb_text') === 'large') root.setAttribute('data-text', 'large');
  if (read('carweb_rail') === 'right') root.setAttribute('data-rail', 'right');
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0f0f0f' : '#ffffff');
})();
