-- Playlist của người dùng. Không dùng khóa ngoại: playlists.user_id và playlist_items.playlist_id trỏ bằng quy ước,
-- việc xóa dây chuyền (xóa playlist thì xóa các bài) do PlaylistRepository xử lý.
CREATE TABLE playlists (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_playlists_user (user_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE playlist_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  playlist_id INT UNSIGNED NOT NULL,
  video_id CHAR(11) NOT NULL,
  title VARCHAR(255) NOT NULL,
  uploader VARCHAR(150) NOT NULL DEFAULT '',
  duration INT UNSIGNED NOT NULL DEFAULT 0,
  thumbnail VARCHAR(500) NOT NULL DEFAULT '',
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  added_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_playlist_video (playlist_id, video_id),
  KEY idx_items_order (playlist_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
