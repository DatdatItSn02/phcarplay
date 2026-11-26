<?php
declare(strict_types=1);

namespace App\Services;

/**
 * Danh mục bấm nhanh ở Trang chủ của ứng dụng (mỗi danh mục là một từ khóa tìm kiếm có sẵn, để người lái xe khỏi phải gõ).
 * Cấu hình bằng HOME_CHIPS trong .env, các mục cách nhau bằng dấu phẩy, mỗi mục "Nhãn=từ khóa" (thiếu "=từ khóa" thì tìm đúng nhãn).
 * Ví dụ: HOME_CHIPS="Nhạc Việt=nhạc Việt mới nhất,Bolero=nhạc bolero trữ tình,Podcast"
 */
final class HomeChips
{
    public const DEFAULT = 'Nhạc Việt=nhạc Việt mới nhất,Nhạc trẻ=nhạc trẻ hay nhất,Bolero=nhạc bolero trữ tình,'
        . 'Lofi=nhạc lofi chill,Remix=nhạc remix sôi động,Không lời=nhạc không lời thư giãn,Podcast=podcast tiếng Việt';
    public const MAX = 12;
    private const LABEL_MAX = 30;
    private const QUERY_MAX = 100;

    /** @return array<int,array{label:string,q:string}> */
    public static function parse(string $raw): array
    {
        $out = [];
        $seen = [];
        foreach (explode(',', $raw) as $part) {
            $pos = strpos($part, '=');
            $label = trim($pos === false ? $part : (string) substr($part, 0, $pos));
            $query = trim($pos === false ? $part : (string) substr($part, $pos + 1));
            $label = self::cut($label, self::LABEL_MAX);
            $query = self::cut($query === '' ? $label : $query, self::QUERY_MAX);
            $key = mb_strtolower($label, 'UTF-8');
            if ($label === '' || isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $out[] = ['label' => $label, 'q' => $query];
            if (count($out) >= self::MAX) {
                break;
            }
        }
        return $out;
    }

    private static function cut(string $text, int $max): string
    {
        $clean = preg_replace('/\s+/u', ' ', $text);
        return mb_substr(is_string($clean) ? $clean : $text, 0, $max, 'UTF-8');
    }
}
