package com.phcarplay.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.media.session.MediaSession;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Giai đoạn 15: dịch vụ chạy nền để nghe nhạc khi ứng dụng không còn ở trước mặt (mở ứng dụng khác, tắt màn hình).
 * Dịch vụ KHÔNG tự phát nhạc: nhạc vẫn do website trong WebView của MainActivity phát. Dịch vụ chỉ:
 *  - báo cho Android "ứng dụng đang phát nhạc" (foreground service loại mediaPlayback) để ứng dụng không bị tắt;
 *  - hiện thông báo có tên bài và 3 nút lùi / phát-dừng / tới (bấm nút -> MainActivity -> website);
 *  - giữ máy và Wi-Fi thức trong lúc đang phát để tự chuyển được sang bài kế khi màn hình tắt.
 * MainActivity gọi show(...) mỗi khi website báo trạng thái phát và hide(...) khi không cần nữa.
 * Mọi hàm đều chạy trên luồng giao diện.
 */
public final class PlaybackService extends Service {
    interface Controls {
        void onMediaKey(String name);
    }

    private static final String ACTION_KEY = "com.phcarplay.app.action.MEDIA_KEY";
    private static final String EXTRA_KEY = "key";
    private static final String CHANNEL = "playback";
    private static final int NOTIFICATION_ID = 15;
    private static final long WAKE_TIMEOUT_MS = 4L * 60 * 60 * 1000;   // tự nhả sau 4 giờ nếu vì lý do nào đó không được nhả

    private static PlaybackService instance;
    private static MediaSession.Token token;
    private static Controls controls;
    private static boolean playing;
    private static String title = "";
    private static String artist = "";

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    /** Bật (hoặc cập nhật) thông báo đang phát. Trả về false nếu Android không cho khởi động dịch vụ lúc này. */
    static boolean show(Context context, MediaSession.Token sessionToken, Controls sink,
                        boolean isPlaying, String newTitle, String newArtist) {
        token = sessionToken;
        controls = sink;
        playing = isPlaying;
        title = newTitle == null ? "" : newTitle;
        artist = newArtist == null ? "" : newArtist;
        if (instance != null) {
            instance.refresh();
            return true;
        }
        Intent i = new Intent(context, PlaybackService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(i);
            else context.startService(i);
            return true;
        } catch (RuntimeException e) {
            // Android 12+: không được khởi động dịch vụ nền khi ứng dụng đang ở nền. MainActivity sẽ thử lại khi mở ứng dụng.
            return false;
        }
    }

    static void hide(Context context) {
        controls = null;
        token = null;
        playing = false;
        if (instance != null) instance.shutdown();
        else context.stopService(new Intent(context, PlaybackService.class));
    }

    static boolean isRunning() {
        return instance != null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, getString(R.string.playback_channel), NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ch.setSound(null, null);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Đã gọi startForegroundService thì phải gọi startForeground ngay, kể cả khi sắp dừng.
        boolean ok = enterForeground();
        if (!ok || token == null) {
            shutdown();   // tiến trình vừa được Android dựng lại, MainActivity không còn: không có gì để điều khiển
            return START_NOT_STICKY;
        }
        if (intent != null && ACTION_KEY.equals(intent.getAction())) {
            String key = intent.getStringExtra(EXTRA_KEY);
            Controls c = controls;
            if (c != null && key != null) c.onMediaKey(key);
        }
        updateLocks();
        return START_NOT_STICKY;
    }

    private void refresh() {
        if (!enterForeground()) return;
        updateLocks();
    }

    private boolean enterForeground() {
        try {
            Notification n = buildNotification();
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(NOTIFICATION_ID, n);
            return true;
        } catch (RuntimeException e) {
            return false;   // Android từ chối (đang ở nền, thiếu quyền...): bỏ qua, nhạc vẫn do WebView quyết định
        }
    }

    @SuppressWarnings("deprecation")
    private Notification buildNotification() {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        b.setSmallIcon(R.drawable.ic_stat_music)
                .setContentTitle(title.isEmpty() ? getString(R.string.app_name) : title)
                .setContentText(artist)
                .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .setOngoing(playing)
                .setShowWhen(false)
                .setOnlyAlertOnce(true)
                .addAction(action(R.drawable.ic_media_prev, R.string.media_prev, "prev", 1))
                .addAction(playing
                        ? action(R.drawable.ic_media_pause, R.string.media_pause, "pause", 2)
                        : action(R.drawable.ic_media_play, R.string.media_play, "play", 3))
                .addAction(action(R.drawable.ic_media_next, R.string.media_next, "next", 4));
        Notification.MediaStyle style = new Notification.MediaStyle().setShowActionsInCompactView(0, 1, 2);
        if (token != null) style.setMediaSession(token);
        b.setStyle(style);
        return b.build();
    }

    private Notification.Action action(int iconRes, int labelRes, String key, int requestCode) {
        Intent i = new Intent(this, PlaybackService.class).setAction(ACTION_KEY).putExtra(EXTRA_KEY, key);
        PendingIntent pi = PendingIntent.getService(this, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Action.Builder(Icon.createWithResource(this, iconRes), getString(labelRes), pi).build();
    }

    /** Đang phát thì giữ máy và Wi-Fi thức (màn hình tắt vẫn tải được bài kế); dừng thì nhả để đỡ tốn pin. */
    @SuppressWarnings("deprecation")
    private void updateLocks() {
        try {
            if (playing) {
                if (wakeLock == null) {
                    PowerManager pm = getSystemService(PowerManager.class);
                    if (pm != null) {
                        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PHCarPlay:playback");
                        wakeLock.setReferenceCounted(false);
                    }
                }
                if (wakeLock != null) wakeLock.acquire(WAKE_TIMEOUT_MS);
                if (wifiLock == null) {
                    WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                    if (wm != null) {
                        wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "PHCarPlay:playback");
                        wifiLock.setReferenceCounted(false);
                    }
                }
                if (wifiLock != null && !wifiLock.isHeld()) wifiLock.acquire();
            } else {
                releaseLocks();
            }
        } catch (RuntimeException ignored) {
            // máy không cho giữ thức: nhạc vẫn phát khi màn hình sáng
        }
    }

    private void releaseLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (RuntimeException ignored) {
            // đã nhả
        }
    }

    private void shutdown() {
        releaseLocks();
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Người dùng vuốt bỏ ứng dụng khỏi danh sách gần đây: tắt nhạc và thông báo.
        Controls c = controls;
        if (c != null) c.onMediaKey("pause");
        shutdown();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        releaseLocks();
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
