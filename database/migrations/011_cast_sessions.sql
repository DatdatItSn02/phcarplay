-- Giai đoạn 15 (đợt 2): chiếu màn hình điện thoại lên màn hình xe.
-- Máy chủ CHỈ giúp hai máy tìm thấy nhau (ghép nối bằng mã 6 số, trao đổi thông tin kết nối WebRTC).
-- Hình ảnh màn hình đi thẳng giữa hai máy, không qua máy chủ và không lưu ở đây.
-- Không xóa dòng: phiên kết thúc thì ghi ended_at / ended_by; nội dung tin trao đổi được xóa trắng (payload = '').
--   status: 'waiting' (màn hình xe đang chờ, mã còn hiệu lực) | 'paired' (điện thoại đã nhập mã) | 'ended'
--   ended_by: 'receiver' (màn hình xe) | 'sender' (điện thoại) | 'expired'
CREATE TABLE cast_sessions (
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

-- Tin trao đổi kết nối giữa hai máy. from_role: 'receiver' | 'sender'. kind: 'offer' | 'answer' | 'ice' | 'bye'.
CREATE TABLE cast_signals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id INT UNSIGNED NOT NULL,
  from_role VARCHAR(10) NOT NULL,
  kind VARCHAR(10) NOT NULL,
  payload TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_cast_signals (session_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
