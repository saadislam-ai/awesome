//! The native side of Borderless Studio.
//!
//! This layer is deliberately thin. All book logic lives in the TypeScript
//! engine (packages/core); the commands here only give it what a web view
//! cannot do by itself:
//!
//!   * read and write files, with crash safe (atomic) saves,
//!   * run the bundled tools (Typst, EPUBCheck) and a few optional ones,
//!   * keep a small SQLite index (a cache that can always be rebuilt),
//!   * open files and folders in the operating system,
//!   * make an HTTP request for the optional, opt in online features.
//!
//! Tools are identified by a fixed id. The web view can never ask for an
//! arbitrary program to be run.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
struct AppState {
    /// Tool locations chosen by the user in Settings (tool id -> path).
    tool_paths: Mutex<HashMap<String, String>>,
    db: Mutex<Option<rusqlite::Connection>>,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// The engine always uses forward slashes, on every operating system.
fn fwd(p: impl AsRef<Path>) -> String {
    p.as_ref().to_string_lossy().replace('\\', "/")
}

fn file_error(action: &str, path: &str, e: std::io::Error) -> String {
    format!("Could not {action} \"{path}\": {e}")
}

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HostPaths {
    resources: String,
    user_data: String,
    documents: String,
    temp: String,
    home: String,
}

/// Folder that holds "resources", "specs" and "tools". Inside an installed
/// app this is the bundle's resource folder. A developer can point it at the
/// repository with BORDERLESS_ROOT.
fn root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("BORDERLESS_ROOT") {
        return Ok(PathBuf::from(dir));
    }
    app.path().resource_dir().map_err(err)
}

#[tauri::command]
fn host_paths(app: AppHandle) -> Result<HostPaths, String> {
    let p = app.path();
    Ok(HostPaths {
        resources: fwd(root_dir(&app)?.join("resources")),
        user_data: fwd(p.app_data_dir().map_err(err)?),
        documents: fwd(p.document_dir().or_else(|_| p.home_dir()).map_err(err)?),
        temp: fwd(std::env::temp_dir()),
        home: fwd(p.home_dir().map_err(err)?),
    })
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

/// Crash safe write: the data goes to a temporary file in the same folder,
/// is flushed to the disk, and is then renamed over the target. A power cut
/// leaves either the old file or the new one, never a half written file.
fn atomic_write(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
    let tmp = path.with_file_name(format!(".{}.{}.{}.tmp", name, std::process::id(), nanos));
    let result = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
        return result;
    }
    // On Unix the rename itself must be flushed by syncing the folder.
    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        if let Ok(dir) = fs::File::open(parent) {
            let _ = dir.sync_all();
        }
    }
    Ok(())
}

#[tauri::command]
fn fs_read_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| file_error("read", &path, e))
}

#[tauri::command]
fn fs_write_text(path: String, text: String) -> Result<(), String> {
    atomic_write(Path::new(&path), text.as_bytes()).map_err(|e| file_error("save", &path, e))
}

#[tauri::command]
fn fs_read_binary(path: String) -> Result<Response, String> {
    fs::read(&path).map(Response::new).map_err(|e| file_error("read", &path, e))
}

/// Binary data arrives as the raw request body; the target path travels in a header.
#[tauri::command]
fn fs_write_binary(request: Request<'_>) -> Result<(), String> {
    let header = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "No file path was given.".to_string())?;
    let path = percent_decode(header);
    match request.body() {
        InvokeBody::Raw(bytes) => atomic_write(Path::new(&path), bytes).map_err(|e| file_error("save", &path, e)),
        InvokeBody::Json(_) => Err("Binary data was expected.".to_string()),
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

#[tauri::command]
fn fs_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileStat {
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    is_file: bool,
    is_dir: bool,
    size: u64,
    mtime_ms: f64,
}

fn stat_of(path: &Path, name: Option<String>) -> Option<FileStat> {
    let m = fs::metadata(path).ok()?;
    let mtime = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0);
    Some(FileStat { name, is_file: m.is_file(), is_dir: m.is_dir(), size: m.len(), mtime_ms: mtime })
}

#[tauri::command]
fn fs_stat(path: String) -> Option<FileStat> {
    stat_of(Path::new(&path), None)
}

