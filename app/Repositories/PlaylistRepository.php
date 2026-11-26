<?php
declare(strict_types=1);

namespace App\Repositories;

use App\Core\Database;
use App\Core\Sql;

/** Các bảng playlists và playlist_items. Chỉ chứa câu SQL; kiểm tra quyền sở hữu nằm ở PlaylistService. */
final class PlaylistRepository
{
    private Database $db;

    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    /** @return array<int,array> playlist mới sửa gần nhất đứng đầu */
    public function listByUser(int $userId): array
    {
        return $this->db->all(
            'SELECT p.id, p.name, p.updated_at,
                    (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id AND i.deleted_at IS NULL) AS item_count
             FROM playlists p WHERE p.user_id = ? AND p.deleted_at IS NULL ORDER BY p.updated_at DESC, p.id DESC',
            [$userId]
        );
    }

    public function countByUser(int $userId): int
    {
        return (int) $this->db->value('SELECT COUNT(*) FROM playlists WHERE user_id = ? AND deleted_at IS NULL', [$userId]);
    }

    public function findOwned(int $id, int $userId): ?array
    {
        return $this->db->one('SELECT * FROM playlists WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [$id, $userId]);
    }

    public function create(int $userId, string $name): int
    {
        $now = date('Y-m-d H:i:s');
        return $this->db->insert(
            'INSERT INTO playlists (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
            [$userId, $name, $now, $now]
        );
    }

    /**
     * Tạo playlist kèm danh sách bài trong một giao dịch (nhanh hơn nhiều so với từng câu INSERT riêng lẻ,
     * và lỗi giữa chừng thì không để lại playlist dở dang).
     * @param array<int,array> $items mỗi bài đã làm sạch {id, title, uploader, duration, thumbnail}
     */
    public function createWithItems(int $userId, string $name, array $items): int
    {
        return (int) $this->db->transaction(function () use ($userId, $name, $items) {
            $id = $this->create($userId, $name);
            $order = 1;
            foreach ($items as $item) {
                if ($this->addItem($id, $item, $order)) {
                    $order++;
                }
            }
            return $id;
        });
    }

    public function rename(int $id, string $name): void
    {
        $this->db->execute('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?', [$name, date('Y-m-d H:i:s'), $id]);
    }

    public function touch(int $id): void
    {
        $this->db->execute('UPDATE playlists SET updated_at = ? WHERE id = ?', [date('Y-m-d H:i:s'), $id]);
    }

    /** "Xóa" playlist và các bài của nó bằng cách đánh dấu người xóa và thời điểm (không dùng DELETE). */
    public function softDelete(int $id, array $by): void
    {
        $this->db->transaction(function () use ($id, $by) {
            $mark = SoftDelete::params($by);
            $this->db->execute('UPDATE playlist_items SET ' . SoftDelete::SET . ' WHERE playlist_id = ? AND deleted_at IS NULL', array_merge($mark, [$id]));
            $this->db->execute('UPDATE playlists SET ' . SoftDelete::SET . ' WHERE id = ? AND deleted_at IS NULL', array_merge($mark, [$id]));
        });
    }

    /** @return array<int,array> */
    public function items(int $playlistId): array
    {
        return $this->db->all(
            'SELECT video_id, title, uploader, duration, thumbnail FROM playlist_items WHERE playlist_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, id ASC',
            [$playlistId]
        );
    }

    public function countItems(int $playlistId): int
    {
        return (int) $this->db->value('SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ? AND deleted_at IS NULL', [$playlistId]);
    }

    /** @return array<int,string> mã video đã có trong playlist */
    public function videoIds(int $playlistId): array
    {
        return array_map('strval', array_column(
            $this->db->all('SELECT video_id FROM playlist_items WHERE playlist_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, id ASC', [$playlistId]),
            'video_id'
        ));
    }

    public function nextSortOrder(int $playlistId): int
    {
        return (int) $this->db->value('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM playlist_items WHERE playlist_id = ?', [$playlistId]);
    }

    /**
     * Thêm một bài; bỏ qua nếu đang có (khóa duy nhất playlist_id + video_id). Bài từng bị xóa khỏi playlist thì
     * dòng cũ được dùng lại (bỏ dấu xóa, cập nhật thông tin, xếp vào vị trí mới). Trả true nếu đã thêm.
     */
    public function addItem(int $playlistId, array $item, int $sortOrder): bool
    {
        $restored = $this->db->execute(
            'UPDATE playlist_items SET title = ?, uploader = ?, duration = ?, thumbnail = ?, sort_order = ?, added_at = ?,
                    deleted_at = NULL, deleted_by_type = NULL, deleted_by_id = NULL, deleted_by_email = NULL
             WHERE playlist_id = ? AND video_id = ? AND deleted_at IS NOT NULL',
            [$item['title'], $item['uploader'], $item['duration'], $item['thumbnail'], $sortOrder, date('Y-m-d H:i:s'), $playlistId, $item['id']]
        );
        if ($restored > 0) {
            return true;
        }
        $n = $this->db->execute(
            'INSERT IGNORE INTO playlist_items (playlist_id, video_id, title, uploader, duration, thumbnail, sort_order, added_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$playlistId, $item['id'], $item['title'], $item['uploader'], $item['duration'], $item['thumbnail'], $sortOrder, date('Y-m-d H:i:s')]
        );
        return $n > 0;
    }

    /** Bỏ một bài khỏi playlist bằng cách đánh dấu đã xóa. */
    public function removeItem(int $playlistId, string $videoId, array $by): bool
    {
        return $this->db->execute(
            'UPDATE playlist_items SET ' . SoftDelete::SET . ' WHERE playlist_id = ? AND video_id = ? AND deleted_at IS NULL',
            array_merge(SoftDelete::params($by), [$playlistId, $videoId])
        ) > 0;
    }

    // ---------- dành cho khu vực quản trị (xem playlist của mọi người dùng) ----------

    public function find(int $id): ?array
    {
        return $this->db->one(
            'SELECT p.*, u.email AS user_email, u.name AS user_name FROM playlists p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ? AND p.deleted_at IS NULL',
            [$id]
        );
    }

    /**
     * Bộ lọc: q (tên playlist hoặc email chủ), user_id, deleted (1 = chỉ xem đã xóa).
     * @return array<int,array> playlist mới sửa gần nhất đứng đầu, kèm email chủ và số bài
     */
    public function search(array $filters, int $limit, int $offset): array
    {
        [$where, $params] = $this->searchWhere($filters);
        return $this->db->all(
            'SELECT p.id, p.user_id, p.name, p.created_at, p.updated_at, u.email AS user_email, u.name AS user_name,
                    p.deleted_at, p.deleted_by_type, p.deleted_by_id, p.deleted_by_email,
                    (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id
                        AND (i.deleted_at IS NULL OR (p.deleted_at IS NOT NULL AND i.deleted_at = p.deleted_at))) AS item_count
             FROM playlists p LEFT JOIN users u ON u.id = p.user_id' . $where
            . ' ORDER BY p.updated_at DESC, p.id DESC LIMIT ' . max(1, $limit) . ' OFFSET ' . max(0, $offset),
            $params
        );
    }

    public function countSearch(array $filters): int
    {
        [$where, $params] = $this->searchWhere($filters);
        return (int) $this->db->value('SELECT COUNT(*) FROM playlists p LEFT JOIN users u ON u.id = p.user_id' . $where, $params);
    }

    /** @return array{playlists:int,items:int} */
    public function totals(): array
    {
        return [
            'playlists' => (int) $this->db->value('SELECT COUNT(*) FROM playlists WHERE deleted_at IS NULL'),
            'items' => (int) $this->db->value(
                'SELECT COUNT(*) FROM playlist_items i JOIN playlists p ON p.id = i.playlist_id WHERE i.deleted_at IS NULL AND p.deleted_at IS NULL'
            ),
        ];
    }

    /** @return array{0:string,1:array} */
    private function searchWhere(array $f): array
    {
        $cond = [SoftDelete::filter($f, 'p')];
        $params = [];
        $q = isset($f['q']) ? trim((string) $f['q']) : '';
        if ($q !== '') {
            $cond[] = "(p.name LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!')";
            $params[] = Sql::like($q);
            $params[] = Sql::like($q);
        }
        if (isset($f['user_id']) && (int) $f['user_id'] > 0) {
            $cond[] = 'p.user_id = ?';
            $params[] = (int) $f['user_id'];
        }
        return [$cond ? ' WHERE ' . implode(' AND ', $cond) : '', $params];
    }

    /** @param array<int,string> $videoIds thứ tự mới */
    public function setOrder(int $playlistId, array $videoIds): void
    {
        $this->db->transaction(function () use ($playlistId, $videoIds) {
            foreach (array_values($videoIds) as $i => $videoId) {
                $this->db->execute(
                    'UPDATE playlist_items SET sort_order = ? WHERE playlist_id = ? AND video_id = ? AND deleted_at IS NULL',
                    [$i + 1, $playlistId, $videoId]
                );
            }
        });
    }
}
