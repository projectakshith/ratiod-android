# Agent 1 handoff to Agent 2

Review [native-bridge-contract.md](native-bridge-contract.md) before implementing
the Capacitor adapter. Version 1 is implemented; peer review is still pending.
The tested probe, UI, local storage and updater were not changed. The app already
depends on the new `:ratiod-native` Android library, so Gradle packages both ABIs.

Java class `com.ratiod.core.NativeCore` exposes:

```java
long nativeCreate(String modelPath, String vocabPath); // 0 = failed initialization
String nativeInvoke(long handle, String requestJson);
void nativeDestroy(long handle);
```

Copy `ratiod-core/captcha_crnn.onnx` and `ratiod-core/vocab.json` from APK assets
to app-private files using temporary files and rename, then pass absolute paths.
The class loads `onnxruntime` and `ratiod_core`. Missing model/runtime disables OCR;
manual login survives. Keep the handle in Java only. Use a background executor;
native calls serialize per instance and an entire refresh can exceed 30 seconds.
Create one core per app/session lifecycle; destroy it on logout/shutdown. Both
providers have independent sessions. Clear both if logging out the whole app.

All requests require `apiVersion: 1`, one `service` (`portal` or `academia`) and
`method`. Methods: `checkReachability`, `loadCaptcha`, `login`, `getSessionState`,
`getAttendance`, `getProfile`, `getMarks`, `getTimetable`, `refresh`, `clearSession`.
Only `login` takes extra input: `username`, `password`, optional `useOcr` (default
true), `challengeId`, `captchaAnswer`. Password/answer are input-only. No raw cookie,
token, digest, hidden form or OCR answer crosses back to JavaScript.

Example initial call and response:

```json
{"apiVersion":1,"method":"login","service":"portal","username":"example","password":"<submission-only>","useOcr":true}
```

```json
{"apiVersion":1,"ok":false,"error":{"code":"CAPTCHA_REQUIRED","message":"Enter the CAPTCHA to continue.","retryable":true,"challenge":{"challengeId":"<opaque>","image":"data:image/png;base64,...","ocrStatus":"uncertain"}}}
```

Show the challenge and resubmit `login` with matching `challengeId`, manual
`captchaAnswer` and `useOcr:false`. Never submit an old challenge after replacement.
Academia's initial `login` can return a HIP challenge; its model is unsupported,
so use manual entry. Portal can optionally start with `loadCaptcha`; Academia
`loadCaptcha` only returns its pending HIP after login requested one.

Successful login is `{apiVersion:1,ok:true,data:{authenticated:true,service}}`;
call `getAttendance` or `refresh` afterward. Refresh success is
`data:{service,sections:{attendance,profile,marks,timetable}}`. Each section is
`{ok:true,data,refreshedAt:<epoch-ms>}` or `{ok:false,error}`. Marks section data is
`{marks:[...]}`; attendance is `{attendance:[...],monthly:[...]}`; timetable is
`{schedule:{...},courses:{...}}`. Merge successful sections only, namespace cache
by account/provider, preserve last-good values on failure and show stale timestamps.
Refer to the contract for all wire fields and typed error codes.

Session persistence is **not required in this slice**: credentials and cookies
remain in Rust RAM. Relaunch requires login while cached dashboard data can remain.
There is no import/export method or sensitive disk format. Remove the native flow's
legacy browser password/cookie persistence in `AppContext.tsx` / `Encryption.ts`
and cookie return fields in `backendProxy.ts`. Do not log input JSON, answers,
challenge images, native responses containing profile data or bridge exceptions.
Keep the working `PortalProbe` available for diagnostics and audit its logs before
shipping; it has different security guarantees from this new interface.

Build prerequisites: JDK 21, Rust 1.99.0 with `aarch64-linux-android` and
`x86_64-linux-android`, cargo-ndk 4.1.2, NDK 28.2.13676358, SDK 35 and build tools
34/35. APK minimum API remains 23. Normal builds need no Python/OCR service.
See [rust-core-porting-notes.md](rust-core-porting-notes.md) for commands, model
checksums, source map, deferred operations, known frontend lockfile issue and
manual device scenarios. Native build/test success does not establish live SRM
acceptance; a connected device and owner-entered credentials are still needed.