#[tauri::command]
fn fs_list(path: String) -> Result<Vec<FileStat>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| file_error("list", &path, e))? {
        let entry = entry.map_err(err)?;
        let name = entry.file_name().to_string_lossy().to_string();
        // Leftovers of an interrupted save are never shown.
        if name.starts_with('.') && name.ends_with(".tmp") {
            continue;
        }
        if let Some(s) = stat_of(&entry.path(), Some(name)) {
            out.push(s);
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
fn fs_mkdirp(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| file_error("create the folder", &path, e))
}

#[tauri::command]
fn fs_remove(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(());
    }
    // Refuse anything that is obviously not a file or folder inside a project or cache.
    if p.parent().is_none() || p.components().count() < 3 {
        return Err(format!("Refusing to remove \"{path}\"."));
    }
    let r = if p.is_dir() { fs::remove_dir_all(p) } else { fs::remove_file(p) };
    r.map_err(|e| file_error("remove", &path, e))
}

#[tauri::command]
fn fs_rename(from: String, to: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&to).parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::rename(&from, &to).map_err(|e| file_error("move", &from, e))
}

fn copy_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    if from.is_dir() {
        fs::create_dir_all(to)?;
        for entry in fs::read_dir(from)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &to.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(from, to).map(|_| ())
    }
}

#[tauri::command]
fn fs_copy(from: String, to: String) -> Result<(), String> {
    copy_recursive(Path::new(&from), Path::new(&to)).map_err(|e| file_error("copy", &from, e))
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

const TOOL_IDS: [&str; 6] = ["typst", "epubcheck", "java", "pandoc", "git", "kindle-previewer"];

fn exe_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Look for a program on the PATH and in the usual install folders. Apps
/// started from the Dock or Start menu get a very short PATH, so the common
/// folders are searched as well.
fn find_program(name: &str) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    if cfg!(target_os = "macos") {
        for d in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin"] {
            dirs.push(PathBuf::from(d));
        }
    } else if cfg!(target_os = "linux") {
        for d in ["/usr/local/bin", "/usr/bin", "/snap/bin"] {
            dirs.push(PathBuf::from(d));
        }
    }
    let file = exe_name(name);
    dirs.into_iter().map(|d| d.join(&file)).find(|p| p.is_file())
}

fn newest_child_with(dir: &Path, rel: &[&str]) -> Option<PathBuf> {
    let mut found: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| rel.iter().fold(e.path(), |p, part| p.join(part)))
        .filter(|p| p.is_file())
        .collect();
    found.sort();
    found.pop()
}

fn find_java(app: &AppHandle, configured: Option<&String>) -> Option<(PathBuf, &'static str)> {
    let java = exe_name("java");
    if let Ok(root) = root_dir(app) {
        let bundled = root.join("tools").join("jre").join("bin").join(&java);
        if bundled.is_file() {
            return Some((bundled, "bundled"));
        }
    }
    if let Some(p) = configured {
        if Path::new(p).is_file() {
            return Some((PathBuf::from(p), "configured"));
        }
    }
    if let Some(home) = std::env::var_os("JAVA_HOME") {
        let p = PathBuf::from(home).join("bin").join(&java);
        if p.is_file() {
            return Some((p, "path"));
        }
    }
    if let Some(p) = find_program("java") {
        // macOS ships a stub at /usr/bin/java that only opens a "install Java" dialog.
        let stub = cfg!(target_os = "macos") && p == Path::new("/usr/bin/java") && !Path::new("/Library/Java/JavaVirtualMachines").exists();
        if !stub {
            return Some((p, "path"));
        }
    }
    if cfg!(target_os = "macos") {
        for base in ["/opt/homebrew/opt/openjdk/bin/java", "/usr/local/opt/openjdk/bin/java"] {
            if Path::new(base).is_file() {
                return Some((PathBuf::from(base), "path"));
            }
        }
        if let Some(p) = newest_child_with(Path::new("/Library/Java/JavaVirtualMachines"), &["Contents", "Home", "bin", "java"]) {
            return Some((p, "path"));
        }
    }
    if cfg!(windows) {
        for base in ["C:\\Program Files\\Eclipse Adoptium", "C:\\Program Files\\Java", "C:\\Program Files\\Microsoft", "C:\\Program Files\\Zulu"] {
            if let Some(p) = newest_child_with(Path::new(base), &["bin", "java.exe"]) {
                return Some((p, "path"));
            }
        }
    }
    None
}

