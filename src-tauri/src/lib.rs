use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderSettings {
    #[serde(default = "default_provider_id")]
    id: String,
    #[serde(default = "default_provider_name")]
    name: String,
    base_url: String,
    api_key: String,
    #[serde(default)]
    models: Vec<String>,
}

fn default_provider_id() -> String {
    "default".to_string()
}
fn default_provider_name() -> String {
    "Default".to_string()
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MultiProviderConfig {
    active_id: String,
    providers: Vec<ProviderSettings>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderInput {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    base_url: String,
    api_key: String,
    #[serde(default)]
    models: Option<Vec<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionSummary {
    id: String,
    path: String,
    project_path: String,
    title: String,
    last_activity: String,
    search_text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginFile {
    id: String,
    code: String,
}

// Wii-native plugins: `index.js` is a plain CommonJS file evaluated in the
// frontend webview (`module.exports = { id, name, description, settings,
// prompt(settings), hasTools }`). An optional sibling `tools.js` is a REAL pi
// extension (registerTool/ctx.ui), loaded into pi via explicit --extension
// only when the plugin is enabled \u2014 see pi_args(). Source lives under
// default-plugins/<id>/ so it's readable/editable as real .js, not a Rust
// string; seeded onto disk once, only if ~/.wii/plugins/ is empty.
struct DefaultPlugin {
    id: &'static str,
    index_js: &'static str,
    tools_js: Option<&'static str>,
}

const DEFAULT_PLUGINS: &[DefaultPlugin] = &[
    DefaultPlugin {
        id: "caveman",
        index_js: include_str!("../default-plugins/caveman/index.js"),
        tools_js: None,
    },
    DefaultPlugin {
        id: "ask_user",
        index_js: include_str!("../default-plugins/ask_user/index.js"),
        tools_js: Some(include_str!("../default-plugins/ask_user/tools.js")),
    },
    DefaultPlugin {
        id: "todo",
        index_js: include_str!("../default-plugins/todo/index.js"),
        tools_js: Some(include_str!("../default-plugins/todo/tools.js")),
    },
    DefaultPlugin {
        id: "websearch",
        index_js: include_str!("../default-plugins/websearch/index.js"),
        tools_js: Some(include_str!("../default-plugins/websearch/tools.js")),
    },
    DefaultPlugin {
        id: "webfetch",
        index_js: include_str!("../default-plugins/webfetch/index.js"),
        tools_js: Some(include_str!("../default-plugins/webfetch/tools.js")),
    },
    DefaultPlugin {
        id: "quota",
        index_js: include_str!("../default-plugins/quota/index.js"),
        tools_js: None,
    },
];

// --- Declarative-UI plugin HTTP proxy -------------------------------------
// Webviews block cross-origin fetch from plugin JS (CORS); plugins call
// `ctx.fetch(...)` in the frontend, which routes here so the *actual*
// request leaves from the Rust process instead of the webview.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginHttpResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

#[tauri::command]
async fn plugin_http_request(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<PluginHttpResponse, String> {
    let client = reqwest::Client::new();
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = client.request(method, &url);
    for (k, v) in &headers {
        req = req.header(k, v);
    }
    if let Some(body) = body {
        req = req.body(body);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let resp_headers: HashMap<String, String> = res
        .headers()
        .iter()
        .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.to_string(), v.to_string())))
        .collect();
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(PluginHttpResponse {
        status,
        headers: resp_headers,
        body,
    })
}

// One child process per open session/tab. Keyed by an internally generated id
// (not pi's own session id) so the frontend can route events regardless of
// whether the underlying pi session is brand new or resumed from disk.
struct RunningSession {
    child: CommandChild,
    owner: String,
    label: String,
    resume_path: Option<PathBuf>,
    used: bool,
}

#[derive(Default)]
struct SessionRegistry {
    running: HashMap<String, RunningSession>,
    owners: HashMap<String, String>,
}

#[derive(Default)]
struct PiState {
    sessions: Mutex<SessionRegistry>,
    settings: Mutex<Option<ProviderSettings>>,
    system_prompt: Mutex<Option<String>>,
}

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(0);

fn gen_session_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let counter = SESSION_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{nanos:x}-{counter:x}")
}

fn app_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn prepare_runtime(app: &AppHandle) -> Result<PathBuf, String> {
    let data = app_dir(app)?;
    let runtime = data.join("runtime");
    let pi_bin = runtime.join("pi");
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/pi");
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("pi");
    let source = if source.exists() { source } else { bundled };

    fs::create_dir_all(runtime.join("theme")).map_err(|error| error.to_string())?;
    for file in ["theme/dark.json", "theme/light.json"] {
        let src = source.join(file);
        let dst = runtime.join(file);
        if src.exists() && !dst.exists() {
            let _ = fs::copy(src, dst);
        }
    }

    let src_pkg = source.join("package.json");
    let dst_pkg = runtime.join("package.json");
    if src_pkg.exists() {
        let _ = fs::copy(src_pkg, dst_pkg);
    }

    let src_pi = source.join("pi");
    let needs_copy = match (fs::metadata(&src_pi), fs::metadata(&pi_bin)) {
        (Ok(src_meta), Ok(dst_meta)) => src_meta.len() != dst_meta.len(),
        (Ok(_), Err(_)) => true,
        _ => false,
    };

    if needs_copy && src_pi.exists() {
        // Atomic copy: write to temp file then rename. NEVER overwrite a running binary in place.
        let tmp = runtime.join(format!("pi.tmp.{}", std::process::id()));
        fs::copy(&src_pi, &tmp).map_err(|error| error.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))
                .map_err(|error| error.to_string())?;
        }
        fs::rename(&tmp, &pi_bin).map_err(|error| error.to_string())?;
    } else if pi_bin.exists() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&pi_bin, fs::Permissions::from_mode(0o755));
        }
    }
    Ok(pi_bin)
}

