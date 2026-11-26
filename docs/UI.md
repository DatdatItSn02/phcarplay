# Giao diện cho màn hình xe (giai đoạn 6)

Phong cách lấy ý tưởng từ YouTube (nền đen/trắng, chip danh mục, thanh tua đỏ, nút ⋮) nhưng không dùng logo hay tên YouTube. Mục tiêu: người lái xe nhìn nhanh, bấm trúng, ít phải gõ.

## Bố cục
- **Thanh điều hướng** dọc: Trang chủ, Tìm kiếm, Playlist, Hàng đợi; dưới cùng là nút đổi sáng/tối nhanh và nút Cài đặt (có chữ cái đầu tên tài khoản khi đã đăng nhập). Đặt bên trái hoặc bên phải (xe tay lái nghịch) trong Cài đặt. Màn hình dọc/điện thoại: thanh chuyển xuống dưới như app YouTube.
- **Trình phát** bên trái, **danh sách** bên phải. Kéo thanh giữa để đổi tỉ lệ, hoặc chọn hình trong Cài đặt > Bố cục màn hình: Video lớn, Chia đều, Danh sách lớn, Chỉ video, Chỉ danh sách.
- Khung video tự co cho vừa chỗ, để tên bài, thanh tua và nút điều khiển luôn thấy đủ mà không phải cuộn (đã thử 800x480, 1024x600, 1280x720, 1920x720, màn hình dọc, điện thoại).
- **Chỉ danh sách**: danh sách thành lưới thẻ, phía dưới có thanh phát nhỏ (trước/phát/sau, bấm để hiện lại trình phát).
- Danh sách tự đổi kiểu theo bề rộng khung: rất hẹp thì thẻ ảnh lớn; hẹp thì dòng gọn; rộng thì lưới.

## Thao tác
- Chạm một lần vào video: phát/tạm dừng. Chạm đúp bên trái/phải: lùi/tới 10 giây.
- Nút phát 72px, các nút khác tối thiểu 48px (ngưỡng an toàn 44px).
- Nút ⋮ trên mỗi video mở bảng thao tác lớn: Phát ngay, Phát tiếp theo, Thêm vào hàng đợi, Lưu vào playlist.
- Trang chủ có danh mục bấm một lần (cấu hình bằng `HOME_CHIPS` trong `.env`). Tìm kiếm có gợi ý, **tìm gần đây** (bấm lại thay vì gõ) và **tìm bằng giọng nói** (Chrome/Android; cần Internet; trình duyệt không hỗ trợ thì nút micro bị ẩn).
- Đang tải thì hiện khung xám; lỗi mạng thì báo rõ kèm nút **Thử lại**.

## Theme và cỡ chữ (Cài đặt)
- Giao diện: **Tự động** (theo máy), **Sáng**, **Tối** (mặc định), **Theo giờ** (tối từ 18h đến 6h, tự đổi mỗi phút).
- Cỡ chữ: Bình thường hoặc **Lớn** (phóng to cả chữ lẫn nút 12,5%).
- Các lựa chọn này lưu trên từng thiết bị (trình duyệt), không lưu lên tài khoản. Trang quản trị dùng chung theme đã chọn.

## Đổi màu
Mọi màu nằm ở đầu `public/assets/css/app.css`: khối `:root` (tối) và `[data-theme="light"]` (sáng). Ví dụ đổi màu nhấn đỏ: sửa `--brand`. Nhớ sửa cả màu nền trong `THEME_COLORS` (`core/appearance.js`) và `appearance-boot.js` nếu đổi `--bg`.

## Trang quản trị
Cùng màu và theme. Màn rộng (từ 1024px): thanh mục bên trái; màn hẹp: thanh trên cùng; điện thoại: mỗi dòng bảng thành một thẻ.

## Chưa thử được
- Màn hình xe thật, trình duyệt Android cũ trên đầu xe, Safari/iPhone.
- Nhận giọng nói tiếng Việt thật (bộ kiểm thử dùng bộ nhận giả).
- Kiểm thử giao diện chạy trên Chromium; font hiển thị là font hệ thống (Roboto trên Android, Segoe UI trên Windows), không tải font ngoài để khỏi phụ thuộc mạng.
