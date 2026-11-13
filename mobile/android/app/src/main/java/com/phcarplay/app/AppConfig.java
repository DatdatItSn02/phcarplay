package com.phcarplay.app;

import android.net.Uri;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Địa chỉ website mà ứng dụng mở. Giá trị lấy từ mobile/config/app.json lúc build (app/build.gradle -> BuildConfig.WEB_URL).
 * Chỉ trang thuộc website mới được mở trong ứng dụng và được nói chuyện với ứng dụng; liên kết sang nơi khác mở bằng
 * trình duyệt của máy. "Thuộc website" = cùng giao thức + tên miền + cổng với webUrl, chấp nhận thêm hai kiểu chuyển hướng
 * hay gặp của hosting: http -> https và có/không có "www.".
 */
final class AppConfig {
    /** Địa chỉ đầy đủ để tải lúc mở ứng dụng ("" nếu chưa cấu hình đúng). */
    final String webUrl;
    /** Các nguồn gốc dạng "https://ten-mien" hoặc "http://192.168.1.5:8080" (không có dấu / ở cuối). */
    final Set<String> origins;

    private AppConfig(String webUrl, Set<String> origins) {
        this.webUrl = webUrl;
        this.origins = origins;
    }

    static AppConfig load() {
        String raw = BuildConfig.WEB_URL == null ? "" : BuildConfig.WEB_URL.trim();
        Uri u = parse(raw);
        if (u == null) return new AppConfig("", Collections.<String>emptySet());
        String scheme = lower(u.getScheme());
        String host = lower(u.getHost());
        List<String> hosts = new ArrayList<>();
        hosts.add(host);
        boolean isIp = host.matches("[0-9.]+") || host.contains(":");
        if (host.startsWith("www.")) hosts.add(host.substring(4));
        else if (!isIp && host.contains(".")) hosts.add("www." + host);
        Set<String> set = new LinkedHashSet<>();
        for (String h : hosts) {
            set.add(origin(scheme, h, u.getPort()));
            if ("http".equals(scheme)) set.add(origin("https", h, -1));
        }
        return new AppConfig(raw, Collections.unmodifiableSet(set));
    }

    /** null nếu không phải địa chỉ http/https hợp lệ hoặc vẫn là địa chỉ mẫu (*.example). */
    static Uri parse(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        Uri u;
        try {
            u = Uri.parse(raw);
        } catch (RuntimeException e) {
            return null;
        }
        String scheme = lower(u.getScheme());
        String host = lower(u.getHost());
        if (!"https".equals(scheme) && !"http".equals(scheme)) return null;
        if (host.isEmpty() || host.endsWith(".example")) return null;
        return u;
    }

    boolean isValid() {
        return !webUrl.isEmpty();
    }

    /** Địa chỉ này có thuộc website không? */
    boolean isOwn(Uri u) {
        if (u == null) return false;
        String scheme = lower(u.getScheme());
        if (!"http".equals(scheme) && !"https".equals(scheme)) return false;
        return origins.contains(origin(scheme, lower(u.getHost()), u.getPort()));
    }

    private static String origin(String scheme, String host, int port) {
        int def = "http".equals(scheme) ? 80 : 443;
        return scheme + "://" + host + (port > 0 && port != def ? ":" + port : "");
    }

    private static String lower(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT);
    }
}
