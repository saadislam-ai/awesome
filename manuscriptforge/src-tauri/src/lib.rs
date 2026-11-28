//! ManuscriptForge desktop shell.
//!
//! The shell is deliberately thin: it owns the data folder (SQLite database,
//! original manuscript files, backups) and exposes it to the UI through a
//! small set of commands. It makes no network connections.

pub mod store;

use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use serde_json::{Map, Value as Json};
use tauri::{AppHandle, Manager, State};

use store::{BackupInfo, Statement, Store};

/// Set to a file path to run the built-in self-check on launch, write its
/// report to that file and exit. Used by automated smoke tests.
const SELFTEST_ENV: &str = "MF_SELFTEST_OUT";
/// Overrides where the library is stored.
const DATA_DIR_ENV: &str = "MANUSCRIPTFORGE_DATA_DIR";
const BACKUPS_TO_KEEP: usize = 14;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    data_dir: String,
    version: String,
    os: String,
    arch: String,
    selftest: bool,
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
    }
}

/// Called by the UI when a launch-time self-check finishes.
#[tauri::command]
fn selftest_finish(app: AppHandle, report: String, passed: bool) -> Result<(), String> {
    let out = std::env::var(SELFTEST_ENV).map_err(|_| "Self-check mode is not active".to_string())?;
    fs::write(&out, report).map_err(|e| format!("Could not write the self-check report: {e}"))?;
    app.exit(if passed { 0 } else { 1 });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = resolve_data_dir(app.handle());
            let store = Store::open(data_dir)?;
            app.manage(store);
            Ok(())
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
            selftest_finish
        ])
        .run(tauri::generate_context!())
        .expect("error while running ManuscriptForge");
}
