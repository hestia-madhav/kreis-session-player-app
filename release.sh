#!/bin/bash
# CMCA Player — build and release script
# Usage: ./release.sh "changelog message"
#
# What it does:
#   1. Reads current version from build.gradle.kts
#   2. Bumps patch version (1.0.2 → 1.0.3)
#   3. Builds the debug APK
#   4. Updates app-version.json
#   5. Uploads APK + app-version.json to GitHub Release

set -e

REPO="hestia-madhav/kreis-session-player-app"
RELEASE_TAG="v1.0.0"
GRADLE_FILE="app/build.gradle.kts"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
GRADLE_BIN=$(find ~/.gradle/wrapper/dists -name "gradle" -path "*/bin/gradle" 2>/dev/null | head -1)

if [ -z "$GRADLE_BIN" ]; then
  echo "ERROR: Gradle not found. Open project in Android Studio first."
  exit 1
fi

# --- 1. Read current version ---
CURRENT_VERSION=$(grep 'versionName' "$GRADLE_FILE" | head -1 | sed 's/.*"\(.*\)".*/\1/')
CURRENT_CODE=$(grep 'versionCode' "$GRADLE_FILE" | head -1 | sed 's/[^0-9]*//g')
echo "Current: v$CURRENT_VERSION (code $CURRENT_CODE)"

# --- 2. Bump patch version ---
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
NEW_PATCH=$((PATCH + 1))
NEW_VERSION="$MAJOR.$MINOR.$NEW_PATCH"
NEW_CODE=$((CURRENT_CODE + 1))
echo "    New: v$NEW_VERSION (code $NEW_CODE)"

sed -i '' "s/versionCode = $CURRENT_CODE/versionCode = $NEW_CODE/" "$GRADLE_FILE"
sed -i '' "s/versionName = \"$CURRENT_VERSION\"/versionName = \"$NEW_VERSION\"/" "$GRADLE_FILE"

# --- 3. Build ---
echo "Building APK..."
"$GRADLE_BIN" assembleDebug --project-dir "$SCRIPT_DIR" -q
APK="$SCRIPT_DIR/app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$APK" ]; then
  echo "ERROR: Build failed — no APK produced."
  exit 1
fi
cp "$APK" "$SCRIPT_DIR/CMCAPlayer-debug.apk"
echo "Built: CMCAPlayer-debug.apk ($(du -h "$SCRIPT_DIR/CMCAPlayer-debug.apk" | cut -f1))"

# --- 4. Update app-version.json ---
CHANGELOG="${1:-Bug fixes and improvements.}"
cat > "$SCRIPT_DIR/app-version.json" << EOF
{
  "version": "$NEW_VERSION",
  "versionCode": $NEW_CODE,
  "downloadUrl": "https://github.com/$REPO/releases/latest/download/CMCAPlayer-debug.apk",
  "changelog": "$CHANGELOG"
}
EOF
echo "app-version.json → v$NEW_VERSION"

# --- 5. Upload to GitHub Release ---
echo "Uploading to GitHub Release $RELEASE_TAG..."
unset GH_TOKEN 2>/dev/null
unset GITHUB_TOKEN 2>/dev/null
gh release upload "$RELEASE_TAG" \
  "$SCRIPT_DIR/CMCAPlayer-debug.apk" \
  "$SCRIPT_DIR/app-version.json" \
  --repo "$REPO" --clobber

echo ""
echo "=== Released v$NEW_VERSION ==="
echo "Download: https://github.com/$REPO/releases"
echo "Tablets will see the update on next Refresh."
