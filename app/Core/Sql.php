<?php
declare(strict_types=1);

namespace App\Core;

/** Tiện ích nhỏ để viết SQL an toàn và chạy giống nhau trên MySQL và SQLite (dùng khi thử). */
final class Sql
{
    /**
     * Mẫu cho LIKE tìm chuỗi con. Dùng kèm: "... LIKE ? ESCAPE '!'". Ký tự %, _ và ! do người dùng gõ được thoát
     * để không bị hiểu là ký tự đại diện.
     */
    public static function like(string $text): string
    {
        return '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $text) . '%';
    }
}
