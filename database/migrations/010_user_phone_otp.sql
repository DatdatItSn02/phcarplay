-- Giai đoạn 14: đăng nhập bằng số điện thoại và mã OTP khi quên/đổi mật khẩu.
-- users.phone: số di động Việt Nam dạng 0xxxxxxxxx. Khóa duy nhất (phone, alive) giống email: tài khoản đã xóa
-- (alive = NULL) trả lại số cho người khác đăng ký; tài khoản cũ chưa có số thì phone = NULL.
ALTER TABLE users
  ADD COLUMN phone VARCHAR(15) NULL AFTER email,
  ADD UNIQUE KEY uq_users_phone_alive (phone, alive);

-- Mã OTP 6 số: chỉ lưu bản băm, hết hạn sau OTP_TTL_MINUTES phút, sai 5 lần thì hủy.
-- Không xóa dòng: dùng xong / bị thay bằng mã mới / sai quá số lần thì ghi used_at.
-- purpose: 'reset' (quên mật khẩu) | 'change' (đổi mật khẩu khi đang đăng nhập). channels: kênh đã gửi, ví dụ 'email,sms'.
CREATE TABLE otp_codes (
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
