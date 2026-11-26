<?php
declare(strict_types=1);

/**
 * Cấu trúc SQLite tương đương database/schema.sql cho các bảng của khu vực quản trị và các bảng nó đọc (người dùng, playlist, key),
 * để chạy mã thật khi không có MySQL (kiểm thử đơn vị và máy chủ thử tests/support/serve_sqlite.php).
 * Có kiểm thử so sánh tên cột với schema.sql (tests/unit/AdminTest.php) nên không thể lệch âm thầm.
 */

use App\Core\Database;

/*
 * PDO cho SQLite chỉ dùng khi thử: đổi cú pháp riêng của MySQL "INSERT IGNORE" thành "INSERT OR IGNORE" của SQLite
 * (mã thật của website giữ nguyên cú pháp MySQL). Tham số không khai báo kiểu để chạy được trên PHP 7.4 lẫn 8.x.
 * PHP 8.1+ đòi thuộc tính #[\ReturnTypeWillChange] cho phương thức ghi đè; thuộc tính chỉ có từ PHP 8 nên lớp được dựng
 * bằng eval và chỉ gắn thuộc tính khi PHP >= 8.0 (PHP 7.4 coi "#[" là chú thích nên không thể viết thẳng trong file).
 */
if (!class_exists('SqliteTestPdo', false)) {
    $sqliteAttr = PHP_VERSION_ID >= 80000 ? '#[\\ReturnTypeWillChange] ' : '';
    eval('class SqliteTestPdo extends PDO { ' . $sqliteAttr
        . 'public function prepare($query, $options = []) { '
        . '$query = preg_replace(\'/^\\s*INSERT\\s+IGNORE\\b/i\', \'INSERT OR IGNORE\', (string) $query); '
        . 'return parent::prepare($query, $options); } }');
    unset($sqliteAttr);
}

