#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
pkg="$root/node_modules/@earendil-works/pi-coding-agent"
out="$root/src-tauri/resources/pi"

command -v bun >/dev/null || { echo "bun is required to rebuild bundled pi" >&2; exit 1; }
mkdir -p "$out/theme"
bun build --compile "$pkg/dist/bundle/cli-runtime.js" --outfile "$out/pi"
cp "$pkg/dist/modes/interactive/theme/dark.json" "$out/theme/dark.json"
cp "$pkg/dist/modes/interactive/theme/light.json" "$out/theme/light.json"
"$out/pi" --version
