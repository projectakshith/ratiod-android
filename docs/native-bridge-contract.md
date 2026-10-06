# Native bridge contract — version 1

Agent 1 owns Rust, JNI exports and build packaging. Agent 2 owns the Java/Capacitor
adapter, TypeScript types and UI. This is the first draft for Agent 2 review; no
changes to the tested `PortalProbe` adapter are made by Agent 1.

## JNI boundary

Java class: `com.ratiod.core.NativeCore`. Static native methods:

```java
long nativeCreate(String modelPath, String vocabPath);
String nativeInvoke(long handle, String requestJson);
void nativeDestroy(long handle);
```

The library is `ratiod_core`. Paths must point to APK-packaged assets copied to
app-private storage by the adapter. Missing OCR assets disable OCR but do not
disable manual login. Handle 0 means initialization failed. Handles remain in
Java; never expose them through Capacitor. Invoke on a background executor.
Destroy releases sessions and credentials. Serialize requests per core instance;
calls may block while waiting for the instance's current operation.

## Requests and responses

Requests are `{ "apiVersion": 1, "method": "...", "service": "academia" | "portal", ... }`.
Unknown versions, methods and fields return `INVALID_REQUEST`.

| Method | Additional arguments | Success data |
| --- | --- | --- |
| `checkReachability` | None | `{ reachable: true, status: number, latencyMs: number }` |
| `loadCaptcha` | None | Challenge below; Academia requires an existing login challenge |
| `login` | `username`, `password`, optional `challengeId`, `captchaAnswer`, `useOcr` (default true) | `{ authenticated: true, service }` |
| `getSessionState` | None | `{ authenticated: boolean, service }` (local state, not a live validation) |
| `getAttendance` | None | `{ attendance: Attendance[], monthly: Monthly[] }` |
| `getProfile` | None | `Profile` |
| `getMarks` | None | `{ marks: Marks[] }` |
| `getTimetable` | None | `{ schedule: Schedule, courses: Record<string, Course> }` |
| `refresh` | None | `{ service, sections: Record<string, SectionResult> }` |
| `clearSession` | None | `{ cleared: true }` |

Success: `{ apiVersion: 1, ok: true, data }`.
Failure: `{ apiVersion: 1, ok: false, error: { code, message, retryable, challenge? } }`.
A challenge is `{ challengeId: string, image: data-URI, ocrStatus: "available" | "unavailable" | "uncertain" }`.
`challengeId` is opaque and process-local; it is never an SRM nonce, digest or cookie.
It is invalidated on replacement, success, logout and process exit. Never log images
or challenge IDs. Predicted answers stay in Rust; manual answers are submission-only.

SectionResult is `{ ok: true, data, refreshedAt: epochMilliseconds }` or
`{ ok: false, error }`. Merge only successful sections into cache. A failure must
not erase good cached data. Session failure at refresh entry is a top-level error.

## Models

Wire field names preserve Python behavior and the current UI's aliases:

- Attendance: `code`, `title`, `category`, `slot`, `conducted`, `absent`, `present`,
  `percent`, `isPortal`. Monthly: `month`, `present`, `absent`.
- Profile: `name`, `regNo`, `batch`, `semester`, `dept`, `section`, `mobile`, `program`.
- Marks: `courseCode`, optional `title`, `type`, `performance`, `assessments`,
  `totalMarkGot`, `totalMaxMarks`; assessment: `title`, `marks`, `total`, optional `date`.
  Missing numeric totals are null, not zero.
- Course: `code`, `name`, `credits`, `type`, `raw_type`, `faculty`, `room`, `slot`.
  Academia course maps are keyed by slot; Portal maps are keyed by course code.
- Schedule: day label -> time range -> slot object containing `slot`, `course`,
  `code`, `type`, `raw_type`, `room`, `faculty`, `time`, with Portal aliases
  `courseCode`, `courseTitle`, `name`, `credits`.

## Errors and security

Codes: `NETWORK_ERROR`, `TIMEOUT`, `TLS_ERROR`, `INVALID_CREDENTIALS`,
`CAPTCHA_REQUIRED`, `CAPTCHA_REJECTED`, `ACCOUNT_LOCKED`, `SESSION_EXPIRED`,
`SESSION_CONFLICT`, `UNEXPECTED_RESPONSE`, `PARSER_FAILURE`, `INVALID_REQUEST`,
`INTERNAL_ERROR`, `OCR_UNAVAILABLE`, `OCR_UNCERTAIN`.
Messages are fixed safe text. No upstream response/exception text, URLs containing
tokens, credentials, CAPTCHA answers or cookie values appear in responses or logs.

Credentials are retained in Rust memory only until logout/account replacement/process
exit, enabling refresh re-authentication. No session import/export or disk format is
defined. Agent 2 must remove browser credential/cookie persistence for native flows.
An authentication success is distinct from a data fetch; call attendance/refresh
after login. Never return raw cookies as a legacy compatibility shortcut.

Portal permits up to four automatic CAPTCHA submissions per authentication cycle,
with immediate stop on uncertainty, network error, invalid credentials or account
lockout. Manual entry remains available. Academia concurrent-session termination
is automatic by owner choice, bounded to one termination/retry per login.

