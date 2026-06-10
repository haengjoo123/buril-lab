package com.burillab.app;

import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final long EXIT_CONFIRMATION_WINDOW_MS = 2000;
    private boolean waitingForExitConfirmation = false;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable resetExitConfirmation = () -> waitingForExitConfirmation = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getOnBackPressedDispatcher()
            .addCallback(
                this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        handleBackPress();
                    }
                }
            );
    }

    private void handleBackPress() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;

        if (webView == null) {
            finish();
            return;
        }

        String url = webView.getUrl();
        String path = getPath(url);

        if (isLoginPath(path)) {
            waitingForExitConfirmation = false;
            handler.removeCallbacks(resetExitConfirmation);
            if (webView.canGoBack()) {
                webView.goBack();
            } else {
                webView.loadUrl(getAppHomeUrl(url));
            }
            return;
        }

        if (isAppRootPath(path)) {
            confirmExit();
            return;
        }

        waitingForExitConfirmation = false;
        handler.removeCallbacks(resetExitConfirmation);

        if (webView.canGoBack()) {
            webView.goBack();
            return;
        }

        webView.loadUrl(getAppHomeUrl(url));
    }

    private void confirmExit() {
        if (waitingForExitConfirmation) {
            finish();
            return;
        }

        waitingForExitConfirmation = true;
        Toast.makeText(this, "뒤로 버튼을 한번 더 누르시면 종료됩니다.", Toast.LENGTH_SHORT).show();
        handler.removeCallbacks(resetExitConfirmation);
        handler.postDelayed(resetExitConfirmation, EXIT_CONFIRMATION_WINDOW_MS);
    }

    private String getPath(String url) {
        if (url == null || url.isEmpty()) {
            return "/";
        }

        String path = Uri.parse(url).getPath();
        return path == null || path.isEmpty() ? "/" : path;
    }

    private boolean isLoginPath(String path) {
        return "/login".equals(path);
    }

    private boolean isAppRootPath(String path) {
        return "/app".equals(path) || "/app/".equals(path) || "/".equals(path);
    }

    private String getAppHomeUrl(String currentUrl) {
        String fallback = "https://app.buril-lab.local/app";

        if (currentUrl == null || currentUrl.isEmpty()) {
            return fallback;
        }

        Uri uri = Uri.parse(currentUrl);
        String scheme = uri.getScheme() != null ? uri.getScheme() : "https";
        String authority = uri.getAuthority();

        if (authority == null || authority.isEmpty()) {
            return fallback;
        }

        return scheme + "://" + authority + "/app";
    }
}
