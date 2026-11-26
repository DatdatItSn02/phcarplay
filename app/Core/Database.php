<?php
declare(strict_types=1);

namespace App\Core;

use PDO;
use PDOStatement;

/** Bọc PDO (MySQL). Kết nối được tạo khi dùng lần đầu. */
final class Database
{
    private ?PDO $pdo = null;

    private ?array $cfg;

    public function __construct(?array $cfg = null)
    {
        $this->cfg = $cfg;
    }

    public function pdo(): PDO
    {
        if ($this->pdo === null) {
            $c = $this->cfg ?? (array) Config::get('database', []);
            $dsn = sprintf(
                'mysql:host=%s;port=%d;dbname=%s;charset=%s',
                $c['host'] ?? '127.0.0.1',
                (int) ($c['port'] ?? 3306),
                $c['name'] ?? '',
                $c['charset'] ?? 'utf8mb4'
            );
            $this->pdo = new PDO($dsn, (string) ($c['user'] ?? ''), (string) ($c['pass'] ?? ''), [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
            // Đồng bộ múi giờ MySQL với PHP để so sánh thời gian hết hạn chính xác.
            $this->pdo->exec("SET time_zone = '" . date('P') . "'");
        }
        return $this->pdo;
    }

    public function run(string $sql, array $params = []): PDOStatement
    {
        $stmt = $this->pdo()->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }

    public function one(string $sql, array $params = []): ?array
    {
        $row = $this->run($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    /** @return array<int,array> */
    public function all(string $sql, array $params = []): array
    {
        return $this->run($sql, $params)->fetchAll();
    }

    public function value(string $sql, array $params = [])
    {
        $v = $this->run($sql, $params)->fetchColumn();
        return $v === false ? null : $v;
    }

    public function insert(string $sql, array $params = []): int
    {
        $this->run($sql, $params);
        return (int) $this->pdo()->lastInsertId();
    }

    /** Chạy một nhóm thao tác trong giao dịch: lỗi ở đâu cũng hoàn tác tất cả. */
    public function transaction(callable $fn)
    {
        $pdo = $this->pdo();
        $pdo->beginTransaction();
        try {
            $result = $fn();
            $pdo->commit();
            return $result;
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    public function execute(string $sql, array $params = []): int
    {
        return $this->run($sql, $params)->rowCount();
    }
}
