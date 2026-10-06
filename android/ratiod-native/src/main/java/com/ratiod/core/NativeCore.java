package com.ratiod.core;

/** JNI contract only. Capacitor/session storage adapters are owned by Agent 2. */
public final class NativeCore {
    private static boolean isLoaded = false;
    static {
        // The Rust OCR wrapper dynamically loads this APK-packaged C library.
        try { System.loadLibrary("onnxruntime"); } catch (Throwable ignored) { }
        try {
            System.loadLibrary("ratiod_core");
            isLoaded = true;
        } catch (Throwable ignored) {
            isLoaded = false;
        }
    }
    public static boolean isAvailable() { return isLoaded; }
    private NativeCore() { }
    public static native long nativeCreate(String modelPath, String vocabPath);
    public static native String nativeInvoke(long handle, String requestJson);
    public static native void nativeDestroy(long handle);
}
