# Thêm một chức năng mới

Ví dụ: thêm "địa điểm yêu thích" (lưu các nơi hay đến).

1. **Bảng dữ liệu:** tạo `database/migrations/00N_favorite_places.sql`, rồi chạy `php bin/migrate.php`. Nhớ thêm cùng đoạn SQL vào `database/schema.sql` (và dòng ghi tên migration vào bảng `migrations`). **Không dùng khóa ngoại**, chỉ thêm `KEY` cho cột liên kết.
2. **Repository:** `app/Repositories/FavoritePlaceRepository.php` chứa các câu SQL (list, create, delete). Nhận `Database` ở hàm khởi tạo.
3. **Service (nếu có nghiệp vụ):** `app/Services/FavoritePlaceService.php`, ví dụ giới hạn số địa điểm, kiểm tra quyền qua `EntitlementService`.
4. **Controller:** `app/Controllers/FavoritePlaceController.php`, mỗi hàm nhận `Request` và trả `Response::ok(...)`. Lấy người dùng hiện tại bằng `$request->attributes['user']`. Báo lỗi bằng `throw new HttpException(...)`.
5. **Route:** thêm vào `routes/api.php`, bọc trong nhóm cần đăng nhập:
   ```php
   $router->group([RequireUser::class], function (Router $r) {
       $r->get('/places', [FavoritePlaceController::class, 'index']);
       $r->post('/places', [FavoritePlaceController::class, 'store']);
   });
   ```
6. **Giao diện:** tạo `public/assets/js/modules/places/` (api + view), dùng `api` từ `core/api.js`. Gắn vào màn hình chính ở `main.js` hoặc khung chia màn hình (từ giai đoạn 2 sẽ có cơ chế đăng ký "panel").
7. **Kiểm thử:** thêm file `tests/unit/...Test.php` (hàm `test('tên', fn)`), và nếu cần thì `tests/integration/`.
8. **Tài liệu:** ghi API mới vào `docs/API.md`.

## Lưu ý bảo mật khi thêm chức năng (giai đoạn 7)
- Thao tác có thể bị lạm dụng (gửi thư, tạo dữ liệu hàng loạt, gọi dịch vụ ngoài): thêm giới hạn tần suất ngay trong Controller, ví dụ `$this->limiter->enforce('places:u:' . $userId, 30, 600, 'Bạn thao tác quá nhanh.');` (nhận `RateLimiter $limiter` ở hàm khởi tạo).
- Trang có Content-Security-Policy: **không thêm thẻ `<script>` nội tuyến hay thuộc tính `onclick=`** trong HTML; viết code trong file `.js` và gắn sự kiện bằng `h()` (CSP sẽ chặn mã nội tuyến). Ảnh/video từ máy chủ ngoài vẫn dùng được.
- Không trả phiên bản phần mềm, đường dẫn file hay câu SQL trong thông báo lỗi; lỗi bất ngờ để `ErrorHandler` lo (chỉ hiện chi tiết khi `APP_DEBUG=true`).
- Hành động quản trị quan trọng: ghi nhật ký bằng `AuditService::record(...)`, không bao giờ ghi mật khẩu/token.
- Chạy `php bin/doctor.php` sau khi thêm cấu hình mới vào `.env`.
