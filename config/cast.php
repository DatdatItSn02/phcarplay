<?php
declare(strict_types=1);

use App\Core\Env;

// Giai đoạn 15: chiếu màn hình điện thoại lên màn hình xe. Máy chủ chỉ ghép nối hai máy; hình đi thẳng giữa hai máy.
//   CAST_ENABLED          false = tắt hẳn chức năng (API trả lỗi CAST_DISABLED)
//   CAST_CODE_TTL_SECONDS mã 6 số trên màn hình xe còn hiệu lực bao lâu
//   CAST_SESSION_HOURS    một phiên chiếu dài nhất bao lâu (hết thì ghép nối lại)
//   CAST_STUN_URLS        máy chủ STUN giúp hai máy khác mạng tìm đường nối (cách nhau dấu phẩy; để trống = chỉ nối khi cùng mạng).
//                         Hai máy cùng mạng (wifi phát từ điện thoại, hoặc cắm dây + chia sẻ kết nối qua USB) không cần STUN.
return [
    'enabled' => Env::bool('CAST_ENABLED', true),
    'code_ttl_seconds' => max(60, Env::int('CAST_CODE_TTL_SECONDS', 300)),
    'session_hours' => max(1, Env::int('CAST_SESSION_HOURS', 12)),
    'stun_urls' => array_values(array_filter(array_map('trim', explode(',', (string) Env::get('CAST_STUN_URLS', 'stun:stun.l.google.com:19302'))), static function ($u) {
        return (bool) preg_match('/^stuns?:[A-Za-z0-9.\-\[\]:]+$/', $u);
    })),
];
