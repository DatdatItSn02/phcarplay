<?php
declare(strict_types=1);

/**
 * Khởi tạo chung cho web, API và lệnh CLI:
 * hằng số đường dẫn, autoload, đọc .env, múi giờ, hiển thị lỗi.
 */

if (PHP_VERSION_ID < 70400) {
    http_response_code(500);
    exit('Cần PHP 7.4 trở lên.');
}

if (!defined('BASE_PATH')) {
    define('BASE_PATH', dirname(__DIR__));
}

require_once __DIR__ . '/autoload.php';

use App\Core\Config;
use App\Core\Env;

Env::load(BASE_PATH . '/.env');

date_default_timezone_set((string) Config::get('app.timezone', 'Asia/Ho_Chi_Minh'));

$debug = (bool) Config::get('app.debug', false);
ini_set('display_errors', $debug ? '1' : '0');
error_reporting(E_ALL);
