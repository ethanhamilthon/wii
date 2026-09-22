#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

[[ "$(uname -s)/$(uname -m)" == 'Darwin/arm64' ]] || { echo 'macOS arm64 required' >&2; exit 1; }
command -v bun >/dev/null || { echo 'Bun required' >&2; exit 1; }
target='/Applications/Wii.app'
[[ -d "$target" && -w /Applications ]] || { echo 'Installed Wii.app and write access to /Applications required' >&2; exit 1; }

# Build current checkout before touching installed stable.
npm ci
npm run build:pi
npm run tauri -- build --bundles app --no-sign
source_app='src-tauri/target/release/bundle/macos/Wii.app'
[[ -x "$source_app/Contents/Resources/pi/pi" ]] || { echo 'New bundle missing pi' >&2; exit 1; }
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$source_app/Contents/Info.plist")" == 'com.erdana.wii-harness' ]] || { echo 'Wrong bundle ID' >&2; exit 1; }
"$source_app/Contents/Resources/pi/pi" --version

printf 'Replace %s? Type REPLACE Wii.app: ' "$target"
read -r answer
[[ "$answer" == 'REPLACE Wii.app' ]] || { echo 'Cancelled'; exit 1; }
osascript -e 'tell application id "com.erdana.wii-harness" to quit' 2>/dev/null || true
if pgrep -f '/Applications/Wii.app/Contents/MacOS/wii-harness' >/dev/null; then
  echo 'Wii still running. Quit it manually; no replacement made.' >&2
  exit 1
fi

backup="${target}.backup-$(date +%Y%m%d-%H%M%S)"
stage="/Applications/.Wii.new-$$.app"
trap 'if [[ ! -d "$target" && -d "$backup" ]]; then mv "$backup" "$target"; fi; rm -rf "$stage"' EXIT
[[ ! -e "$backup" && ! -e "$stage" ]] || { echo 'Backup/staging path exists' >&2; exit 1; }
ditto "$source_app" "$stage"
mv "$target" "$backup"
mv "$stage" "$target"
trap - EXIT
printf 'Installed: %s\nBackup (kept for rollback): %s\n' "$target" "$backup"
