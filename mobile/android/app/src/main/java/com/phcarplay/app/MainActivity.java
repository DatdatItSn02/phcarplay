package com.phcarplay.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.media.projection.MediaProjectionManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.os.SystemClock;
import android.speech.RecognizerIntent;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.json.JSONException;
import org.json.JSONObject;

import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.Locale;

/**
 * Vỏ ứng dụng Android: mở website PH Car Play (mobile/config/app.json) toàn màn hình trong WebView.
 * - Tự phát nhạc có tiếng ngay khi mở (không cần chạm), giữ màn hình luôn sáng, ẩn thanh trạng thái.
 * - Nút trên vô lăng / tai nghe (MediaKeys), tìm bằng giọng nói của Google (RecognizerIntent), nút Quay lại.
 * - Liên kết ra ngoài website mở bằng trình duyệt của máy; mất mạng thì hiện màn hình "Thử lại".
 * - Ra nền (giai đoạn 15): người dùng bật "Phát trong nền" và đang có bài thì trang web được giữ chạy, nhạc phát tiếp,
 *   PlaybackService hiện thông báo có nút lùi / phát-dừng / tới. Tắt "Phát trong nền" (hoặc chưa có bài) thì như trước:
 *   báo website dừng nhạc, mở lại thì phát tiếp. Đã dừng ở nền quá 30 phút thì cho trang nghỉ để đỡ tốn pin.
 * - Chiếu màn hình lên xe (giai đoạn 15 đợt 2): website gửi 'cast.start' -> hỏi quyền chụp màn hình của Android -> CastService
 *   chụp và ghi ảnh vào FrameStore -> website lấy ảnh qua địa chỉ /__cast/frame (bị chặn ở shouldInterceptRequest, không ra mạng)
 *   và gửi thẳng cho màn hình xe. Đang chiếu thì trang web luôn được giữ chạy khi ứng dụng ra nền (người dùng mở bản đồ).
 * Phần website tương ứng: public/assets/js/core/nativeApp.js (window.__phApp).
 */
public class MainActivity extends Activity implements NativeBridge.Listener, MediaKeys.Sink, PlaybackService.Controls, CastService.Events {
    private static final int REQ_VOICE = 41;
    private static final int REQ_NOTIFICATIONS = 42;
    private static final int REQ_CAST = 43;
    private static final long EXIT_WINDOW_MS = 2000;
    private static final long IDLE_STOP_MS = 30L * 60 * 1000;
    private static final String PREFS = "app";
    private static final String PREF_ASKED_NOTIFICATIONS = "asked_notifications";
    private static final String JS_BACK =
            "(function(){try{var a=window.__phApp;return !!(a&&a.back());}catch(e){return false;}})()";