fn write_pi_config(app: &AppHandle, settings: &ProviderSettings) -> Result<(), String> {
    let config = app_dir(app)?.join("pi");
    fs::create_dir_all(&config).map_err(|error| error.to_string())?;

    let mut model_entries: Vec<Value> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for m in &settings.models {
        if seen.insert(m.clone()) {
            model_entries.push(json!({
                "id": m,
                "name": m,
                "reasoning": true,
                "input": ["text", "image"],
                "contextWindow": 128000,
                "maxTokens": 16384,
                "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
            }));
        }
    }

    let models = json!({
        "providers": {
            "wii-openai": {
                "baseUrl": settings.base_url,
                "api": "openai-completions",
                "apiKey": "$WII_API_KEY",
                "authHeader": true,
                "compat": {
                    "supportsDeveloperRole": false,
                    "supportsReasoningEffort": true
                },
                "models": model_entries
            }
        }
    });

    let target_path = config.join("models.json");
    let tmp_path = config.join("models.json.tmp");
    let content = serde_json::to_vec_pretty(&models).map_err(|error| error.to_string())?;
    fs::write(&tmp_path, &content).map_err(|error| error.to_string())?;
    fs::rename(&tmp_path, &target_path).map_err(|error| error.to_string())?;

    fs::write(
        config.join("settings.json"),
        br#"{"enableInstallTelemetry":false,"defaultProjectTrust":"never"}"#,
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn read_provider_config(app: &AppHandle) -> Result<Option<MultiProviderConfig>, String> {
    let path = app_dir(app)?.join("provider.json");
    if !path.exists() {
        return Ok(None);
    }
    let data = fs::read(&path).map_err(|e| e.to_string())?;
    if let Ok(multi) = serde_json::from_slice::<MultiProviderConfig>(&data) {
        return Ok(Some(multi));
    }
    if let Ok(single) = serde_json::from_slice::<ProviderSettings>(&data) {
        let active_id = if single.id.is_empty() { "default".to_string() } else { single.id.clone() };
        return Ok(Some(MultiProviderConfig {
            active_id,
            providers: vec![single],
        }));
    }
    Ok(None)
}

fn system_prompt_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_dir(app)?.join("system-prompt.txt"))
}

fn user_wii_dir() -> PathBuf {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".wii")
}

