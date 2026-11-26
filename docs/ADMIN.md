# Trang quản trị

Địa chỉ: `https://TEN-MIEN/admin` (thử trên máy: http://localhost:8000/admin). Phiên đăng nhập riêng, hết hạn sau 8 giờ.

## Lần đầu: tạo tài khoản master
1. Cập nhật cấu trúc database. Cách nào cũng được:
   - `php bin/migrate.php` (chạy các migration mới `005_audit_log.sql` và `006_license_keys.sql`), hoặc
   - dán SQL này vào phpMyAdmin (tab SQL) của database `carweb`:
```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id INT UNSIGNED NULL,
  admin_email VARCHAR(190) NOT NULL DEFAULT '',
  action VARCHAR(60) NOT NULL,
  target_type VARCHAR(30) NOT NULL DEFAULT '',
  target_id VARCHAR(64) NOT NULL DEFAULT '',
  detail VARCHAR(1000) NOT NULL DEFAULT '',
  ip VARCHAR(45) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_audit_created (created_at),
  KEY idx_audit_admin (admin_id, created_at),
  KEY idx_audit_action (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO migrations (name, ran_at) VALUES ('005_audit_log.sql', NOW());

CREATE TABLE IF NOT EXISTS license_keys (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code CHAR(19) NOT NULL,
  days INT UNSIGNED NOT NULL,
  note VARCHAR(190) NOT NULL DEFAULT '',
  status ENUM('unused','used','revoked') NOT NULL DEFAULT 'unused',
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL,
  used_by INT UNSIGNED NULL,
  used_by_email VARCHAR(190) NULL,
  used_at DATETIME NULL,
  revoked_by INT UNSIGNED NULL,
  revoked_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_license_code (code),
  KEY idx_license_status (status, id),
  KEY idx_license_user (used_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO migrations (name, ran_at) VALUES ('006_license_keys.sql', NOW());
```
   Nếu dán bằng phpMyAdmin thì làm xong cả các lệnh (cả hai bảng và hai dòng `INSERT IGNORE INTO migrations`) để lần sau `php bin/migrate.php` không chạy lại. Database mới tạo bằng `database/schema.sql` thì đã có đủ, không cần làm gì thêm.
2. Tạo master (nếu chưa có): `php bin/install.php` (hỏi email và mật khẩu từ 8 ký tự). Quên mật khẩu master: dùng "Quên mật khẩu?" ở màn hình đăng nhập (cần cấu hình gửi mail), hoặc `php bin/reset-master.php --password=MatKhauMoi123`.

## Các mục của trang quản trị
Thanh mục phía trên: **Tổng quan, Người dùng, Key kích hoạt, Playlist, Nhật ký, Quản trị viên, Tài khoản của tôi**. Admin thường không thấy **Nhật ký** và **Quản trị viên** (chỉ master); quyền được kiểm tra ở máy chủ, ẩn nút chỉ là tiện lợi.

### Tổng quan
Số người dùng (tổng, hoạt động, đã khóa, đăng ký 7 ngày qua), tình trạng hạn dùng (còn hạn, hết hạn, chưa có hạn), số key theo trạng thái, số playlist và bài, số quản trị viên. Master thấy thêm 8 thao tác gần đây. Có nút "Làm mới" và đường tắt sang các mục.

### Người dùng
- Tìm theo email hoặc tên; lọc theo trạng thái (hoạt động/đã khóa/**đã xóa**) và hạn dùng (còn hạn/hết hạn/chưa có hạn). Chọn "Đã xóa" để xem tài khoản đã xóa kèm **người xóa và thời điểm**.
- Bấm **Quản lý** ở một dòng để mở hộp chi tiết: email, tên, trạng thái, hạn dùng, thiết bị đang đăng nhập (trình duyệt/hệ điều hành, IP, từ lúc nào), ngày đăng ký, đăng nhập gần nhất, danh sách playlist và các key đã nhập.
- Thao tác trong hộp chi tiết: **Sửa thông tin** (tên, email, số điện thoại đăng nhập; để trống ô SĐT để bỏ số), **Hạn dùng** (+30/+90/+365 ngày, đặt ngày hết hạn cụ thể, hoặc xóa hạn), **Khóa/Mở khóa** (khóa thì người dùng bị đăng xuất ngay và không đăng nhập lại được), **Mật khẩu mới** (hiện một lần để bạn chép gửi họ; người dùng bị đăng xuất khỏi mọi thiết bị), **Gửi mã đặt lại mật khẩu** (mã 6 số qua email, hiệu lực 10 phút), **Đăng xuất thiết bị**, **Xóa người dùng**.
- Mật khẩu mới do admin đặt cho người dùng là mật khẩu **chính thức** (người dùng không bị buộc đổi); họ muốn đổi thì dùng "Quên mật khẩu" ở màn hình đăng nhập. Nên dùng "Gửi mã đặt lại mật khẩu" khi có thể để người dùng tự chọn mật khẩu.
- Xóa người dùng: tài khoản không đăng nhập được nữa, bị ẩn khỏi danh sách cùng playlist của họ. Từ giai đoạn 8 **không có gì bị xóa khỏi database**: hệ thống chỉ đánh dấu người xóa và thời điểm (xem ở bộ lọc "Đã xóa"). Email đó đăng ký lại được (thành tài khoản mới). Key họ đã nhập vẫn được giữ để đối soát. Mọi admin đều xóa được người dùng.

### Key kích hoạt
- **Tạo key**: chọn số lượng (1 đến 100), số ngày mỗi key cộng (1 đến 3650) và ghi chú (ví dụ tên khách hoặc lô bán). Sau khi tạo có hộp liệt kê đủ key, nút **Sao chép tất cả** và **Tải CSV** (mở được bằng Excel, đúng tiếng Việt).
- Key dạng `ABCD-EFGH-JKMN-PQRS` (16 ký tự, không có 0/O/1/I/L để khỏi nhầm). Mỗi key dùng **một lần**; người dùng nhập ở **Cài đặt > Nhập key kích hoạt** trên trang chính (nút Cài đặt có chữ cái đầu tên tài khoản ở thanh điều hướng), gõ chữ thường hay bỏ gạch nối đều được.
- Nhập key thì **cộng dồn** vào hạn dùng: còn hạn thì nối tiếp vào hạn hiện tại, hết hạn hoặc chưa có thì tính từ lúc nhập.
- Trạng thái: *Chưa dùng*, *Đã dùng* (ghi người dùng và thời điểm), *Đã thu hồi*. **Thu hồi** chỉ với key chưa dùng; **Xóa** chỉ với key chưa dùng hoặc đã thu hồi. Key đã dùng được giữ làm lịch sử, không xóa được.
- **Chọn nhiều key**: mỗi dòng có cột **STT** và **ô tích**; ô tích ở đầu bảng chọn tất cả key trong trang đang xem. Khi có key được chọn, thanh thao tác hiện ở đáy màn hình: **Thu hồi**, **Xóa**, **Sao chép mã**, **Tải CSV**, **Bỏ chọn**. Con số trên nút là số key làm được (ví dụ key đã dùng không xóa được); key không làm được tự bỏ qua và được báo lại. Cả lô ghi một dòng nhật ký.
- Bộ lọc trạng thái có thêm **Đã xóa**: xem key đã xóa kèm người xóa và thời điểm. Key đã xóa không nhập được nữa.
- Key lưu trong database ở dạng chữ rõ (để bạn xem lại và gửi cho khách). Coi danh sách key như tiền: chỉ giao quyền admin cho người tin cậy.
- `ENFORCE_LICENSE` mặc định **tắt**: người dùng đăng ký xong dùng được đủ tính năng dù chưa nhập key. Khi bật, tài khoản hết hạn chỉ còn tính năng của khách. Hãy bật khi bạn đã sẵn sàng bán key.

### Playlist
Xem playlist người dùng đã lưu trên tài khoản (không gồm playlist khách lưu trên trình duyệt): tìm theo tên hoặc email chủ, **Xem** danh sách bài, **Xóa** playlist (ẩn cả bài trong đó). Chọn **Đã xóa** để xem playlist đã xóa kèm người xóa (quản trị viên hoặc chính người dùng) và thời điểm. Mỗi lần xóa đều có trong nhật ký.

### Nhật ký (chỉ master)
Ai đã làm gì, lúc nào, từ IP nào: lọc theo hành động, khoảng ngày, tìm theo email người làm hoặc chi tiết. Chỉ thêm, không sửa hay xóa được và không bao giờ chứa mật khẩu. Các hành động: đăng nhập và quản lý admin; sửa, gia hạn, khóa, đặt mật khẩu, gửi thư đặt lại, đăng xuất thiết bị, xóa người dùng; tạo, thu hồi, xóa key (từng key hoặc hàng loạt); xóa playlist.

### Quản trị viên (chỉ master)
Thêm admin (tên, email, mật khẩu tạm; có nút tạo mật khẩu ngẫu nhiên), sửa tên/email, khóa/mở khóa, đặt lại mật khẩu tạm, xóa (đánh dấu; xem lại ở bộ lọc **Đã xóa**). Mật khẩu tạm chỉ hiện **một lần** ở hộp thoại để bạn chép gửi cho người đó; họ bị buộc đổi mật khẩu ở lần đăng nhập đầu và chưa dùng được chức năng nào khác trước khi đổi.

### Tài khoản của tôi (mọi admin)
Xem thông tin, đổi mật khẩu. Master sửa được tên và email của chính mình.

### Ghi chú chung
- Khóa, xóa tài khoản hoặc đổi mật khẩu của một admin thì mọi phiên đang mở của người đó bị đăng xuất trong vòng khoảng một phút (hoặc ngay ở thao tác kế tiếp).
- Master được bảo vệ: không khóa, không xóa, không đặt mật khẩu tạm, không tạo thêm master từ giao diện.
- Hộp thoại đóng bằng phím **Esc**; khi mở hộp này chồng lên hộp kia thì Esc đóng hộp trên cùng.
- Trang quản trị dùng được trên điện thoại: bảng tự chuyển thành thẻ.

## Nhật ký thao tác
Mọi thao tác quan trọng ghi vào bảng `audit_log` kèm người làm, thời điểm và IP, không bao giờ ghi mật khẩu. Từ giai đoạn 7 còn ghi **Đăng nhập quản trị sai mật khẩu** (kèm email đã gõ; mỗi máy tối đa 5 dòng trong 15 phút) và **Đăng nhập quản trị sai nhiều lần liên tiếp**; người làm hiển thị là "Hệ thống". Đăng nhập sai không bị chặn (quyết định của dự án); nếu bật `LOGIN_THROTTLE=true` thì sai 5 lần trên một máy sẽ bị tạm chặn 15 phút và nhật ký ghi **Tạm chặn đăng nhập quản trị**. Thấy nhiều dòng lạ là dấu hiệu có người đang dò mật khẩu: đổi mật khẩu quản trị và xem `docs/DEPLOY.md` mục 8. Master xem ở mục **Nhật ký**; cũng có thể xem bằng phpMyAdmin: `SELECT * FROM audit_log ORDER BY id DESC`.

## Gửi thư (quên mật khẩu)
Cần cấu hình `MAIL_DRIVER`, `APP_URL`... trong `.env` (xem README). Khi phát triển để `MAIL_DRIVER=log` thì thư được ghi vào `storage/mail/*.txt`; mở file `.txt` mới nhất để lấy liên kết `/admin/reset-password?token=...`.
