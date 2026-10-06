package com.ratiod.portalprobe;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String TAG = "AppUpdater";
    private static final String GITHUB_REPO = "projectakshith/ratiod-android";
    private static final String RELEASES_API = "https://api.github.com/repos/" + GITHUB_REPO + "/releases/latest";

    private final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build();

    @PluginMethod
    public void checkUpdate(PluginCall call) {
        new Thread(() -> {
            try {
                Request request = new Request.Builder()
                        .url(RELEASES_API)
                        .header("User-Agent", "RatioD-Android-App")
                        .header("Accept", "application/vnd.github.v3+json")
                        .build();

                try (Response response = client.newCall(request).execute()) {
                    if (response.code() == 404) {
                        JSObject ret = new JSObject();
                        ret.put("ok", true);
                        ret.put("updateAvailable", false);
                        ret.put("message", "No published releases found yet.");
                        call.resolve(ret);
                        return;
                    }

                    if (!response.isSuccessful()) {
                        call.reject("GitHub API returned HTTP " + response.code());
                        return;
                    }

                    ResponseBody body = response.body();
                    if (body == null) {
                        call.reject("Empty response from GitHub API");
                        return;
                    }

                    JSONObject json = new JSONObject(body.string());
                    String tagName = json.optString("tag_name", "").trim();
                    String changelog = json.optString("body", "");
                    String releaseName = json.optString("name", tagName);

                    String apkUrl = null;
                    long apkSize = 0;
                    JSONArray assets = json.optJSONArray("assets");
                    if (assets != null) {
                        for (int i = 0; i < assets.length(); i++) {
                            JSONObject asset = assets.getJSONObject(i);
                            String name = asset.optString("name", "");
                            if (name.toLowerCase().endsWith(".apk")) {
                                apkUrl = asset.optString("browser_download_url", null);
                                apkSize = asset.optLong("size", 0);
                                break;
                            }
                        }
                    }

                    Context context = getContext();
                    String currentVersion = "1.0.0";
                    try {
                        currentVersion = context.getPackageManager()
                                .getPackageInfo(context.getPackageName(), 0).versionName;
                    } catch (Exception ignored) {}

                    boolean updateAvailable = isNewerVersion(tagName, currentVersion) && apkUrl != null;

                    JSObject ret = new JSObject();
                    ret.put("ok", true);
                    ret.put("updateAvailable", updateAvailable);
                    ret.put("tagName", tagName);
                    ret.put("releaseName", releaseName);
                    ret.put("changelog", changelog);
                    ret.put("apkUrl", apkUrl);
                    ret.put("apkSize", apkSize);
                    ret.put("currentVersion", currentVersion);
                    call.resolve(ret);
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to check GitHub releases: " + e.getMessage(), e);
                call.reject("Failed to check for updates: " + e.getMessage());
            }
        }).start();
    }

    private boolean isNewerVersion(String remoteTag, String localVersion) {
        String cleanRemote = remoteTag.replaceAll("^[vV]", "").trim();
        String cleanLocal = localVersion.replaceAll("^[vV]", "").trim();
        if (cleanRemote.isEmpty()) return false;
        if (cleanRemote.equals(cleanLocal)) return false;

        String[] rParts = cleanRemote.split("\\.");
        String[] lParts = cleanLocal.split("\\.");
        int length = Math.max(rParts.length, lParts.length);

        for (int i = 0; i < length; i++) {
            int r = i < rParts.length ? parseSafeInt(rParts[i]) : 0;
            int l = i < lParts.length ? parseSafeInt(lParts[i]) : 0;
            if (r > l) return true;
            if (r < l) return false;
        }
        return false;
    }

    private int parseSafeInt(String s) {
        try {
            return Integer.parseInt(s.replaceAll("\\D+", ""));
        } catch (Exception e) {
            return 0;
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String apkUrl = call.getString("apkUrl");
        if (apkUrl == null || apkUrl.isEmpty()) {
            call.reject("apkUrl is required");
            return;
        }

        new Thread(() -> {
            try {
                Context context = getContext();
                File cacheDir = context.getExternalCacheDir();
                if (cacheDir == null) {
                    cacheDir = context.getCacheDir();
                }
                File apkFile = new File(cacheDir, "ratiod-update.apk");
                if (apkFile.exists()) {
                    apkFile.delete();
                }

                Request request = new Request.Builder()
                        .url(apkUrl)
                        .header("User-Agent", "RatioD-Android-App")
                        .build();

                try (Response response = client.newCall(request).execute()) {
                    if (!response.isSuccessful()) {
                        call.reject("Download failed: HTTP " + response.code());
                        return;
                    }

                    ResponseBody body = response.body();
                    if (body == null) {
                        call.reject("Empty body while downloading APK");
                        return;
                    }

                    long totalBytes = body.contentLength();
                    long downloadedBytes = 0;

                    try (InputStream is = body.byteStream();
                         FileOutputStream fos = new FileOutputStream(apkFile)) {
                        byte[] buffer = new byte[8192];
                        int read;
                        long lastNotify = 0;

                        while ((read = is.read(buffer)) != -1) {
                            fos.write(buffer, 0, read);
                            downloadedBytes += read;

                            long now = System.currentTimeMillis();
                            if (now - lastNotify > 200) {
                                lastNotify = now;
                                JSObject progress = new JSObject();
                                progress.put("downloaded", downloadedBytes);
                                progress.put("total", totalBytes);
                                int pct = totalBytes > 0 ? (int) ((downloadedBytes * 100) / totalBytes) : 0;
                                progress.put("percent", pct);
                                notifyListeners("downloadProgress", progress);
                            }
                        }
                        fos.flush();
                    }

                    // Complete notification
                    JSObject doneProgress = new JSObject();
                    doneProgress.put("downloaded", downloadedBytes);
                    doneProgress.put("total", totalBytes);
                    doneProgress.put("percent", 100);
                    notifyListeners("downloadProgress", doneProgress);

                    // Check unknown sources permission on Android 8.0+
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        if (!context.getPackageManager().canRequestPackageInstalls()) {
                            Activity activity = getActivity();
                            if (activity != null) {
                                Intent permIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                                        .setData(Uri.parse("package:" + context.getPackageName()));
                                activity.startActivity(permIntent);
                            }
                        }
                    }

                    // Launch Package Installer
                    Uri contentUri = FileProvider.getUriForFile(
                            context,
                            context.getPackageName() + ".fileprovider",
                            apkFile
                    );

                    Intent installIntent = new Intent(Intent.ACTION_VIEW);
                    installIntent.setDataAndType(contentUri, "application/vnd.android.package-archive");
                    installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

                    context.startActivity(installIntent);

                    JSObject ret = new JSObject();
                    ret.put("ok", true);
                    ret.put("startedInstall", true);
                    call.resolve(ret);
                }
            } catch (Exception e) {
                Log.e(TAG, "Error downloading and installing APK: " + e.getMessage(), e);
                call.reject("Failed to download or install update: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void canRequestPackageInstalls(PluginCall call) {
        Context context = getContext();
        boolean canInstall = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            canInstall = context.getPackageManager().canRequestPackageInstalls();
        }
        JSObject ret = new JSObject();
        ret.put("canInstall", canInstall);
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Activity activity = getActivity();
            if (activity != null) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                        .setData(Uri.parse("package:" + context.getPackageName()));
                activity.startActivity(intent);
            }
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }
}
