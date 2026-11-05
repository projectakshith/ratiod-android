package com.ratiod.portalprobe;

import android.animation.ValueAnimator;
import android.graphics.Color;
import android.graphics.Outline;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.view.animation.DecelerateInterpolator;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.BackEventCompat;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";

    public static final String DASHBOARD_ROUTE = "/dashboard";

    // Live route of the web app, kept in sync by PortalProbe.setRoute (JS side).
    public static volatile String currentRoute = "/";

    private static final long PREVIEW_REFRESH_DEBOUNCE_MS = 4000L;

    private static MainActivity instance;

    private WebView webView;
    private BackHandler backHandler;
    private ViewOutlineProvider originalOutlineProvider;
    private boolean originalClipToOutline;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // Hidden WebView frozen on /dashboard, revealed behind the shrinking page
    // during a predictive back gesture so the destination is actually visible.
    private WebView dashboardPreview;
    private ViewGroup webViewParent;
    private String previewBaseUrl = "https://localhost";
    private boolean previewReady = false;
    private boolean previewLoading = false;
    private boolean gestureActive = false;
    private boolean previewHadError = false;
    private int previewRetries = 0;
    private int previewGeneration = 0;
    private volatile boolean committing = false;
    private long lastPreviewRefreshAt = 0L;
    private int backdropColor = Color.parseColor("#050505");

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PortalProbePlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        super.onCreate(savedInstanceState);

        instance = this;
        webView = bridge.getWebView();
        originalOutlineProvider = webView.getOutlineProvider();
        originalClipToOutline = webView.getClipToOutline();

        backHandler = new BackHandler();
        getOnBackPressedDispatcher().addCallback(this, backHandler);
        updateBackEnabled(currentRoute);

        initDashboardPreview();
    }

    @Override
    public void onDestroy() {
        if (instance == this) {
            instance = null;
        }
        mainHandler.removeCallbacksAndMessages(null);
        if (dashboardPreview != null) {
            dashboardPreview.destroy();
            dashboardPreview = null;
        }
        super.onDestroy();
    }

    /**
     * Called by PortalProbePlugin whenever the web app reports a new route
     * (plus the resolved --theme-bg color so the back-drop matches the theme).
     * On /dashboard the callback disables itself so the system renders the
     * predictive back-to-home animation; everywhere else it handles back
     * itself with an in-app predictive animation that lands on the dashboard.
     */
    public static void notifyRouteChanged(String path, String bgColor) {
        currentRoute = path;
        MainActivity activity = instance;
        if (activity != null) {
            activity.runOnUiThread(() -> {
                activity.committing = false;
                activity.applyBackdropColor(bgColor);
                if (isDashboard(path)) {
                    // not ready yet? every dashboard arrival is a free retry
                    activity.refreshDashboardPreview(!activity.previewReady);
                }
                activity.updateBackEnabled(path);
            });
        }
    }

    private void updateBackEnabled(String path) {
        if (backHandler == null) return;
        backHandler.setRoute(path);
    }

    private static boolean isDashboard(String path) {
        if (path == null) return false;
        String normalized = path.length() > 1 && path.endsWith("/") ? path.substring(0, path.length() - 1) : path;
        return DASHBOARD_ROUTE.equals(normalized);
    }

    private void navigateToDashboard() {
        if (webView == null) return;
        // stay enabled through the commit window (guarded by `committing`) so a
        // double-back can't fall through to exit; the route report or an 8s
        // safety clears it, then the route report disables back as usual
        committing = true;
        mainHandler.postDelayed(() -> committing = false, 8000);
        webView.evaluateJavascript("window.location.assign('/dashboard')", null);
    }

    private void resetBackAnimation() {
        if (webView == null) return;
        webView.setScaleX(1f);
        webView.setScaleY(1f);
        webView.setTranslationX(0f);
        webView.setElevation(0f);
        webView.setOutlineProvider(originalOutlineProvider);
        webView.setClipToOutline(originalClipToOutline);
    }

    private float dp(float value) {
        return value * getResources().getDisplayMetrics().density;
    }

    // ---------------------------------------------------------------------
    // Dashboard preview layer
    // ---------------------------------------------------------------------

    private String resolveAppOrigin() {
        try {
            String serverUrl = bridge.getServerUrl();
            if (serverUrl != null && serverUrl.startsWith("http")) {
                return serverUrl.replaceAll("/+$", "");
            }
        } catch (Exception ignored) {
        }
        try {
            String url = webView.getUrl();
            if (url != null && url.startsWith("http")) {
                java.net.URI uri = java.net.URI.create(url);
                String origin = uri.getScheme() + "://" + uri.getHost()
                        + (uri.getPort() > 0 ? ":" + uri.getPort() : "");
                return origin;
            }
        } catch (Exception ignored) {
        }
        return "https://localhost";
    }

    private void initDashboardPreview() {
        webViewParent = (ViewGroup) webView.getParent();
        if (webViewParent == null) return;

        previewBaseUrl = resolveAppOrigin();

        dashboardPreview = new WebView(this);
        WebSettings s = dashboardPreview.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setTextZoom(webView.getSettings().getTextZoom());
        s.setUseWideViewPort(webView.getSettings().getUseWideViewPort());
        s.setLoadWithOverviewMode(webView.getSettings().getLoadWithOverviewMode());
        dashboardPreview.setBackgroundColor(backdropColor);
        // stays VISIBLE permanently, sitting behind the opaque main web view —
        // INVISIBLE webviews never composite a frame, so the first reveal
        // mid-gesture would show a flat background instead of the dashboard
        dashboardPreview.setFocusable(false);
        dashboardPreview.setClickable(false);
        dashboardPreview.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        dashboardPreview.setOverScrollMode(View.OVER_SCROLL_NEVER);
        dashboardPreview.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                // the preview has no Capacitor bridge — route its requests through
                // Capacitor's local asset server so https://localhost resolves here too
                WebResourceResponse local = bridge.getLocalServer().shouldInterceptRequest(request);
                return local != null ? local : super.shouldInterceptRequest(view, request);
            }

            @Override
            public void onReceivedError(WebView view, android.webkit.WebResourceRequest request, android.webkit.WebResourceError error) {
                super.onReceivedError(view, request, error);
                // net-error pages still fire onPageFinished — never trust them as a valid frame
                if (request.isForMainFrame()) {
                    previewHadError = true;
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // let the SPA hydrate from the shared localStorage cache before freezing the frame
                mainHandler.postDelayed(() -> {
                    if (dashboardPreview == null) return;
                    if (previewHadError) {
                        // failed load (often the cold-start race with the local asset server) — retry a few times
                        previewLoading = false;
                        previewReady = false;
                        if (previewRetries < 3 && !gestureActive) {
                            previewRetries++;
                            mainHandler.postDelayed(() -> refreshDashboardPreview(true), 1500);
                        }
                        return;
                    }
                    previewRetries = 0;
                    previewLoading = false;
                    previewReady = true;
                    if (!gestureActive) {
                        dashboardPreview.onPause();
                    }
                }, 1200);
            }
        });
        webViewParent.addView(dashboardPreview, 0,
                new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webViewParent.setBackgroundColor(backdropColor);

        refreshDashboardPreview();
    }

    private void refreshDashboardPreview() {
        refreshDashboardPreview(false);
    }

    private void refreshDashboardPreview(boolean force) {
        if (dashboardPreview == null || gestureActive || previewLoading) return;
        long now = SystemClock.uptimeMillis();
        if (!force && now - lastPreviewRefreshAt < PREVIEW_REFRESH_DEBOUNCE_MS) return;
        lastPreviewRefreshAt = now;
        previewReady = false;
        previewLoading = true;
        final int gen = ++previewGeneration;
        dashboardPreview.onResume();
        dashboardPreview.loadUrl(previewBaseUrl + DASHBOARD_ROUTE);
        Log.d(TAG, "preview refresh -> " + previewBaseUrl + DASHBOARD_ROUTE);
        // watchdog: if onPageFinished never arrives (stuck load), unstick and retry
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (gen != previewGeneration || !previewLoading || dashboardPreview == null) return;
                if (gestureActive) {
                    // mid-gesture — re-check shortly instead of dropping the retry
                    mainHandler.postDelayed(this, 2000);
                    return;
                }
                Log.d(TAG, "preview watchdog: load stuck, retrying");
                previewLoading = false;
                previewRetries++;
                if (previewRetries <= 5) {
                    mainHandler.postDelayed(() -> refreshDashboardPreview(true), 800);
                }
            }
        }, 6000);
    }

    private void showDashboardPreview() {
        if (dashboardPreview == null || !previewReady || previewLoading) return;
        // frame is already composited (view is always visible, just paused) — resume processing
        dashboardPreview.onResume();
    }

    private void hideDashboardPreview() {
        if (dashboardPreview != null && !previewLoading) {
            dashboardPreview.onPause();
        }
        gestureActive = false;
    }

    private void applyBackdropColor(String cssColor) {
        if (cssColor == null || cssColor.isEmpty()) return;
        try {
            int color = Color.parseColor(cssColor);
            if (color != backdropColor) {
                backdropColor = color;
                if (webViewParent != null) webViewParent.setBackgroundColor(color);
                if (dashboardPreview != null) dashboardPreview.setBackgroundColor(color);
                // theme changed — the frozen preview frame is from the old theme, re-render it
                lastPreviewRefreshAt = 0L;
                refreshDashboardPreview();
            }
        } catch (Exception ignored) {
            // CSS var wasn't a plain color (oklch() etc.) — keep the last one
        }
    }

    /**
     * After a committed back gesture, the main webview reloads /dashboard while
     * the preview shows behind it; once the real page is back, animate it into
     * place and tuck the preview away.
     */
    private void scheduleRestoreAfterCommit() {
        final long deadline = SystemClock.uptimeMillis() + 6000L;
        final Runnable[] poll = new Runnable[1];
        poll[0] = () -> webView.evaluateJavascript(
                "(location.pathname==='/dashboard'||location.pathname==='/dashboard/')&&document.readyState==='complete'?'1':'0'",
                value -> {
                    boolean ready = value != null && value.contains("1");
                    if (ready || SystemClock.uptimeMillis() > deadline) {
                        mainHandler.postDelayed(() -> {
                            if (backHandler != null) backHandler.settleBack(true);
                        }, 250);
                    } else {
                        mainHandler.postDelayed(poll[0], 100);
                    }
                });
        mainHandler.postDelayed(poll[0], 250);
    }

    // ---------------------------------------------------------------------
    // Predictive back gesture
    // ---------------------------------------------------------------------

    /**
     * Progress-driven predictive back: the web view shrinks toward the gesture
     * edge (Material predictive back spec) revealing the frozen dashboard
     * preview behind it, then either commits to the dashboard or springs back.
     */
    private class BackHandler extends OnBackPressedCallback {
        private static final float MIN_SCALE = 0.88f;
        private static final float MAX_RADIUS_DP = 28f;
        private static final float MAX_SHIFT_DP = 16f;

        private int edge = BackEventCompat.EDGE_LEFT;
        private float cornerRadius = 0f;
        private ValueAnimator settleAnimator;

        private final ViewOutlineProvider backOutlineProvider = new ViewOutlineProvider() {
            @Override
            public void getOutline(View view, Outline outline) {
                outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), cornerRadius);
            }
        };

        BackHandler() {
            super(true);
        }

        void setRoute(String path) {
            setEnabled(!isDashboard(path));
        }

        @Override
        public void handleOnBackStarted(@NonNull BackEventCompat backEvent) {
            if (committing) return; // navigation already in flight
            cancelSettle();
            gestureActive = true;
            edge = backEvent.getSwipeEdge();
            webView.setPivotX(edge == BackEventCompat.EDGE_LEFT ? 0f : webView.getWidth());
            webView.setPivotY(backEvent.getTouchY());
            webView.setClipToOutline(true);
            webView.setOutlineProvider(backOutlineProvider);
            webView.setElevation(dp(16f));
            showDashboardPreview();
        }

        @Override
        public void handleOnBackProgressed(@NonNull BackEventCompat backEvent) {
            float p = backEvent.getProgress();
            float eased = 1f - (1f - p) * (1f - p);
            float scale = 1f - (1f - MIN_SCALE) * eased;
            float shift = dp(MAX_SHIFT_DP) * eased;
            cornerRadius = dp(MAX_RADIUS_DP) * eased;

            webView.setScaleX(scale);
            webView.setScaleY(scale);
            webView.setTranslationX(edge == BackEventCompat.EDGE_LEFT ? -shift : shift);
            webView.invalidateOutline();
        }

        @Override
        public void handleOnBackPressed() {
            if (committing) return; // navigation already in flight
            boolean previewShown = dashboardPreview != null && dashboardPreview.getVisibility() == View.VISIBLE;
            Log.d(TAG, "back -> dashboard (preview=" + previewShown + ")");
            navigateToDashboard();
            if (previewShown) {
                // keep the scaled page in front of the preview until /dashboard is really back
                scheduleRestoreAfterCommit();
            } else {
                gestureActive = false;
                resetBackAnimation();
            }
        }

        @Override
        public void handleOnBackCancelled() {
            hideDashboardPreview();
            settleBack(false);
        }

        void settleBack(boolean commitRestore) {
            final float startScaleX = webView.getScaleX();
            final float startScaleY = webView.getScaleY();
            final float startTranslation = webView.getTranslationX();
            final float startRadius = cornerRadius;

            settleAnimator = ValueAnimator.ofFloat(0f, 1f);
            settleAnimator.setDuration(180);
            settleAnimator.setInterpolator(new DecelerateInterpolator());
            settleAnimator.addUpdateListener(animation -> {
                float t = 1f - animation.getAnimatedFraction();
                webView.setScaleX(startScaleX * t + 1f * (1f - t));
                webView.setScaleY(startScaleY * t + 1f * (1f - t));
                webView.setTranslationX(startTranslation * t);
                cornerRadius = startRadius * t;
                webView.invalidateOutline();
            });
            settleAnimator.addListener(new android.animation.AnimatorListenerAdapter() {
                @Override
                public void onAnimationEnd(android.animation.Animator animation) {
                    resetBackAnimation();
                    settleAnimator = null;
                    if (commitRestore) {
                        hideDashboardPreview();
                        refreshDashboardPreview();
                    }
                }
            });
            settleAnimator.start();
        }

        private void cancelSettle() {
            if (settleAnimator != null) {
                settleAnimator.cancel();
                settleAnimator = null;
            }
        }
    }
}
