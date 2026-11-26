Thư mục cho thư viện tải về máy chủ của bạn (không bắt buộc).

hls.js: giúp phát luồng HLS trên trình duyệt không tự phát được (Chrome trên Android, máy tính).
Mặc định website nạp hls.js từ CDN cdnjs. Muốn không phụ thuộc CDN bên ngoài:
  1. Tải file: https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.17/hls.min.js
  2. Đặt vào đúng chỗ này với tên hls.min.js  (public/assets/vendor/hls.min.js)
Website tự nhận ra file và dùng nó thay cho CDN. Kiểm tra bằng lệnh: php bin/doctor.php
