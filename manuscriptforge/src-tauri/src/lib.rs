//! ManuscriptForge desktop shell.
//!
//! The shell is deliberately thin: it owns the data folder (SQLite database,
//! original manuscript files, backups) and exposes it to the UI through a
//! small set of commands. It makes no network connections.

pub mod engine;
pub mod gguf;
pub mod hardware;
pub mod models;
pub mod store;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine as _;
use serde::Serialize;
use serde_json::{Map, Value as Json};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_dialog::DialogExt;

use engine::{Engine, EngineBinary, EngineStatus, StartOptions};
use hardware::Hardware;
use models::ModelFile;
use store::{BackupInfo, Statement, Store};

/// Set to a file path to run the built-in self-check on launch, write its
/// report to that file and exit. Used by automated smoke tests.
const SELFTEST_ENV: &str = "MF_SELFTEST_OUT";
/// Overrides where the library is stored.
const DATA_DIR_ENV: &str = "MANUSCRIPTFORGE_DATA_DIR";
const BACKUPS_TO_KEEP: usize = 14;
/// Sent to the UI when the user closes the window, so it can save first.
const CLOSE_REQUESTED_EVENT: &str = "mf://close-requested";
/// How long the UI gets to save before the window closes anyway.
const CLOSE_GRACE: Duration = Duration::from_secs(4);

#[derive(Default)]
struct Lifecycle {
    /// True once the UI is listening for close requests.
    ui_ready: AtomicBool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    data_dir: String,
    version: String,
    os: String,
    arch: String,
    selftest: bool,
    /// A model file to exercise the AI engine with during a self-check.
    selftest_model: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecResult {
    rows_affected: usize,
}

fn resolve_data_dir(app: &AppHandle) -> PathBuf {
    if let Ok(dir) = std::env::var(DATA_DIR_ENV) {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir);
        }
    }
    // A pointer file lets the library live somewhere other than the default.
    if let Ok(config) = app.path().app_config_dir() {
        if let Ok(custom) = fs::read_to_string(config.join("data-location.txt")) {
            let custom = custom.trim();
            if !custom.is_empty() {
                return PathBuf::from(custom);
            }
        }
    }
    if let Ok(docs) = app.path().document_dir() {
        return docs.join("ManuscriptForge");
    }
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("ManuscriptForge"))
}

#[tauri::command(async)]
fn db_execute(store: State<'_, Store>, sql: String, params: Vec<Json>) -> Result<ExecResult, String> {
    store.execute(&sql, &params).map(|rows_affected| ExecResult { rows_affected })
}

#[tauri::command(async)]
fn db_select(
    store: State<'_, Store>,
    sql: String,
    params: Vec<Json>,
) -> Result<Vec<Map<String, Json>>, String> {
    store.select(&sql, &params)
}

#[tauri::command(async)]
fn db_batch(store: State<'_, Store>, statements: Vec<Statement>) -> Result<(), String> {
    store.batch(&statements)
}

#[tauri::command(async)]
fn file_write(store: State<'_, Store>, path: String, base64: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("Could not decode file data: {e}"))?;
    store.file_write(&path, &bytes)
}

#[tauri::command(async)]
fn file_read(store: State<'_, Store>, path: String) -> Result<String, String> {
    let bytes = store.file_read(&path)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command(async)]
fn file_exists(store: State<'_, Store>, path: String) -> Result<bool, String> {
    store.file_exists(&path)
}

#[tauri::command(async)]
fn file_remove(store: State<'_, Store>, path: String) -> Result<(), String> {
    store.file_remove(&path)
}

#[tauri::command(async)]
fn backup_now(store: State<'_, Store>) -> Result<BackupInfo, String> {
    store.backup_now(BACKUPS_TO_KEEP)
}

#[tauri::command(async)]
fn backup_if_due(store: State<'_, Store>) -> Result<Option<BackupInfo>, String> {
    store.ensure_recent_backup(Duration::from_secs(24 * 60 * 60), BACKUPS_TO_KEEP)
}

#[tauri::command(async)]
fn list_backups(store: State<'_, Store>) -> Result<Vec<BackupInfo>, String> {
    store.list_backups()
}

