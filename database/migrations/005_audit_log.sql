-- Nhật ký thao tác của quản trị viên (đăng nhập, tạo/sửa/xóa tài khoản...). Không dùng khóa ngoại:
-- admin_id chỉ là số tham chiếu, còn admin_email lưu kèm để xem lại được cả khi tài khoản admin đã bị xóa.
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
