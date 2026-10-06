package com.ratiod.core;

/** JNI contract only. Capacitor/session storage adapters are owned by Agent 2. */
public final class NativeCore {
    static {
        // The Rust OCR wrapper dynamically loads this APK-packaged C library.
        try { System.loadLibrary("onnxruntime"); } catch (UnsatisfiedLinkError ignored) { }
        System.loadLibrary("ratiod_core");
    }
    private NativeCore() { }
    public static native long nativeCreate(String modelPath, String vocabPath);
    public static native String nativeInvoke(long handle, String requestJson);
    public static native void nativeDestroy(long handle);
}
