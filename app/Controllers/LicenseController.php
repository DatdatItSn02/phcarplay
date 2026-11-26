<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\HttpException;
use App\Core\Request;
use App\Core\Response;
use App\Repositories\UserRepository;
use App\Services\EntitlementService;
use App\Services\LicenseKeyService;
use App\Services\RateLimiter;

/** Người dùng tự kích hoạt key để gia hạn tài khoản. */
final class LicenseController
{
    private LicenseKeyService $keys;
    private EntitlementService $entitlements;
    private RateLimiter $limiter;

    public function __construct(LicenseKeyService $keys, EntitlementService $entitlements, RateLimiter $limiter)
    {
        $this->keys = $keys;
        $this->entitlements = $entitlements;
        $this->limiter = $limiter;
    }

    public function redeem(Request $request): Response
    {
        $code = $request->input('code');
        if (!is_string($code) || trim($code) === '') {
            throw HttpException::validation(['code' => 'Hãy nhập key kích hoạt.']);
        }
        // Nhập sai key 10 lần trong 15 phút thì tạm chặn (chống đoán key).
        $limitKey = 'redeem:u:' . (int) $request->attributes['user']['id'];
        $this->limiter->guard([[$limitKey, 10, 900]], 'Bạn đã nhập sai key quá nhiều lần.');
        try {
            $result = $this->keys->redeem($request->attributes['user'], $code);
        } catch (HttpException $e) {
            if ($e->status !== 422) {
                $this->limiter->hit($limitKey, 900);
            }
            throw $e;
        }
        return Response::ok(array_merge(
            [
                'days_added' => $result['days_added'],
                'previous_expires_at' => $result['previous_expires_at'],
                'user' => UserRepository::publicView($result['user']),
            ],
            $this->entitlements->forUser($result['user'])
        ));
    }
}