struct Located {
    /// Program to start.
    program: Option<PathBuf>,
    /// Arguments placed before the caller's arguments (for example "-jar epubcheck.jar").
    prefix: Vec<String>,
    /// What is shown as the tool's location.
    shown: Option<PathBuf>,
    source: &'static str,
    hint: Option<String>,
}

fn missing(hint: &str) -> Located {
    Located { program: None, prefix: vec![], shown: None, source: "missing", hint: Some(hint.to_string()) }
}

fn locate(app: &AppHandle, state: &AppState, tool: &str) -> Located {
    let configured = state.tool_paths.lock().ok().and_then(|m| m.get(tool).cloned()).filter(|p| !p.is_empty());
    let found = |p: PathBuf, source: &'static str| Located { program: Some(p.clone()), prefix: vec![], shown: Some(p), source, hint: None };
    if tool != "epubcheck" && tool != "java" {
        if let Some(p) = &configured {
            if Path::new(p).is_file() {
                return found(PathBuf::from(p), "configured");
            }
        }
    }
    let root = root_dir(app).ok();
    match tool {
        "typst" => {
            // 1. Next to the app's own program: this is where the installer puts the bundled copy.
            if let Ok(exe) = std::env::current_exe() {
                if let Some(dir) = exe.parent() {
                    let p = dir.join(exe_name("typst"));
                    if p.is_file() {
                        return found(p, "bundled");
                    }
                }
            }
            if let Some(root) = &root {
                let p = root.join("tools").join("typst").join(exe_name("typst"));
                if p.is_file() {
                    return found(p, "bundled");
                }
            }
            match find_program("typst") {
                Some(p) => found(p, "path"),
                None => missing("The typesetting engine (Typst) is missing from this installation. Reinstall Borderless Studio, or set the location of typst in Settings."),
            }
        }
        "epubcheck" => {
            let jar = configured
                .as_ref()
                .map(PathBuf::from)
                .filter(|p| p.is_file())
                .or_else(|| root.as_ref().map(|r| r.join("tools").join("epubcheck").join("epubcheck.jar")).filter(|p| p.is_file()));
            let Some(jar) = jar else {
                return missing("EPUBCheck is missing from this installation. Reinstall Borderless Studio.");
            };
            let java_conf = state.tool_paths.lock().ok().and_then(|m| m.get("java").cloned());
            match find_java(app, java_conf.as_ref()) {
                Some((java, _)) => Located {
                    program: Some(java),
                    prefix: vec!["-Djava.awt.headless=true".into(), "-jar".into(), jar.to_string_lossy().to_string()],
                    shown: Some(jar),
                    source: "bundled",
                    hint: None,
                },
                None => missing("EPUBCheck needs Java, which was not found. Install a Java runtime (for example Eclipse Temurin 17 or newer from adoptium.net), then restart the app."),
            }
        }
        "java" => match find_java(app, configured.as_ref()) {
            Some((p, source)) => found(p, source),
            None => missing("Install a Java runtime (for example Eclipse Temurin 17 or newer from adoptium.net)."),
        },
        "kindle-previewer" => {
            let mut candidates: Vec<PathBuf> = Vec::new();
            if cfg!(target_os = "macos") {
                candidates.push(PathBuf::from("/Applications/Kindle Previewer 4.app/Contents/MacOS/Kindle Previewer 4"));
                candidates.push(PathBuf::from("/Applications/Kindle Previewer 3.app/Contents/MacOS/Kindle Previewer 3"));
            } else if cfg!(windows) {
                if let Some(local) = std::env::var_os("LOCALAPPDATA") {
                    let base = PathBuf::from(local).join("Amazon");
                    candidates.push(base.join("Kindle Previewer 4").join("Kindle Previewer 4.exe"));
                    candidates.push(base.join("Kindle Previewer 3").join("Kindle Previewer 3.exe"));
                }
            }
            match candidates.into_iter().find(|p| p.is_file()) {
                Some(p) => found(p, "path"),
                None => missing("Kindle Previewer is a free download from Amazon. Install it to preview ebooks exactly as Kindle shows them."),
            }
        }
        "pandoc" | "git" => match find_program(tool) {
            Some(p) => found(p, "path"),
            None => missing(if tool == "git" { "Git is optional. Install it to keep a version history of your books." } else { "Pandoc is optional. Install it to import other document formats." }),
        },
        _ => missing("Unknown tool."),
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RunOptions {
    cwd: Option<String>,
    stdin: Option<String>,
    timeout_ms: Option<u64>,
    env: Option<HashMap<String, String>>,
}

#[derive(Serialize)]
struct ToolResult {
    code: i32,
    stdout: String,
    stderr: String,
}

fn spawn_and_wait(program: &Path, args: &[String], opts: &RunOptions) -> ToolResult {
    let mut cmd = Command::new(program);
    cmd.args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(cwd) = &opts.cwd {
        cmd.current_dir(cwd);
    }
    if let Some(env) = &opts.env {
        cmd.envs(env);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console window flashes up
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return ToolResult { code: -1, stdout: String::new(), stderr: format!("Could not start {}: {e}", program.display()) },
    };
    if let Some(mut stdin) = child.stdin.take() {
        if let Some(text) = &opts.stdin {
            let _ = stdin.write_all(text.as_bytes());
        }
    }
    let mut out_pipe = child.stdout.take();
    let mut err_pipe = child.stderr.take();
    let out_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(p) = out_pipe.as_mut() {
            let _ = p.read_to_end(&mut buf);
        }
        buf
    });
    let err_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(p) = err_pipe.as_mut() {
            let _ = p.read_to_end(&mut buf);
        }
        buf
    });
    let limit = Duration::from_millis(opts.timeout_ms.unwrap_or(120_000));
    let started = Instant::now();
    let mut timed_out = false;
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code().unwrap_or(-1),
            Ok(None) => {
                if started.elapsed() > limit {
                    let _ = child.kill();
                    let _ = child.wait();
                    timed_out = true;
                    break -2;
                }
                std::thread::sleep(Duration::from_millis(15));
            }
            Err(_) => break -1,
        }
    };
    let stdout = String::from_utf8_lossy(&out_thread.join().unwrap_or_default()).to_string();
    let mut stderr = String::from_utf8_lossy(&err_thread.join().unwrap_or_default()).to_string();
    if timed_out {
        stderr.push_str(&format!("\nStopped after {} seconds (time limit).", limit.as_secs()));
    }
    ToolResult { code, stdout, stderr }
}

