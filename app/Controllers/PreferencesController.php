<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Services\PreferencesService;

/** Cài đặt giao diện của người dùng đang đăng nhập. */
final class PreferencesController
{
    private PreferencesService $prefs;

    public function __construct(PreferencesService $prefs)
    {
        $this->prefs = $prefs;
    }

    public function show(Request $request): Response
    {
        return Response::ok($this->prefs->get((int) $request->attributes['user']['id']));
    }

    public function update(Request $request): Response
    {
        return Response::ok($this->prefs->save((int) $request->attributes['user']['id'], $request->body));
    }
}
