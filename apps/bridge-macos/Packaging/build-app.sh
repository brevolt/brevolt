#!/usr/bin/env bash
# Builds Brevolt Bridge.app and signs it with the Developer ID identity (hardened runtime).
# Usage: build-app.sh <version> <out-dir>
# Env: SIGN_IDENTITY (default "-" = ad-hoc, for local builds only).
set -euo pipefail
VERSION="${1:?version}"; OUT="${2:?out dir}"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/.."
IDENTITY="${SIGN_IDENTITY:--}"
APP="$OUT/Brevolt Bridge.app"

cd "$ROOT"
swift build -c release --arch arm64 --arch x86_64
BIN="$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)/BrevoltBridge"

rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS"
cp "$BIN" "$APP/Contents/MacOS/BrevoltBridge"
sed "s/__VERSION__/${VERSION}/g" "$HERE/Info.plist" > "$APP/Contents/Info.plist"
codesign --force --timestamp --options runtime \
  --entitlements "$HERE/BrevoltBridge.entitlements" --sign "$IDENTITY" "$APP"
codesign --verify --strict --verbose=2 "$APP"
echo "$APP"
