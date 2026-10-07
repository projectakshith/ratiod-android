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
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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
                    if (response.code() == 403 || response.code() == 404 || response.code() == 429) {
                        JSObject fallback = checkLatestReleasePage();
                        if (fallback != null) {
                            call.resolve(fallback);
                        } else {
                            call.resolve(noPublicRelease());
                        }
                        return;
                    }

                    if (!response.isSuccessful()) {
                        JSObject fallback = checkLatestReleasePage();
                        if (fallback != null) call.resolve(fallback);
                        else call.reject("GitHub Releases could not be reached. Check your connection and try again.");
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
                try {
                    JSObject fallback = checkLatestReleasePage();
                    if (fallback != null) call.resolve(fallback);
                    else call.reject("GitHub Releases could not be reached. Check your connection and try again.");
                } catch (Exception fallbackError) {
                    call.reject("GitHub Releases could not be reached. Check your connection and try again.");
                }
            }
        }).start();
    }

    private JSObject checkLatestReleasePage() throws Exception {
        Request request = new Request.Builder()
                .url("https://github.com/" + GITHUB_REPO + "/releases/latest")
                .header("User-Agent", "RatioD-Android-App")
                .header("Accept", "text/html")
                .build();
        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful()) return null;
            String path = response.request().url().encodedPath();
            Matcher matcher = Pattern.compile("/releases/tag/([^/]+)$").matcher(path);
            if (!matcher.find()) return null;

            String tagName = URLDecoder.decode(matcher.group(1), StandardCharsets.UTF_8.name());
            Context context = getContext();
            String currentVersion = "1.0.0";
            try {
                currentVersion = context.getPackageManager()
                        .getPackageInfo(context.getPackageName(), 0).versionName;
            } catch (Exception ignored) {}

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("updateAvailable", isNewerVersion(tagName, currentVersion));
            ret.put("tagName", tagName);
            ret.put("releaseName", "Ratio'd " + tagName);
            ret.put("changelog", "");
            ret.put("apkUrl", "https://github.com/" + GITHUB_REPO + "/releases/download/"
                    + tagName + "/ratiod-" + tagName + ".apk");
            ret.put("currentVersion", currentVersion);
            return ret;
        }
    }

    private JSObject noPublicRelease() {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("checkFailed", true);
        ret.put("updateAvailable", false);
        ret.put("message", "No public GitHub release is available. The app cannot read private repository releases.");
        return ret;
    }

    private boolean isNewerVersion(String remoteTag, String localVersion) {
        String cleanRemote = remoteTag.replaceAll("^[vV]", "").trim();
        String cleanLocal = localVersion.replaceAll("^[vV]", "").trim();
        int remotePrerelease = cleanRemote.indexOf('-');
        int localPrerelease = cleanLocal.indexOf('-');
        String remoteCore = remotePrerelease >= 0 ? cleanRemote.substring(0, remotePrerelease) : cleanRemote;
        String localCore = localPrerelease >= 0 ? cleanLocal.substring(0, localPrerelease) : cleanLocal;
        remoteCore = remoteCore.split("\\+", 2)[0];
        localCore = localCore.split("\\+", 2)[0];
        if (remoteCore.isEmpty() || localCore.isEmpty()) return false;

        String[] rParts = remoteCore.split("\\.");
        String[] lParts = localCore.split("\\.");
        int length = Math.max(rParts.length, lParts.length);

        for (int i = 0; i < length; i++) {
            Integer r = i < rParts.length ? parseVersionPart(rParts[i]) : 0;
            Integer l = i < lParts.length ? parseVersionPart(lParts[i]) : 0;
            if (r == null || l == null) return false;
            if (r > l) return true;
            if (r < l) return false;
        }
        // For equal numeric versions, a stable release supersedes a prerelease.
        return remotePrerelease < 0 && localPrerelease >= 0;
    }

    private Integer parseVersionPart(String s) {
        if (!s.matches("\\d+")) return null;
        try {
            return Integer.parseInt(s);
        } catch (Exception e) {
            return null;
        }
    }

    private File stagedApk() {
        File cacheDir = getContext().getExternalCacheDir();
        if (cacheDir == null) cacheDir = getContext().getCacheDir();
        return new File(cacheDir, "ratiod-update.apk");
    }

    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        String apkUrl = call.getString("apkUrl");
        if (apkUrl == null || apkUrl.isEmpty()) {
            call.reject("apkUrl is required");
            return;
        }
        Uri requestedApk = Uri.parse(apkUrl);
        String host = requestedApk.getHost();
        if (!"https".equalsIgnoreCase(requestedApk.getScheme()) || host == null ||
                !(host.equalsIgnoreCase("github.com") || host.endsWith(".githubusercontent.com"))) {
            call.reject("Update APK must come from GitHub over HTTPS");
            return;
        }
        new Thread(() -> {
            try {
                Context context = getContext();
                File apkFile = stagedApk();
                File tempFile = new File(apkFile.getParentFile(), "ratiod-update.apk.part");
                if (tempFile.exists()) tempFile.delete();

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
                         FileOutputStream fos = new FileOutputStream(tempFile)) {
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

                    if (downloadedBytes == 0 || (totalBytes > 0 && downloadedBytes != totalBytes)) {
                        tempFile.delete();
                        call.reject("The update download was incomplete.");
                        return;
                    }
                    if (apkFile.exists()) apkFile.delete();
                    if (!tempFile.renameTo(apkFile)) {
                        tempFile.delete();
                        call.reject("Could not save the downloaded update.");
                        return;
                    }

                    JSObject ret = new JSObject();
                    ret.put("ok", true);
                    ret.put("prepared", true);
                    call.resolve(ret);
                }
            } catch (Exception e) {
                Log.e(TAG, "Error downloading APK: " + e.getMessage(), e);
                call.reject("Failed to download update: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void installDownloadedUpdate(PluginCall call) {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !context.getPackageManager().canRequestPackageInstalls()) {
            call.reject("Allow Ratio'd to install apps in Android settings, then tap Install again.");
            return;
        }
        File apkFile = stagedApk();
        if (!apkFile.isFile() || apkFile.length() == 0) {
            call.reject("The update has not finished downloading. Check again in a moment.");
            return;
        }
        try {
            Uri contentUri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apkFile);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("startedInstall", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not open Android's installer: " + e.getMessage());
        }
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
