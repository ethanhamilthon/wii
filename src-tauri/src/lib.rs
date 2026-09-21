use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State};
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
    model: String,
    api_key: String,
    #[serde(default)]
    reasoning_effort: Option<String>,
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
    model: String,
    api_key: String,
    #[serde(default)]
    reasoning_effort: Option<String>,
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

// One child process per open session/tab. Keyed by an internally generated id
// (not pi's own session id) so the frontend can route events regardless of
// whether the underlying pi session is brand new or resumed from disk.
#[derive(Default)]
struct PiState {
    sessions: Mutex<HashMap<String, CommandChild>>,
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
    let reasoning = settings
        .reasoning_effort
        .as_deref()
        .map(|v| !v.is_empty())
        .unwrap_or(false);

    let mut model_entries: Vec<Value> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    seen.insert(settings.model.clone());
    model_entries.push(json!({
        "id": settings.model,
        "name": settings.model,
        "reasoning": reasoning,
        "input": ["text", "image"],
        "contextWindow": 128000,
        "maxTokens": 16384,
        "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
    }));

    for m in &settings.models {
        if seen.insert(m.clone()) {
            model_entries.push(json!({
                "id": m,
                "name": m,
                "reasoning": reasoning,
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
                    "supportsReasoningEffort": reasoning
                },
                "models": model_entries
            }
        }
    });
    fs::write(
        config.join("models.json"),
        serde_json::to_vec_pretty(&models).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
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
    settings: &ProviderSettings,
    session_id: &str,
    resume_path: Option<&str>,
    system_prompt: Option<&str>,
) -> Vec<String> {
    let mut args: Vec<String> = [
        "--mode",
        "rpc",
        "--provider",
        "wii-openai",
        "--model",
        settings.model.as_str(),
        "--no-context-files",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--no-approve",
    ]
    .iter()
    .map(|value| value.to_string())
    .collect();

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

    if let Some(effort) = settings.reasoning_effort.as_deref() {
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
    resume_path: Option<String>,
    project_path: Option<String>,
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
    let path = std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin".into());
    let session_id = gen_session_id();
    let args = pi_args(
        &settings,
        &session_id,
        resume_path.as_deref(),
        system_prompt.as_deref(),
    );
    let mut command = app
        .shell()
        .command(binary)
        .env_clear()
        .env("HOME", &home)
        .env("PATH", path)
        .env("PI_CODING_AGENT_DIR", &config)
        .env("PI_CODING_AGENT_SESSION_DIR", &sessions)
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
    let (mut rx, child) = command.spawn().map_err(|error| error.to_string())?;
    state
        .sessions
        .lock()
        .map_err(|_| "Session lock poisoned".to_string())?
        .insert(session_id.clone(), child);

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
                sessions.remove(&sid);
            }
        }
    });
    Ok(session_id)
}

fn send(state: &PiState, session_id: &str, value: Value) -> Result<(), String> {
    let mut line = serde_json::to_vec(&value).map_err(|error| error.to_string())?;
    line.push(b'\n');
    state
        .sessions
        .lock()
        .map_err(|_| "Session lock poisoned".to_string())?
        .get_mut(session_id)
        .ok_or("Session is not running")?
        .write(&line)
        .map_err(|error| error.to_string())
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
    if input.model.trim().is_empty() || input.api_key.trim().is_empty() {
        return Err("Model and API key are required".into());
    }

    let mut config = read_provider_config(&app)?.unwrap_or_else(|| MultiProviderConfig {
        active_id: "default".to_string(),
        providers: Vec::new(),
    });

    let target_id = input.id.unwrap_or_else(|| config.active_id.clone());
    let target_name = input.name.unwrap_or_else(|| "Default".to_string());

    if let Some(existing) = config.providers.iter_mut().find(|p| p.id == target_id) {
        existing.base_url = input.base_url.trim_end_matches('/').to_string();
        existing.model = input.model.trim().to_string();
        existing.api_key = input.api_key.trim().to_string();
        existing.reasoning_effort = input.reasoning_effort.filter(|v| !v.is_empty());
        if let Some(m) = input.models {
            existing.models = m;
        }
    } else {
        config.providers.push(ProviderSettings {
            id: target_id.clone(),
            name: target_name,
            base_url: input.base_url.trim_end_matches('/').to_string(),
            model: input.model.trim().to_string(),
            api_key: input.api_key.trim().to_string(),
            reasoning_effort: input.reasoning_effort.filter(|v| !v.is_empty()),
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
    state: State<PiState>,
    resume_path: Option<String>,
    project_path: Option<String>,
) -> Result<String, String> {
    spawn_session(&app, &state, resume_path, project_path)
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
    let dir = app_dir(&app)?.join("sessions");
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if name.contains(&session_id) {
                    return Ok(Some(path.to_string_lossy().to_string()));
                }
            }
        }
    }
    Ok(None)
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
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(PiState::default())
        .setup(|app| {
            let _ = prepare_runtime(app.handle());
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
        .invoke_handler(tauri::generate_handler![
            get_provider,
            save_provider,
            get_providers,
            save_providers,
            get_system_prompt,
            save_system_prompt,
            create_session,
            send_message,
            abort,
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
                        for (_, child) in sessions.drain() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}
