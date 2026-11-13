-- Giai đoạn 8: KHÔNG xóa dòng nào khỏi database. "Xóa" chỉ là đánh dấu: thời điểm xóa và người xóa.
--   deleted_at        thời điểm xóa (NULL = chưa xóa)
--   deleted_by_type   'admin' (quản trị viên), 'user' (chính người dùng) hoặc 'system'
--   deleted_by_id     id người xóa (trong bảng admins hoặc users, tùy deleted_by_type)
--   deleted_by_email  email người xóa lúc đó (để xem lại được kể cả khi tài khoản đó sau này cũng bị xóa)
-- Bảng users, admins có thêm cột alive: 1 khi còn dùng, NULL khi đã xóa. Khóa duy nhất (email, alive) cho phép
-- đăng ký lại bằng email của tài khoản đã xóa mà vẫn không cho hai tài khoản đang dùng trùng email.
ALTER TABLE users
  ADD COLUMN alive TINYINT(1) NULL DEFAULT 1,
  ADD COLUMN deleted_at DATETIME NULL,
  ADD COLUMN deleted_by_type VARCHAR(10) NULL,
  ADD COLUMN deleted_by_id INT UNSIGNED NULL,
  ADD COLUMN deleted_by_email VARCHAR(190) NULL,
  DROP INDEX uq_users_email,
  ADD UNIQUE KEY uq_users_email_alive (email, alive),
  ADD KEY idx_users_deleted (deleted_at);

ALTER TABLE admins
  ADD COLUMN alive TINYINT(1) NULL DEFAULT 1,
  ADD COLUMN deleted_at DATETIME NULL,
  ADD COLUMN deleted_by_type VARCHAR(10) NULL,
  ADD COLUMN deleted_by_id INT UNSIGNED NULL,
  ADD COLUMN deleted_by_email VARCHAR(190) NULL,
  DROP INDEX uq_admins_email,
  ADD UNIQUE KEY uq_admins_email_alive (email, alive),
  ADD KEY idx_admins_deleted (deleted_at);

ALTER TABLE playlists
  ADD COLUMN deleted_at DATETIME NULL,
  ADD COLUMN deleted_by_type VARCHAR(10) NULL,
  ADD COLUMN deleted_by_id INT UNSIGNED NULL,
  ADD COLUMN deleted_by_email VARCHAR(190) NULL,
  ADD KEY idx_playlists_deleted (deleted_at);

ALTER TABLE playlist_items
  ADD COLUMN deleted_at DATETIME NULL,
  ADD COLUMN deleted_by_type VARCHAR(10) NULL,
  ADD COLUMN deleted_by_id INT UNSIGNED NULL,
  ADD COLUMN deleted_by_email VARCHAR(190) NULL;

ALTER TABLE license_keys
  ADD COLUMN deleted_at DATETIME NULL,
  ADD COLUMN deleted_by_type VARCHAR(10) NULL,
  ADD COLUMN deleted_by_id INT UNSIGNED NULL,
  ADD COLUMN deleted_by_email VARCHAR(190) NULL,
  ADD KEY idx_license_deleted (deleted_at);
