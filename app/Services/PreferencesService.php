<?php
declare(strict_types=1);

namespace App\Services;

use App\Core\HttpException;
use App\Repositories\PreferencesRepository;

/**
 * Cài đặt của người dùng. Chỉ nhận các khóa đã khai báo trong sanitize() (danh sách trắng),
 * muốn lưu thêm loại cài đặt mới thì bổ sung vào đó.
 *   layout: { h: tỉ lệ khung trái khi chia ngang, v: tỉ lệ khung trên khi chia dọc }, mỗi giá trị 0.1 - 0.9
 *   playback (giai đoạn 12): { repeat: 'off'|'all'|'one'|'shuffle' (lần lượt/lặp tất cả/lặp 1 bài/trộn bài), autoMix: bool }
 */
final class PreferencesService
{
    private PreferencesRepository $repo;

    public function __construct(PreferencesRepository $repo)
    {
        $this->repo = $repo;
    }

    /** @return array{layout: ?array, playback: ?array} null nếu người dùng chưa từng lưu */
    public function get(int $userId): array
    {
        $stored = $this->decode($this->repo->find($userId));
        return ['layout' => $stored['layout'] ?? null, 'playback' => $stored['playback'] ?? null];
    }

    public function save(int $userId, array $input): array
    {
        $clean = self::sanitize($input);
        if ($clean === []) {
            throw HttpException::validation(['layout' => 'Không có cài đặt hợp lệ để lưu.']);
        }
        $stored = $this->decode($this->repo->find($userId));
        foreach (['layout', 'playback'] as $k) {
            if (isset($clean[$k])) {
                $clean[$k] = array_merge($stored[$k] ?? [], $clean[$k]);
            }
        }
        $merged = array_merge($stored, $clean);
        $this->repo->save($userId, (string) json_encode($merged, JSON_UNESCAPED_UNICODE));
        return ['layout' => $merged['layout'] ?? null, 'playback' => $merged['playback'] ?? null];
    }

    /** Giữ lại đúng các khóa hợp lệ và kẹp giá trị vào giới hạn. */
    public static function sanitize(array $input): array
    {
        $out = [];
        if (isset($input['layout']) && is_array($input['layout'])) {
            $layout = [];
            foreach (['h', 'v'] as $key) {
                $value = $input['layout'][$key] ?? null;
                if (is_int($value) || is_float($value)) {
                    $layout[$key] = round(min(0.9, max(0.1, (float) $value)), 3);
                }
            }
            if ($layout !== []) {
                $out['layout'] = $layout;
            }
        }
        if (isset($input['playback']) && is_array($input['playback'])) {
            $pb = [];
            $repeat = $input['playback']['repeat'] ?? null;
            if (is_string($repeat) && in_array($repeat, ['off', 'all', 'one', 'shuffle'], true)) {
                $pb['repeat'] = $repeat;
            }
            foreach (['autoMix'] as $key) {
                if (isset($input['playback'][$key]) && is_bool($input['playback'][$key])) {
                    $pb[$key] = $input['playback'][$key];
                }
            }
            if ($pb !== []) {
                $out['playback'] = $pb;
            }
        }
        return $out;
    }

    private function decode(?string $json): array
    {
        if ($json === null || $json === '') {
            return [];
        }
        $data = json_decode($json, true);
        return is_array($data) ? $data : [];
    }
}
