-- Key kích hoạt: mỗi key cộng thêm số ngày dùng cho tài khoản nhập nó. Không dùng khóa ngoại:
-- used_by / created_by / revoked_by chỉ là số tham chiếu; used_by_email lưu kèm để xem lại được cả khi người dùng đã bị xóa.
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