    private final Handler main = new Handler(Looper.getMainLooper());
    private AppConfig config;
    private FrameLayout root;
    private KeepAliveWebView web;
    private StatusScreen status;
    private MediaKeys keys;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private ConnectivityManager.NetworkCallback netCallback;
    private int voiceId;
    private long lastBackAt;
    private boolean mainFrameError;
    private String failedUrl;
    // ----- phát trong nền (giai đoạn 15) -----
    private boolean backgroundEnabled;   // website báo: người dùng đang bật "Phát trong nền"
    private boolean playing;             // website báo: đang phát
    private boolean hasTrack;            // website báo: đang có bài (có tên bài)
    private String trackTitle = "";
    private String trackArtist = "";
    private boolean stopped;             // màn hình ứng dụng không còn hiện
    private boolean keptAlive;           // đang ở nền nhưng trang web vẫn chạy
    private boolean serviceOn;
    private boolean resumeOnStart;
    private final Runnable idleStop = this::suspendInBackground;
    // ----- chiếu màn hình lên xe (giai đoạn 15 đợt 2) -----
    private boolean casting;             // CastService đang chụp màn hình
    private boolean castAsking;          // hộp hỏi quyền chụp màn hình của Android đang mở
    private int castMaxSide = 1280;
    private int castQuality = 70;
    private int castFps = 12;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        config = AppConfig.load();

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);   // màn hình luôn sáng khi đang mở ứng dụng
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }

        root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.app_background));
        setContentView(root);
        // Chừa chỗ cho tai thỏ, thanh hệ thống (khi đang hiện) và bàn phím ảo.
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets i = insets.getInsets(WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            v.setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        hideSystemBars();

        status = new StatusScreen(this);
        keys = new MediaKeys(this, this);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }

        if (!config.isValid()) {
            root.addView(status.root, matchParent());
            status.show(getString(R.string.config_title), getString(R.string.config_message, BuildConfig.WEB_URL), "", null, null);
            return;
        }
        web = createWebView();
        root.addView(web, matchParent());
        root.addView(status.root, matchParent());
        watchNetwork();
        web.loadUrl(config.webUrl);
    }

    private static FrameLayout.LayoutParams matchParent() {
        return new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private KeepAliveWebView createWebView() {
        KeepAliveWebView w = new KeepAliveWebView(this);
        w.setBackgroundColor(getColor(R.color.app_background));
        w.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                    // website lưu cài đặt, playlist của khách
        s.setMediaPlaybackRequiresUserGesture(false);    // tự phát có tiếng, không cần chạm
        s.setTextZoom(100);                              // website có cỡ chữ riêng trong Cài đặt
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSupportMultipleWindows(true);               // liên kết mở cửa sổ mới -> trình duyệt của máy (onCreateWindow)
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " PHCarPlayApp/" + BuildConfig.VERSION_NAME + " (Android)");

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);                   // giữ đăng nhập (cookie 30 ngày của website)
        cookies.setAcceptThirdPartyCookies(w, true);     // trình phát YouTube nhúng
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);   // bản debug: xem lỗi bằng chrome://inspect trên máy tính

        new NativeBridge(config, this).attach(w);
        w.setWebViewClient(new Client());
        w.setWebChromeClient(new Chrome());
        return w;
    }

    // ------------------------------------------------------------------ trang web

    private final class Client extends WebViewClient {
        /**
         * Giai đoạn 15 (đợt 2): website hỏi ảnh màn hình mới nhất ở địa chỉ /__cast/frame của chính nó; trả thẳng từ bộ nhớ
         * (FrameStore), không ra mạng. Hàm này chạy trên luồng riêng của WebView nên không được đụng tới giao diện.
         */
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (u != null && FrameStore.PATH.equals(u.getPath()) && config.isOwn(u)) {
                return FrameStore.respond(u.getQueryParameter("since"));
            }
            return null;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;   // khung con (trình phát YouTube) tự xử lý
            Uri u = request.getUrl();
            if (isWeb(u) && config.isOwn(u)) return false;
            openExternal(u);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            mainFrameError = false;
            // Trang được tải lại: phiên chiếu của trang cũ đã mất, đừng chụp màn hình tiếp cho không ai nhận.
            if (casting || castAsking) onCastStop();
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (!mainFrameError) {
                failedUrl = null;
                status.hide();
            }
            CookieManager.getInstance().flush();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            mainFrameError = true;
            failedUrl = request.getUrl().toString();
            CharSequence d = error.getDescription();
            showOffline((d == null ? "" : d.toString()) + " (" + error.getErrorCode() + ")");
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // Bộ hiển thị web bị tắt (máy thiếu bộ nhớ): bỏ WebView này và dựng lại màn hình thay vì để ứng dụng bị đóng.
            if (view == web) {
                root.removeView(web);
                web.destroy();
                web = null;
                main.post(MainActivity.this::recreate);
            }
            return true;
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            // Video toàn màn hình (nút toàn màn hình của website hoặc của trình phát YouTube).
            if (customView != null) {
                callback.onCustomViewHidden();
                return;
            }
            customView = view;
            customCallback = callback;
            root.addView(view, matchParent());
            if (web != null) web.setVisibility(View.INVISIBLE);
        }

        @Override
        public void onHideCustomView() {
            exitFullscreen();
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            if (!isUserGesture) return false;   // chặn cửa sổ bật lên tự động
            WebView popup = new WebView(MainActivity.this);
            popup.setWebViewClient(new PopupCatcher());
            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(popup);
            resultMsg.sendToTarget();
            return true;
        }

        @Override
        public Bitmap getDefaultVideoPoster() {
            // Không hiện hình nút phát màu xám mặc định của WebView khi video chưa có hình.
            return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
        }
    }

    /** WebView tạm cho liên kết target=_blank / window.open: lấy địa chỉ rồi mở bằng trình duyệt của máy. */
    private final class PopupCatcher extends WebViewClient {
        private boolean done;

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!done) {
                done = true;
                Uri u = request.getUrl();
                if (isWeb(u) && config.isOwn(u) && web != null) web.loadUrl(u.toString());
                else openExternal(u);
                main.post(view::destroy);
            }
            return true;
        }
    }

    private boolean exitFullscreen() {
        if (customView == null) return false;
        root.removeView(customView);
        customView = null;
        if (web != null) web.setVisibility(View.VISIBLE);
        WebChromeClient.CustomViewCallback cb = customCallback;
        customCallback = null;
        if (cb != null) cb.onCustomViewHidden();
        hideSystemBars();
        return true;
    }

    private static boolean isWeb(Uri u) {
        String s = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
        return "http".equals(s) || "https".equals(s);
    }

    private void openExternal(Uri u) {
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
        try {
            Intent i;
            if ("intent".equals(scheme)) {
                i = Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME);
                i.setComponent(null);   // không cho trang web mở thẳng một màn hình bất kỳ của ứng dụng khác
                i.setSelector(null);
            } else if (isWeb(u) || "mailto".equals(scheme) || "tel".equals(scheme) || "sms".equals(scheme)
                    || "geo".equals(scheme) || "market".equals(scheme)) {
                i = new Intent(Intent.ACTION_VIEW, u);
            } else {
                return;   // file:, content:, javascript:... thì bỏ qua
            }
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (URISyntaxException | ActivityNotFoundException | SecurityException e) {
            Toast.makeText(this, R.string.cannot_open_link, Toast.LENGTH_SHORT).show();
        }
    }

    // ------------------------------------------------------------------ mất mạng

    private void showOffline(String detail) {
        status.show(getString(R.string.offline_title), getString(R.string.offline_message), detail,
                getString(R.string.retry), v -> retry());
    }

    private void retry() {
        if (web == null) return;
        web.loadUrl(failedUrl != null ? failedUrl : config.webUrl);
    }

    private void watchNetwork() {
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        if (cm == null) return;
        ConnectivityManager.NetworkCallback cb = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                main.post(() -> {
                    if (web != null && status.isShowing() && failedUrl != null) retry();
                });
            }
        };
        try {
            cm.registerDefaultNetworkCallback(cb);
            netCallback = cb;
        } catch (RuntimeException ignored) {
            // máy không cho theo dõi mạng: vẫn còn nút Thử lại
        }
    }

    // ------------------------------------------------------------------ gọi vào website

    /** Gọi window.__phApp.fn(arg) ở khung chính; arg là một giá trị JSON (chuỗi đã đặt trong ngoặc kép, số, đối tượng). */
    private void callWeb(String fn, String argJson) {
        if (web == null) return;
        web.evaluateJavascript("(function(){try{var a=window.__phApp;if(a&&typeof a." + fn + "==='function')a."
                + fn + "(" + argJson + ");}catch(e){}})()", null);
    }

    // ------------------------------------------------------------------ nút Quay lại

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        handleBack();   // Android 12 trở xuống; Android 13+ đi qua OnBackInvokedCallback đăng ký trong onCreate
    }

    /** Thoát toàn màn hình -> hỏi website (đóng hộp thoại, về Trang chủ...) -> trang trước -> bấm 2 lần để thoát. */
    private void handleBack() {
        if (exitFullscreen()) return;
        if (web == null || status.isShowing()) {
            confirmExit();
            return;
        }
        web.evaluateJavascript(JS_BACK, value -> {
            if ("true".equals(value)) return;
            if (web != null && web.canGoBack()) {
                web.goBack();
                return;
            }
            confirmExit();
        });
    }

    private void confirmExit() {
        long now = SystemClock.elapsedRealtime();
        if (now - lastBackAt < EXIT_WINDOW_MS) {
            finish();
            return;
        }
        lastBackAt = now;
        Toast.makeText(this, R.string.press_back_again, Toast.LENGTH_SHORT).show();
    }

    // ------------------------------------------------------------------ phím nhạc

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        String name = MediaKeys.keyName(event.getKeyCode());
        if (name != null && web != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) onMediaKey(name);
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onMediaKey(String name) {
        callWeb("mediaKey", JSONObject.quote(name));
    }

    @Override
    public void onPlaybackState(boolean isPlaying, String title, String artist, long durationMs, long positionMs) {
        keys.update(isPlaying, title, artist, durationMs, positionMs);
        playing = isPlaying;
        trackTitle = title;
        trackArtist = artist;
        hasTrack = !title.isEmpty();
        if (keptAlive) {
            main.removeCallbacks(idleStop);
            if (!playing && !casting) main.postDelayed(idleStop, IDLE_STOP_MS);
        }
        syncService();
        if (playing && backgroundEnabled && !stopped) askNotificationPermissionOnce();
    }

    // ------------------------------------------------------------------ phát trong nền

    @Override
    public void onBackgroundMode(boolean enabled) {
        backgroundEnabled = enabled;
        if (!enabled && keptAlive && !casting) suspendInBackground();   // tắt ngay lúc đang ở nền (hiếm): cho trang nghỉ
        else syncService();
    }

    /** Dịch vụ nền + thông báo chạy khi: bật "Phát trong nền", đang có bài, và ứng dụng đang hiện hoặc đang được giữ chạy ở nền. */
    private void syncService() {
        boolean want = backgroundEnabled && hasTrack && web != null && (!stopped || keptAlive);
        if (want) {
            serviceOn = PlaybackService.show(this, keys.token(), this, playing, trackTitle, trackArtist);
        } else if (serviceOn || PlaybackService.isRunning()) {
            PlaybackService.hide(this);
            serviceOn = false;
        }
    }

    /** Đang ở nền mà không cần giữ trang chạy nữa (dừng quá lâu, hoặc vừa tắt "Phát trong nền"). */
    private void suspendInBackground() {
        main.removeCallbacks(idleStop);
        if (!keptAlive || casting) return;   // đang chiếu màn hình thì trang web phải chạy tiếp
        keptAlive = false;
        if (web != null) {
            if (playing) callWeb("mediaKey", "\"pause\"");
            web.setKeepVisible(false);
            web.onPause();
        }
        keys.setActive(false);
        syncService();
    }

    // ------------------------------------------------------------------ chiếu màn hình lên xe

    @Override
    public void onCastStart(int maxSide, int quality, int fps) {
        castMaxSide = maxSide;
        castQuality = quality;
        castFps = fps;
        if (castAsking) return;
        if (casting) {   // website bắt đầu lại từ đầu: bỏ lần chụp cũ, hỏi quyền lại
            casting = false;
            CastService.stop(this);
        }
        MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        if (mpm == null) {
            castEvent("error", jsonMessage(getString(R.string.cast_error_start)));
            return;
        }
        askNotificationPermissionOnce();   // để thấy thông báo "Đang chiếu" có nút Dừng
        try {
            castAsking = true;
            startActivityForResult(mpm.createScreenCaptureIntent(), REQ_CAST);
        } catch (RuntimeException e) {
            castAsking = false;
            castEvent("error", jsonMessage(getString(R.string.cast_error_start)));
        }
    }

    @Override
    public void onCastStop() {
        if (castAsking) {
            castAsking = false;
            finishActivity(REQ_CAST);
        }
        casting = false;
        CastService.stop(this);
        afterCastEnded();
    }

    @Override
    public void onCastStarted(int width, int height) {
        casting = true;
        castEvent("started", "{\"width\":" + width + ",\"height\":" + height + "}");
    }

    @Override
    public void onCastFrame() {
        castEvent("frame", "{}");
    }

    @Override
    public void onCastStopped() {
        casting = false;
        castEvent("stopped", "{}");
        afterCastEnded();
    }

    @Override
    public void onCastError(String message) {
        casting = false;
        castEvent("error", jsonMessage(message));
        afterCastEnded();
    }

    private void castEvent(String name, String dataJson) {
        callWeb("cast", "\"" + name + "\"," + dataJson);
    }

    private static String jsonMessage(String message) {
        try {
            return new JSONObject().put("message", message).toString();
        } catch (JSONException e) {
            return "{}";
        }
    }

    /** Hết chiếu lúc ứng dụng đang ở nền: nếu không còn lý do giữ trang chạy (không phát nhạc nền) thì cho trang nghỉ. */
    private void afterCastEnded() {
        if (stopped && keptAlive && !(backgroundEnabled && hasTrack && serviceOn)) suspendInBackground();
    }

    /** Android 13+: thông báo có nút điều khiển cần quyền hiện thông báo. Chỉ hỏi một lần, lúc bắt đầu phát bài đầu tiên. */
    private void askNotificationPermissionOnce() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (prefs.getBoolean(PREF_ASKED_NOTIFICATIONS, false)) return;
        prefs.edit().putBoolean(PREF_ASKED_NOTIFICATIONS, true).apply();
        try {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQ_NOTIFICATIONS);
        } catch (RuntimeException ignored) {
            // không hỏi được: nhạc vẫn phát ở nền, chỉ thiếu thông báo
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIFICATIONS) syncService();   // vừa được cấp quyền: hiện lại thông báo
    }

    // ------------------------------------------------------------------ tìm bằng giọng nói

    @Override
    public void onVoiceStart(int id, String lang) {
        if (voiceId != 0) {
            finishActivity(REQ_VOICE);
            sendVoice(voiceId, "error", "", "aborted");
            voiceId = 0;
        }
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
        i.putExtra(RecognizerIntent.EXTRA_PROMPT, getString(R.string.voice_prompt));
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        try {
            startActivityForResult(i, REQ_VOICE);
            voiceId = id;
        } catch (ActivityNotFoundException | SecurityException e) {
            sendVoice(id, "error", "", "not-available");   // máy không có dịch vụ nhận giọng nói (thường là thiếu ứng dụng Google)
        }
    }

    @Override
    public void onVoiceStop(int id) {
        if (voiceId == 0 || id != voiceId) return;
        voiceId = 0;
        finishActivity(REQ_VOICE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_CAST) {
            if (!castAsking) return;   // website đã hủy trong lúc hộp hỏi còn mở
            castAsking = false;
            if (resultCode != RESULT_OK || data == null) {
                castEvent("denied", "{}");
            } else if (!CastService.start(this, resultCode, data, castMaxSide, castQuality, castFps, this)) {
                castEvent("error", jsonMessage(getString(R.string.cast_error_start)));
            }
            return;
        }
        if (requestCode != REQ_VOICE) return;
        int id = voiceId;
        voiceId = 0;
        if (id == 0) return;   // website đã hủy lần nghe này
        if (resultCode == RESULT_OK) {
            ArrayList<String> list = data == null ? null : data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            String text = list != null && !list.isEmpty() && list.get(0) != null ? list.get(0).trim() : "";
            if (text.isEmpty()) sendVoice(id, "error", "", "no-speech");
            else sendVoice(id, "result", text, "");
            return;
        }
        sendVoice(id, "error", "", voiceError(resultCode));
    }

    private static String voiceError(int resultCode) {
        switch (resultCode) {
            case RESULT_CANCELED:
                return "aborted";
            case RecognizerIntent.RESULT_NO_MATCH:
                return "no-speech";
            case RecognizerIntent.RESULT_NETWORK_ERROR:
            case RecognizerIntent.RESULT_SERVER_ERROR:
                return "network";
            case RecognizerIntent.RESULT_AUDIO_ERROR:
                return "audio-capture";
            default:
                return "other";
        }
    }

    private void sendVoice(int id, String kind, String text, String code) {
        JSONObject o = new JSONObject();
        try {
            o.put("id", id);
            o.put("kind", kind);
            o.put("text", text);
            o.put("code", code);
        } catch (JSONException ignored) {
            return;
        }
        callWeb("voice", o.toString());
    }

    // ------------------------------------------------------------------ vòng đời

    @Override
    protected void onStart() {
        super.onStart();
        stopped = false;
        main.removeCallbacks(idleStop);
        hideSystemBars();
        keys.setActive(true);
        if (web != null) {
            if (keptAlive) {
                keptAlive = false;
                web.setKeepVisible(false);
            }
            web.onResume();
            callWeb("lifecycle", "\"visible\"");
            if (resumeOnStart) main.postDelayed(() -> callWeb("mediaKey", "\"play\""), 300);
        }
        resumeOnStart = false;
        syncService();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!serviceOn) syncService();   // lần thử ở onStart có thể bị Android từ chối vì ứng dụng chưa kịp lên trước
    }

    @Override
    protected void onStop() {
        stopped = true;
        if (web != null) {
            callWeb("lifecycle", "\"hidden\"");   // website tự quyết: phát tiếp (phát trong nền) hay dừng
            if (casting || (backgroundEnabled && hasTrack && serviceOn)) {
                // Phát trong nền hoặc đang chiếu màn hình: giữ trang chạy, giữ nút vô lăng.
                // Không chiếu mà đang dừng sẵn thì sau 30 phút cho trang nghỉ.
                keptAlive = true;
                web.setKeepVisible(true);
                if (!playing && !casting) main.postDelayed(idleStop, IDLE_STOP_MS);
            } else {
                // Website tưởng được phát tiếp nhưng dịch vụ nền không chạy được: dừng, mở lại thì phát tiếp.
                resumeOnStart = backgroundEnabled && playing;
                web.onPause();
                keys.setActive(false);
            }
        } else {
            keys.setActive(false);
        }
        syncService();
        CookieManager.getInstance().flush();
        super.onStop();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    protected void onDestroy() {
        if (netCallback != null) {
            ConnectivityManager cm = getSystemService(ConnectivityManager.class);
            try {
                if (cm != null) cm.unregisterNetworkCallback(netCallback);
            } catch (RuntimeException ignored) {
                // đã gỡ
            }
            netCallback = null;
        }
        main.removeCallbacks(idleStop);
        CastService.detach(this);
        CastService.stop(this);
        PlaybackService.hide(this);
        serviceOn = false;
        keys.release();
        if (web != null) {
            root.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /** Ẩn thanh trạng thái và thanh điều hướng; vuốt từ mép màn hình để hiện tạm. */
    private void hideSystemBars() {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        c.hide(WindowInsetsCompat.Type.systemBars());
    }
}
