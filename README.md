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

## Run

```sh
npm install
npm run tauri dev
```

## Build

Bundled pi binary in `src-tauri/resources/pi/pi` targets macOS arm64. Rebuild it from pinned npm package with Bun:

```sh
npm run build:pi
npm run build
npm run tauri build
```
