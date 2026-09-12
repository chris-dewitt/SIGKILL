# Android

SIGKILL wraps in Capacitor. The web app is the game; Android is a container
around it.

## One-time setup

Install **Android Studio** (it brings the SDK, platform tools and a JDK).
Then, in Studio: *More Actions → SDK Manager* and confirm you have

- Android SDK Platform **35**
- Android SDK Build-Tools **35**
- Android SDK Platform-Tools

Set `ANDROID_HOME` if Studio hasn't:

```powershell
# Windows — typical location
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
```

## Build and run

From `apps/terminal`:

```bash
pnpm android:sync       # build the web app, copy it into the Android project
pnpm android:open       # open in Android Studio, then press Run
```

Or straight to an APK without opening Studio:

```bash
pnpm android:debug      # android/app/build/outputs/apk/debug/app-debug.apk
```

Sideload it:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Enable **Developer options → USB debugging** on the phone first.

For a Play upload:

```bash
pnpm android:release    # android/app/build/outputs/bundle/release/app-release.aab
```

That needs a signing config. **Keep the keystore off the repo** — `*.keystore`
and `*.jks` are gitignored, and losing it means you can never update the
listing again.

## What the manifest says, and why

`android/app/src/main/AndroidManifest.xml` is **tracked in git**, not
regenerated. It carries three decisions `cap sync` would not reproduce.

### `windowSoftInputMode="adjustResize"`

The single most important line in the file. Without it the soft keyboard
*covers* the prompt instead of pushing it up, and a terminal you cannot see
while typing into is not a terminal. If the input ever disappears behind the
keyboard, this is what regressed.

### No `INTERNET` permission

Capacitor adds it by default. It is removed on purpose.

The game is entirely offline — Pyodide, every asset and all content ship
inside the package. Removing the permission means the app *provably* cannot
reach the network, which is worth being able to say about a game that runs
player-authored code.

Capacitor serves the web layer through `WebViewAssetLoader` over
`https://localhost`, which is a local interception and needs no permission.

> **If the app ever shows a blank screen after a Capacitor upgrade, restore
> this line first:** `<uses-permission android:name="android.permission.INTERNET" />`

### `allowBackup="false"`

Nothing in app storage gets swept into a cloud backup. Saves are local and
disposable, and if BYO API key ever ships, a backed-up key would be a real
leak. Dead Drift shipped with `allow_backup=True`; this does not.

## Size

Pyodide is ~12 MB of the package. It is copied into `public/pyodide` by
`tools/copy-pyodide.mjs` before every build and is **not** committed.

If the download size becomes a problem, the lever is Play Asset Delivery:
ship the base game small and deliver the interpreter as an install-time
asset pack. Not worth doing until there is a listing to measure.

## Known unknowns

These have not been tested on a real device yet. They are the reason
Capacitor was wrapped at the *start* of Phase 2 rather than the end.

- **IME behaviour.** Android keyboards vary wildly. Gboard, Samsung Keyboard
  and SwiftKey all handle `autocapitalize`, autocorrect and composition text
  differently, and a terminal wants all three off.
- **Keyboard resize timing.** `adjustResize` fires an event the layout has to
  keep up with; the chip bar and prompt must not jump.
- **Safe areas.** The CSS uses `env(safe-area-inset-*)` and `100dvh`; gesture
  navigation bars and punch-hole cutouts are the things to watch.
- **Pyodide load on a cold device.** 12 MB from local assets should be fast,
  but wasm compilation on a mid-range phone is the unknown.
- **Worker support in the Android WebView.** Module workers need a recent
  WebView; `minSdk` is 23 but the WebView version matters more than the API
  level. If Python fails only on device, this is the first suspect.
