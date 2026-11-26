package com.phcarplay.app;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.drawable.Icon;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.Display;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * Giai đoạn 15 (đợt 2): chụp màn hình điện thoại để chiếu lên màn hình xe.
 * Android chỉ cho chụp màn hình khi (1) người dùng vừa bấm đồng ý ở hộp hỏi của hệ thống và (2) có dịch vụ nền loại
 * "mediaProjection" đang chạy kèm thông báo. Dịch vụ này:
 *  - chụp màn hình vài lần mỗi giây (thu nhỏ để cạnh dài không quá maxSide), nén JPEG, ghi vào FrameStore;
 *  - KHÔNG gửi gì ra mạng: trang web trong MainActivity lấy ảnh từ FrameStore và gửi thẳng cho màn hình xe (WebRTC);
 *  - hiện thông báo "Đang chiếu màn hình lên xe" có nút "Dừng chiếu";
 *  - tự theo dõi xoay màn hình; hệ thống thu hồi quyền chụp thì báo MainActivity.
 * Các hàm tĩnh và các sự kiện Events đều chạy trên luồng giao diện; việc chụp và nén chạy trên luồng riêng.
 */
public final class CastService extends Service {
    interface Events {
        void onCastStarted(int width, int height);

        void onCastFrame();

        void onCastStopped();

        void onCastError(String message);
    }

    private static final String ACTION_STOP = "com.phcarplay.app.action.CAST_STOP";
    private static final String EXTRA_RESULT_CODE = "resultCode";
    private static final String EXTRA_RESULT_DATA = "resultData";
    private static final String EXTRA_MAX_SIDE = "maxSide";
    private static final String EXTRA_QUALITY = "quality";
    private static final String EXTRA_FPS = "fps";
    private static final String CHANNEL = "cast";
    private static final int NOTIFICATION_ID = 16;

    private static CastService instance;
    private static volatile Events events;

