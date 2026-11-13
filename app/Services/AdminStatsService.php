<?php
declare(strict_types=1);

namespace App\Services;

use App\Repositories\AdminRepository;
use App\Repositories\LicenseKeyRepository;
use App\Repositories\PlaylistRepository;
use App\Repositories\UserRepository;

/** Số liệu cho trang Tổng quan của khu vực quản trị. */
final class AdminStatsService
{
    private UserRepository $users;
    private LicenseKeyRepository $keys;
    private PlaylistRepository $playlists;
    private AdminRepository $admins;
    private AuditViewService $audit;

    public function __construct(UserRepository $users, LicenseKeyRepository $keys, PlaylistRepository $playlists, AdminRepository $admins, AuditViewService $audit)
    {
        $this->users = $users;
        $this->keys = $keys;
        $this->playlists = $playlists;
        $this->admins = $admins;
        $this->audit = $audit;
    }

    /** @param bool $withActivity true (master) thì kèm các thao tác gần đây; admin thường không xem được nhật ký nên không kèm */
    public function overview(bool $withActivity): array
    {
        return [
            'users' => $this->users->stats(),
            'keys' => $this->keys->counts(),
            'playlists' => $this->playlists->totals(),
            'admins' => ['total' => $this->admins->countAll()],
            'recent' => $withActivity ? $this->audit->recent(8) : null,
        ];
    }
}
