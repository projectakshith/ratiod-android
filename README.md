# Ratio'd Android

Standalone Android application for **Ratio'd**, bundling the full web frontend and native on-device authentication bridges for SRM Student Portal and SRM Academia.

---

## ⚡ Features

- **Full Ratio'd UI**: 1:1 bundled Next.js/React experience with all themes, animations, attendance calculations, marks, and timetable logic.
- **Zero Cloud Backend Required**: Connects on-device directly to SRM endpoints (`sp.srmist.edu.in` and `academia.srmist.edu.in`) via native Android OkHttp clients.
- **Dual Flow Support**: Supports both **Student Portal** and **Academia** authentication with automatic CAPTCHA extraction.
- **In-Memory Sessions**: Cookies and session state remain in RAM only for security.
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