fn ensure_user_wii_dirs() -> Result<PathBuf, String> {
    let wii = user_wii_dir();
    // Only "plugins" (Wii-native) matters now; skills/prompts/extensions/themes
    // are pi's own resource kinds and Wii deliberately never feeds them to pi.
    for sub in ["plugins"] {
        let _ = fs::create_dir_all(wii.join(sub));
    }

    // Seed the built-in plugins exactly once, ever \u2014 gated by a marker file so
    // a user who deletes a default plugin doesn't get it silently reinstated
    // on the next launch.
    let plugins_dir = wii.join("plugins");
    let seeded_marker = plugins_dir.join(".defaults-seeded");
    if !seeded_marker.exists() {
        for plugin in DEFAULT_PLUGINS {
            let dir = plugins_dir.join(plugin.id);
            if dir.exists() {
                continue;
            }
            let _ = fs::create_dir_all(&dir);
            let _ = fs::write(dir.join("index.js"), plugin.index_js);
            if let Some(tools_js) = plugin.tools_js {
                let _ = fs::write(dir.join("tools.js"), tools_js);
            }
        }
        let _ = fs::write(&seeded_marker, b"1");
    }

    Ok(wii)
}

// ponytail: single JS file per plugin folder, no manifest.json — the exported
// object carries its own id/name/description, one file to read instead of two.
#[tauri::command]
fn list_plugins() -> Vec<PluginFile> {
    let dir = user_wii_dir().join("plugins");
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(&dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let (id, js_path) = if path.is_dir() {
            let candidate = path.join("index.js");
            if !candidate.exists() {
                continue;
            }
            let id = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            (id, candidate)
        } else if path.extension().and_then(|e| e.to_str()) == Some("js") {
            let id = path.file_stem().and_then(|n| n.to_str()).unwrap_or("").to_string();
            (id, path.clone())
        } else {
            continue;
        };
        if let Ok(code) = fs::read_to_string(&js_path) {
            out.push(PluginFile { id, code });
        }
    }
    out
}

#[tauri::command]
fn delete_plugin(id: String) -> Result<(), String> {
    if id.is_empty() || id.contains('/') || id.contains("..") {
        return Err("Invalid plugin id".into());
    }
    let dir = user_wii_dir().join("plugins");
    let as_dir = dir.join(&id);
    let as_file = dir.join(format!("{id}.js"));
    if as_dir.is_dir() {
        fs::remove_dir_all(as_dir).map_err(|e| e.to_string())?;
    } else if as_file.is_file() {
        fs::remove_file(as_file).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn emit_line(app: &AppHandle, session_id: &str, line: &[u8]) {
    let line = line.strip_suffix(b"\r").unwrap_or(line);
    match serde_json::from_slice::<Value>(line) {
        Ok(event) => {
            let _ = app.emit(
                "pi-event",
                json!({ "sessionId": session_id, "event": event }),
            );
        }
        Err(error) => {
            let _ = app.emit(
                "pi-stderr",
                json!({ "sessionId": session_id, "message": format!("Invalid pi event: {error}") }),
            );
        }
    }
}

fn pi_args(
    model: &str,
    reasoning_effort: Option<&str>,
    session_id: &str,
    resume_path: Option<&str>,
    system_prompt: Option<&str>,
    sessions_dir: &Path,
    tool_plugins: &[String],
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--mode".into(),
        "rpc".into(),
        "--provider".into(),
        "wii-openai".into(),
        "--model".into(),
        model.to_string(),
        "--approve".into(),
        "--session-dir".into(),
        sessions_dir.to_string_lossy().to_string(),
    ];

    // Wii never feeds pi its own skills/prompt-templates/themes, and never lets
    // pi *discover* extensions on its own. Wii-native prompt customization
    // (Plugins) reaches it only as plain text via --system-prompt below.
    // The only extensions pi ever loads are `tools.js` files that Wii names
    // explicitly below, one per enabled plugin that declares it needs tools
    // (see ~/.wii/plugins/<id>/tools.js) \
    args.push("--no-skills".into());
    args.push("--no-prompt-templates".into());
    args.push("--no-extensions".into());
    args.push("--no-themes".into());

    for plugin_id in tool_plugins {
        if plugin_id.is_empty() || plugin_id.contains('/') || plugin_id.contains("..") {
            continue;
        }
        let tools_path = user_wii_dir().join("plugins").join(plugin_id).join("tools.js");
        if tools_path.exists() {
            args.push("--extension".into());
            args.push(tools_path.to_string_lossy().to_string());
        }
    }

    match resume_path {
        Some(path) => {
            args.push("--session".into());
            args.push(path.to_string());
        }
        None => {
            args.push("--session-id".into());
            args.push(session_id.to_string());
        }
    }

    if let Some(effort) = reasoning_effort {
        if !effort.is_empty() {
            args.push("--thinking".into());
            args.push(effort.to_string());
        }
    }

    if let Some(prompt) = system_prompt {
        if !prompt.trim().is_empty() {
            args.push("--system-prompt".into());
            args.push(prompt.to_string());
        }
    }

    args
}

fn project_from_session(path: &Path) -> Result<PathBuf, String> {
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    for line in text.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) == Some("session") {
            if let Some(cwd) = value.get("cwd").and_then(Value::as_str) {
                return validate_project_path(Path::new(cwd));
            }
        }
    }
    Err("Session has no project directory".into())
}

