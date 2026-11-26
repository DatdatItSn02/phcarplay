package com.phcarplay.app;

import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Kênh tin nhắn website -> ứng dụng, tên PHCarPlayNative (phía website: public/assets/js/core/nativeApp.js).
 * Website gửi chuỗi JSON: { type: 'voice.start', id, lang } | { type: 'voice.stop', id }
 *                         | { type: 'state', playing, title, artist, duration, position }  (giây)
 *                         | { type: 'background', enabled }  (giai đoạn 15: người dùng bật/tắt "Phát trong nền")
 *                         | { type: 'cast.start', maxSide, quality, fps } | { type: 'cast.stop' }  (đợt 2: chụp màn hình để chiếu lên xe)
 * Ứng dụng trả lời bằng cách gọi window.__phApp.* (MainActivity.callWeb).
 */
final class NativeBridge {
    static final String NAME = "PHCarPlayNative";
    private static final int MAX_MESSAGE = 8192;

    interface Listener {
        void onVoiceStart(int id, String lang);

        void onVoiceStop(int id);

        void onPlaybackState(boolean playing, String title, String artist, long durationMs, long positionMs);

        void onBackgroundMode(boolean enabled);

        void onCastStart(int maxSide, int quality, int fps);

        void onCastStop();
    }

    private final AppConfig config;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());

    NativeBridge(AppConfig config, Listener listener) {
        this.config = config;
        this.listener = listener;
    }

    /**
     * Gắn kênh vào WebView (gọi trước khi tải trang).
     * WebView mới (từ 2020): addWebMessageListener - chỉ khung chính của đúng website thấy được kênh.
     * WebView quá cũ (màn hình xe không cập nhật được): addJavascriptInterface - mọi khung đều thấy (kể cả trình phát YouTube),
     * nên chỉ nhận khi trang chính đang là website; các lệnh đều vô hại (mở màn hình nghe giọng nói của Google, báo tên bài).
     */
    void attach(WebView web) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, NAME, config.origins,
                    (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                        if (!isMainFrame || !config.isOwn(sourceOrigin)) return;
                        handle(message.getData());
                    });
        } else {
            web.addJavascriptInterface(new LegacyChannel(web), NAME);
        }
    }

    /** Dùng cho WebView cũ. Hàm được gọi trên luồng riêng của WebView nên chuyển về luồng giao diện. */
    final class LegacyChannel {
        private final WebView web;

        LegacyChannel(WebView web) {
            this.web = web;
        }

        @JavascriptInterface
        public void postMessage(final String data) {
            main.post(() -> {
                String url = web.getUrl();
                if (url == null || !config.isOwn(Uri.parse(url))) return;
                handle(data);
            });
        }
    }

    private void handle(String data) {
        if (data == null || data.length() > MAX_MESSAGE) return;
        JSONObject o;
        try {
            o = new JSONObject(data);
        } catch (JSONException e) {
            return;
        }
        switch (o.optString("type", "")) {
            case "voice.start":
                listener.onVoiceStart(o.optInt("id", 0), o.optString("lang", "vi-VN"));
                break;
            case "voice.stop":
                listener.onVoiceStop(o.optInt("id", 0));
                break;
            case "state":
                listener.onPlaybackState(o.optBoolean("playing", false), o.optString("title", ""), o.optString("artist", ""),
                        Math.round(o.optDouble("duration", 0) * 1000), Math.round(o.optDouble("position", 0) * 1000));
                break;
            case "cast.start":
                listener.onCastStart(o.optInt("maxSide", 1280), o.optInt("quality", 70), o.optInt("fps", 12));
                break;
            case "cast.stop":
                listener.onCastStop();
                break;
            case "background":
                listener.onBackgroundMode(o.optBoolean("enabled", false));
                break;
            default:
                break;
        }
    }
}
