<?php
declare(strict_types=1);

/**
 * Autoloader PSR-4 đơn giản: namespace App\ ánh xạ vào thư mục app/.
 * Ví dụ: App\Services\Mailer -> app/Services/Mailer.php
 */
spl_autoload_register(static function (string $class): void {
    $prefix = 'App\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $file = __DIR__ . '/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
    if (is_file($file)) {
        require $file;
    }
});
