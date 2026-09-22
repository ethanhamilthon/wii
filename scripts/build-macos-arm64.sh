#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

[[ "$(uname -s)/$(uname -m)" == 'Darwin/arm64' ]] || { echo 'macOS arm64 required' >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo 'Clean checkout required' >&2; exit 1; }
command -v bun >/dev/null && command -v cargo >/dev/null || { echo 'Bun and Rust required' >&2; exit 1; }

npm ci
npm run build:pi
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --target aarch64-apple-darwin --bundles app dmg --no-sign

app='src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Wii.app'
[[ -d "$app" && -x "$app/Contents/Resources/pi/pi" ]] || { echo 'Bundled pi missing' >&2; exit 1; }
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")" == 'com.erdana.wii-harness' ]] || { echo 'Wrong bundle ID' >&2; exit 1; }
file "$app/Contents/Resources/pi/pi" | grep -q 'arm64' || { echo 'pi is not arm64' >&2; exit 1; }
"$app/Contents/Resources/pi/pi" --version
shopt -s nullglob
dmgs=(src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg)
((${#dmgs[@]})) || { echo 'DMG missing' >&2; exit 1; }
shasum -a 256 "${dmgs[@]}" | tee src-tauri/target/aarch64-apple-darwin/release/bundle/SHA256SUMS.txt
printf '\nUnsigned, unnotarized preview only. Do not publish as signed release.\n'
