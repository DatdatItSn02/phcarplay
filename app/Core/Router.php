<?php
declare(strict_types=1);

namespace App\Core;

use App\Middleware\MiddlewareInterface;

/**
 * Router: khai báo đường dẫn trong routes/*.php.
 *   $router->get('/playlists/{id}', [PlaylistController::class, 'show']);
 *   $router->group([RequireUser::class], function (Router $r) { ... });
 * Handler là [ClassController, 'method'] hoặc một hàm; nhận Request và trả Response (hoặc mảng dữ liệu).
 */
final class Router
{
    /** @var array<int,array{method:string,regex:string,handler:mixed,middleware:array}> */
    private array $routes = [];
    private array $globalMiddleware = [];
    private array $groupStack = [];

    public function setGlobalMiddleware(array $middleware): void
    {
        $this->globalMiddleware = $middleware;
    }

    public function group(array $middleware, callable $define): void
    {
        $this->groupStack[] = $middleware;
        $define($this);
        array_pop($this->groupStack);
    }

    public function get(string $path, $handler, array $middleware = []): void
    {
        $this->add('GET', $path, $handler, $middleware);
    }

    public function post(string $path, $handler, array $middleware = []): void
    {
        $this->add('POST', $path, $handler, $middleware);
    }

    public function put(string $path, $handler, array $middleware = []): void
    {
        $this->add('PUT', $path, $handler, $middleware);
    }

    public function patch(string $path, $handler, array $middleware = []): void
    {
        $this->add('PATCH', $path, $handler, $middleware);
    }

    public function delete(string $path, $handler, array $middleware = []): void
    {
        $this->add('DELETE', $path, $handler, $middleware);
    }

    public function add(string $method, string $path, $handler, array $middleware = []): void
    {
        $stack = [];
        foreach ($this->groupStack as $g) {
            $stack = array_merge($stack, $g);
        }
        $regex = '#^' . preg_replace('#\{(\w+)\}#', '(?P<$1>[^/]+)', rtrim($path, '/') ?: '/') . '$#';
        $this->routes[] = [
            'method' => $method,
            'regex' => $regex,
            'handler' => $handler,
            'middleware' => array_merge($stack, $middleware),
        ];
    }

    public function dispatch(Request $request): Response
    {
        $allowed = [];
        foreach ($this->routes as $route) {
            if (!preg_match($route['regex'], $request->path, $m)) {
                continue;
            }
            if ($route['method'] !== $request->method) {
                $allowed[] = $route['method'];
                continue;
            }
            $params = [];
            foreach ($m as $k => $v) {
                if (is_string($k)) {
                    $params[$k] = $v;
                }
            }
            $request->attributes['params'] = $params;
            return $this->run($request, $route);
        }
        if ($allowed) {
            throw new HttpException(405, 'METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ.');
        }
        throw HttpException::notFound('Không tìm thấy đường dẫn.');
    }

    private function run(Request $request, array $route): Response
    {
        $core = function (Request $req) use ($route): Response {
            return $this->callHandler($route['handler'], $req);
        };
        $pipeline = $core;
        foreach (array_reverse(array_merge($this->globalMiddleware, $route['middleware'])) as $mw) {
            $next = $pipeline;
            $pipeline = function (Request $req) use ($mw, $next): Response {
                /** @var MiddlewareInterface $instance */
                $instance = is_string($mw) ? Container::get($mw) : $mw;
                return $instance->handle($req, $next);
            };
        }
        return $pipeline($request);
    }

    private function callHandler($handler, Request $request): Response
    {
        if (is_array($handler) && is_string($handler[0])) {
            $result = Container::get($handler[0])->{$handler[1]}($request);
        } else {
            $result = $handler($request);
        }
        return $result instanceof Response ? $result : Response::ok($result);
    }
}
