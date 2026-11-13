-- Giai đoạn 11: đếm lượt nghe của từng tài khoản để đưa "bài bạn hay nghe" lên đầu tab "Tất cả" ở Trang chủ.
-- Một lượt = nghe ít nhất 30 giây (bài ngắn hơn 1 phút: quá nửa bài). Bài nghe từ 2 lượt và nghe trong 60 ngày gần nhất mới hiện.
-- "Ẩn khỏi bài hay nghe" / "Xóa danh sách hay nghe" chỉ đưa play_count về 0 và ghi hidden_at (không xóa dòng).
-- Không dùng khóa ngoại: user_id trỏ tới users.id bằng quy ước. Ảnh bìa không lưu, tạo lại từ video_id.
CREATE TABLE user_play_stats (
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
