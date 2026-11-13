package com.phcarplay.app;

import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Giai đoạn 15 (đợt 2): ảnh JPEG mới nhất của màn hình, CastService chụp và ghi vào, trang web lấy ra.
 * Trang web (modules/cast/castSender.js) gọi fetch('/__cast/frame?since=<số ảnh đã có>'); MainActivity chặn địa chỉ này
 * (shouldInterceptRequest) và trả lời bằng respond(): không đi ra mạng, ảnh chỉ nằm trong bộ nhớ của ứng dụng.
 *   200 + ảnh JPEG + header X-Cast-Seq / X-Cast-Width / X-Cast-Height : có ảnh mới hơn ảnh số `since`
 *   204 : chưa có ảnh mới (màn hình không đổi)          410 : không còn chụp màn hình
 * Được gọi từ nhiều luồng (luồng chụp ghi, luồng mạng của WebView đọc) nên mọi truy cập đều khóa LOCK.
 */
final class FrameStore {
    static final String PATH = "/__cast/frame";
    private static final Object LOCK = new Object();
    private static final byte[] EMPTY = new byte[0];

    private static boolean active;
    private static byte[] jpeg;
    private static long seq;
    private static int width;
    private static int height;

    private FrameStore() {
    }

    static void open() {
        synchronized (LOCK) {
            active = true;
            jpeg = null;
        }
    }

    static void put(byte[] data, int w, int h) {
        synchronized (LOCK) {
            if (!active) return;
            jpeg = data;
            width = w;
            height = h;
            seq += 1;   // không đặt lại về 0 giữa các lần chiếu: trang web luôn thấy số tăng dần
        }
    }

    static void close() {
        synchronized (LOCK) {
            active = false;
            jpeg = null;
        }
    }

    static WebResourceResponse respond(String sinceRaw) {
        long since = 0;
        try {
            if (sinceRaw != null) since = Long.parseLong(sinceRaw);
        } catch (NumberFormatException ignored) {
            // coi như chưa có ảnh nào
        }
        byte[] data;
        long s;
        int w;
        int h;
        synchronized (LOCK) {
            if (!active) return plain(410, "Gone");
            if (jpeg == null || seq <= since) return plain(204, "No Content");
            data = jpeg;
            s = seq;
            w = width;
            h = height;
        }
        Map<String, String> headers = baseHeaders();
        headers.put("X-Cast-Seq", String.valueOf(s));
        headers.put("X-Cast-Width", String.valueOf(w));
        headers.put("X-Cast-Height", String.valueOf(h));
        return new WebResourceResponse("image/jpeg", null, 200, "OK", headers, new ByteArrayInputStream(data));
    }

    private static Map<String, String> baseHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        return headers;
    }

    private static WebResourceResponse plain(int status, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", status, reason, baseHeaders(), new ByteArrayInputStream(EMPTY));
    }
}
