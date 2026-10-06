# On-device Rust core port

## Scope and status

This implements Agent 1's native library inside the existing Capacitor Android
project. The tested `PortalProbePlugin.java`, React screens, browser storage and
updater are preserved. The app depends on `:ratiod-native`, which packages Rust,
ONNX Runtime and OCR assets. Agent 2 still needs to connect the Capacitor adapter
to the JNI interface and review the version 1 contract. Packaging the library
does **not** switch the existing UI to Rust automatically.

The core connects directly to `https://sp.srmist.edu.in` and
`https://academia.srmist.edu.in`. It contains no Ratio'd backend URL, HTTP server,
remote OCR client, Python interpreter or session persistence format.

## Reference sources

Behavior was read from [ratio-d at bc0bc241580fbaebdced0b68e8c16554f7d24b9d](https://github.com/projectakshith/ratio-d/tree/bc0bc241580fbaebdced0b68e8c16554f7d24b9d/backend).
OCR was adapted from [TinyOCR at d59c4474cb5371bbe7866b18e6ffa1af0908dbae](https://github.com/wtfPrethiv/TinyOCR/tree/d59c4474cb5371bbe7866b18e6ffa1af0908dbae).
The backend's `ocr-engine/` manifest, inference source, checkpoint and vocabulary
match that TinyOCR revision. No production student HTML, cookies or credentials
were copied. Backend service fixtures in this repository are synthetic.

## Module boundaries

| Crate/module | Responsibility |
| --- | --- |
| `ratiod-core/contract.rs`, `models.rs`, `error.rs` | Versioned JSON requests, typed data and fixed safe errors |
| `ratiod-core/transport.rs` | Validated HTTPS, service origin allowlists, isolated cookie jars, body limits and timeout/TLS classification |
| `ratiod-core/portal.rs`, `academia.rs` | Provider authentication, challenge lifecycle, session credentials in RAM and direct SRM operations |
| `ratiod-core/parsers.rs`, `academic_parsers.rs`, `portal_parsers.rs` | DOM parsing and Academia wrapper decoding |
| `ratiod-core/core.rs` | Dispatch, local OCR orchestration, refresh re-authentication and per-section results |
| `tinyocr` | CPU ONNX inference, upstream preprocessing and greedy CTC decoding; no server |
| `ratiod-jni` | Stable JNI exports, guarded instance registry, serialized calls and panic containment |
| `android/ratiod-native` | Java native declarations, Cargo/NDK Gradle tasks, native libraries and model/license assets |

## Source-to-port operation map

Python paths below are relative to `ratio-d/backend`. `P` means
`https://sp.srmist.edu.in/srmiststudentportal`; `A` means
`https://academia.srmist.edu.in`.

| Operation / Python entry | Source function(s) | Direct endpoint(s) | Rust implementation |
| --- | --- | --- | --- |
| Reachability; working probe `checkReachability` | Existing Android `PortalProbePlugin.checkReachability`; backend provider base URLs | GET `P/students/loginManager/youLogin.jsp` or `A/` | `Core::dispatch(CheckReachability)` |
| `/portal/captcha` | `main.portal_captcha`, `core/portal_client.PortalSession.load_captcha` | GET login page, discovered same-origin `SCaptchaServlet` with domain proof | `Portal::load_captcha` |
| `/portal/login` | `main.portal_login`, `PortalSession.login`, `classify_failure`, `telemetry_payload` | POST `P/LoginServlet`; verify authenticated attendance | `Portal::login`, `login_manual`, `submit`, `rejection` |
| Portal OCR during login / `/captcha/solve` | `main.solve_captcha_ocr_bytes`; TinyOCR preprocessing and CTC decoder | No remote OCR endpoint in native implementation | `tinyocr::Engine`, called privately by `Portal::login` |
| Portal session handling | `PortalClient`, cookies passed through Python schemas | Cookie jar remains native; no cookie import/export | `Portal`, `Transport`, `getSessionState`, `clearSession` |
| Portal attendance / monthly | `PortalClient.get_attendance_html`, `PortalAttendanceService.parse` | GET `P/students/report/studentAttendanceDetails.jsp` | `Portal::attendance`, `parsers::portal_attendance` |
| Portal profile | `PortalClient.get_profile_html`, `PortalProfileService.parse` | GET `P/students/report/studentPersonalDetails.jsp` | `Portal::profile`, `portal_parsers::profile` |
| Portal marks / components | `PortalClient.get_marks_data`, `PortalMarksService.parse_main`, `parse_inner` | GET `P/students/report/studentInternalMarkDetails.jsp`; POST `P/students/report/studentInternalMarkDetailsInner.jsp` | `Portal::marks`, `portal_parsers::marks_main`, `marks_inner` |
| Portal timetable / courses | `PortalClient.get_timetable_html`, `PortalTimetableService.parse` and helper functions | POST `P/students/report/studentTimeTableDetails.jsp` | `Portal::timetable`, `portal_parsers::timetable` |
| `/portal/refresh` | `main.portal_refresh`, `PortalClient.keepalive`, data operations, bounded OCR re-login loop | Attendance validates session; remaining endpoints above | `Core::refresh`, `reauthenticate`; no periodic background keepalive |
| `/login` Academia | `main.login`, `AcademiaClient.authenticate`, `SessionHandler.login` | POST `A/accounts/signin.ac`; SRM-returned same-origin token exchange URI; attendance verification | `Academia::login` |
| Academia HIP challenge / answer | `SessionHandler.login` `HIP_REQUIRED` / `HIP_FAILED` branch | GET `A/accounts/p/40-10002227248/webclient/v1/captcha/{digest}?darkmode=false`; answer on next signin | `Academia::login`, `challenge`; digest stays native |
| Academia concurrent sessions | `SessionHandler.force_logout_sessions`, recursive `login` retry | Same-origin terminate form action, then signin retry | `Academia::terminate`; maximum one termination/retry per login |
| Academia session handling | `SessionHandler`, `AcademiaClient.get_page` | Native cookie jar and in-memory credentials | `Academia`, `Transport`, session methods |
| Academia HTML extraction | `core/decoder.HTMLDecoder.smart_extract` | Response wrapper: `pageSanitizer.sanitize` or `zmlvalue` | `academic_parsers::extract` |
| Academia attendance | `AcademiaClient.get_attendance_html`, active `AttendanceService.parse_attendance` | GET `A/srm_university/academia-academic-services/page/My_Attendance` | `Academia::attendance`, `academic_parsers::attendance` |
| Academia profile / courses | `AcademiaClient.get_profile_html`, `ProfileService.parse_student_profile`, `CourseService.get_course_map` | GET `A/srm_university/academia-academic-services/page/My_Time_Table_2023_24` | `Academia::profile`, `academic_parsers::profile`, `courses` |
| Academia marks | `MarksService.parse_test_performance` on attendance HTML | GET Academia attendance endpoint | `Academia::marks`, `academic_parsers::marks` |
| Academia timetable | `AcademiaClient.get_grid_html`, `TimetableService.parse_unified_grid` | GET `A/srm_university/academia-academic-services/page/Unified_Time_Table_2025_Batch_1` or `..._batch_2` | `Academia::timetable`, `academic_parsers::timetable` |
| `/refresh` Academia | `main.refresh_data`, one session re-authentication, active parsers above | Attendance, profile and selected batch grid endpoints | `Core::refresh`, `reauthenticate` |

### Frontend/probe call sites to migrate by Agent 2

`src/utils/backendProxy.ts::handleNativeBridge` routes `/portal/captcha`,
`/portal/login`, `/portal/refresh`, `/login` and `/refresh` to the existing probe.
`src/context/AppContext.tsx` consumes those endpoints for login and refresh;
`src/app/login/page.tsx` owns interactive login. Existing plugin methods are
`checkReachability`, `loadCaptcha`, `login`, `getAttendance`, `clearSession`,
`getSessionState`, `loginAcademia`, `getAcademiaAttendance`.
Replace those production SRM calls with the version 1 contract, preserving the
tested probe for diagnostics. Do not retain the old response's cookie fields.

### Explicitly deferred or outside the SRM port

| Source operation | Reason / integration consequence |
| --- | --- |
| `AcademiaClient.get_planner_html`, `CalendarService.parse_calendar` | Present in source but unused by active `/login` and `/refresh`. No planner bridge method in this slice. Existing calendar UI must use its own local/static data or display unavailable state. |
| `attendance_service_v2`, `TimetableService.parse_attendance` | Alternative inactive parser implementations; active `AttendanceService` is the parity reference. |
| Standalone `/captcha/solve` URL/image proxy | Replaced by private local login OCR. No arbitrary image URL or predicted-answer bridge endpoint is exposed. |
| Academia CAPTCHA OCR | Provided model is trained for Portal 175 x 45 challenges, not Zoho HIP. HIP fetch/answer is implemented; manual entry is required. |
| `/feedback`, `/api/announcements`, `/pyq-proxy`, `/version` | Non-SRM operations involving Discord, external PYQ hosting or app releases. Not native SRM operations; Agent 2 owns app/update behavior. No service keys are embedded. |
| Persisted/imported cookies, password storage | Deliberately absent. Owner selected credentials/session values in Rust RAM only. Restart requires login; Agent 2 retains non-secret dashboard cache separately. |

## Behavior differences and constraints

- Login returns authentication status, then attendance/refresh returns data. Python
  endpoints combined these steps and returned cookies; Rust never returns cookies,
  tokens, digests, form fields, exposed CAPTCHA text or predicted answers.
- Refresh validates attendance and re-authenticates at most once on expiry/conflict.
  Other section requests run concurrently. Successful sections have epoch-millisecond
  timestamps; failed sections have typed errors and no replacement data. Only
  successful sections should update cache. Portal marks components run in batches
  of four; the Python source used unbounded `asyncio.gather`.
- Parser/HTTP failures return explicit errors rather than Python's swallowed errors,
  null pages or successful empty arrays. Recognized empty attendance tables remain
  valid. A failed marks component fails that section to preserve the previous cache.
- Academia batch values are normalized from `Batch / 1` to `1`. A dangling department
  separator left by Python's trim order is removed. HTML entities, nested tags,
  escaped Unicode/surrogate pairs and already-unwrapped tables are supported.
  The synthetic parity generator records these normalization differences.
- Academia concurrency recovery is automatic by owner choice and bounded to one
  termination/retry, including a conflict after token exchange. Foreign terminate
  actions/token exchange URLs are rejected before transmission.
- Portal loads a fresh unauthenticated cookie jar for each CAPTCHA replacement.
  Manual answers require a matching opaque challenge ID; stale answers never submit.
  Initial Academia login may request HIP; `loadCaptcha` only returns an existing HIP.
- Portal fingerprint/domain fields and elapsed trap proof follow the Python source.
  Mobile hints use fixed Android defaults rather than the backend's random desktop
  telemetry. Actual device/browser telemetry is not collected. Compatibility with
  live SRM anti-bot checks remains a physical-device check; elapsed proof has a
  minimum of three seconds, matching the source's fabricated minimum, not a sleep.
- Each HTTP request has a 30-second timeout and a 4 MiB response limit; images have
  a 1 MiB limit. A whole refresh can take longer because component batches are
  sequential. Run JNI on a background executor and keep cached UI usable.
- Certificate validation uses Rustls and committed Mozilla trust-root dependency
  versions, with no certificate bypass. Only exact provider HTTPS hosts/port 443 are
  accepted; additional SRM SSO hosts require an explicit reviewed allowlist change.
- Academia page names include the source's 2023/24 and 2025 labels. These are preserved,
  not guessed from the current year. Upstream page changes return typed parser errors.
- Credentials and manual answers use zeroizing Rust buffers where owned; request
  forms and JNI request copies are wiped on drop. Third-party networking/Java/JS
  allocations are not guaranteed to be wiped. There are no native operational logs;
  JNI disables Rust logging/tracing and suppresses panic payload printing.
- Existing JS storage and probe response/logging behavior are **not** covered by the
  native security guarantee. `backendProxy.ts` returns cookies; `AppContext.tsx` and
  `src/utils/shared/Encryption.ts` persist sensitive browser state. Agent 2 must remove
  this for production native flows and audit the legacy probe separately. The existing
  Android manifest's cleartext allowance is also Agent 2's app-level follow-up.

## Android builds

Declared ABIs: **arm64-v8a** (physical phones) and **x86_64** (development emulator).
Minimum Android API 23; compile/target SDK 35. No ARMv7/x86-32 support is declared.
JDK **21**, Android NDK **28.2.13676358**, Rust **1.99.0** and cargo-ndk **4.1.2**
were used. Gradle 8.11.1 / AGP 8.7.2 remain the existing project's configuration.
Rust toolchain/dependency versions and generated native tasks are committed.

From the repository root, with `JAVA_HOME`, `ANDROID_HOME` and SDK tools configured:

```powershell
rustup toolchain install 1.99.0 --component rustfmt --component clippy
rustup target add --toolchain 1.99.0 aarch64-linux-android x86_64-linux-android
cargo install cargo-ndk --version 4.1.2 --locked
sdkmanager 'platforms;android-35' 'build-tools;34.0.0' 'build-tools;35.0.0' 'platform-tools' 'ndk;28.2.13676358'
sdkmanager --licenses
npm install --package-lock=false --no-audit --no-fund
npm run build
npx cap sync android
./android/gradlew.bat -p android :app:assembleDebug
./android/gradlew.bat -p android :app:assembleRelease
python scripts/check-native-apk.py android/app/build/outputs/apk/debug/app-debug.apk
zipalign -c -P 16 4 android/app/build/outputs/apk/debug/app-debug.apk
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

On Unix use `./android/gradlew` instead. `sdkmanager`/`zipalign`/`adb` must be on
PATH or invoked from the SDK. An ignored `android/local.properties` may specify
`sdk.dir` in place of `ANDROID_HOME`. JDK 17 is insufficient for Capacitor 7.
The existing npm lock is inconsistent with its package manifest (`npm ci` failed
on missing webpack peers). The command above was the temporary build workaround,
without editing Agent 2's manifest/lock. Agent 2 should repair that lock for fully
reproducible frontend builds. The web build can contact Google Fonts at build time;
the APK contains its resulting UI assets and has no remote `server.url`.

Gradle automatically runs `cargo ndk ... --platform 23 build --locked -p ratiod-jni`
for both ABIs and the appropriate debug/release profile. Output libraries go under
`android/ratiod-native/build/generated/rust/{debug|release}/{abi}`; ONNX libraries
under `build/generated/ort/{abi}`. Rust link flags require 16 KiB ELF LOAD alignment.
All generated binaries/SDKs/tool caches are ignored, not committed.

The release task currently produces `app-release-unsigned.apk`; configure stable
owner signing through Agent 2's release process before distributing it. No signing
key or package-ID changes were made. The package remains `com.ratiod.portalprobe`.

## OCR assets, provenance and licenses

The committed ONNX model reconstructs the provided TinyCRNN checkpoint, with an
equivalent export wrapper replacing height pooling with a mean operation. Opset
17; input `[batch,1,45,175]`, output `[batch,44,37]`. Preprocessing retains upstream
fixed-point PIL grayscale and normalization to [-1,1], without resizing. Invalid
dimensions/decode failures use manual entry. Decoding retains upstream greedy CTC.
The minimum softmax confidence of emitted symbols must be at least 0.90 for an
automatic submission; this is an uncalibrated heuristic, not an accuracy guarantee.
Up to four CAPTCHA submissions are allowed per authentication cycle. Uncertainty,
OCR failure, network errors, invalid credentials and account lockout stop the loop.

| Asset | SHA-256 |
| --- | --- |
| Public `best_captcha_crnn.pt` source checkpoint | `e9072bf58ad9ccbba4326ae9f2a607e6d64edebd52cd9ac0025e21aea419326e` |
| Committed `captcha_crnn.onnx` | `82367bed329cace83f9828c907fab2fbd81c35c4caa695d99a57e9bc7e5ff948` |
| Committed `vocab.json` | `0ba87b0dc21dec2de3f88b1612b36e3150a776122c6012f538b3d482265c9563` |
| Maven `onnxruntime-android:1.20.0` AAR | `07a8f71ef890afed8c6087a56220e6d558a492804276ee2dd7cb7f6262242027` |

The Gradle module verifies all shipped model/vocab/AAR hashes and copies model
assets to `assets/ratiod-core/`. Agent 2 copies model/vocab to app-private native
file paths before creating the core. These files are public model data, not secrets.

ONNX Runtime **1.20.0**, C API **20**, CPU only, was selected to preserve API 23:
the originally referenced API 27 / newer runtime requires a newer Android minimum.
The chosen official AAR declares minSdk 21, includes both required ABIs and has
16 KiB aligned ELF LOAD segments. `ort = 2.0.0-rc.13` is pinned with `api-20` and
dynamic loading; Level2 graph optimization is compatible with this runtime. No
Java ONNX wrapper or extra service process is included. Runtime upgrades must
repeat API-level, ABI, ELF alignment and numerical parity checks.

Core/JNI behavior derives from the backend's **AGPL-3.0-or-later** code;
`native/LICENSE-AGPL-3.0` is retained. TinyOCR is **MIT**, copyright 2026 Prethiv
Sriman D, with its original license retained. Checkpoint/model/data came from that
public MIT repository; no separate model/data license was present in the referenced
source. ONNX Runtime is MIT with bundled third-party notices. Licenses accompany
the APK in `assets/ratiod-core/licenses/`. Native distribution should include the
corresponding source and attribution; no Python backend was removed.

Recreate the model export environment only when updating/verifying the model:

```powershell
python -m venv native/.cache/model-env
native/.cache/model-env/Scripts/python.exe -m pip install -r native/tinyocr/scripts/requirements-lock.txt
native/.cache/model-env/Scripts/python.exe native/tinyocr/scripts/prepare_reference.py
native/.cache/model-env/Scripts/python.exe native/tinyocr/scripts/export_onnx.py --samples 512
```

The fetch script pins the source revision, verifies the checkpoint SHA-256 and
public corpus Git blob hashes, and downloads only 512 public CAPTCHA examples,
not SRM/student data. Checkpoint and corpus stay ignored. Export parity checks
random batches 1/2/8/16 plus those 512 images and writes small public golden
tensors/decoder cases. Update asset checksum declarations intentionally if model
bytes change; do not bypass the hash gates. Export uses the pinned Python package
set (validated with Python 3.14 on Windows); an ordinary Android build needs no Python.

## Validation and remaining device checks

On 2026-10-06, 36 ordinary workspace tests passed; the separately invoked OCR
model golden test also passed, as did Clippy with warnings denied and the actual
Java JNI smoke test. Android debug and unsigned release builds succeeded for both
declared ABIs. Both APKs passed model/license/bundled-UI checks, correct ELF machine
and 16 KiB LOAD alignment checks, and `zipalign -c -P 16`. Release exports include
all three JNI methods. These are host/build results, not physical-device acceptance.

Host verification covers provider CAPTCHA/login/cookie/attendance slices with local
mock SRM responses, bounded retry/lockout, Academia token exchange/concurrency,
manual stale-challenge rejection, partial refresh, synthetic Python parser parity,
TLS rejection of a locally generated untrusted certificate, network/timeout errors,
JNI handle lifetime, and OCR preprocessing/CTC/uncertainty. Use:

```powershell
cargo fmt --all --check
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
python -m pip install -r native/ratiod-core/tests/requirements-lock.txt
python native/ratiod-core/tests/generate_parity.py /path/to/pinned/ratio-d/backend
```

The optional Rust model test requires an official host ONNX Runtime 1.20 shared
library: set `ORT_DYLIB_PATH` to its absolute DLL/.so path, then run
`cargo test -p tinyocr model_golden_parity_when_runtime_is_configured -- --ignored`.
The same runtime passed golden output checks. PyTorch/ONNX greedy outputs matched
512/512 public images (max logit difference 2.480e-5); labels matched 497/512 on
this subset. That is export parity evidence, not measured SRM/device accuracy.
`native/ratiod-jni/tests/NativeCoreSmoke.java` tests the actual Java declarations
against a host-built JNI library through create, both service states and destroy.

No physical device/emulator or SRM credentials were available for live acceptance.
Agent 2's adapter/device pass must verify: bundled UI starts offline; both services
are reachable; Portal local OCR and manual fallback; Academia HIP manual entry;
authenticated attendance; remaining sections; expired-session re-login; logout and
process restart; failed refresh preserves cached data. Inspect traffic destinations
without capturing secret bodies, cookies or URLs containing access tokens. Test an
API 23 ARM64 device and the x86_64 emulator, plus a 16 KiB-page device if available.