#[tauri::command]
async fn run_tool(app: AppHandle, state: State<'_, AppState>, tool: String, args: Vec<String>, opts: Option<RunOptions>) -> Result<ToolResult, String> {
    if !TOOL_IDS.contains(&tool.as_str()) {
        return Err(format!("\"{tool}\" is not a tool this app can run."));
    }
    let loc = locate(&app, &state, &tool);
    let Some(program) = loc.program else {
        return Ok(ToolResult { code: -1, stdout: String::new(), stderr: loc.hint.unwrap_or_else(|| format!("{tool} was not found.")) });
    };
    let mut all = loc.prefix.clone();
    all.extend(args);
    let opts = opts.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || spawn_and_wait(&program, &all, &opts)).await.map_err(err)
}

/// Programs with a window of their own that may be started and left running.
const LAUNCHABLE: [&str; 1] = ["kindle-previewer"];

/// Start a program from the launch list and return at once. Ok(false) means it is not installed.
#[tauri::command]
fn launch_tool(app: AppHandle, state: State<'_, AppState>, tool: String, args: Vec<String>) -> Result<bool, String> {
    if !LAUNCHABLE.contains(&tool.as_str()) {
        return Err(format!("\"{tool}\" cannot be started this way."));
    }
    let loc = locate(&app, &state, &tool);
    let Some(program) = loc.program else {
        return Ok(false);
    };
    let mut all = loc.prefix.clone();
    all.extend(args);
    let mut child = Command::new(&program)
        .args(&all)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("{} could not be started: {e}", program.display()))?;
    // Collect the exit status when the program is closed, so that no dead process entry is left behind.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(true)
}

#[derive(Serialize)]
struct ToolInfo {
    id: String,
    found: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    hint: Option<String>,
}