#[tauri::command]
fn app_info(app: AppHandle, store: State<'_, Store>) -> AppInfo {
    AppInfo {
        data_dir: store.data_dir().to_string_lossy().into_owned(),
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        selftest: std::env::var(SELFTEST_ENV).is_ok(),
        selftest_model: std::env::var("MF_SELFTEST_MODEL").ok().filter(|p| !p.is_empty()),
    }
}

/// The UI calls this once it can save pending work on request.
#[tauri::command]
fn ui_ready(lifecycle: State<'_, Lifecycle>) {
    lifecycle.ui_ready.store(true, Ordering::SeqCst);
}

/// The UI calls this after saving, in answer to a close request.
#[tauri::command]
fn close_now(window: tauri::Window) {
    let _ = window.destroy();
}

/// Called by the UI when a launch-time self-check finishes. A passing run
/// then closes the window the same way a user would, which also exercises
/// the save-before-close path.
#[tauri::command]
fn selftest_finish(app: AppHandle, window: tauri::Window, report: String, passed: bool) -> Result<(), String> {
    let out = std::env::var(SELFTEST_ENV).map_err(|_| "Self-check mode is not active".to_string())?;
    fs::write(&out, report).map_err(|e| format!("Could not write the self-check report: {e}"))?;
    if passed {
        window.close().map_err(|e| format!("Could not close the window: {e}"))
    } else {
        app.exit(1);
        Ok(())
    }
}

// ----- Local AI: hardware, engine, models ---------------------------------

/// Downloads in progress, so they can be cancelled.
#[derive(Default)]
struct Downloads(Mutex<HashMap<String, Arc<AtomicBool>>>);

fn find_engines(app: &AppHandle, store: &Store, custom_dir: Option<&str>) -> Vec<EngineBinary> {
    engine::locate(custom_dir, app.path().resource_dir().ok().as_deref(), store.data_dir())
}

#[tauri::command(async)]
fn engine_find(app: AppHandle, store: State<'_, Store>, custom_dir: Option<String>) -> Vec<EngineBinary> {
    find_engines(&app, &store, custom_dir.as_deref())
}

#[tauri::command(async)]
fn hardware_info(app: AppHandle, store: State<'_, Store>, custom_dir: Option<String>) -> Hardware {
    let engines = find_engines(&app, &store, custom_dir.as_deref());
    hardware::detect(engines.first().map(|e| Path::new(&e.path)))
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|e| format!("Internal error: {e}"))?
}

#[tauri::command]
async fn engine_start(engine: State<'_, Arc<Engine>>, options: StartOptions) -> Result<EngineStatus, String> {
    let engine = engine.inner().clone();
    blocking(move || engine.start(options)).await
}

#[tauri::command]
async fn engine_stop(engine: State<'_, Arc<Engine>>) -> Result<(), String> {
    let engine = engine.inner().clone();
    blocking(move || {
        engine.stop();
        Ok(())
    })
    .await
}

#[tauri::command(async)]
fn engine_status(engine: State<'_, Arc<Engine>>) -> EngineStatus {
    engine.status()
}

/// Sends a chat request to the local engine and streams the reply back.
#[tauri::command]
async fn ai_chat(engine: State<'_, Arc<Engine>>, request_id: String, body: String, on_data: Channel<String>) -> Result<(), String> {
    let engine = engine.inner().clone();
    blocking(move || {
        engine.chat(&request_id, &body, |data| {
            let _ = on_data.send(data.to_string());
        })
    })
    .await
}

#[tauri::command]
fn ai_cancel(engine: State<'_, Arc<Engine>>, request_id: String) {
    engine.cancel(&request_id);
}

#[tauri::command(async)]
fn models_list(store: State<'_, Store>, extra_paths: Vec<String>) -> Vec<ModelFile> {
    models::list(store.data_dir(), &extra_paths)
}

#[tauri::command]
async fn model_download(
    store: State<'_, Store>,
    downloads: State<'_, Downloads>,
    id: String,
    url: String,
    file_name: String,
    on_progress: Channel<models::Progress>,
) -> Result<String, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    downloads.0.lock().map_err(|_| "Internal error".to_string())?.insert(id.clone(), cancel.clone());
    let data_dir = store.data_dir().to_path_buf();
    let result = blocking(move || {
        models::download(&data_dir, &url, &file_name, &cancel, |progress| {
            let _ = on_progress.send(progress);
        })
        .map(|path| path.to_string_lossy().into_owned())
    })
    .await;
    if let Ok(mut map) = downloads.0.lock() {
        map.remove(&id);
    }
    result
}