fn validate_project_path(path: &Path) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err("Project path does not exist".into());
    }
    if !path.is_dir() {
        return Err("Project path is not a directory".into());
    }
    path.canonicalize().map_err(|error| error.to_string())
}

fn spawn_session(
    app: &AppHandle,
    state: &PiState,
    label: &str,
    owner: &str,
    resume_path: Option<String>,
    project_path: Option<String>,
    tool_plugins: Vec<String>,
    model: String,
    reasoning_effort: Option<String>,
) -> Result<String, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "Settings lock poisoned".to_string())?
        .clone()
        .ok_or("Save provider settings first")?;
    let system_prompt = state
        .system_prompt
        .lock()
        .map_err(|_| "System prompt lock poisoned".to_string())?
        .clone();
    let project = match project_path.as_deref() {
        Some(path) => validate_project_path(Path::new(path))?,
        None => match resume_path.as_deref() {
            Some(path) => project_from_session(Path::new(path))?,
            None => return Err("Choose a project directory".into()),
        },
    };
    let data = app_dir(app)?;
    let config = data.join("pi");
    let sessions = data.join("sessions");
    let home = data.join("home");
    for dir in [&config, &sessions, &home] {
        fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    }
    let binary = prepare_runtime(app)?;
    let _ = ensure_user_wii_dirs()?; // makes sure ~/.wii/plugins exists to scan
    let path = std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin".into());
    let session_id = gen_session_id();
    let args = pi_args(
        &model,
        reasoning_effort.as_deref(),
        &session_id,
        resume_path.as_deref(),
        system_prompt.as_deref(),
        &sessions,
        &tool_plugins,
    );
    let mut command = app
        .shell()
        .command(binary)
        .env_clear()
        .env("HOME", &home)
        .env("PATH", path)
        .env("PI_CODING_AGENT_DIR", &config)
        .env("PI_CODING_AGENT_SESSION_DIR", &sessions)
        .env("WII_CODING_AGENT_DIR", &config)
        .env("WII_CODING_AGENT_SESSION_DIR", &sessions)
        .env("PI_SKIP_VERSION_CHECK", "1")
        .env("PI_TELEMETRY", "0")
        .env("WII_API_KEY", settings.api_key.as_str())
        .current_dir(project)
        .args(args)
        .set_raw_out(true);
    #[cfg(unix)]
    {
        command = command.env("SHELL", "/bin/sh");
    }
    let resume = resume_path.as_deref().map(|path| fs::canonicalize(path).map_err(|e| e.to_string())).transpose()?;
    let mut registry = state.sessions.lock().map_err(|_| "Session lock poisoned".to_string())?;
    if registry.owners.get(label).map(String::as_str) != Some(owner) {
        return Err("WebView owner expired".into());
    }
    if let Some(path) = &resume {
        if registry.running.iter().any(|(id, session)| {
            session.resume_path.as_ref() == Some(path)
                || (session.resume_path.is_none() && session_file(&sessions, id).as_ref() == Some(path))
        }) {
            return Err("Session file already open".into());
        }
    }
    let (mut rx, child) = command.spawn().map_err(|error| error.to_string())?;
    registry.running.insert(session_id.clone(), RunningSession {
        child,
        owner: owner.to_string(),
        label: label.to_string(),
        resume_path: resume,
        used: false,
    });
    drop(registry);

    let app = app.clone();
    let sid = session_id.clone();
    tauri::async_runtime::spawn(async move {
        let mut stdout = Vec::new();
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(chunk) => {
                    stdout.extend_from_slice(&chunk);
                    while let Some(index) = stdout.iter().position(|byte| *byte == b'\n') {
                        let line: Vec<u8> = stdout.drain(..=index).collect();
                        emit_line(&app, &sid, &line[..line.len() - 1]);
                    }
                }
                CommandEvent::Stderr(chunk) => {
                    let msg = String::from_utf8_lossy(&chunk).to_string();
                    if !msg.trim().starts_with("Warning:") {
                        let _ = app.emit(
                            "pi-stderr",
                            json!({ "sessionId": sid, "message": msg }),
                        );
                    }
                }
                CommandEvent::Error(error) => {
                    let _ = app.emit("pi-stderr", json!({ "sessionId": sid, "message": error }));
                }
                CommandEvent::Terminated(status) => {
                    if !stdout.is_empty() {
                        emit_line(&app, &sid, &stdout);
                    }
                    let _ = app.emit("pi-exit", json!({ "sessionId": sid, "status": status }));
                    break;
                }
                _ => {}
            }
        }
        if let Some(state) = app.try_state::<PiState>() {
            if let Ok(mut sessions) = state.sessions.lock() {
                sessions.running.remove(&sid);
            }
        }
    });
    Ok(session_id)
}

