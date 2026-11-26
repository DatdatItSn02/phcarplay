-- PH Car Play - BỔ SUNG PHẦN DATABASE CỦA GIAI ĐOẠN 14 VÀ 15
--
-- Dùng khi website báo "Lỗi hệ thống" lúc đăng nhập bằng số điện thoại, đăng ký, quên mật khẩu,
-- lưu số điện thoại trong Cài đặt hoặc bấm "Chiếu ĐT". Nguyên nhân: mã nguồn đã là bản mới nhưng
-- database vẫn ở cấu trúc cũ (thiếu cột users.phone, bảng otp_codes, cast_sessions, cast_signals).
--
-- File này làm gì: THÊM những cột và bảng nói trên nếu database chưa có. Cái gì có rồi thì bỏ qua.
-- An toàn: không xóa, không sửa dữ liệu đang có; chạy lại bao nhiêu lần cũng được.
-- Điều kiện: database đã có các bảng của website (bản 009 trở lên).
--
-- Cách chạy (chọn MỘT cách), nhớ chọn đúng database của website (trên alwaysdata: ten-tai-khoan_ten-database):
--   Navicat:    bấm phải vào tên database > "Execute SQL File..." > chọn file này > Start.
--   phpMyAdmin: bấm vào tên database > tab "Import" (Nhập) > chọn file này > bấm nút ở cuối trang.
--   Dòng lệnh:  mysql -u TEN_DANG_NHAP -p TEN_DATABASE < database/bo-sung-giai-doan-14-15.sql
-- Kết quả giống hệt lệnh "php bin/migrate.php" khi chạy hai file 010_user_phone_otp.sql và 011_cast_sessions.sql.

SET NAMES utf8mb4;

-- 1. Giai đoạn 14: cột users.phone (số điện thoại đăng nhập). Tài khoản đang có sẽ có phone = NULL.
SET @thieu := (SELECT COUNT(*) = 0 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone');
SET @lenh := IF(@thieu, 'ALTER TABLE users ADD COLUMN phone VARCHAR(15) NULL AFTER email', 'SET @bo_qua = 1');
PREPARE buoc FROM @lenh;
EXECUTE buoc;
DEALLOCATE PREPARE buoc;

-- 2. Giai đoạn 14: mỗi số điện thoại chỉ thuộc một tài khoản đang dùng.
SET @thieu := (SELECT COUNT(*) = 0 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'uq_users_phone_alive');
SET @lenh := IF(@thieu, 'ALTER TABLE users ADD UNIQUE KEY uq_users_phone_alive (phone, alive)', 'SET @bo_qua = 1');
PREPARE buoc FROM @lenh;
EXECUTE buoc;
DEALLOCATE PREPARE buoc;

-- 3. Giai đoạn 14: bảng mã OTP 6 số (quên mật khẩu).
CREATE TABLE IF NOT EXISTS otp_codes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_type VARCHAR(10) NOT NULL,
  account_id INT UNSIGNED NOT NULL,
  purpose VARCHAR(20) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  channels VARCHAR(30) NOT NULL DEFAULT '',
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_otp_account (account_type, account_id, purpose, used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Giai đoạn 15: hai bảng ghép nối khi chiếu màn hình điện thoại lên màn hình xe.
CREATE TABLE IF NOT EXISTS cast_sessions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code CHAR(6) NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'waiting',
  receiver_hash CHAR(64) NOT NULL,
  sender_hash CHAR(64) NULL,
  device_name VARCHAR(60) NOT NULL DEFAULT '',
  created_ip VARCHAR(45) NOT NULL DEFAULT '',
  joined_ip VARCHAR(45) NOT NULL DEFAULT '',
  code_expires_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  paired_at DATETIME NULL,
  ended_at DATETIME NULL,
  ended_by VARCHAR(10) NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_cast_code (code, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cast_signals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id INT UNSIGNED NOT NULL,
  from_role VARCHAR(10) NOT NULL,
  kind VARCHAR(10) NOT NULL,
  payload TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_cast_signals (session_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Ghi nhận là hai bản cập nhật này đã chạy, để "php bin/migrate.php" về sau không chạy lại.
CREATE TABLE IF NOT EXISTS migrations (
  name VARCHAR(190) NOT NULL PRIMARY KEY,
  ran_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO migrations (name, ran_at) VALUES ('010_user_phone_otp.sql', NOW()), ('011_cast_sessions.sql', NOW());

-- 6. Kết quả: cả bốn cột phải bằng 1.
SELECT
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone') AS co_cot_phone,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'otp_codes') AS co_bang_otp_codes,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cast_sessions') AS co_bang_cast_sessions,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cast_signals') AS co_bang_cast_signals;
