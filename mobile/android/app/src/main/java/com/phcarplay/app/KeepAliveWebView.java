package com.phcarplay.app;

import android.content.Context;
import android.view.View;
import android.webkit.WebView;

/**
 * WebView giữ được trang chạy khi ứng dụng ra nền (giai đoạn 15: nghe nhạc trong nền).
 * Bình thường khi cửa sổ bị ẩn, WebView báo cho trang là "đang ẩn" và trình phát video của WebView tự dừng.
 * Khi setKeepVisible(true), WebView vẫn báo "đang hiện" nên thẻ video của website phát tiếp phần tiếng.
 * MainActivity chỉ bật chế độ này lúc ra nền, khi người dùng bật "Phát trong nền" và đang có bài.
 * (Bài phát bằng trình phát nhúng của YouTube thì website tự dừng khi ra nền - xem core/nativeApp.js.)
 */
final class KeepAliveWebView extends WebView {
    private boolean keepVisible;
    private int realVisibility = View.VISIBLE;

    KeepAliveWebView(Context context) {
        super(context);
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        realVisibility = visibility;
        super.onWindowVisibilityChanged(keepVisible ? View.VISIBLE : visibility);
    }

    void setKeepVisible(boolean keep) {
        if (keep == keepVisible) return;
        keepVisible = keep;
        // Cửa sổ đang ẩn thật: báo lại ngay cho WebView theo chế độ mới.
        if (realVisibility != View.VISIBLE) super.onWindowVisibilityChanged(keep ? View.VISIBLE : realVisibility);
    }
}