/** @return array<int,string> câu lệnh tạo các bảng bằng cú pháp SQLite (tương đương database/schema.sql) */
function adminSqliteDdl(): array
{
    return [
        "CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'admin',
            status TEXT NOT NULL DEFAULT 'active',
            must_change_password INTEGER NOT NULL DEFAULT 0,
            last_login_at TEXT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            alive INTEGER NULL DEFAULT 1,
            deleted_at TEXT NULL,
            deleted_by_type TEXT NULL,
            deleted_by_id INTEGER NULL,
            deleted_by_email TEXT NULL,
            UNIQUE (email, alive)
        )",
        "CREATE TABLE IF NOT EXISTS otp_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_type TEXT NOT NULL,
            account_id INTEGER NOT NULL,
            purpose TEXT NOT NULL,
            code_hash TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            channels TEXT NOT NULL DEFAULT '',
            expires_at TEXT NOT NULL,
            used_at TEXT NULL,
            created_at TEXT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS cast_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'waiting',
            receiver_hash TEXT NOT NULL,
            sender_hash TEXT NULL,
            device_name TEXT NOT NULL DEFAULT '',
            pair_id INTEGER NULL,
            created_ip TEXT NOT NULL DEFAULT '',
            joined_ip TEXT NOT NULL DEFAULT '',
            code_expires_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            paired_at TEXT NULL,
            ended_at TEXT NULL,
            ended_by TEXT NULL,
            created_at TEXT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS cast_signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            from_role TEXT NOT NULL,
            kind TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS cast_pairs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            receiver_hash TEXT NOT NULL,
            sender_hash TEXT NOT NULL,
            receiver_name TEXT NOT NULL DEFAULT '',
            sender_name TEXT NOT NULL DEFAULT '',
            request_session_id INTEGER NULL,
            request_at TEXT NULL,
            last_used_at TEXT NULL,
            created_ip TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            deleted_at TEXT NULL,
            deleted_by TEXT NULL
        )",
        "CREATE TABLE IF NOT EXISTS password_resets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_type TEXT NOT NULL,
            account_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used_at TEXT NULL,
            created_at TEXT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            phone TEXT NULL,
            name TEXT NOT NULL DEFAULT '',
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            expires_at TEXT NULL,
            last_login_at TEXT NULL,
            session_token TEXT NULL,
            session_device TEXT NULL,
            session_ip TEXT NULL,
            session_at TEXT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            alive INTEGER NULL DEFAULT 1,
            deleted_at TEXT NULL,
            deleted_by_type TEXT NULL,
            deleted_by_id INTEGER NULL,
            deleted_by_email TEXT NULL,
            UNIQUE (email, alive),
            UNIQUE (phone, alive)
        )",
        "CREATE TABLE IF NOT EXISTS user_preferences (
            user_id INTEGER PRIMARY KEY,
            data TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS user_api_keys (
            user_id INTEGER PRIMARY KEY,
            key_enc TEXT NULL,
            key_hint TEXT NULL,
            updated_at TEXT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS user_play_stats (
            user_id INTEGER NOT NULL,
            video_id TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            uploader TEXT NOT NULL DEFAULT '',
            duration INTEGER NOT NULL DEFAULT 0,
            play_count INTEGER NOT NULL DEFAULT 0,
            last_played_at TEXT NOT NULL,
            hidden_at TEXT NULL,
            PRIMARY KEY (user_id, video_id)
        )",
        "CREATE TABLE IF NOT EXISTS playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT NULL,
            deleted_by_type TEXT NULL,
            deleted_by_id INTEGER NULL,
            deleted_by_email TEXT NULL
        )",
        "CREATE TABLE IF NOT EXISTS playlist_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            playlist_id INTEGER NOT NULL,
            video_id TEXT NOT NULL,
            title TEXT NOT NULL,
            uploader TEXT NOT NULL DEFAULT '',
            duration INTEGER NOT NULL DEFAULT 0,
            thumbnail TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            added_at TEXT NOT NULL,
            deleted_at TEXT NULL,
            deleted_by_type TEXT NULL,
            deleted_by_id INTEGER NULL,
            deleted_by_email TEXT NULL,
            UNIQUE (playlist_id, video_id)
        )",
        "CREATE TABLE IF NOT EXISTS license_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            days INTEGER NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'unused',
            created_by INTEGER NULL,
            created_at TEXT NOT NULL,
            used_by INTEGER NULL,
            used_by_email TEXT NULL,
            used_at TEXT NULL,
            revoked_by INTEGER NULL,
            revoked_at TEXT NULL,
            deleted_at TEXT NULL,
            deleted_by_type TEXT NULL,
            deleted_by_id INTEGER NULL,
            deleted_by_email TEXT NULL
        )",
        "CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER NULL,
            admin_email TEXT NOT NULL DEFAULT '',
            action TEXT NOT NULL,
            target_type TEXT NOT NULL DEFAULT '',
            target_id TEXT NOT NULL DEFAULT '',
            detail TEXT NOT NULL DEFAULT '',
            ip TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        )",
    ];
}

/**
 * Database trỏ vào SQLite (trong bộ nhớ, hoặc vào file nếu truyền đường dẫn), hoặc null nếu PHP chưa bật pdo_sqlite.
 * Dùng để chạy mã thật (Repository, Service, Controller) khi không có MySQL.
 */
function adminSqliteDatabase(?string $file = null): ?Database
{
    if (!extension_loaded('pdo_sqlite')) {
        return null;
    }
    $pdo = new SqliteTestPdo($file === null ? 'sqlite::memory:' : 'sqlite:' . $file, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    foreach (adminSqliteDdl() as $sql) {
        $pdo->exec($sql);
    }
    $db = new Database([]);
    $prop = new ReflectionProperty(Database::class, 'pdo');
    $prop->setAccessible(true);
    $prop->setValue($db, $pdo);
    return $db;
}

/** Tên cột của một bảng, đọc từ đoạn CREATE TABLE trong file SQL (để so với bản SQLite dùng khi thử). */
function adminSqlColumns(string $sqlFile, string $table): array
{
    $sql = (string) file_get_contents($sqlFile);
    if (preg_match('/CREATE TABLE IF NOT EXISTS ' . preg_quote($table, '/') . ' \((.*?)\n\) ENGINE/s', $sql, $m) !== 1) {
        return [];
    }
    $cols = [];
    foreach (explode("\n", $m[1]) as $line) {
        if (preg_match('/^  ([a-z_]+) [A-Z]/', $line, $c) === 1) {
            $cols[] = $c[1];
        }
    }
    return $cols;
}