    private final Handler main = new Handler(Looper.getMainLooper());
    private HandlerThread thread;
    private Handler worker;
    private volatile MediaProjection projection;
    private volatile VirtualDisplay display;
    private volatile ImageReader reader;
    private Bitmap bitmap;
    private ByteBuffer scratch;
    private final ByteArrayOutputStream jpegOut = new ByteArrayOutputStream(256 * 1024);
    private int maxSide = 1280;
    private int quality = 70;
    private long intervalMs = 83;
    private int capWidth;
    private int capHeight;
    private volatile boolean capturing;
    private volatile boolean framePosted;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (!capturing) return;
            grab();
            worker.postDelayed(this, intervalMs);
        }
    };
    private final Runnable notifyFrame = () -> {
        framePosted = false;
        Events e = events;
        if (e != null && capturing) e.onCastFrame();
    };
    private final MediaProjection.Callback projectionCallback = new MediaProjection.Callback() {
        @Override
        public void onStop() {
            main.post(() -> finish(true));   // hệ thống hoặc người dùng thu hồi quyền chụp
        }
    };
    private final DisplayManager.DisplayListener displayListener = new DisplayManager.DisplayListener() {
        @Override
        public void onDisplayAdded(int displayId) {
        }

        @Override
        public void onDisplayRemoved(int displayId) {
        }

        @Override
        public void onDisplayChanged(int displayId) {
            if (displayId == Display.DEFAULT_DISPLAY && worker != null) worker.post(() -> configure(false));
        }
    };

    /** Bắt đầu chụp. resultCode/data: kết quả của hộp hỏi quyền chụp màn hình (MediaProjectionManager.createScreenCaptureIntent). */
    static boolean start(Context context, int resultCode, Intent data, int maxSide, int quality, int fps, Events sink) {
        events = sink;
        Intent i = new Intent(context, CastService.class)
                .putExtra(EXTRA_RESULT_CODE, resultCode)
                .putExtra(EXTRA_RESULT_DATA, data)
                .putExtra(EXTRA_MAX_SIDE, maxSide)
                .putExtra(EXTRA_QUALITY, quality)
                .putExtra(EXTRA_FPS, fps);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(i);
            else context.startService(i);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** Dừng chụp theo yêu cầu của trang web (không báo lại onCastStopped). */
    static void stop(Context context) {
        if (instance != null) instance.finish(false);
        else context.stopService(new Intent(context, CastService.class));
    }

    static void detach(Events sink) {
        if (events == sink) events = null;
    }

    static boolean isRunning() {
        return instance != null && instance.capturing;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, getString(R.string.cast_channel), NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ch.setSound(null, null);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Đã gọi startForegroundService thì phải gọi startForeground ngay; Android 14+ còn đòi gọi TRƯỚC khi lấy quyền chụp.
        try {
            Notification n = buildNotification();
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            else startForeground(NOTIFICATION_ID, n);
        } catch (RuntimeException e) {
            fail(getString(R.string.cast_error_start));
            return START_NOT_STICKY;
        }
        if (intent == null) {
            finish(true);   // tiến trình vừa được dựng lại: quyền chụp cũ không còn dùng được
            return START_NOT_STICKY;
        }
        if (ACTION_STOP.equals(intent.getAction())) {
            finish(true);   // nút "Dừng chiếu" trong thông báo
            return START_NOT_STICKY;
        }
        if (capturing) return START_NOT_STICKY;
        int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED);
        Intent data = Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent.class)
                : (Intent) intent.getParcelableExtra(EXTRA_RESULT_DATA);
        maxSide = clamp(intent.getIntExtra(EXTRA_MAX_SIDE, 1280), 480, 1920);
        quality = clamp(intent.getIntExtra(EXTRA_QUALITY, 70), 30, 95);
        intervalMs = 1000L / clamp(intent.getIntExtra(EXTRA_FPS, 12), 1, 30);
        MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        try {
            projection = (mpm == null || data == null) ? null : mpm.getMediaProjection(resultCode, data);
        } catch (RuntimeException e) {
            projection = null;
        }
        if (projection == null) {
            fail(getString(R.string.cast_error_start));
            return START_NOT_STICKY;
        }
        thread = new HandlerThread("phcarplay-cast");
        thread.start();
        worker = new Handler(thread.getLooper());
        projection.registerCallback(projectionCallback, main);
        capturing = true;
        FrameStore.open();
        worker.post(() -> {
            if (!configure(true)) {
                main.post(() -> fail(getString(R.string.cast_error_start)));
                return;
            }
            final int w = capWidth;
            final int h = capHeight;
            main.post(() -> {
                Events e = events;
                if (e != null && capturing) e.onCastStarted(w, h);
            });
            worker.postDelayed(tick, intervalMs);
        });
        DisplayManager dm = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
        if (dm != null) dm.registerDisplayListener(displayListener, main);
        return START_NOT_STICKY;
    }

    private static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }

    /**
     * (Luồng chụp) Tạo hoặc đổi kích thước màn hình ảo theo kích thước thật hiện tại của máy (gọi lại khi xoay màn hình).
     * Android 14+ chỉ cho tạo màn hình ảo MỘT lần cho mỗi lần xin quyền, nên khi xoay chỉ resize + đổi bề mặt nhận hình.
     */
    @SuppressWarnings("deprecation")
    private boolean configure(boolean first) {
        final MediaProjection mp = projection;
        if (!capturing || mp == null) return false;
        try {
            DisplayManager dm = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
            Display d = dm == null ? null : dm.getDisplay(Display.DEFAULT_DISPLAY);
            if (d == null) return false;
            DisplayMetrics m = new DisplayMetrics();
            d.getRealMetrics(m);
            float scale = Math.min(1f, maxSide / (float) Math.max(m.widthPixels, m.heightPixels));
            int w = Math.max(2, Math.round(m.widthPixels * scale) & ~1);
            int h = Math.max(2, Math.round(m.heightPixels * scale) & ~1);
            if (!first && w == capWidth && h == capHeight) return true;
            ImageReader next = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2);
            ImageReader old = reader;
            if (display == null) {
                display = mp.createVirtualDisplay("phcarplay-cast", w, h, m.densityDpi,
                        DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, next.getSurface(), null, worker);
            } else {
                VirtualDisplay vd = display;
                vd.resize(w, h, m.densityDpi);
                vd.setSurface(next.getSurface());
            }
            reader = next;
            capWidth = w;
            capHeight = h;
            if (old != null) old.close();
            return display != null;
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** (Luồng chụp) Lấy hình mới nhất nếu màn hình vừa đổi, nén JPEG, ghi vào FrameStore. Màn hình đứng yên thì không có hình mới. */
    private void grab() {
        ImageReader r = reader;
        if (r == null) return;
        Image img = null;
        try {
            img = r.acquireLatestImage();
            if (img == null) return;
            Image.Plane plane = img.getPlanes()[0];
            int w = img.getWidth();
            int h = img.getHeight();
            int pixelStride = plane.getPixelStride();
            int rowWidth = pixelStride > 0 ? plane.getRowStride() / pixelStride : w;   // có thể rộng hơn w vài điểm đệm
            if (rowWidth < w) rowWidth = w;
            if (bitmap == null || bitmap.getWidth() != rowWidth || bitmap.getHeight() != h) {
                if (bitmap != null) bitmap.recycle();
                bitmap = Bitmap.createBitmap(rowWidth, h, Bitmap.Config.ARGB_8888);
            }
            ByteBuffer buf = plane.getBuffer();
            int need = rowWidth * h * 4;
            if (buf.remaining() < need) {
                // một số máy trả bộ đệm thiếu phần đệm của dòng cuối: chép sang bộ đệm đủ lớn
                if (scratch == null || scratch.capacity() != need) scratch = ByteBuffer.allocate(need);
                scratch.clear();
                scratch.put(buf);
                scratch.rewind();
                buf = scratch;
            }
            bitmap.copyPixelsFromBuffer(buf);
            Bitmap out = rowWidth == w ? bitmap : Bitmap.createBitmap(bitmap, 0, 0, w, h);
            jpegOut.reset();
            out.compress(Bitmap.CompressFormat.JPEG, quality, jpegOut);
            if (out != bitmap) out.recycle();
            FrameStore.put(jpegOut.toByteArray(), w, h);
            if (!framePosted) {
                framePosted = true;
                main.post(notifyFrame);
            }
        } catch (RuntimeException | OutOfMemoryError e) {
            // bỏ hình này, lần chụp sau thử lại
        } finally {
            if (img != null) img.close();
        }
    }

    private Notification buildNotification() {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : legacyBuilder();
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        Intent stop = new Intent(this, CastService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return b.setSmallIcon(R.drawable.ic_stat_cast)
                .setContentTitle(getString(R.string.cast_title))
                .setContentText(getString(R.string.cast_text))
                .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
                .setOngoing(true)
                .setShowWhen(false)
                .setOnlyAlertOnce(true)
                .addAction(new Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_media_stop), getString(R.string.cast_stop), stopPi).build())
                .build();
    }

    @SuppressWarnings("deprecation")
    private Notification.Builder legacyBuilder() {
        return new Notification.Builder(this);
    }

    private void fail(String message) {
        Events e = events;
        finish(false);
        if (e != null) e.onCastError(message);
    }

    /** (Luồng giao diện) Ngừng chụp và tắt dịch vụ. notify = true: báo MainActivity (dừng không phải do trang web yêu cầu). */
    private void finish(boolean notify) {
        boolean was = capturing;
        capturing = false;
        FrameStore.close();
        main.removeCallbacks(notifyFrame);
        DisplayManager dm = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
        if (dm != null) dm.unregisterDisplayListener(displayListener);
        final MediaProjection p = projection;
        final VirtualDisplay d = display;
        final ImageReader r = reader;
        final HandlerThread t = thread;
        projection = null;
        display = null;
        reader = null;
        thread = null;
        Runnable release = () -> {
            try {
                if (d != null) d.release();
                if (r != null) r.close();
                if (bitmap != null) {
                    bitmap.recycle();
                    bitmap = null;
                }
                scratch = null;
            } catch (RuntimeException ignored) {
                // đã giải phóng
            }
            if (t != null) t.quitSafely();
        };
        if (worker != null) {
            worker.removeCallbacks(tick);
            worker.post(release);   // giải phóng trên luồng chụp để không đụng lúc đang nén hình
            worker = null;
        } else {
            release.run();
        }
        if (p != null) {
            try {
                p.unregisterCallback(projectionCallback);
                p.stop();
            } catch (RuntimeException ignored) {
                // đã dừng
            }
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
        Events e = events;
        if (notify && was && e != null) e.onCastStopped();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        finish(false);   // vuốt bỏ ứng dụng: ngừng chụp
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        if (capturing) finish(false);
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
