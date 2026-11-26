# PH Car Play

Website cho màn hình xe hơi: xem YouTube (qua Piped, dự phòng Invidious, cuối cùng là YouTube: tìm kiếm trực tiếp/Data API và trình phát YouTube) có cửa sổ nổi (PiP), chia màn hình kéo thả.
Backend PHP 7.4+ và MySQL, giao diện JavaScript thuần (ES module, không cần bước build).

**Tiến độ:** đã xong giai đoạn 0 (nền tảng), 1 (tài khoản), 2 (chia màn hình kéo thả), 3 (YouTube qua Piped: tìm kiếm, trình phát, playlist, tự phát, Mix), 4 (cửa sổ nổi PiP, toàn màn hình, Media Session), 5 (trang quản trị `/admin`: tổng quan, người dùng, key kích hoạt, playlist, nhật ký, quản trị viên), 6 (giao diện kiểu YouTube cho màn hình xe, theme sáng/tối, `docs/UI.md`) 7 (rà soát bảo mật, hướng dẫn triển khai `docs/DEPLOY.md`, lệnh tự kiểm tra `php bin/doctor.php`) 8 (sửa trang đăng nhập, Invidious dự phòng, chọn nhiều key, không xóa dữ liệu khỏi database) và 9 (YouTube dự phòng: tìm kiếm trực tiếp hoặc YouTube Data API, phát bằng trình phát YouTube khi không có luồng). Cửa sổ nổi thật chỉ thử được trên thiết bị, xem `docs/PIP.md`. Hướng dẫn trang quản trị: `docs/ADMIN.md`.

## Yêu cầu
Mã nguồn viết tương thích PHP 7.4 đến 8.x. PHP 7.4 đã hết hỗ trợ bảo mật từ 11/2022, khi chạy thật nên nâng lên PHP 8.1 trở lên.

- PHP 7.4 trở lên (extension `pdo_mysql`, `mbstring`, `openssl`)
- MySQL 5.7+ hoặc MariaDB 10.3+
- HTTPS khi chạy thật (cookie bảo mật, HSTS; trình duyệt chỉ cho dùng micro và một số tính năng trên HTTPS)

## Cài đặt
Đưa lên máy chủ thật (hosting cPanel hoặc VPS, HTTPS, sao lưu, cập nhật): xem **`docs/DEPLOY.md`**. Tóm tắt:

1. `cp .env.example .env` rồi sửa thông tin database, `APP_URL`...
2. Tạo database: dán `database/schema.sql` vào phpMyAdmin (tab SQL) hoặc chạy `mysql -u root -p < database/schema.sql`.
   File này tạo database `carweb` và toàn bộ bảng, **không có khóa ngoại**. Cuối file có sẵn câu lệnh (đang để dạng chú thích) để tạo admin master. Trên hosting cPanel hãy xóa hai dòng đầu (`CREATE DATABASE`, `USE`) và chọn sẵn database trong phpMyAdmin.
   Nếu có dòng lệnh, có thể thay bước này bằng `php bin/install.php` (chạy migration và hỏi email/mật khẩu admin master).
3. Điều hướng **mọi yêu cầu** của website vào `public/index.php` (giữ nguyên đường dẫn gốc). Chỉ có một file vào duy nhất này, lo cả API (`/api/...`), file tĩnh (`/assets/...`) và trang giao diện.
   Nếu website nằm trong thư mục con, đặt `APP_BASE_PATH=/ten-thu-muc` trong `.env`.

4. Chạy `php bin/doctor.php` để máy tự kiểm tra cấu hình (database, gửi thư, Piped, quyền thư mục, có lộ `.env` không...).

Chạy thử nhanh không cần cấu hình máy chủ: `php -S localhost:8000 public/index.php`, rồi mở http://localhost:8000 (khi phát triển có thể đặt `APP_DEBUG=true` để xem chi tiết lỗi).

## Piped / Invidious / YouTube (nguồn video)
Piped và Invidious công cộng hay bị YouTube chặn. Khi cả hai hỏng, website **tự dùng YouTube**: tìm kiếm trực tiếp (hoặc YouTube Data API nếu đặt `YOUTUBE_API_KEY`) và phát bằng **trình phát YouTube** (có quảng cáo của YouTube, không có cửa sổ nổi, tắt màn hình thường dừng nhạc). Xem các dòng `YOUTUBE_*` trong `.env.example`.
App lấy video qua Piped; Piped không trả lời thì tự chuyển sang Invidious (thứ tự đặt ở `VIDEO_SOURCES`). Địa chỉ nằm ở `PIPED_API_URLS` và `INVIDIOUS_API_URLS` trong `.env` (nhiều địa chỉ, cách nhau bằng dấu phẩy; thử lần lượt, địa chỉ hỏng bị tạm bỏ qua 10 phút).
- **Tìm địa chỉ đang chạy:** `php bin/video-scan.php` thử từng địa chỉ (trong `.env` và danh sách công khai có sẵn): tìm kiếm, xin luồng phát và tải thử luồng phát; cuối cùng in dòng `PIPED_API_URLS=...` / `INVIDIOUS_API_URLS=...` để dán vào `.env`. Chạy trên **chính máy chủ website** (máy chủ có thể bị chặn khác máy bạn).
- Kiểm tra một địa chỉ còn sống không: mở `https://TEN-MIEN-PIPED-API/healthcheck` trên trình duyệt, phải thấy `OK`. Instance công khai có thể ngừng hoạt động hoặc bị YouTube chặn bất cứ lúc nào; danh sách cập nhật: https://github.com/TeamPiped/documentation/blob/main/content/docs/public-instances/index.md. Về lâu dài nên tự dựng một instance Piped riêng.
- Máy chủ PHP cần extension `curl` (hoặc `openssl` kèm `allow_url_fopen`). Nếu `storage/logs/app.log` ghi lỗi `SSL certificate problem` (thường gặp trên XAMPP/Windows), hãy cấu hình `curl.cainfo` trong `php.ini` trỏ tới file `cacert.pem`, hoặc tạm đặt `PIPED_VERIFY_SSL=false` khi phát triển (không dùng khi chạy thật).
- `MUSIC_QUERY` là từ khóa tìm nhạc thịnh hành khi mở web mà người dùng chưa có playlist.

