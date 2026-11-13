<?php
declare(strict_types=1);

namespace App\Controllers\Admin;

use App\Core\Pagination;
use App\Core\Request;
use App\Core\Response;
use App\Services\AdminPlaylistService;

/** Xem và gỡ playlist của người dùng. */
final class AdminPlaylistsController
{
    use ReadsParams;

    private AdminPlaylistService $playlists;

    public function __construct(AdminPlaylistService $playlists)
    {
        $this->playlists = $playlists;
    }

    public function index(Request $request): Response
    {
        [$page, $per, $offset] = Pagination::fromQuery($request->query);
        $filters = $this->filters($request, ['q', 'user_id', 'deleted']);
        if (isset($filters['user_id']) && !ctype_digit($filters['user_id'])) {
            unset($filters['user_id']);
        }
        return Response::ok($this->playlists->search($filters, $page, $per, $offset));
    }

    public function show(Request $request): Response
    {
        return Response::ok($this->playlists->get($this->idParam($request, 'id', 'Không tìm thấy playlist.')));
    }

    public function destroy(Request $request): Response
    {
        $this->playlists->delete($request->attributes['admin'], $this->idParam($request, 'id', 'Không tìm thấy playlist.'), $request->ip);
        return Response::ok(['deleted' => true]);
    }
}
