-- Cài đặt giao diện của từng tài khoản (tỉ lệ chia màn hình...). Không dùng khóa ngoại: user_id trỏ tới users.id bằng quy ước.
CREATE TABLE user_preferences (
  user_id INT UNSIGNED NOT NULL,
  data MEDIUMTEXT NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