#[tauri::command]
async fn tool_info(app: AppHandle, state: State<'_, AppState>, tool: String) -> Result<ToolInfo, String> {
    let loc = locate(&app, &state, &tool);
    let mut info = ToolInfo {
        id: tool.clone(),
        found: loc.program.is_some(),
        path: loc.shown.as_ref().map(fwd),
        version: None,
        source: loc.source.to_string(),
        hint: loc.hint.clone(),
    };
    if let Some(program) = loc.program {
        let version_args: Option<Vec<String>> = match tool.as_str() {
            "typst" | "pandoc" | "git" => Some(vec!["--version".into()]),
            "java" => Some(vec!["-version".into()]),
            "epubcheck" => Some(loc.prefix.iter().cloned().chain(std::iter::once("--version".to_string())).collect()),
            _ => None,
        };
        if let Some(args) = version_args {
            let opts = RunOptions { timeout_ms: Some(30_000), ..Default::default() };
            let res = tauri::async_runtime::spawn_blocking(move || spawn_and_wait(&program, &args, &opts)).await.map_err(err)?;
            let text = format!("{}\n{}", res.stdout, res.stderr);
            info.version = text
                .lines()
                .map(str::trim)
                .find(|l| !l.is_empty() && !l.starts_with("Picked up") && (tool != "epubcheck" || l.contains("EPUBCheck")) && (tool != "java" || l.contains("version")))
                .map(str::to_string);
        }
    }
    Ok(info)
}

#[tauri::command]
fn set_tool_paths(state: State<'_, AppState>, paths: HashMap<String, String>) -> Result<(), String> {
    let mut guard = state.tool_paths.lock().map_err(err)?;
    *guard = paths.into_iter().filter(|(k, _)| TOOL_IDS.contains(&k.as_str())).collect();
    Ok(())
}

/* ------------------------------------------------------------------ */
/* SQLite index (a rebuildable cache, never the source of truth)        */
/* ------------------------------------------------------------------ */

fn with_db<T>(app: &AppHandle, state: &AppState, f: impl FnOnce(&rusqlite::Connection) -> rusqlite::Result<T>) -> Result<T, String> {
    let mut guard = state.db.lock().map_err(err)?;
    if guard.is_none() {
        let dir = app.path().app_data_dir().map_err(err)?;
        fs::create_dir_all(&dir).map_err(err)?;
        let conn = rusqlite::Connection::open(dir.join("index.sqlite")).map_err(err)?;
        let _ = conn.pragma_update(None, "journal_mode", "WAL");
        *guard = Some(conn);
    }
    f(guard.as_ref().expect("database is open")).map_err(err)
}

fn to_sql(v: &serde_json::Value) -> rusqlite::types::Value {
    use rusqlite::types::Value;
    match v {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Integer(i64::from(*b)),
        serde_json::Value::Number(n) => n.as_i64().map(Value::Integer).unwrap_or_else(|| Value::Real(n.as_f64().unwrap_or(0.0))),
        serde_json::Value::String(s) => Value::Text(s.clone()),
        other => Value::Text(other.to_string()),
    }
}

#[tauri::command]
fn db_exec(app: AppHandle, state: State<'_, AppState>, sql: String, params: Option<Vec<serde_json::Value>>) -> Result<(), String> {
    let params = params.unwrap_or_default();
    with_db(&app, &state, |conn| {
        if params.is_empty() {
            conn.execute_batch(&sql)
        } else {
            let values: Vec<rusqlite::types::Value> = params.iter().map(to_sql).collect();
            conn.execute(&sql, rusqlite::params_from_iter(values)).map(|_| ())
        }
    })
}

#[tauri::command]
fn db_query(app: AppHandle, state: State<'_, AppState>, sql: String, params: Option<Vec<serde_json::Value>>) -> Result<Vec<serde_json::Map<String, serde_json::Value>>, String> {
    let params = params.unwrap_or_default();
    with_db(&app, &state, |conn| {
        let mut stmt = conn.prepare(&sql)?;
        let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let values: Vec<rusqlite::types::Value> = params.iter().map(to_sql).collect();
        let mut rows = stmt.query(rusqlite::params_from_iter(values))?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            let mut map = serde_json::Map::new();
            for (i, name) in names.iter().enumerate() {
                let v = match row.get_ref(i)? {
                    rusqlite::types::ValueRef::Null => serde_json::Value::Null,
                    rusqlite::types::ValueRef::Integer(n) => serde_json::Value::from(n),
                    rusqlite::types::ValueRef::Real(f) => serde_json::Value::from(f),
                    rusqlite::types::ValueRef::Text(t) => serde_json::Value::from(String::from_utf8_lossy(t).to_string()),
                    rusqlite::types::ValueRef::Blob(b) => serde_json::Value::from(b.len()),
                };
                map.insert(name.clone(), v);
            }
            out.push(map);
        }
        Ok(out)
    })
}

/* ------------------------------------------------------------------ */
/* Operating system integration                                        */
/* ------------------------------------------------------------------ */

