-- Đăng nhập trên một thiết bị: lưu dấu vết phiên đang hợp lệ của mỗi tài khoản (không dùng khóa ngoại)
ALTER TABLE users
  ADD COLUMN session_token CHAR(64) NULL AFTER last_login_at,
  ADD COLUMN session_device VARCHAR(190) NULL AFTER session_token,
  ADD COLUMN session_ip VARCHAR(45) NULL AFTER session_device,
  ADD COLUMN session_at DATETIME NULL AFTER session_ip;
