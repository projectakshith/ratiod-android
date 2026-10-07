<img width="1867" height="369" alt="ratio'd" src="https://github.com/user-attachments/assets/cf152291-6290-431a-bf97-448f42a21586" />

<div align="center">

### built for speed.

> ratio'd is a dashboard built by students, for students. this is its standalone android app, with the same tools and themes, packaged for your phone.

[![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![Android](https://img.shields.io/badge/Android-3DDC84?style=for-the-badge&logo=android&logoColor=white)](https://developer.android.com)
[![Capacitor](https://img.shields.io/badge/Capacitor-119EFF?style=for-the-badge&logo=capacitor&logoColor=white)](https://capacitorjs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)

<img src="public/screenshots/mobile.jpeg" width="42%" />
&nbsp;&nbsp;
<img src="public/screenshots/attendance.jpeg" width="42%" />

</div>

---

## what's this

ratio'd for Android brings the SRM student dashboard to a standalone app. the interface and academic tools are bundled on your device, while native networking connects to SRM Academia and the Student Portal.

Academia provides your profile and timetable. the Student Portal provides attendance and marks. account data stays on your device.

---

## features

| feature | what it does |
|---|---|
| **student portal sync** | refreshes attendance and marks from the Student Portal |
| **academia timetable** | loads your profile and timetable from Academia |
| **offline first** | keeps the app interface and saved data available on your device |
| **attendance predictor** | calculates how many classes you can miss while meeting your target |
| **marks target** | estimates the marks needed to reach your target grade |
| **class reminders** | schedules local notifications for upcoming classes |
| **built-in updater** | downloads signed APK updates from GitHub Releases |
| **ratio'd themes** | use the minimalist or brutalist interface |

---

## architecture

```
android app
    │
    ├──▶ bundled ratio'd interface
    │       └── Next.js, React, Tailwind CSS
    │
    ├──▶ Capacitor native bridge
    │       ├── portal networking and local session storage
    │       ├── class reminder notifications
    │       └── APK update and installation flow
    │
    ├──▶ SRM Academia       (profile and timetable)
    ├──▶ SRM Student Portal (attendance and marks)
    └──▶ GitHub Releases    (app updates)
```

---

## stack

| layer | tech |
|---|---|
| frontend | Next.js, React, TypeScript, Tailwind CSS, Framer Motion |
| native bridge | Capacitor 7 |
| android | Kotlin/Java, Android SDK, Gradle |
| portal networking | native HTTP clients and Rust core |
| notifications | Android local notifications |
| updates | GitHub Releases and Android Package Installer |

---

## project structure

```
ratiod-android/
├── src/                  # app pages, themes, components, and data logic
├── public/               # bundled assets, fonts, and screenshots
├── android/              # native Android app and Capacitor plugins
├── native/               # Rust core and native libraries
├── capacitor.config.ts   # Capacitor configuration
└── next.config.ts         # static export configuration
```

---

## setup (local)

### 1. clone

```bash
git clone https://github.com/projectakshith/ratiod-android
cd ratiod-android
```

### 2. install dependencies

```bash
npm install
```

### 3. build the app

```bash
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

the debug APK is at `android/app/build/outputs/apk/debug/app-debug.apk`.

---

## releases

Android builds are published as signed APKs on [GitHub Releases](https://github.com/projectakshith/ratiod-android/releases). Install an APK and allow installs from the app you used to download it when Android prompts you.

The in-app updater checks for releases after portal refresh, downloads the APK, and asks Android to install it. Android requires the user to confirm the installation.

Tagged releases use the `vMAJOR.MINOR.PATCH` format. Pushing a version tag starts the GitHub Actions build and attaches the APK to the release. Release signing secrets must be configured in the repository to build an upgrade that installs over an existing release.

---

## contributing

this is a student project. if you find a bug or want to add something:

1. fork it
2. create a branch for your change
3. open a pull request

---

## disclaimer

ratio'd is not affiliated with SRM in any way. we don't own the portals. use it at your own risk, gng.

---

<div align="center">

star if you loved this hehe uwu

</div>