fn send(state: &PiState, session_id: &str, value: Value) -> Result<(), String> {
    let is_prompt = value.get("type").and_then(Value::as_str) == Some("prompt");
    let mut line = serde_json::to_vec(&value).map_err(|error| error.to_string())?;
    line.push(b'\n');
    let mut registry = state.sessions.lock().map_err(|_| "Session lock poisoned".to_string())?;
    let session = registry.running.get_mut(session_id).ok_or("Session is not running")?;
    session.child.write(&line).map_err(|error| error.to_string())?;
    if is_prompt { session.used = true; }
    Ok(())
}

fn extract_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(|text| text.as_str()))
            .collect::<Vec<_>>()
            .join(" "),
        _ => String::new(),
    }
}

#[tauri::command]
fn get_providers(app: AppHandle) -> Result<Option<MultiProviderConfig>, String> {
    read_provider_config(&app)
}

#[tauri::command]
fn save_providers(
    app: AppHandle,
    state: State<PiState>,
    config: MultiProviderConfig,
) -> Result<(), String> {
    if config.providers.is_empty() {
        return Err("At least one provider is required".into());
    }
    let active = config
        .providers
        .iter()
        .find(|p| p.id == config.active_id)
        .or_else(|| config.providers.first())
        .cloned()
        .ok_or("Active provider not found")?;

    let path = app_dir(&app)?.join("provider.json");
    let json_bytes = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, &json_bytes).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }

    write_pi_config(&app, &active)?;
    *state.settings.lock().map_err(|_| "Settings lock poisoned")? = Some(active);
    Ok(())
}

#[tauri::command]
fn get_provider(app: AppHandle) -> Result<Option<ProviderSettings>, String> {
    let config = read_provider_config(&app)?;
    Ok(config.and_then(|c| {
        c.providers
            .into_iter()
            .find(|p| p.id == c.active_id)
            .or_else(|| None)
    }))
}

