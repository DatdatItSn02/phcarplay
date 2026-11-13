<?php
declare(strict_types=1);

/** Lệnh tự kiểm tra máy chủ php bin/doctor.php (App\Services\SystemCheck): chạy trên thư mục giả và mạng giả. */

use App\Core\Config;
use App\Services\SystemCheck;

require_once dirname(__DIR__) . '/support/sqlite_schema.php';

/** Thư mục dự án giả: .env, thư mục storage, migrations, .htaccess. */
function doctorFakeBase(): string
{
    $base = sys_get_temp_dir() . '/carweb-doctor-' . bin2hex(random_bytes(4));
    foreach (['storage/cache', 'storage/logs', 'storage/mail', 'storage/sessions', 'database/migrations', 'public/assets'] as $d) {
        mkdir($base . '/' . $d, 0775, true);
    }
    file_put_contents($base . '/.env', "APP_DEBUG=false\n");
    file_put_contents($base . '/.htaccess', '#');
    file_put_contents($base . '/public/.htaccess', '#');
    foreach (['001_core.sql', '002_more.sql'] as $m) {
        file_put_contents($base . '/database/migrations/' . $m, '-- thử');
    }
    return $base;
}

/** @return array<string,array{0:string,1:string}> tiêu đề => [mức, giải thích] */
function doctorIndex(array $items): array
{
    $out = [];
    foreach ($items as [$level, $title, $detail]) {
        $out[$title] = [$level, $detail];
    }
    return $out;
}

function doctorFind(array $items, string $needle): ?array
{
    foreach ($items as $it) {
        if (strpos($it[1], $needle) !== false) {
            return $it;
        }
    }
    return null;
}

test('Doctor: báo lỗi khi chưa chạy migration, chưa có master; báo đúng APP_DEBUG/APP_URL/MAIL theo cấu hình', function () {
    if (adminSqliteDatabase() === null) {
        return;
    }
    $saved = ['app' => Config::get('app', []), 'mail' => Config::get('mail', [])];
    try {
        $base = doctorFakeBase();
        $db = adminSqliteDatabase();
        Config::override('app', ['debug' => true, 'url' => 'http://car.example.vn', 'security' => ['rate_limit' => false, 'csp' => true]]);
        Config::override('mail', ['driver' => 'log']);
        $items = (new SystemCheck($db, null, $base))->run(false);
        assertSame('error', doctorFind($items, 'APP_DEBUG=true trên website thật')[0], 'APP_DEBUG=true với tên miền thật là lỗi');
        assertSame('warn', doctorFind($items, 'APP_URL chưa dùng https')[0]);
        assertSame('warn', doctorFind($items, 'MAIL_DRIVER=log')[0]);
        assertSame('warn', doctorFind($items, 'RATE_LIMIT=false')[0]);
        assertSame('note', doctorFind($items, 'LOGIN_THROTTLE=false')[0]);
        assertSame('error', doctorFind($items, 'Còn migration chưa chạy: 001_core.sql, 002_more.sql')[0]);
        assertSame('error', doctorFind($items, 'Chưa có tài khoản quản trị master')[0]);
        assertSame('ok', doctorFind($items, 'Ghi được storage/sessions')[0]);

        $db->run('CREATE TABLE migrations (name VARCHAR(190) NOT NULL PRIMARY KEY, ran_at DATETIME NOT NULL)');
        foreach (['001_core.sql', '002_more.sql'] as $m) {
            $db->run('INSERT INTO migrations (name, ran_at) VALUES (?, ?)', [$m, '2026-01-01 00:00:00']);
        }
        $db->run("INSERT INTO admins (email, name, password_hash, salt, role, must_change_password, created_at, updated_at) VALUES ('m@x.vn', 'M', 'h', 's', 'master', 0, '2026-01-01', '2026-01-01')");
        Config::override('app', ['debug' => false, 'url' => 'https://car.example.vn']);
        Config::override('mail', ['driver' => 'smtp', 'smtp' => ['host' => '']]);
        $items = (new SystemCheck($db, null, $base))->run(false);
        assertSame('ok', doctorFind($items, 'Database đã cập nhật đủ 2 migration')[0]);
        assertSame('ok', doctorFind($items, 'Có tài khoản quản trị master')[0]);
        assertSame('ok', doctorFind($items, 'APP_DEBUG=false')[0]);
        assertSame('ok', doctorFind($items, 'APP_URL = https://car.example.vn')[0]);
        assertSame('error', doctorFind($items, 'MAIL_DRIVER=smtp nhưng chưa có SMTP_HOST')[0]);
        unlink($base . '/.env');
        assertSame('error', doctorFind((new SystemCheck($db, null, $base))->run(false), 'Chưa có file .env')[0]);
    } finally {
        Config::override('app', $saved['app']);
        Config::override('mail', $saved['mail']);
    }
});

