# BentoPDF for Android

The same offline app as the website and the Windows program, packaged as an Android app.

## Privacy

- The app asks for **no permissions at all**. Without the internet permission, Android itself stops it from using the network.
- The app's own files are served to its built-in browser from inside the APK.
- Cloud backup and phone-to-phone transfer of the app's data are switched off.
- The system web view's Safe Browsing checks and usage reporting are switched off.
- The app only ever sees files you open with it or pick in Android's own Open and Save dialogs.

`test/e2e.cjs` runs on an Android emulator for every build. It checks the permissions and watches the kernel's socket tables for any connection the app makes.

## Getting the APK

The **Android app (APK)** workflow builds it. Open the repository's **Actions** tab, pick the latest successful run of that workflow, and download **BentoPDF-Android-APK** (a zip containing `BentoPDF-0.1.0.apk`). Copy the APK to your phone, or download it there directly.

1. Open the APK on the phone. Android asks to allow installing apps from that source (your browser or Files app); allow it.
2. Install.
3. To use it for all PDFs: open any PDF, choose **BentoPDF**, then **Always**.

This first version is a test build: it's signed with a throw-away key that changes on every build, so installing a newer version means uninstalling the old one first. A test build also lets a computer connected by USB, with USB debugging on, inspect the app. A properly signed build fixes both.

## Using it

| Action | How |
| --- | --- |
| Open a PDF | "Open with BentoPDF" from Files, email or any app; "Share → BentoPDF"; or PDF Editor in the app |
| Add an image | **Insert → Image**, tap where it should go, choose the picture, drag to move or resize |
| Sign | **Insert → Signatures** |
| Save | **Save** in the bar above the editor opens Android's Save dialog |
| Other tools | **← Tools**, or the Back button |

Android doesn't let an app overwrite the file it was opened from in most apps (email attachments, for example), so Save always asks where to save. Choose the same folder and name to replace a file you own.

## Building locally

Needs Node.js, Java 21 and the Android SDK. From the repository root:

```bash
npm run build
```

```bash
npx cap sync android
```

```bash
cd android && ./gradlew assembleDebug
```
