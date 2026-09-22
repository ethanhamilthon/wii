#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
pkg="$root/node_modules/@earendil-works/pi-coding-agent"
out="$root/src-tauri/resources/pi"

command -v bun >/dev/null || { echo "bun is required to rebuild bundled pi" >&2; exit 1; }
mkdir -p "$out/theme"
cat << 'EOF' > "$out/package.json"
{
  "name": "wii",
  "version": "0.1.0",
  "piConfig": {
    "name": "wii",
    "configDir": ".wii"
  }
}
EOF
# cli-runtime.js (the npm bundle entry) turns jiti's static import into a
# dynamic createRequire("jiti") that `bun build --compile` can't trace, so any
# --extension load fails at runtime with "Cannot find module 'jiti'". The
# dedicated Bun entrypoint keeps the static import, letting bun embed jiti's
# babel transform directly into the binary. See docs/plugins.md.
bun build --compile --no-compile-autoload-bunfig \
  "$pkg/dist/bun/cli.js" "$pkg/dist/utils/image-resize-worker.js" \
  --outfile "$out/pi"
cp "$pkg/dist/modes/interactive/theme/dark.json" "$out/theme/dark.json"
cp "$pkg/dist/modes/interactive/theme/light.json" "$out/theme/light.json"
"$out/pi" --version