#[tauri::command]
fn save_provider(
    app: AppHandle,
    state: State<PiState>,
    input: ProviderInput,
) -> Result<(), String> {
    if !(input.base_url.starts_with("http://") || input.base_url.starts_with("https://")) {
        return Err("Base URL must start with http:// or https://".into());
    }
    if input.api_key.trim().is_empty() {
        return Err("API key is required".into());
    }

    let mut config = read_provider_config(&app)?.unwrap_or_else(|| MultiProviderConfig {
        active_id: "default".to_string(),
        providers: Vec::new(),
    });

    let target_id = input.id.unwrap_or_else(|| config.active_id.clone());
    let target_name = input.name.unwrap_or_else(|| "Default".to_string());

    if let Some(existing) = config.providers.iter_mut().find(|p| p.id == target_id) {
        existing.base_url = input.base_url.trim_end_matches('/').to_string();
        existing.api_key = input.api_key.trim().to_string();
        if let Some(m) = input.models {
            existing.models = m;
        }
    } else {
        config.providers.push(ProviderSettings {
            id: target_id.clone(),
            name: target_name,
            base_url: input.base_url.trim_end_matches('/').to_string(),
            api_key: input.api_key.trim().to_string(),
            models: input.models.unwrap_or_default(),
        });
    }
    config.active_id = target_id;

    save_providers(app, state, config)
}

