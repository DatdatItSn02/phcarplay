<?php
declare(strict_types=1);

namespace App\Repositories;

use App\Core\Database;

/** Bảng user_play_stats: số lượt nghe mỗi bài của từng tài khoản. Không xóa dòng: ẩn = play_count về 0 + hidden_at. */
final class PlayStatsRepository
{
    private Database $db;

    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    /** Cộng 1 lượt nghe (tạo dòng nếu chưa có) và cập nhật tên bài/kênh/thời lượng mới nhất. */
    public function record(int $userId, string $videoId, string $title, string $uploader, int $duration, string $now): void
    {
        $this->db->execute(
            'INSERT IGNORE INTO user_play_stats (user_id, video_id, title, uploader, duration, play_count, last_played_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
            [$userId, $videoId, $title, $uploader, $duration, $now]
        );
        $this->db->execute(
            'UPDATE user_play_stats SET play_count = play_count + 1, last_played_at = ?, title = ?, uploader = ?, duration = ? WHERE user_id = ? AND video_id = ?',
            [$now, $title, $uploader, $duration, $userId, $videoId]
        );
    }

    /** @return array<int,array> các bài nghe từ $minPlays lượt, nghe lần cuối từ $since, nhiều lượt trước, bằng nhau thì gần đây trước */
    public function top(int $userId, int $minPlays, string $since, int $limit): array
    {
        return $this->db->all(
            'SELECT video_id, title, uploader, duration, play_count, last_played_at FROM user_play_stats
             WHERE user_id = ? AND play_count >= ? AND last_played_at >= ?
             ORDER BY play_count DESC, last_played_at DESC LIMIT ' . max(1, min(100, $limit)),
            [$userId, $minPlays, $since]
        );
    }

    /** Ẩn một bài: số lượt về 0 (nghe lại đủ lượt thì tự hiện lại). Trả số dòng đổi. */
    public function hide(int $userId, string $videoId, string $now): int
    {
        return $this->db->execute('UPDATE user_play_stats SET play_count = 0, hidden_at = ? WHERE user_id = ? AND video_id = ?', [$now, $userId, $videoId]);
    }

    /** Xóa danh sách hay nghe: mọi bài về 0 lượt. */
    public function clear(int $userId, string $now): int
    {
        return $this->db->execute('UPDATE user_play_stats SET play_count = 0, hidden_at = ? WHERE user_id = ? AND play_count > 0', [$now, $userId]);
    }
}
