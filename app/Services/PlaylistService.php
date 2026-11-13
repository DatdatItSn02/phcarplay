<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\Config;
use App\Core\HttpException;
use App\Core\Validator;
use App\Repositories\PlaylistRepository;
use App\Repositories\SoftDelete;

/** Nghiệp vụ playlist: kiểm tra quyền sở hữu, giới hạn số lượng, làm sạch dữ liệu bài hát. */
final class PlaylistService
{
    private PlaylistRepository $repo;

    public function __construct(PlaylistRepository $repo)
    {
        $this->repo = $repo;
    }

    public function listFor(int $userId): array
    {
        return array_map(static function (array $p): array {
            return ['id' => (int) $p['id'], 'name' => $p['name'], 'count' => (int) $p['item_count'], 'updated_at' => $p['updated_at']];
        }, $this->repo->listByUser($userId));
    }

    public function create(int $userId, $name): array
    {
        $clean = $this->cleanName($name);
        if ($this->repo->countByUser($userId) >= (int) Config::get('app.playlists.max_per_user', 50)) {
            throw new HttpException(422, 'PLAYLIST_LIMIT', 'Bạn đã đạt số playlist tối đa. Hãy xóa bớt playlist cũ.');
        }
        $id = $this->repo->create($userId, $clean);
        return $this->summary($userId, $id);
    }

    public function rename(int $userId, int $id, $name): array
    {
        $this->owned($userId, $id);
        $this->repo->rename($id, $this->cleanName($name));
        return $this->summary($userId, $id);
    }

    public function delete(int $userId, int $id): void
    {
        $this->owned($userId, $id);
        $this->repo->softDelete($id, SoftDelete::byUser($userId));
    }

    public function get(int $userId, int $id): array
    {
        $p = $this->owned($userId, $id);
        return ['id' => (int) $p['id'], 'name' => $p['name'], 'items' => $this->itemsOf($id)];
    }

    /**
     * Thêm bài vào playlist (bỏ qua bài đã có). Trả về số bài thực sự được thêm.
     * @param array<int,mixed> $items
     */
    public function addItems(int $userId, int $id, array $items): array
    {
        $this->owned($userId, $id);
        $clean = $this->cleanItems($items);
        if ($clean === []) {
            throw HttpException::validation(['items' => 'Không có bài hợp lệ để thêm.']);
        }
        $max = (int) Config::get('app.playlists.max_items', 500);
        $have = $this->repo->videoIds($id);
        $fresh = array_values(array_filter($clean, static function (array $it) use ($have): bool {
            return !in_array($it['id'], $have, true);
        }));
        if (count($have) + count($fresh) > $max) {
            throw new HttpException(422, 'PLAYLIST_FULL', 'Playlist chỉ chứa tối đa ' . $max . ' bài.');
        }
        $order = $this->repo->nextSortOrder($id);
        $added = 0;
        foreach ($fresh as $item) {
            if ($this->repo->addItem($id, $item, $order)) {
                $order++;
                $added++;
            }
        }
        if ($added > 0) {
            $this->repo->touch($id);
        }
        return ['added' => $added, 'count' => $this->repo->countItems($id)];
    }

    public function removeItem(int $userId, int $id, string $videoId): void
    {
        $this->owned($userId, $id);
        if ($this->repo->removeItem($id, $videoId, SoftDelete::byUser($userId))) {
            $this->repo->touch($id);
        }
    }

    /** @param array<int,mixed> $videoIds phải đúng bằng tập bài hiện có, chỉ đổi thứ tự */
    public function reorder(int $userId, int $id, array $videoIds): array
    {
        $this->owned($userId, $id);
        $have = $this->repo->videoIds($id);
        $given = array_values(array_filter($videoIds, 'is_string'));
        $a = $have;
        $b = $given;
        sort($a);
        sort($b);
        if (count($given) !== count($videoIds) || $a !== $b) {
            throw HttpException::validation(['video_ids' => 'Danh sách bài không khớp với playlist hiện tại.']);
        }
        $this->repo->setOrder($id, $given);
        $this->repo->touch($id);
        return $this->get($userId, $id);
    }

