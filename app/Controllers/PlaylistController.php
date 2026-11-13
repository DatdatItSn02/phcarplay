<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Services\PlaylistService;

/** Playlist của người dùng đang đăng nhập. Đường dẫn: xem routes/api.php và docs/API.md. */
final class PlaylistController
{
    private PlaylistService $playlists;

    public function __construct(PlaylistService $playlists)
    {
        $this->playlists = $playlists;
    }

    private function uid(Request $r): int
    {
        return (int) $r->attributes['user']['id'];
    }

    private function id(Request $r): int
    {
        return (int) $r->param('id');
    }

    public function index(Request $r): Response
    {
        return Response::ok(['playlists' => $this->playlists->listFor($this->uid($r))]);
    }

    public function store(Request $r): Response
    {
        return Response::ok($this->playlists->create($this->uid($r), $r->input('name')), 201);
    }

    public function show(Request $r): Response
    {
        return Response::ok($this->playlists->get($this->uid($r), $this->id($r)));
    }

    public function update(Request $r): Response
    {
        return Response::ok($this->playlists->rename($this->uid($r), $this->id($r), $r->input('name')));
    }

    public function destroy(Request $r): Response
    {
        $this->playlists->delete($this->uid($r), $this->id($r));
        return Response::ok(['deleted' => true]);
    }

    public function addItems(Request $r): Response
    {
        $items = $r->input('items');
        return Response::ok($this->playlists->addItems($this->uid($r), $this->id($r), is_array($items) ? $items : []), 201);
    }

    public function removeItem(Request $r): Response
    {
        $this->playlists->removeItem($this->uid($r), $this->id($r), (string) $r->param('video_id'));
        return Response::ok(['deleted' => true]);
    }

    public function reorder(Request $r): Response
    {
        $ids = $r->input('video_ids');
        return Response::ok($this->playlists->reorder($this->uid($r), $this->id($r), is_array($ids) ? $ids : []));
    }

    public function import(Request $r): Response
    {
        $list = $r->input('playlists');
        return Response::ok($this->playlists->import($this->uid($r), is_array($list) ? $list : []));
    }
}
