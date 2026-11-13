-- Giai đoạn 10: khóa YouTube Data API riêng của từng người dùng (không bắt buộc).
-- Khóa được mã hóa bằng APP_KEY trong .env (AES-256-GCM) trước khi lưu; website không bao giờ gửi khóa về trình duyệt.
-- "Xóa khóa" chỉ để trống cột key_enc (không xóa dòng). Không dùng khóa ngoại: user_id trỏ tới users.id bằng quy ước.
CREATE TABLE user_api_keys (
  user_id INT UNSIGNED NOT NULL,
  key_enc TEXT NULL,
  key_hint VARCHAR(8) NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