test('Doctor (mạng giả): thử từng địa chỉ Piped; gọi website qua APP_URL phát hiện lộ .env và thiếu tiêu đề bảo mật', function () {
    if (adminSqliteDatabase() === null) {
        return;
    }
    $saved = ['app' => Config::get('app', []), 'piped' => Config::get('piped', [])];
    try {
        $base = doctorFakeBase();
        Config::override('app', ['debug' => false, 'url' => 'https://car.example.vn', 'security' => ['csp' => true, 'hsts_max_age' => 100]]);
        Config::override('piped', ['instances' => ['https://a.example', 'https://b.example'], 'timeout' => 2]);
        $calls = [];
        $leak = true;
        $http = function (string $url, int $timeout) use (&$calls, &$leak): array {
            $calls[] = $url;
            if ($url === 'https://a.example/suggestions?query=test') {
                return [200, [], '["test"]'];
            }
            if ($url === 'https://b.example/suggestions?query=test') {
                return [0, [], ''];
            }
            if ($url === 'https://car.example.vn/api/health') {
                return [200, [], '{"ok":true,"data":{"status":"ok"}}'];
            }
            if ($url === 'https://car.example.vn/.env') {
                return $leak ? [200, [], "APP_NAME=x\nDB_PASS=bimat\n"] : [404, [], 'Không tìm thấy.'];
            }
            if ($url === 'https://car.example.vn/') {
                return $leak ? [200, [], '<html>'] : [200, ['content-security-policy' => "default-src 'self'", 'x-frame-options' => 'SAMEORIGIN', 'strict-transport-security' => 'max-age=100'], '<html>'];
            }
            return [404, [], 'Không tìm thấy.'];
        };
        $items = (new SystemCheck(adminSqliteDatabase(), $http, $base))->run(true);
        $piped = doctorFind($items, 'địa chỉ Piped trả lời');
        assertSame('warn', $piped[0]);
        assertTrue(strpos($piped[1], '1/2') === 0 && strpos($piped[2], 'https://b.example (không kết nối được)') !== false, $piped[2]);
        assertSame('warn', doctorFind($items, 'Không địa chỉ Invidious nào trả lời')[0], 'Invidious (dự phòng) hỏng hết chỉ là chú ý');
        assertSame(null, doctorFind($items, 'Không nguồn video nào trả lời'), 'còn Piped chạy thì không báo lỗi');
        assertSame('ok', doctorFind($items, 'Website trả lời ở https://car.example.vn/api/health')[0]);
        assertSame('error', doctorFind($items, 'LỘ FILE NỘI BỘ: /.env')[0]);
        assertSame('warn', doctorFind($items, 'Trang thiếu tiêu đề bảo mật')[0]);
        assertSame('warn', doctorFind($items, 'Chưa có HSTS dù chạy https')[0]);

        $leak = false;
        $items = (new SystemCheck(adminSqliteDatabase(), $http, $base))->run(true);
        assertSame('ok', doctorFind($items, 'Không đọc được .env, log, mã nguồn qua web')[0]);
        assertSame('ok', doctorFind($items, 'Trang có tiêu đề bảo mật')[0]);
        assertSame(null, doctorFind($items, 'Chưa có HSTS'));

        Config::override('app', ['debug' => false, 'url' => 'http://localhost:8000']);
        $calls = [];
        $items = (new SystemCheck(adminSqliteDatabase(), $http, $base))->run(true);
        assertSame('note', doctorFind($items, 'Bỏ qua kiểm tra website qua APP_URL')[0]);
        assertTrue(!in_array('http://localhost:8000/api/health', $calls, true), 'không gọi website khi APP_URL là máy mình');
        // Mọi địa chỉ đều hỏng (có địa chỉ trả trang web thay vì dữ liệu) thì báo LỖI
        Config::override('piped', ['instances' => ['https://web.example'], 'timeout' => 2]);
        $html = function (string $url) { return strpos($url, 'https://web.example') === 0 ? [200, [], '<html>'] : [0, [], '']; };
        $items = (new SystemCheck(adminSqliteDatabase(), $html, $base))->run(true);
        assertSame('error', doctorFind($items, 'Không nguồn video nào trả lời')[0]);
        assertTrue(strpos(doctorFind($items, 'Không địa chỉ Piped nào trả lời')[2], 'trả về trang web, không phải dữ liệu Piped') !== false);
        // Piped/Invidious hỏng hết nhưng tìm kiếm qua YouTube chạy được: chỉ CHÚ Ý (website vẫn dùng được), không phải LỖI
        $ytJson = json_encode(['contents' => [['videoRenderer' => ['videoId' => 'aaaaaaaaaaa', 'title' => ['runs' => [['text' => 'Bài']]], 'lengthText' => ['simpleText' => '3:00']]]]]);
        $yt = function (string $url) use ($ytJson) { return strpos($url, 'https://www.youtube.com/youtubei/v1/search') === 0 ? [200, [], $ytJson] : [0, [], '']; };
        $items = (new SystemCheck(adminSqliteDatabase(), $yt, $base))->run(true);
        assertSame(null, doctorFind($items, 'Không nguồn video nào trả lời'));
        assertSame('warn', doctorFind($items, 'Piped và Invidious đều hỏng: website đang dùng YouTube dự phòng')[0]);
        assertSame('ok', doctorFind($items, 'Tìm kiếm qua YouTube (đọc trực tiếp) chạy được')[0]);
        assertSame('ok', doctorFind($items, 'Không lấy được luồng trực tiếp thì phát bằng trình phát YouTube (YOUTUBE_EMBED)')[0]);
        assertSame('note', doctorFind($items, 'Tìm kiếm dự phòng: đọc trực tiếp từ YouTube')[0]);
        $count = count((new SystemCheck(adminSqliteDatabase(), function () { throw new RuntimeException('không được gọi mạng'); }, $base))->run(false));
        assertTrue($count > 10, '--offline không gọi mạng');
    } finally {
        Config::override('app', $saved['app']);
        Config::override('piped', $saved['piped']);
    }
});