    /**
     * Nhập playlist của khách (lưu trên trình duyệt) vào tài khoản sau khi đăng nhập.
     * Giữ đủ bài của mỗi playlist (tối đa app.playlists.max_items, giống giới hạn trên trình duyệt), tối đa 20 playlist mỗi lần.
     * @param array<int,mixed> $playlists mỗi phần tử {name, items[]}
     */
    public function import(int $userId, array $playlists): array
    {
        $created = 0;
        $maxItems = (int) Config::get('app.playlists.max_items', 500);
        foreach (array_slice($playlists, 0, 20) as $p) {
            if (!is_array($p)) {
                continue;
            }
            $name = Validator::text($p['name'] ?? '', 100);
            if ($name === '' || $this->repo->countByUser($userId) >= (int) Config::get('app.playlists.max_per_user', 50)) {
                continue;
            }
            $this->repo->createWithItems($userId, $name, $this->cleanItems((array) ($p['items'] ?? []), $maxItems));
            $created++;
        }
        return ['created' => $created];
    }

    /** Làm sạch một bài hát nhận từ trình duyệt. Trả null nếu không hợp lệ. */
    public static function sanitizeItem($raw): ?array
    {
        if (!is_array($raw)) {
            return null;
        }
        $id = is_string($raw['id'] ?? null) ? $raw['id'] : '';
        $title = Validator::text($raw['title'] ?? '', 255);
        if (!YoutubeService::isVideoId($id) || $title === '') {
            return null;
        }
        $thumb = is_string($raw['thumbnail'] ?? null) ? trim($raw['thumbnail']) : '';
        if ($thumb === '' || strlen($thumb) > 500 || preg_match('#^https?://#i', $thumb) !== 1) {
            $thumb = '';
        }
        $duration = is_numeric($raw['duration'] ?? null) ? (int) $raw['duration'] : 0;
        return [
            'id' => $id,
            'title' => $title,
            'uploader' => Validator::text($raw['uploader'] ?? '', 150),
            'duration' => min(max($duration, 0), 86400),
            'thumbnail' => $thumb,
        ];
    }

    // ---------- nội bộ ----------

    private function owned(int $userId, int $id): array
    {
        $p = $this->repo->findOwned($id, $userId);
        if ($p === null) {
            throw HttpException::notFound('Không tìm thấy playlist.');
        }
        return $p;
    }

    private function cleanName($name): string
    {
        $clean = Validator::text($name, 100);
        if ($clean === '') {
            throw HttpException::validation(['name' => 'Hãy nhập tên playlist.']);
        }
        return $clean;
    }

    /** @return array<int,array> tối đa $limit bài (mặc định 50 mỗi lần thêm), loại trùng */
    private function cleanItems(array $items, int $limit = 50): array
    {
        $out = [];
        $seen = [];
        foreach (array_slice($items, 0, $limit) as $raw) {
            $item = self::sanitizeItem($raw);
            if ($item !== null && !isset($seen[$item['id']])) {
                $seen[$item['id']] = true;
                $out[] = $item;
            }
        }
        return $out;
    }

    private function itemsOf(int $id): array
    {
        return array_map(static function (array $r): array {
            return ['id' => $r['video_id'], 'title' => $r['title'], 'uploader' => $r['uploader'], 'duration' => (int) $r['duration'], 'thumbnail' => $r['thumbnail']];
        }, $this->repo->items($id));
    }

    private function summary(int $userId, int $id): array
    {
        $p = $this->owned($userId, $id);
        return ['id' => (int) $p['id'], 'name' => $p['name'], 'count' => $this->repo->countItems($id), 'updated_at' => $p['updated_at']];
    }
}
