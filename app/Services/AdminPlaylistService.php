<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\HttpException;
use App\Repositories\PlaylistRepository;
use App\Repositories\SoftDelete;

/** Quản trị viên xem và gỡ playlist của người dùng (ví dụ nội dung vi phạm). Mọi lần xóa đều để lại nhật ký. */
final class AdminPlaylistService
{
    private PlaylistRepository $playlists;
    private AuditService $audit;

    public function __construct(PlaylistRepository $playlists, AuditService $audit)
    {
        $this->playlists = $playlists;
        $this->audit = $audit;
    }

    public function search(array $filters, int $page, int $perPage, int $offset): array
    {
        $items = array_map(static function (array $p): array {
            return [
                'id' => (int) $p['id'],
                'name' => $p['name'],
                'count' => (int) $p['item_count'],
                'user_id' => (int) $p['user_id'],
                'user_email' => $p['user_email'] ?? null,
                'user_name' => $p['user_name'] ?? null,
                'created_at' => $p['created_at'],
                'updated_at' => $p['updated_at'],
                'deleted' => SoftDelete::view($p),
            ];
        }, $this->playlists->search($filters, $perPage, $offset));
        return ['items' => $items, 'total' => $this->playlists->countSearch($filters), 'page' => $page, 'per_page' => $perPage];
    }

    public function get(int $id): array
    {
        $p = $this->mustFind($id);
        return [
            'id' => (int) $p['id'],
            'name' => $p['name'],
            'user_id' => (int) $p['user_id'],
            'user_email' => $p['user_email'] ?? null,
            'updated_at' => $p['updated_at'],
            'items' => array_map(static function (array $r): array {
                return ['id' => $r['video_id'], 'title' => $r['title'], 'uploader' => $r['uploader'], 'duration' => (int) $r['duration']];
            }, $this->playlists->items($id)),
        ];
    }

    public function delete(array $actor, int $id, string $ip): void
    {
        $p = $this->mustFind($id);
        $count = $this->playlists->countItems($id);
        $this->playlists->softDelete($id, SoftDelete::byAdmin($actor));
        $this->audit->record($actor, 'playlist.delete', 'playlist', $id, 'tên: ' . $p['name'] . '; chủ: ' . ($p['user_email'] ?? ('#' . $p['user_id'])) . '; ' . $count . ' bài', $ip);
    }

    private function mustFind(int $id): array
    {
        $p = $this->playlists->find($id);
        if ($p === null) {
            throw HttpException::notFound('Không tìm thấy playlist.');
        }
        return $p;
    }
}
