<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Container rất nhỏ: tự tạo đối tượng theo kiểu khai báo ở hàm khởi tạo (autowire).
 * Chỉ cần đăng ký thủ công khi class cần tham số đặc biệt: Container::bind(Foo::class, fn() => new Foo(...)).
 */
final class Container
{
    /** @var array<string,object> */
    private static array $instances = [];
    /** @var array<string,callable> */
    private static array $bindings = [];

    public static function bind(string $id, callable $factory): void
    {
        self::$bindings[$id] = $factory;
        unset(self::$instances[$id]);
    }

    public static function set(string $id, object $instance): void
    {
        self::$instances[$id] = $instance;
    }

    public static function get(string $id): object
    {
        if (isset(self::$instances[$id])) {
            return self::$instances[$id];
        }
        $object = isset(self::$bindings[$id]) ? (self::$bindings[$id])() : self::autowire($id);
        self::$instances[$id] = $object;
        return $object;
    }

    public static function reset(): void
    {
        self::$instances = [];
        self::$bindings = [];
    }

    private static function autowire(string $class): object
    {
        $ref = new \ReflectionClass($class);
        $ctor = $ref->getConstructor();
        if ($ctor === null) {
            return new $class();
        }
        $args = [];
        foreach ($ctor->getParameters() as $param) {
            $type = $param->getType();
            if ($type instanceof \ReflectionNamedType && !$type->isBuiltin()) {
                $args[] = self::get($type->getName());
            } elseif ($param->isDefaultValueAvailable()) {
                $args[] = $param->getDefaultValue();
            } else {
                throw new \RuntimeException('Không thể tự tạo ' . $class . ': thiếu tham số $' . $param->getName());
            }
        }
        return $ref->newInstanceArgs($args);
    }
}
