<?php
declare(strict_types=1);

use App\Core\Env;

return [
    'driver' => Env::get('MAIL_DRIVER', 'log'),   // log | mail | smtp
    'from_email' => Env::get('MAIL_FROM_EMAIL', 'no-reply@example.com'),
    'from_name' => Env::get('MAIL_FROM_NAME', 'PH Car Play'),
    'smtp' => [
        'host' => Env::get('SMTP_HOST', ''),
        'port' => Env::int('SMTP_PORT', 587),
        'encryption' => Env::get('SMTP_ENCRYPTION', 'tls'),   // tls (587) | ssl (465) | rỗng
        'username' => Env::get('SMTP_USER', ''),
        'password' => Env::get('SMTP_PASS', ''),
        'helo' => Env::get('SMTP_HELO', 'localhost'),
        'timeout' => 15,
    ],
];