## Cấu hình hay dùng (.env)
| Biến | Ý nghĩa |
|---|---|
| `SINGLE_DEVICE_LOGIN` | `true` (mặc định): mỗi tài khoản chỉ đăng nhập một thiết bị, đăng nhập mới đăng xuất thiết bị cũ. `false`: cho nhiều thiết bị |
| `ENFORCE_LICENSE` | Bật kiểm soát quyền theo key/hạn dùng (mặc định tắt) |
| `MAIL_DRIVER` | `log`, `mail` hoặc `smtp` |
| `HOME_CHIPS` | Danh mục bấm nhanh ở Trang chủ, dạng `Nhãn=từ khóa,Nhãn=từ khóa` (tối đa 12). Bỏ trống dùng 7 danh mục mặc định |
| `APP_DEBUG` | `false` khi chạy thật (mặc định). `true` chỉ khi phát triển |
| `CLIENT_IP_HEADER` | Để trống; chỉ đặt khi chạy sau Cloudflare/proxy (xem `docs/DEPLOY.md`) |
| `LOGIN_THROTTLE` | `false` (mặc định): không giới hạn số lần đăng nhập sai, đúng quyết định dự án. `true`: tạm chặn 15 phút khi sai nhiều lần |
| `RATE_LIMIT`, `RATE_LIMIT_YOUTUBE`, `CSP_ENABLED`, `HSTS_MAX_AGE`, `HLS_JS_URL`, `HLS_JS_INTEGRITY` | Các tùy chọn bảo mật, giữ mặc định (xem `docs/DEPLOY.md` mục 8) |

## Kiểm thử
```bash
php tests/run.php                  # kiểm thử đơn vị, không cần database
php tests/run.php --integration    # thêm luồng đăng ký/đăng nhập/quên mật khẩu và quản trị với MySQL thật (dùng database thử riêng, đã chạy php bin/migrate.php)
node --test tests/js/*.test.mjs    # kiểm thử phần JavaScript lõi (api, layout, youtube, pip, admin, manage, ui6, security; cần Node 18+)
php bin/doctor.php                 # tự kiểm tra máy chủ (thêm --offline để bỏ phần gọi mạng)
php bin/send-test-mail.php ten@email.com   # thử cấu hình gửi mail
```

## Lệnh hữu ích
| Lệnh | Việc làm |
|---|---|
| `php bin/migrate.php` | Chạy các migration mới |
| `php bin/install.php` | Migration và tạo admin master lần đầu |
| `php -S localhost:8000 public/index.php` | Chạy thử nhanh; trang quản trị ở http://localhost:8000/admin |
| `php bin/reset-master.php --password=...` | Đặt lại mật khẩu admin master khi quên |
| `php bin/send-test-mail.php email` | Gửi thư thử |
| `php bin/doctor.php` | Tự kiểm tra máy chủ trước khi mở website và sau mỗi lần cập nhật |

## Tài liệu
- `docs/DEPLOY.md` - đưa lên máy chủ thật (cPanel/VPS), HTTPS, sao lưu, cập nhật, bảo mật, xử lý sự cố
- `docs/ARCHITECTURE.md` - cấu trúc thư mục, cách các lớp phối hợp, bảo mật
- `docs/ADD_FEATURE.md` - cách thêm một chức năng mới
- `docs/API.md` - danh sách API hiện có (người dùng và quản trị)
- `docs/ADMIN.md` - dùng trang quản trị: cài master, đăng nhập, quản lý người dùng, key kích hoạt, playlist, nhật ký, thêm admin, quên mật khẩu
- `docs/PIP.md` - cửa sổ nổi: giới hạn và cách thử trên thiết bị
- `docs/UI.md` - giao diện cho màn hình xe: theme sáng/tối, cỡ chữ, bố cục, các thao tác chạm, cách đổi màu
- `mobile/README.md` - ứng dụng Android/iOS (vỏ mở website): điền cấu hình, build APK, build iOS trên Mac, quy tắc đồng bộ khi cập nhật
