# Ratio'd Android

Standalone Android application for **Ratio'd**, bundling the full web frontend and native on-device authentication bridges for SRM Student Portal and SRM Academia.

---

## ⚡ Features

- **Full Ratio'd UI**: 1:1 bundled Next.js/React experience with all themes, animations, attendance calculations, marks, and timetable logic.
- **Zero Cloud Backend Required**: Connects on-device directly to SRM endpoints (`sp.srmist.edu.in` and `academia.srmist.edu.in`) via native Android OkHttp clients.
- **Dual Flow Support**: Supports both **Student Portal** and **Academia** authentication with automatic CAPTCHA extraction.
- **In-Memory Rust Sessions**: The new Rust core retains credentials and sessions in RAM only; migration of legacy browser storage remains Agent 2's integration work.
- **Instant Offline Startup**: All application routes, fonts, styles, and assets are packaged in the APK.

---

## 🏗️ Structure

```text
ratiod-android/
├── src/                # Next.js application (App router, components, contexts)
├── public/             # Icons, images, fonts, and static assets
├── android/            # Capacitor Android native project & OkHttp bridge plugins
├── capacitor.config.ts # Capacitor configuration
├── next.config.ts      # Static export configuration
└── package.json
```

---

## 🚀 Building

### 1. Build Web Assets
```bash
npm run build
```

### 2. Sync to Android Shell
```bash
npm run cap:sync
```

### 3. Build APK
```bash
cd android
./gradlew assembleDebug
```

The APK will be generated at:
```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## On-device Rust core

The existing probe is preserved. The new `android/ratiod-native` module compiles
and packages the Rust SRM core and local TinyOCR for ARM64 phones and x86_64
emulators. Connecting the production Capacitor flows is Agent 2's next step.

Read the [native bridge contract](docs/native-bridge-contract.md),
[porting notes and native build prerequisites](docs/rust-core-porting-notes.md),
and [Agent 2 handoff](docs/agent-2-handoff.md) before building or wiring the adapter.
