import com.ratiod.core.NativeCore;

/** Host JVM smoke test of the same JNI class packaged in the Android library. */
public final class NativeCoreSmoke {
    public static void main(String[] args) {
        long handle = NativeCore.nativeCreate(args[0], args[1]);
        if (handle == 0) throw new AssertionError("Native initialization failed");
        try {
            for (String service : new String[]{"portal", "academia"}) {
                String result = NativeCore.nativeInvoke(handle,
                    "{\"apiVersion\":1,\"method\":\"getSessionState\",\"service\":\"" + service + "\"}");
                if (!result.contains("\"ok\":true") || !result.contains("\"authenticated\":false"))
                    throw new AssertionError("Unexpected session state");
            }
        } finally {
            NativeCore.nativeDestroy(handle);
        }
        if (!NativeCore.nativeInvoke(handle, "{}").contains("INVALID_REQUEST"))
            throw new AssertionError("Destroyed handle accepted");
        System.out.println("JNI create/invoke/destroy smoke test passed.");
    }
}
