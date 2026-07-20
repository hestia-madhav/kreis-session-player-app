# CMCA Session Player — Android APK

Offline-capable Android app wrapping the CMCA session player for tablet
deployment (Lenovo Tab M8 HD and similar). WebView + embedded NanoHTTPd
local server. Zero changes to the vanilla JS player.

## Quick start

1. Open in Android Studio (Arctic Fox or later)
2. Sync Gradle
3. Connect tablet via USB, enable developer mode
4. Run → select device → install

## Architecture

- **LocalServer.kt** — NanoHTTPd on a random port, serves `/player/*` from
  APK assets and `/sessions/*` from device storage. Supports HTTP Range
  requests for video seeking.
- **MainActivity.kt** — WebView with fullscreen video support. Routes
  login/logout and session management via JavaScript bridge.
- **PlayerBridge.kt** — `@JavascriptInterface` bridge exposing login,
  session manifest, download/delete, connectivity, and storage info.
- **SessionManager.kt** — Downloads session zips from remote hosting,
  extracts to device storage, tracks local manifest.

## Login

Default credentials (SHA-256 hashed in `assets/credentials.json`):
- `cmca_admin` / `password`
- `kreis_demo` / `password`

**Change these before production.** To generate a hash:
```
echo -n "your_password" | shasum -a 256 | cut -d' ' -f1
```

## Updating sessions

Sessions are downloaded on-demand from a remote manifest. No APK rebuild needed.

1. Run `node scripts/build-session-zips.js` in the kreis-demo project
2. Upload zips + manifest.json to your hosting (GitHub Releases, S3, etc.)
3. Replace `{{BASE_URL}}` in manifest.json with the actual URL
4. In the app: Settings → set remote manifest URL
5. Users tap "Refresh" to see new/updated sessions

## Session zip format

Each zip contains:
```
data/<id>.en.js    — English session data
data/<id>.kn.js    — Kannada session data
assets/            — Media files (mp4, mp3, jpg, png, gif)
```

## Project structure

```
cmca-player-app/
├── app/src/main/
│   ├── assets/
│   │   ├── credentials.json          Login credentials
│   │   └── player/                   Offline player (copied from kreis-demo)
│   │       ├── css/fonts.css, player.css
│   │       ├── fonts/*.woff2
│   │       ├── js/player.js          Vanilla JS player (unchanged)
│   │       ├── index.html            Session picker (APK-aware)
│   │       ├── login.html            Login screen
│   │       └── player.html           Session player
│   ├── kotlin/org/cmca/player/
│   │   ├── LocalServer.kt
│   │   ├── MainActivity.kt
│   │   ├── PlayerBridge.kt
│   │   └── SessionManager.kt
│   └── res/
├── build.gradle.kts
└── settings.gradle.kts
```

## Requirements

- Min SDK 21 (Android 5.0)
- Target SDK 34
- Single dependency: NanoHTTPd 2.3.1
