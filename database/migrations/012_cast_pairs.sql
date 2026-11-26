-- Giai đoạn 17 (đợt 2): GHÉP ĐÔI điện thoại với màn hình xe một lần (bằng mã 6 số như cũ); lần sau trên điện thoại chỉ cần
-- bấm "Chia sẻ màn hình" là chiếu, không phải nhập mã. Mỗi máy có một khóa thiết bị bí mật lưu trên chính máy đó
-- (localStorage); máy chủ chỉ lưu bản băm SHA-256 của khóa.
-- Không xóa dòng: "Quên thiết bị" ghi deleted_at + deleted_by ('receiver' = màn hình xe, 'sender' = điện thoại).
--   receiver_name / sender_name: tên màn hình xe / tên điện thoại để hiện cho máy bên kia.
--   request_session_id / request_at: điện thoại vừa bấm "Chia sẻ" -> phiên chiếu đang chờ màn hình xe nhận
--   (màn hình xe đã ghép đôi hỏi máy chủ vài giây một lần; nhận xong thì để trống lại).
CREATE TABLE cast_pairs (
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

-- cast_sessions.pair_id: NULL = phiên kiểu cũ (máy không gửi khóa thiết bị, không ghép đôi) | 0 = màn hình xe ghép đôi được,
-- chưa có cặp | > 0 = thuộc cặp ghép đôi cast_pairs.id. Phiên do điện thoại bấm "Chia sẻ" tạo ra không có mã (code = '').
-- Lúc màn hình xe đang chờ nhập mã, device_name tạm giữ tên của màn hình xe (dùng làm receiver_name khi ghép đôi),
-- điện thoại nhập mã xong thì thành tên điện thoại như trước.
ALTER TABLE cast_sessions ADD COLUMN pair_id INT UNSIGNED NULL AFTER device_name;
