package com.phcarplay.app;

import android.content.Context;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.SystemClock;
import android.view.KeyEvent;

/**
 * Nút trên vô lăng, tai nghe Bluetooth, bàn phím: Android gửi tới MediaSession của ứng dụng đang phát nhạc.
 * Đổi thành tên phím gửi cho website: 'play' | 'pause' | 'toggle' | 'next' | 'prev' | 'forward' | 'rewind'.
 * Tên bài/kênh do website báo được đưa lên MediaSession, nên màn hình xe nối Bluetooth hiện được tên bài.
 * Hoạt động khi ứng dụng đang mở, và cả khi ở nền nếu đang "Phát trong nền" (giai đoạn 15: PlaybackService dùng
 * chung MediaSession này cho thông báo có nút điều khiển).
 */
final class MediaKeys {
    interface Sink {
        void onMediaKey(String name);
    }

    private static final long ACTIONS = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
            | PlaybackState.ACTION_STOP | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS
            | PlaybackState.ACTION_FAST_FORWARD | PlaybackState.ACTION_REWIND;

    private final MediaSession session;
    private String title = "";
    private String artist = "";
    private long durationMs = -1;

    @SuppressWarnings("deprecation")
    MediaKeys(Context context, final Sink sink) {
        session = new MediaSession(context, "PHCarPlay");
        // Android 7 cần cờ này mới nhận nút bấm (Android 8+ luôn nhận, cờ bị bỏ qua).
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                sink.onMediaKey("play");
            }

            @Override
            public void onPause() {
                sink.onMediaKey("pause");
            }

            @Override
            public void onStop() {
                sink.onMediaKey("pause");
            }

            @Override
            public void onSkipToNext() {
                sink.onMediaKey("next");
            }

            @Override
            public void onSkipToPrevious() {
                sink.onMediaKey("prev");
            }

            @Override
            public void onFastForward() {
                sink.onMediaKey("forward");
            }

            @Override
            public void onRewind() {
                sink.onMediaKey("rewind");
            }
        });
        setState(false, 0);
    }

    MediaSession.Token token() {
        return session.getSessionToken();
    }

    void setActive(boolean active) {
        try {
            session.setActive(active);
        } catch (RuntimeException ignored) {
            // phiên đã bị giải phóng
        }
    }

    /** Website báo trạng thái phát (NativeBridge 'state'). */
    void update(boolean playing, String newTitle, String newArtist, long newDurationMs, long positionMs) {
        if (!newTitle.equals(title) || !newArtist.equals(artist) || newDurationMs != durationMs) {
            title = newTitle;
            artist = newArtist;
            durationMs = newDurationMs;
            MediaMetadata.Builder b = new MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, artist);
            if (durationMs > 0) b.putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs);
            session.setMetadata(b.build());
        }
        setState(playing, positionMs);
    }

    private void setState(boolean playing, long positionMs) {
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(ACTIONS)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                        Math.max(0, positionMs), playing ? 1f : 0f, SystemClock.elapsedRealtime())
                .build());
    }

    void release() {
        setActive(false);
        session.release();
    }

    /** Phím bấm gửi thẳng vào ứng dụng đang mở (bàn phím, một số màn hình xe). null nếu không phải phím nhạc. */
    static String keyName(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                return "play";
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_STOP:
                return "pause";
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_HEADSETHOOK:
                return "toggle";
            case KeyEvent.KEYCODE_MEDIA_NEXT:
                return "next";
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                return "prev";
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                return "forward";
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                return "rewind";
            default:
                return null;
        }
    }
}
