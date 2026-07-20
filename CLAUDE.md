# CMCA Player App — Android APK

This is the **CMCA Session Player** Android app. It is a standalone project —
do NOT modify files in `cmca-pulse`, `kreis-demo`, or any other repo from here.

## What this is

Offline session player for Android tablets (Lenovo Tab M8 HD). Teachers download
session zips on WiFi, then play them fully offline in classrooms. Built for CMCA
India — no A2Z branding in user-facing surfaces.

## Architecture

WebView app serving content from a local NanoHTTPd server on localhost.

| Component | File | Purpose |
|---|---|---|
| LocalServer | `app/src/main/kotlin/org/cmca/player/LocalServer.kt` | NanoHTTPd routes: `/player/*` → APK assets, `/sessions/*` → device storage. HTTP Range for video seeking. **Critical routing rule:** `player/sessions/` must come BEFORE generic `player/` (media assets resolve as relative paths from player.html). |
| PlayerBridge | `app/src/main/kotlin/org/cmca/player/PlayerBridge.kt` | `@JavascriptInterface` bridge (`window.Android.*`). Login, session CRUD, app update. Uses manual redirect-following for GitHub URLs (Java HttpURLConnection doesn't follow cross-host redirects). |
| SessionManager | `app/src/main/kotlin/org/cmca/player/SessionManager.kt` | Remote manifest fetch, zip download/extract, local manifest merge, storage info. |
| MainActivity | `app/src/main/kotlin/org/cmca/player/MainActivity.kt` | WebView config, fullscreen video, back button = minimize (not logout). |
| player.js | `app/src/main/assets/player/js/player.js` | Session slide renderer (27 slide types, ~1100 lines). |
| index.html | `app/src/main/assets/player/index.html` | Two-tab session picker (My Sessions / Browse), download/delete/play, app update banner. |
| login.html | `app/src/main/assets/player/login.html` | SHA-256 credential check. |
| player.css | `app/src/main/assets/player/css/player.css` | All player styles. |

## Build

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
GRADLE_BIN=~/.gradle/wrapper/dists/gradle-8.5-bin/5t9huq95ubn472n8rpzujfbqh/gradle-8.5/bin/gradle
$GRADLE_BIN clean assembleDebug --project-dir "/Users/admin/Desktop/DEV: Sessions/cmca-player-app"
```

- **Always `clean` before build** — spaces in project path cause classpath issues without it.
- `gradlew` wrapper doesn't work (spaces in path break it). Use the global gradle binary above.
- APK output: `app/build/outputs/apk/debug/app-debug.apk`

## Release

Use `./release.sh "changelog message"` — auto-bumps version, builds, uploads APK + app-version.json to GitHub Release.

Or manually:
```bash
unset GH_TOKEN && unset GITHUB_TOKEN
gh release upload v1.0.0 CMCAPlayer-debug.apk app-version.json \
  --repo hestia-madhav/kreis-session-player-app --clobber
```

**GitHub auth note:** `unset GH_TOKEN && unset GITHUB_TOKEN` is required before every `gh` command.

## Session content updates (no APK rebuild needed)

Session content (slides, videos, audio) lives in zip files on GitHub Releases, NOT in the APK.
To update session content: rebuild the session zip, upload to the GitHub Release, bump the version
in `manifest.json`. Teachers tap Refresh in the app to pull new sessions.

Only app code changes (Kotlin, HTML, JS, CSS in this repo) need a new APK build.

## Key gotchas

1. **LocalServer routing order matters.** `player/sessions/` MUST come before `player/` in the `when` block, otherwise media assets 404 (browser resolves relative paths against `/player/player.html`).
2. **Tip auto-show uses `updateTip()`, not `render()`.** Full `render()` replaces the DOM and kills playing audio/video. The `updateTip()` function only touches tip button/panel elements.
3. **Java HttpURLConnection cross-host redirects.** GitHub releases redirect across hosts. All HTTP fetches use manual `followRedirects()` / `fetchWithRedirects()`.
4. **Login credentials** are in `app/src/main/assets/credentials.json` (SHA-256 hashed passwords). Currently: `cmca_admin` and `kreis_demo`, both password "password".
5. **Version bumping** — `versionCode` and `versionName` in `app/build.gradle.kts`. Current: code 11, name "1.0.10".

## Never-do list

- Do NOT modify files outside this project directory
- Do NOT put A2Z or Hestia branding in user-facing surfaces — this is CMCA only
- Do NOT use `render()` for tip show/hide — use `updateTip()` (kills media playback)
- Do NOT skip `clean` in the build command (classpath errors from spaces in path)
- Do NOT use `gradlew` (broken due to spaces in path)
- Do NOT commit secrets or credentials in plain text