/// Open a file, folder or web address with the system's default program, or
/// show a file in Finder / Explorer.
#[tauri::command]
fn os_open(target: String, reveal: Option<bool>) -> Result<(), String> {
    let is_url = target.starts_with("https://") || target.starts_with("http://") || target.starts_with("mailto:");
    if !is_url && !Path::new(&target).exists() {
        return Err(format!("\"{target}\" does not exist."));
    }
    let reveal = reveal.unwrap_or(false) && !is_url;
    let mut cmd;
    if cfg!(target_os = "macos") {
        cmd = Command::new("open");
        if reveal {
            cmd.arg("-R");
        }
        cmd.arg(&target);
    } else if cfg!(windows) {
        if reveal {
            cmd = Command::new("explorer");
            cmd.arg(format!("/select,{}", target.replace('/', "\\")));
        } else if is_url {
            cmd = Command::new("rundll32");
            cmd.args(["url.dll,FileProtocolHandler", &target]);
        } else {
            cmd = Command::new("explorer");
            cmd.arg(target.replace('/', "\\"));
        }
    } else {
        cmd = Command::new("xdg-open");
        let shown = if reveal { Path::new(&target).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or(target.clone()) } else { target.clone() };
        cmd.arg(shown);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map(|_| ()).map_err(|e| format!("Could not open \"{target}\": {e}"))
}

/* ------------------------------------------------------------------ */
/* HTTP (optional online features only)                                */
/* ------------------------------------------------------------------ */

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpRequest {
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
struct HttpResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

fn read_response(resp: ureq::Response) -> HttpResponse {
    let status = resp.status();
    let mut headers = HashMap::new();
    for name in resp.headers_names() {
        if let Some(v) = resp.header(&name) {
            headers.insert(name.to_lowercase(), v.to_string());
        }
    }
    let body = resp.into_string().unwrap_or_default();
    HttpResponse { status, headers, body }
}

/// The app is offline by default. This command is only reached when the user
/// has switched on an online feature (for example the AI assistant with their
/// own key, or a local Ollama server on this computer).
#[tauri::command]
async fn http_request(req: HttpRequest) -> Result<HttpResponse, String> {
    if !(req.url.starts_with("https://") || req.url.starts_with("http://localhost") || req.url.starts_with("http://127.0.0.1")) {
        return Err("Only https addresses and this computer (localhost) can be contacted.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_millis(req.timeout_ms.unwrap_or(120_000))).build();
        let mut r = agent.request(req.method.as_deref().unwrap_or("GET"), &req.url);
        for (k, v) in req.headers.unwrap_or_default() {
            r = r.set(&k, &v);
        }
        let result = match req.body {
            Some(body) => r.send_string(&body),
            None => r.call(),
        };
        match result {
            Ok(resp) => Ok(read_response(resp)),
            Err(ureq::Error::Status(_, resp)) => Ok(read_response(resp)),
            Err(e) => Err(format!("The request could not be sent: {e}")),
        }
    })
    .await
    .map_err(err)?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            host_paths,
            fs_read_text,
            fs_write_text,
            fs_read_binary,
            fs_write_binary,
            fs_exists,
            fs_stat,
            fs_list,
            fs_mkdirp,
            fs_remove,
            fs_rename,
            fs_copy,
            run_tool,
            launch_tool,
            tool_info,
            set_tool_paths,
            db_exec,
            db_query,
            os_open,
            http_request
        ])
        .run(tauri::generate_context!())
        .expect("Borderless Studio could not start");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_and_leaves_no_temp_files() {
        let dir = std::env::temp_dir().join(format!("bstudio-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("scene.md");
        atomic_write(&file, b"first").unwrap();
        atomic_write(&file, b"second version").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "second version");
        let leftovers: Vec<_> = fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().ends_with(".tmp")).collect();
        assert!(leftovers.is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn percent_decoding() {
        assert_eq!(percent_decode("C%3A/My%20Books/caf%C3%A9.md"), "C:/My Books/café.md");
    }

    #[test]
    fn json_values_map_to_sql() {
        assert_eq!(to_sql(&serde_json::json!(3)), rusqlite::types::Value::Integer(3));
        assert_eq!(to_sql(&serde_json::json!("a")), rusqlite::types::Value::Text("a".into()));
        assert_eq!(to_sql(&serde_json::json!(null)), rusqlite::types::Value::Null);
    }
}
