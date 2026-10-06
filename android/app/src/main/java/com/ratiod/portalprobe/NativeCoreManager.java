package com.ratiod.portalprobe;

import android.content.Context;
import android.util.Log;

import com.ratiod.core.NativeCore;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class NativeCoreManager {
    private static final String TAG = "NativeCoreManager";
    private static volatile NativeCoreManager instance;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private long handle = 0;
    private boolean initialized = false;

    public interface NativeCallback {
        void onResult(String responseJson);
        void onError(Exception error);
    }

    public static synchronized NativeCoreManager getInstance() {
        if (instance == null) {
            instance = new NativeCoreManager();
        }
        return instance;
    }

    private NativeCoreManager() {}

    public synchronized void init(Context context) {
        if (initialized && handle != 0) {
            return;
        }

        if (!NativeCore.isAvailable()) {
            Log.w(TAG, "NativeCore native library not available, fallback to Java OkHttp probe.");
            return;
        }

        executor.execute(() -> {
            try {
                File filesDir = context.getFilesDir();
                File modelFile = new File(filesDir, "captcha_crnn.onnx");
                File vocabFile = new File(filesDir, "vocab.json");

                copyAsset(context, "ratiod-core/captcha_crnn.onnx", modelFile);
                copyAsset(context, "ratiod-core/vocab.json", vocabFile);

                long h = NativeCore.nativeCreate(modelFile.getAbsolutePath(), vocabFile.getAbsolutePath());
                synchronized (NativeCoreManager.this) {
                    handle = h;
                    initialized = (h != 0);
                }
                Log.i(TAG, "NativeCore initialized with handle: " + (h != 0 ? "active" : "failed"));
            } catch (Exception e) {
                Log.e(TAG, "Error initializing NativeCore", e);
            }
        });
    }

    public synchronized boolean isReady() {
        return handle != 0;
    }

    public void invoke(String requestJson, NativeCallback callback) {
        executor.execute(() -> {
            try {
                long h;
                synchronized (NativeCoreManager.this) {
                    h = handle;
                }

                if (h == 0) {
                    JSONObject err = new JSONObject();
                    err.put("apiVersion", 1);
                    err.put("ok", false);
                    JSONObject errorObj = new JSONObject();
                    errorObj.put("code", "OCR_UNAVAILABLE");
                    errorObj.put("message", "Native core not initialized");
                    errorObj.put("retryable", false);
                    err.put("error", errorObj);
                    callback.onResult(err.toString());
                    return;
                }

                String res = NativeCore.nativeInvoke(h, requestJson);
                callback.onResult(res);
            } catch (Exception e) {
                callback.onError(e);
            }
        });
    }

    public synchronized void destroy() {
        if (handle != 0) {
            long h = handle;
            handle = 0;
            initialized = false;
            executor.execute(() -> {
                try {
                    NativeCore.nativeDestroy(h);
                    Log.i(TAG, "NativeCore instance destroyed");
                } catch (Exception ignored) {}
            });
        }
    }

    private static void copyAsset(Context context, String assetPath, File destFile) {
        try {
            if (destFile.exists() && destFile.length() > 0) {
                return;
            }

            File tempFile = new File(destFile.getParentFile(), destFile.getName() + ".tmp");
            try (InputStream in = context.getAssets().open(assetPath);
                 OutputStream out = new FileOutputStream(tempFile)) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                }
                out.flush();
            }

            if (tempFile.renameTo(destFile)) {
                Log.d(TAG, "Copied asset " + assetPath + " to " + destFile.getAbsolutePath());
            } else {
                Log.w(TAG, "Failed to rename temp file to " + destFile.getAbsolutePath());
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to copy asset " + assetPath + ": " + e.getMessage());
        }
    }
}
