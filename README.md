# Wii prototype

Tauri/Rust desktop harness over pi RPC.

## Included

- bundled standalone pi `0.86.1`; user pi and system Node are unused
- isolated app-owned `HOME`, pi config, sessions, and workspace
- OpenAI-compatible provider settings: base URL, model, API key
- streamed final answer and visible tool calls/results
- new session and abort controls

Base URL, model, and API key persist in app data (`provider.json`, file mode `600`), the same trust model pi itself uses for `auth.json`. Settings form re-shows the saved key masked, with an eye toggle to reveal it.

## Run

```sh
npm install
npm run tauri dev
```

## Build

Bundled pi binary in `src-tauri/resources/pi/pi` currently targets macOS arm64. Rebuild it from pinned npm package with Bun:

```sh
npm run build:pi
npm run tauri build
```

Build one pi binary per target platform before producing cross-platform installers.

## Isolation

Rust launches pi with cleared environment and these app-owned paths:

- `HOME=<app-data>/home`
- `PI_CODING_AGENT_DIR=<app-data>/pi`
- `PI_CODING_AGENT_SESSION_DIR=<app-data>/sessions`
- working directory `<app-data>/workspace`

Pi also starts with user/project discovery disabled: `--no-context-files`, `--no-extensions`, `--no-skills`, `--no-prompt-templates`, `--no-themes`, and `--no-approve`.