#[tauri::command]
fn model_download_cancel(downloads: State<'_, Downloads>, id: String) {
    if let Ok(map) = downloads.0.lock() {
        if let Some(flag) = map.get(&id) {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

#[tauri::command(async)]
fn model_remove(store: State<'_, Store>, path: String) -> Result<(), String> {
    models::remove(store.data_dir(), &path)
}

#[tauri::command]
async fn pick_file(app: AppHandle, title: String, extensions: Vec<String>) -> Result<Option<String>, String> {
    blocking(move || {
        let extensions: Vec<&str> = extensions.iter().map(String::as_str).collect();
        let mut dialog = app.dialog().file().set_title(title);
        if !extensions.is_empty() {
            dialog = dialog.add_filter("Files", &extensions);
        }
        Ok(dialog.blocking_pick_file().and_then(|f| f.into_path().ok()).map(|p| p.to_string_lossy().into_owned()))
    })
    .await
}

#[tauri::command]
async fn pick_folder(app: AppHandle, title: String) -> Result<Option<String>, String> {
    blocking(move || Ok(app.dialog().file().set_title(title).blocking_pick_folder().and_then(|f| f.into_path().ok()).map(|p| p.to_string_lossy().into_owned())))
        .await
}

/// Asks where to save a file, then writes it there. Returns the chosen path,
/// or nothing when the publisher cancelled.
#[tauri::command]
async fn save_file(app: AppHandle, default_name: String, extension: String, base64: String) -> Result<Option<String>, String> {
    blocking(move || {
        // Automated tests name the destination folder instead of answering a dialog.
        let chosen = match std::env::var("MF_EXPORT_DIR") {
            Ok(dir) => Some(PathBuf::from(dir).join(&default_name)),
            Err(_) => app
                .dialog()
                .file()
                .set_file_name(&default_name)
                .add_filter(extension.to_uppercase(), &[extension.as_str()])
                .blocking_save_file()
                .and_then(|f| f.into_path().ok()),
        };
        let Some(path) = chosen else { return Ok(None) };
        let bytes = base64::engine::general_purpose::STANDARD.decode(base64.as_bytes()).map_err(|e| format!("Could not decode file data: {e}"))?;
        fs::write(&path, bytes).map_err(|e| format!("Could not save the file: {e}"))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Lifecycle::default())
        .manage(Arc::new(Engine::default()))
        .manage(Downloads::default())
        .setup(|app| {
            let data_dir = resolve_data_dir(app.handle());
            let store = Store::open(data_dir)?;
            app.manage(store);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !window.state::<Lifecycle>().ui_ready.load(Ordering::SeqCst) {
                    return;
                }
                // Give the UI a moment to save unsaved typing, then close.
                api.prevent_close();
                let _ = window.emit(CLOSE_REQUESTED_EVENT, ());
                let window = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(CLOSE_GRACE);
                    let _ = window.destroy();
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            db_execute,
            db_select,
            db_batch,
            file_write,
            file_read,
            file_exists,
            file_remove,
            backup_now,
            backup_if_due,
            list_backups,
            app_info,
            ui_ready,
            close_now,
            selftest_finish,
            engine_find,
            hardware_info,
            engine_start,
            engine_stop,
            engine_status,
            ai_chat,
            ai_cancel,
            models_list,
            model_download,
            model_download_cancel,
            model_remove,
            pick_file,
            pick_folder,
            save_file
        ])
        .build(tauri::generate_context!())
        .expect("error while starting ManuscriptForge");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            // The engine is a separate program: make sure it does not outlive the app.
            if let Some(engine) = app.try_state::<Arc<Engine>>() {
                engine.stop();
            }
            // Leave one complete database file behind, safe to copy or back up.
            if let Some(store) = app.try_state::<Store>() {
                let _ = store.checkpoint();
            }
        }
    });
}
