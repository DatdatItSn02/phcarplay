package com.phcarplay.app;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/**
 * Màn hình báo lỗi phủ lên WebView: "Không kết nối được" (có nút Thử lại) và "Chưa cài địa chỉ website".
 * Chữ to, nút to để bấm được trên màn hình xe; vừa cả màn hình xe 800x480 (cuộn được nếu thiếu chỗ).
 */
final class StatusScreen {
    final FrameLayout root;
    private final TextView title;
    private final TextView message;
    private final TextView detail;
    private final Button action;

    StatusScreen(Context ctx) {
        float dp = ctx.getResources().getDisplayMetrics().density;
        root = new FrameLayout(ctx);
        root.setBackgroundColor(ctx.getColor(R.color.app_background));
        root.setClickable(true);   // không cho chạm xuyên xuống trang web bên dưới
        root.setVisibility(View.GONE);

        LinearLayout box = new LinearLayout(ctx);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        int pad = Math.round(24 * dp);
        box.setPadding(pad, pad, pad, pad);

        title = text(ctx, 24, Color.WHITE, true);
        message = text(ctx, 18, 0xFFD0D0D0, false);
        detail = text(ctx, 13, 0xFF8A8A8A, false);
        action = new Button(ctx);
        action.setAllCaps(false);
        action.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        action.setTextColor(Color.WHITE);
        action.setBackgroundTintList(ColorStateList.valueOf(ctx.getColor(R.color.brand)));
        action.setMinHeight(Math.round(56 * dp));
        action.setMinWidth(Math.round(200 * dp));

        int gap = Math.round(12 * dp);
        box.addView(title, wrap(0));
        box.addView(message, wrap(gap));
        box.addView(action, wrap(gap * 2));
        box.addView(detail, wrap(gap * 2));

        ScrollView scroll = new ScrollView(ctx);
        scroll.setFillViewport(false);
        scroll.addView(box, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(scroll, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
    }

    private static TextView text(Context ctx, int sp, int color, boolean bold) {
        TextView t = new TextView(ctx);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setGravity(Gravity.CENTER);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private static LinearLayout.LayoutParams wrap(int topMargin) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = topMargin;
        lp.gravity = Gravity.CENTER_HORIZONTAL;
        return lp;
    }

    /** actionLabel = null: không có nút. */
    void show(String titleText, String messageText, String detailText, String actionLabel, View.OnClickListener onAction) {
        title.setText(titleText);
        message.setText(messageText);
        detail.setText(detailText == null ? "" : detailText);
        detail.setVisibility(detailText == null || detailText.isEmpty() ? View.GONE : View.VISIBLE);
        if (actionLabel == null) {
            action.setVisibility(View.GONE);
            action.setOnClickListener(null);
        } else {
            action.setText(actionLabel);
            action.setOnClickListener(onAction);
            action.setVisibility(View.VISIBLE);
        }
        root.setVisibility(View.VISIBLE);
        root.bringToFront();
    }

    void hide() {
        root.setVisibility(View.GONE);
    }

    boolean isShowing() {
        return root.getVisibility() == View.VISIBLE;
    }
}
