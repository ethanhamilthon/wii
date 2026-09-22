# Wii

Tauri v2 + Rust desktop harness over pi RPC with React 19, TypeScript, Tailwind CSS v4, and Radix UI / shadcn/ui.

## Directory Structure & Configuration Rules

Wii maintains strict separation between **User Customizations** (editable by user) and **Application Sandbox** (managed internally by Wii, non-editable by user).

### 1. User Customizations (`~/.wii/` and `<project>/.wii/`)
All user-editable settings, skills, prompts, and extensions live in:

- **Global (`~/.wii/`):**
  - `~/.wii/skills/` — Global user skills
  - `~/.wii/prompts/` — Global prompt templates
  - `~/.wii/extensions/` — Global user plugins / extensions
  - `~/.wii/themes/` — Custom themes
  - `~/.wii/agents/` — Custom agent definitions

- **Project-level (`<project>/.wii/`):**
  - `<project>/.wii/skills/` — Project-specific skills
  - `<project>/.wii/prompts/` — Project-specific prompts
  - `<project>/.wii/extensions/` — Project-specific extensions
  - `<project>/.wii/SYSTEM.md` — Project-specific system prompt overrides
  - `<project>/AGENTS.md` — Project context instructions

*Note: Legacy `.pi/` folders in projects are ignored; `<project>/.wii/` is the official configuration directory.*

### 2. Application Sandbox (`<app_data_dir>`)
All internal state that should NOT be modified manually by the user lives in the sandbox (e.g. `~/Library/Application Support/com.erdana.wii-harness/` on macOS):

- `provider.json` — Saved multi-provider configurations and API keys (mode `600`)
- `pi/models.json` — Generated OpenAI-compatible model registry for runtime
- `pi/settings.json` — Managed runtime settings
- `system-prompt.txt` — Custom system prompt configured in Command Center
- `sessions/*.jsonl` — All session history logs and agent event records
- `runtime/` — Isolated runtime binary and assets

## Development (macOS arm64)

Requires Xcode Command Line Tools, Rust/Cargo, Node.js/npm and Bun. From a clean clone:

```sh
npm ci
npm run build:pi
npm run dev:app
```

`dev:app` uses `src-tauri/tauri.dev.conf.json`: Wii Dev (`com.erdana.wii-harness.dev`), Vite port 5174, separate app data (`~/Library/Application Support/com.erdana.wii-harness.dev/`) and plugin source (`~/.wii-dev/plugins/`). Stable keeps `~/.wii/plugins/` and its own app data. No fallback to stable plugin source. LocalStorage separation depends on macOS WebView's per-app data store; verify with both installed apps before using real accounts. Both apps can run together, but share any project directory you explicitly open in both.

```sh
npm run build:dev  # creates Wii Dev.app; does not install or replace Wii.app
```

`build:pi` overwrites bundled `src-tauri/resources/pi/pi` **in this checkout**. It targets host architecture; release builds currently support macOS arm64 only.

## macOS arm64 distribution (preview)

From a clean checkout on macOS arm64, `scripts/build-macos-arm64.sh` installs lockfile dependencies, rebuilds bundled pi, runs tests, builds `Wii.app` + DMG and prints SHA-256 checksums. Upload DMG and `SHA256SUMS.txt` to a matching GitHub Release **only after** validating them on another Mac. Verify downloaded file with `shasum -a 256 <file>` against published checksum. Current build is **unsigned and unnotarized**: macOS Gatekeeper can block installation. Public signed distribution needs Developer ID signing, `xcrun notarytool submit --wait`, stapling and `spctl` verification; none is configured yet. No GitHub upload is automated.

To replace local `/Applications/Wii.app` from current checkout, run `scripts/replace-stable.sh`. It builds first, requires typed confirmation, asks Wii to quit, stages replacement, and keeps timestamped `.app` backup for rollback. It does **not** touch app data, sessions, keys or `~/.wii`. Replacement is unsigned; check Gatekeeper before relying on it. Never point script at Wii Dev. Clean-clone install, stable/dev coexistence and rollback need manual verification before release.