#[tauri::command]
fn get_system_prompt(app: AppHandle) -> Result<String, String> {
    let path = system_prompt_path(&app)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_system_prompt(app: AppHandle, state: State<PiState>, text: String) -> Result<(), String> {
    fs::write(system_prompt_path(&app)?, text.as_bytes()).map_err(|error| error.to_string())?;
    *state
        .system_prompt
        .lock()
        .map_err(|_| "System prompt lock poisoned")? = if text.trim().is_empty() {
        None
    } else {
        Some(text)
    };
    Ok(())
}

#[tauri::command]
fn create_session(
    app: AppHandle,
    window: WebviewWindow,
    state: State<PiState>,
    owner: String,
    resume_path: Option<String>,
    project_path: Option<String>,
    tool_plugins: Option<Vec<String>>,
    model: String,
    reasoning_effort: Option<String>,
) -> Result<String, String> {
    spawn_session(
        &app,
        &state,
        window.label(),
        &owner,
        resume_path,
        project_path,
        tool_plugins.unwrap_or_default(),
        model,
        reasoning_effort,
    )
}

#[tauri::command]
fn set_session_model(state: State<PiState>, session_id: String, model: String) -> Result<(), String> {
    send(
        &state,
        &session_id,
        json!({
            "type": "set_model",
            "provider": "wii-openai",
            "modelId": model
        }),
    )
}

#[tauri::command]
fn set_session_thinking(state: State<PiState>, session_id: String, effort: String) -> Result<(), String> {
    send(
        &state,
        &session_id,
        json!({
            "type": "set_thinking_level",
            "level": effort
        }),
    )
}

// Answers a pending `extension_ui_request` (select/confirm/input/editor) a
// plugin tool raised via `ctx.ui.*` \u2014 see docs/rpc.md "Extension UI Protocol".
// Wii renders the request generically; it never needs to know which plugin
// or tool asked.
#[tauri::command]
fn answer_extension_ui(
    state: State<PiState>,
    session_id: String,
    id: String,
    response: Value,
) -> Result<(), String> {
    let mut payload = match response {
        Value::Object(map) => map,
        _ => serde_json::Map::new(),
    };
    payload.insert("type".into(), json!("extension_ui_response"));
    payload.insert("id".into(), json!(id));
    send(&state, &session_id, Value::Object(payload))
}

#[tauri::command]
fn send_message(state: State<PiState>, session_id: String, message: String) -> Result<(), String> {
    if message.trim().is_empty() {
        return Err("Message is empty".into());
    }
    send(
        &state,
        &session_id,
        json!({ "type": "prompt", "message": message }),
    )
}

#[tauri::command]
fn abort(state: State<PiState>, session_id: String) -> Result<(), String> {
    send(&state, &session_id, json!({ "type": "abort" }))
}

fn session_file(dir: &Path, id: &str) -> Option<PathBuf> {
    fs::read_dir(dir).ok()?.flatten().map(|entry| entry.path()).find(|path| {
        path.file_name().and_then(|n| n.to_str()).is_some_and(|name| name.ends_with(&format!("-{id}.jsonl")))
    })
}

fn empty_history(path: &Path) -> Result<bool, String> {
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(text.lines().filter(|line| !line.trim().is_empty()).all(|line| {
        serde_json::from_str::<Value>(line).ok().and_then(|v| v.get("type").and_then(Value::as_str).map(str::to_string)).as_deref() == Some("session")
    }))
}

fn stop_window_sessions(registry: &mut SessionRegistry, label: &str) -> Result<(), String> {
    let ids: Vec<String> = registry.running.iter().filter(|(_, s)| s.label == label).map(|(id, _)| id.clone()).collect();
    for id in ids {
        if let Some(session) = registry.running.remove(&id) {
            session.child.kill().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn register_webview(state: State<PiState>, window: WebviewWindow, owner: String) -> Result<(), String> {
    let mut registry = state.sessions.lock().map_err(|_| "Session lock poisoned".to_string())?;
    let label = window.label();
    if registry.owners.get(label) == Some(&owner) { return Ok(()); }
    // Reload replaces only children of this WebView, never another window.
    stop_window_sessions(&mut registry, label)?;
    registry.owners.insert(label.to_string(), owner);
    Ok(())
}

#[tauri::command]
fn close_session(app: AppHandle, window: WebviewWindow, state: State<PiState>, owner: String, session_id: String) -> Result<(), String> {
    let mut registry = state.sessions.lock().map_err(|_| "Session lock poisoned".to_string())?;
    if registry.owners.get(window.label()) != Some(&owner) { return Err("WebView owner expired".into()); }
    let session = registry.running.get(&session_id).ok_or("Session is not running")?;
    if session.owner != owner || session.label != window.label() { return Err("Session belongs to another WebView".into()); }
    let session = registry.running.remove(&session_id).unwrap();
    let new_session = session.resume_path.is_none() && !session.used;
    session.child.kill().map_err(|e| e.to_string())?;
    drop(registry);
    if new_session {
        if let Some(path) = session_file(&app_dir(&app)?.join("sessions"), &session_id) {
            // Cleanup failure must not report a still-running child after successful kill.
            if matches!(empty_history(&path), Ok(true)) {
                if let Err(error) = fs::remove_file(path) { eprintln!("Cannot remove empty session: {error}"); }
            }
        }
    }
    Ok(())
}

// ponytail: shells out to `git`, no libgit2 dep for one rev-parse call.
#[tauri::command]
fn get_git_branch(project_path: String) -> Option<String> {
    let out = std::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&project_path)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let branch = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if branch.is_empty() || branch == "HEAD" {
        None
    } else {
        Some(branch)
    }
}

// ponytail: full directory scan stays until session counts make an index worthwhile.
#[tauri::command]
fn list_sessions(app: AppHandle) -> Result<Vec<SessionSummary>, String> {
    let dir = app_dir(&app)?.join("sessions");
    let mut out = Vec::new();
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(out),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let mut id = path
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_string())
            .unwrap_or_default();
        let mut title = String::new();
        let mut search_text = String::new();
        let mut last_activity = String::new();
        let mut project_path = String::new();
        for line in text.lines() {
            let Ok(value) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            if let Some(timestamp) = value.get("timestamp").and_then(|ts| ts.as_str()) {
                last_activity = timestamp.to_string();
            }
            match value.get("type").and_then(|t| t.as_str()) {
                Some("session") => {
                    if let Some(session_id) = value.get("id").and_then(|i| i.as_str()) {
                        id = session_id.to_string();
                    }
                    if let Some(cwd) = value.get("cwd").and_then(|value| value.as_str()) {
                        project_path = cwd.to_string();
                    }
                }
                Some("message") => {
                    let Some(message) = value.get("message") else {
                        continue;
                    };
                    let role = message.get("role").and_then(|r| r.as_str()).unwrap_or("");
                    if role != "user" && role != "assistant" {
                        continue;
                    }
                    let text = extract_text(message.get("content").unwrap_or(&Value::Null));
                    if text.is_empty() {
                        continue;
                    }
                    if role == "user" && title.is_empty() {
                        title = text.chars().take(80).collect();
                    }
                    if search_text.len() < 20_000 {
                        search_text.push(' ');
                        search_text.push_str(&text);
                    }
                }
                _ => {}
            }
        }
        if last_activity.is_empty() {
            continue; // not a real/complete session file
        }
        out.push(SessionSummary {
            id,
            path: path.to_string_lossy().to_string(),
            project_path,
            title: if title.is_empty() {
                "New session".into()
            } else {
                title
            },
            last_activity,
            search_text,
        });
    }
    out.sort_by(|a, b| b.last_activity.cmp(&a.last_activity));
    Ok(out)
}

#[tauri::command]
fn get_session_history(path: String) -> Result<Vec<Value>, String> {
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    for line in text.lines() {
        if let Ok(val) = serde_json::from_str::<Value>(line) {
            entries.push(val);
        }
    }
    Ok(entries)
}

#[tauri::command]
fn get_session_path(app: AppHandle, session_id: String) -> Result<Option<String>, String> {
    Ok(session_file(&app_dir(&app)?.join("sessions"), &session_id)
        .map(|path| path.to_string_lossy().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_project_path() {
        let path = std::env::temp_dir().join(format!("wii-missing-{}", gen_session_id()));
        assert_eq!(
            validate_project_path(&path).unwrap_err(),
            "Project path does not exist"
        );
    }

    #[test]
    fn only_exact_empty_new_history_is_deletable() {
        let dir = std::env::temp_dir().join(format!("wii-session-test-{}", gen_session_id()));
        fs::create_dir(&dir).unwrap();
        let target = dir.join("2026-01-01-abc.jsonl");
        let other = dir.join("2026-01-01-xabc.jsonl");
        fs::write(&target, "{\"type\":\"session\"}\n").unwrap();
        fs::write(&other, "{\"type\":\"message\"}\n").unwrap();
        assert_eq!(session_file(&dir, "abc"), Some(target.clone()));
        assert!(empty_history(&target).unwrap());
        fs::write(&target, "{\"type\":\"session\"}\n{\"type\":\"message\"}\n").unwrap();
        assert!(!empty_history(&target).unwrap());
        fs::write(&target, "not json").unwrap();
        assert!(!empty_history(&target).unwrap());
        fs::remove_dir_all(dir).unwrap();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(PiState::default())
        .setup(|app| {
            let _ = prepare_runtime(app.handle());
            let _ = ensure_user_wii_dirs();
            if let Ok(Some(config)) = read_provider_config(app.handle()) {
                if let Some(active) = config.providers.iter().find(|p| p.id == config.active_id) {
                    *app.state::<PiState>().settings.lock().unwrap() = Some(active.clone());
                }
            }
            let prompt_path = system_prompt_path(app.handle())?;
            if prompt_path.exists() {
                if let Ok(text) = fs::read_to_string(prompt_path) {
                    if !text.trim().is_empty() {
                        *app.state::<PiState>().system_prompt.lock().unwrap() = Some(text);
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<PiState>() {
                    if let Ok(mut registry) = state.sessions.lock() {
                        if let Err(error) = stop_window_sessions(&mut registry, window.label()) {
                            eprintln!("Cannot stop WebView children: {error}");
                        }
                        registry.owners.remove(window.label());
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_provider,
            save_provider,
            get_providers,
            save_providers,
            get_system_prompt,
            save_system_prompt,
            register_webview,
            create_session,
            set_session_model,
            set_session_thinking,
            send_message,
            abort,
            close_session,
            answer_extension_ui,
            get_git_branch,
            list_plugins,
            delete_plugin,
            plugin_http_request,
            list_sessions,
            get_session_history,
            get_session_path
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Kill any still-running pi child processes when the app quits so
            // they don't linger as orphans.
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<PiState>() {
                    if let Ok(mut sessions) = state.sessions.lock() {
                        for (_, session) in sessions.running.drain() {
                            let _ = session.child.kill();
                        }
                    }
                }
            }
        });
}
