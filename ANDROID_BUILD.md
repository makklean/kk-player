# KK Player Android build

The Android app is a Capacitor wrapper around the existing web player. The GitHub Pages app remains unchanged.

## Build an APK with GitHub Actions

1. Push or merge changes to `main`, or run **Build Android APK** manually from the Actions tab.
2. Open the completed workflow run.
3. Download the `kk-player-debug-apk` artifact.

The artifact contains a debug APK intended for installation/testing, not a signed release APK.

## Local build

Requirements: Node.js 22+, Java 21, Android Studio/Android SDK.

```sh
npm install
npm run build
npx cap add android
npx cap sync android
cd android
./gradlew assembleDebug
```

The preparation script copies the existing player, manifest and icons into `www/`, and bundles JSZip locally so ZIP backup/import works without a network connection in the APK.

Keep the Capacitor `appId` stable (`com.makklean.kkplayer`) for future in-place app updates. Do not uninstall the app when testing upgrades if you need to preserve its local IndexedDB data.
