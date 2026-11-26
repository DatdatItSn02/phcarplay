-- ============================================================
-- PH Car Play: tạo toàn bộ cấu trúc database (giai đoạn 0-11: tài khoản, đăng nhập một thiết bị, cài đặt giao diện, playlist, nhật ký quản trị, key kích hoạt, xóa bằng cách đánh dấu, khóa YouTube API riêng, lượt nghe)
-- KHÔNG dùng khóa ngoại (FOREIGN KEY). Quan hệ giữa các bảng chỉ qua cột id
-- và được đảm bảo bằng code PHP; các cột liên kết đều có chỉ mục (KEY) để truy vấn nhanh.
-- Cách dùng: dán toàn bộ file này vào phpMyAdmin (tab SQL) hoặc: mysql -u root -p < database/schema.sql
-- Chạy lại nhiều lần không sao (CREATE TABLE IF NOT EXISTS).
-- ============================================================

CREATE DATABASE IF NOT EXISTS carweb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE carweb;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(15) NULL,
  name VARCHAR(100) NOT NULL DEFAULT '',
  password_hash CHAR(32) NOT NULL,
  salt CHAR(16) NOT NULL,
  status ENUM('active','blocked') NOT NULL DEFAULT 'active',
  expires_at DATETIME NULL,
  last_login_at DATETIME NULL,
  session_token CHAR(64) NULL,
  session_device VARCHAR(190) NULL,
  session_ip VARCHAR(45) NULL,
  session_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  alive TINYINT(1) NULL DEFAULT 1,
  deleted_at DATETIME NULL,
  deleted_by_type VARCHAR(10) NULL,
  deleted_by_id INT UNSIGNED NULL,
  deleted_by_email VARCHAR(190) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email_alive (email, alive),
  UNIQUE KEY uq_users_phone_alive (phone, alive),
  KEY idx_users_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admins (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(190) NOT NULL,
  name VARCHAR(100) NOT NULL DEFAULT '',
  password_hash CHAR(32) NOT NULL,
  salt CHAR(16) NOT NULL,
  role ENUM('master','admin') NOT NULL DEFAULT 'admin',
  status ENUM('active','blocked') NOT NULL DEFAULT 'active',
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  alive TINYINT(1) NULL DEFAULT 1,
  deleted_at DATETIME NULL,
  deleted_by_type VARCHAR(10) NULL,
  deleted_by_id INT UNSIGNED NULL,
  deleted_by_email VARCHAR(190) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admins_email_alive (email, alive),
  KEY idx_admins_deleted (deleted_at),
  KEY idx_admins_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_resets (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_type ENUM('user','admin') NOT NULL,
  account_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_resets_token (token_hash),
  KEY idx_resets_account (account_type, account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bảng theo dõi migration, đánh dấu 001 đã chạy để sau này `php bin/migrate.php` chỉ chạy các file mới
-- Khóa YouTube Data API riêng của người dùng (giai đoạn 10), mã hóa bằng APP_KEY. Xóa khóa = để trống key_enc.
CREATE TABLE IF NOT EXISTS user_api_keys (
  user_id INT UNSIGNED NOT NULL,
  key_enc TEXT NULL,
  key_hint VARCHAR(8) NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lượt nghe của từng tài khoản (giai đoạn 11), cho "bài bạn hay nghe" ở tab "Tất cả". Ẩn/xóa = play_count về 0 + hidden_at.
CREATE TABLE IF NOT EXISTS user_play_stats (
  user_id INT UNSIGNED NOT NULL,
  video_id VARCHAR(11) NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT '',
  uploader VARCHAR(150) NOT NULL DEFAULT '',
  duration INT UNSIGNED NOT NULL DEFAULT 0,
  play_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_played_at DATETIME NOT NULL,
  hidden_at DATETIME NULL,
  PRIMARY KEY (user_id, video_id),
  KEY idx_play_stats_top (user_id, play_count, last_played_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS migrations (
  name VARCHAR(190) NOT NULL,
  ran_at DATETIME NOT NULL,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id INT UNSIGNED NOT NULL,
  data MEDIUMTEXT NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS playlists (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deleted_at DATETIME NULL,
  deleted_by_type VARCHAR(10) NULL,
  deleted_by_id INT UNSIGNED NULL,
  deleted_by_email VARCHAR(190) NULL,
  PRIMARY KEY (id),
  KEY idx_playlists_deleted (deleted_at),
  KEY idx_playlists_user (user_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS playlist_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  playlist_id INT UNSIGNED NOT NULL,
  video_id CHAR(11) NOT NULL,
  title VARCHAR(255) NOT NULL,
  uploader VARCHAR(150) NOT NULL DEFAULT '',
  duration INT UNSIGNED NOT NULL DEFAULT 0,
  thumbnail VARCHAR(500) NOT NULL DEFAULT '',
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  added_at DATETIME NOT NULL,
  deleted_at DATETIME NULL,
  deleted_by_type VARCHAR(10) NULL,
  deleted_by_id INT UNSIGNED NULL,
  deleted_by_email VARCHAR(190) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_playlist_video (playlist_id, video_id),
  KEY idx_items_order (playlist_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  deleted_at DATETIME NULL,
  deleted_by_type VARCHAR(10) NULL,
  deleted_by_id INT UNSIGNED NULL,
  deleted_by_email VARCHAR(190) NULL,
  PRIMARY KEY (id),
  KEY idx_license_deleted (deleted_at),
  UNIQUE KEY uq_license_code (code),
  KEY idx_license_status (status, id),
  KEY idx_license_user (used_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Giai đoạn 14: mã OTP quên/đổi mật khẩu (xem database/migrations/010_user_phone_otp.sql)
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

-- Giai đoạn 15: ghép nối chiếu màn hình điện thoại lên màn hình xe (xem database/migrations/011_cast_sessions.sql)
CREATE TABLE IF NOT EXISTS cast_sessions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code CHAR(6) NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'waiting',
  receiver_hash CHAR(64) NOT NULL,
  sender_hash CHAR(64) NULL,
  device_name VARCHAR(60) NOT NULL DEFAULT '',
  pair_id INT UNSIGNED NULL,
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

-- Tin trao đổi kết nối giữa hai máy. from_role: 'receiver' | 'sender'. kind: 'offer' | 'answer' | 'ice' | 'bye'.
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

-- Giai đoạn 17 (đợt 2): ghép đôi điện thoại với màn hình xe một lần (xem database/migrations/012_cast_pairs.sql).
-- cast_sessions.pair_id ở trên: NULL = phiên kiểu cũ | 0 = màn hình xe ghép đôi được | > 0 = cast_pairs.id
CREATE TABLE IF NOT EXISTS cast_pairs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  receiver_hash CHAR(64) NOT NULL,
  sender_hash CHAR(64) NOT NULL,
  receiver_name VARCHAR(60) NOT NULL DEFAULT '',
  sender_name VARCHAR(60) NOT NULL DEFAULT '',
  request_session_id INT UNSIGNED NULL,
  request_at DATETIME NULL,
  last_used_at DATETIME NULL,
  created_ip VARCHAR(45) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  deleted_at DATETIME NULL,
  deleted_by VARCHAR(10) NULL,
  PRIMARY KEY (id),
  KEY idx_cast_pairs_receiver (receiver_hash),
  KEY idx_cast_pairs_sender (sender_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO migrations (name, ran_at) VALUES ('001_core.sql', NOW());
INSERT IGNORE INTO migrations (name, ran_at) VALUES ('002_single_device.sql', NOW());   -- các cột session_* của bảng users ở trên đã gồm bản 002
INSERT IGNORE INTO migrations (name, ran_at) VALUES ('003_user_preferences.sql', NOW());
INSERT IGNORE INTO migrations (name, ran_at) VALUES ('004_playlists.sql', NOW());
INSERT IGNORE INTO migrations (name, ran_at) VALUES ('005_audit_log.sql', NOW());
INSERT IGNORE INTO migrations (name, ran_at) VALUES ('006_license_keys.sql', NOW());
INSERT IGNORE INTO migrations (name, ran_at) VALUES ('007_soft_delete.sql', NOW());   -- các cột alive, deleted_* ở trên đã gồm bản 007
INSERT IGNORE INTO migrations (name, ran_at) VALUES ('008_user_api_keys.sql', NOW());
INSERT IGNORE INTO migrations (name, ran_at) VALUES ('009_play_stats.sql', NOW());
INSERT IGNORE INTO migrations (name, ran_at) VALUES ('010_user_phone_otp.sql', NOW());   -- cột phone của bảng users ở trên đã gồm bản 010
INSERT IGNORE INTO migrations (name, ran_at) VALUES ('011_cast_sessions.sql', NOW());
INSERT IGNORE INTO migrations (name, ran_at) VALUES ('012_cast_pairs.sql', NOW());   -- cột pair_id của cast_sessions ở trên đã gồm bản 012

-- ------------------------------------------------------------
-- TẠO ADMIN MASTER (bỏ dấu -- ở các dòng dưới, đổi email, mật khẩu và salt rồi chạy)
-- Mật khẩu được băm giống code PHP: md5( md5(mật_khẩu) + salt ). Salt là 16 ký tự hex bất kỳ.
-- ------------------------------------------------------------
-- INSERT INTO admins (email, name, password_hash, salt, role)
-- VALUES ('admin@example.com', 'Master', MD5(CONCAT(MD5('DoiMatKhauNay123'), 'a1b2c3d4e5f60718')), 'a1b2c3d4e5f60718', 'master');
