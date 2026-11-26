<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\HttpException;
use App\Core\Validator;
use App\Repositories\PlayStatsRepository;

/**
 * Giai đoạn 11: "bài bạn hay nghe" đưa lên đầu tab "Tất cả" ở Trang chủ.
 * Giao diện báo một lượt nghe khi bài đã phát ít nhất 30 giây (bài dưới 1 phút: quá nửa bài).
 * Bài hiện ra khi nghe từ MIN_PLAYS lượt và lần nghe cuối trong DAYS ngày; tối đa LIMIT bài.
 */
final class PlayStatsService
{
    public const MIN_PLAYS = 2;
    public const DAYS = 60;
    public const LIMIT = 20;

    private PlayStatsRepository $repo;
    /** @var callable(): int */
    private $clock;

    public function __construct(PlayStatsRepository $repo, ?callable $clock = null)
    {
        $this->repo = $repo;
        $this->clock = $clock ?? 'time';
    }

    private function now(): string
    {
        return date('Y-m-d H:i:s', (int) ($this->clock)());
    }

    public function record(int $userId, array $input): void
    {
        $id = (string) ($input['id'] ?? '');
        if (!YoutubeService::isVideoId($id)) {
            throw HttpException::validation(['id' => 'Mã video không hợp lệ.']);
        }
        $duration = (int) ($input['duration'] ?? 0);
        $this->repo->record(
            $userId,
            $id,
            Validator::text($input['title'] ?? '', 255),
            Validator::text($input['uploader'] ?? '', 150),
            max(0, min(86400, $duration)),
            $this->now()
        );
    }

    /** @return array<int,array> dạng video giống kết quả tìm kiếm, kèm plays */
    public function top(int $userId, int $limit = self::LIMIT): array
    {
        $since = date('Y-m-d H:i:s', (int) ($this->clock)() - self::DAYS * 86400);
        $rows = $this->repo->top($userId, self::MIN_PLAYS, $since, max(1, min(self::LIMIT, $limit)));
        return array_map(static function (array $r): array {
            $id = (string) $r['video_id'];
            return [
                'id' => $id,
                'title' => (string) $r['title'] !== '' ? (string) $r['title'] : 'Video ' . $id,
                'uploader' => (string) $r['uploader'],
                'duration' => (int) $r['duration'],
                'thumbnail' => YoutubeDirectClient::thumb($id),   // tạo lại từ mã video, không lưu đường dẫn do trình duyệt gửi
                'views' => 0,
                'uploaded_at' => 0,
                'plays' => (int) $r['play_count'],
            ];
        }, $rows);
    }

    public function hide(int $userId, string $videoId): void
    {
        if (!YoutubeService::isVideoId($videoId)) {
            throw HttpException::validation(['id' => 'Mã video không hợp lệ.']);
        }
        $this->repo->hide($userId, $videoId, $this->now());
    }

    public function clear(int $userId): void
    {
        $this->repo->clear($userId, $this->now());
    }
}
