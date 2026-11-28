//! The local data store: one SQLite database plus plain files, all inside a
//! single portable data folder. This module has no Tauri dependency so it can
//! be unit-tested on its own.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value as Json};

pub const DB_FILE: &str = "library.db";
pub const BACKUP_DIR: &str = "backups";

#[derive(Debug, Deserialize)]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Json>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub size_bytes: u64,
    pub modified_ms: u64,
}

pub struct Store {
    data_dir: PathBuf,
    conn: Mutex<Connection>,
}

fn err<E: std::fmt::Display>(context: &str) -> impl Fn(E) -> String + '_ {
    move |e| format!("{context}: {e}")
}

fn to_sql(value: &Json) -> SqlValue {
    match value {
        Json::Null => SqlValue::Null,
        Json::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Json::Number(n) => match n.as_i64() {
            Some(i) => SqlValue::Integer(i),
            None => SqlValue::Real(n.as_f64().unwrap_or(0.0)),
        },
        Json::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn from_sql(value: ValueRef<'_>) -> Json {
    match value {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::Number(Number::from(i)),
        ValueRef::Real(f) => Number::from_f64(f).map(Json::Number).unwrap_or(Json::Null),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => {
            use base64::Engine;
            Json::String(base64::engine::general_purpose::STANDARD.encode(b))
        }
    }
}

impl Store {
    /// Opens (creating if needed) the data folder and its database.
    pub fn open(data_dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&data_dir).map_err(err("Could not create the data folder"))?;
        let conn = Connection::open(data_dir.join(DB_FILE))
            .map_err(err("Could not open the library database"))?;
        conn.busy_timeout(Duration::from_secs(5)).map_err(err("Database setup failed"))?;
        // WAL keeps the database consistent if the app is closed or crashes mid-write.
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;",
        )
        .map_err(err("Database setup failed"))?;
        Ok(Self { data_dir, conn: Mutex::new(conn) })
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    fn conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.conn.lock().map_err(|_| "The database is unavailable after an internal error".to_string())
    }

    pub fn execute(&self, sql: &str, params: &[Json]) -> Result<usize, String> {
        let conn = self.conn()?;
        conn.execute(sql, params_from_iter(params.iter().map(to_sql)))
            .map_err(err("Database write failed"))
    }

    pub fn select(&self, sql: &str, params: &[Json]) -> Result<Vec<Map<String, Json>>, String> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(sql).map_err(err("Database read failed"))?;
        let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let mut rows = stmt
            .query(params_from_iter(params.iter().map(to_sql)))
            .map_err(err("Database read failed"))?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(err("Database read failed"))? {
            let mut map = Map::with_capacity(names.len());
            for (i, name) in names.iter().enumerate() {
                let value = row.get_ref(i).map_err(err("Database read failed"))?;
                map.insert(name.clone(), from_sql(value));
            }
            out.push(map);
        }
        Ok(out)
    }

    /// Runs all statements in one transaction: either every statement is
    /// applied or none is.
    pub fn batch(&self, statements: &[Statement]) -> Result<(), String> {
        let mut conn = self.conn()?;
        let tx = conn.transaction().map_err(err("Database write failed"))?;
        for s in statements {
            tx.execute(&s.sql, params_from_iter(s.params.iter().map(to_sql)))
                .map_err(err("Database write failed"))?;
        }
        tx.commit().map_err(err("Database write failed"))
    }

    /// Resolves a path relative to the data folder, refusing anything that
    /// would escape it.
    pub fn resolve(&self, rel: &str) -> Result<PathBuf, String> {
        let rel_path = Path::new(rel);
        if rel.is_empty() || rel_path.is_absolute() {
            return Err(format!("Invalid file path: {rel}"));
        }
        for part in rel_path.components() {
            match part {
                Component::Normal(_) => {}
                _ => return Err(format!("Invalid file path: {rel}")),
            }
        }
        Ok(self.data_dir.join(rel_path))
    }

    pub fn file_write(&self, rel: &str, bytes: &[u8]) -> Result<(), String> {
        let path = self.resolve(rel)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(err("Could not create folder"))?;
        }
        // Write to a temporary file first so a crash never leaves a half-written file.
        let tmp = path.with_extension("mf-tmp");
        fs::write(&tmp, bytes).map_err(err("Could not write file"))?;
        fs::rename(&tmp, &path).map_err(err("Could not write file"))
    }

    pub fn file_read(&self, rel: &str) -> Result<Vec<u8>, String> {
        fs::read(self.resolve(rel)?).map_err(err("Could not read file"))
    }

    pub fn file_exists(&self, rel: &str) -> Result<bool, String> {
        Ok(self.resolve(rel)?.exists())
    }

    /// Removes a file or a whole folder. Missing paths are not an error.
    pub fn file_remove(&self, rel: &str) -> Result<(), String> {
        let path = self.resolve(rel)?;
        if path.is_dir() {
            fs::remove_dir_all(&path).map_err(err("Could not remove folder"))
        } else if path.exists() {
            fs::remove_file(&path).map_err(err("Could not remove file"))
        } else {
            Ok(())
        }
    }

    pub fn list_backups(&self) -> Result<Vec<BackupInfo>, String> {
        let dir = self.data_dir.join(BACKUP_DIR);
        let mut out = Vec::new();
        if !dir.exists() {
            return Ok(out);
        }
        for entry in fs::read_dir(&dir).map_err(err("Could not list backups"))? {
            let entry = entry.map_err(err("Could not list backups"))?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if !(name.starts_with("library-") && name.ends_with(".db")) {
                continue;
            }
            let meta = entry.metadata().map_err(err("Could not list backups"))?;
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            out.push(BackupInfo { name, size_bytes: meta.len(), modified_ms });
        }
        out.sort_by(|a, b| b.name.cmp(&a.name));
        Ok(out)
    }

    /// Writes a consistent copy of the whole library into the backups folder
    /// and keeps only the newest `keep` copies.
    pub fn backup_now(&self, keep: usize) -> Result<BackupInfo, String> {
        let dir = self.data_dir.join(BACKUP_DIR);
        fs::create_dir_all(&dir).map_err(err("Could not create the backups folder"))?;
        let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
        let mut name = format!("library-{stamp}.db");
        let mut n = 1;
        while dir.join(&name).exists() {
            n += 1;
            name = format!("library-{stamp}-{n}.db");
        }
        let target = dir.join(&name);
        {
            let conn = self.conn()?;
            conn.execute("VACUUM INTO ?1", [target.to_string_lossy().as_ref()])
                .map_err(err("Backup failed"))?;
        }
        let backups = self.list_backups()?;
        for old in backups.iter().skip(keep.max(1)) {
            let _ = fs::remove_file(dir.join(&old.name));
        }
        backups
            .into_iter()
            .find(|b| b.name == name)
            .ok_or_else(|| "Backup failed: the backup file was not created".to_string())
    }

    /// Makes a backup if the library has books and the newest backup is older
    /// than `max_age`. Returns the new backup when one was made.
    pub fn ensure_recent_backup(
        &self,
        max_age: Duration,
        keep: usize,
    ) -> Result<Option<BackupInfo>, String> {
        let has_table = self.select(
            "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='books'",
            &[],
        )?;
        if has_table.is_empty() {
            return Ok(None);
        }
        let count = self.select("SELECT count(*) AS n FROM books", &[])?;
        let books = count.first().and_then(|r| r.get("n")).and_then(Json::as_i64).unwrap_or(0);
        if books == 0 {
            return Ok(None);
        }
        let now_ms = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let newest = self.list_backups()?.iter().map(|b| b.modified_ms).max();
        match newest {
            Some(ms) if now_ms.saturating_sub(ms) < max_age.as_millis() as u64 => Ok(None),
            _ => self.backup_now(keep).map(Some),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path().join("data")).unwrap();
        (dir, store)
    }

    #[test]
    fn executes_and_selects_typed_values() {
        let (_dir, s) = store();
        s.execute("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER, r REAL, note TEXT)", &[]).unwrap();
        let n = s
            .execute("INSERT INTO t VALUES (?1, ?2, ?3, ?4)", &[json!("a"), json!(42), json!(1.5), Json::Null])
            .unwrap();
        assert_eq!(n, 1);
        let rows = s.select("SELECT * FROM t WHERE id = ?1", &[json!("a")]).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["n"], json!(42));
        assert_eq!(rows[0]["r"], json!(1.5));
        assert_eq!(rows[0]["note"], Json::Null);
    }

    #[test]
    fn batch_is_atomic() {
        let (_dir, s) = store();
        s.execute("CREATE TABLE t (id TEXT PRIMARY KEY)", &[]).unwrap();
        let result = s.batch(&[
            Statement { sql: "INSERT INTO t VALUES ('one')".into(), params: vec![] },
            Statement { sql: "INSERT INTO t VALUES ('one')".into(), params: vec![] },
        ]);
        assert!(result.is_err());
        let rows = s.select("SELECT count(*) AS n FROM t", &[]).unwrap();
        assert_eq!(rows[0]["n"], json!(0), "a failed batch must leave nothing behind");
    }

    #[test]
    fn foreign_keys_cascade() {
        let (_dir, s) = store();
        s.execute("CREATE TABLE b (id TEXT PRIMARY KEY)", &[]).unwrap();
        s.execute("CREATE TABLE c (id TEXT PRIMARY KEY, b TEXT REFERENCES b(id) ON DELETE CASCADE)", &[]).unwrap();
        s.execute("INSERT INTO b VALUES ('b1')", &[]).unwrap();
        s.execute("INSERT INTO c VALUES ('c1', 'b1')", &[]).unwrap();
        s.execute("DELETE FROM b", &[]).unwrap();
        let rows = s.select("SELECT count(*) AS n FROM c", &[]).unwrap();
        assert_eq!(rows[0]["n"], json!(0));
    }

    #[test]
    fn files_round_trip_and_stay_inside_the_data_folder() {
        let (_dir, s) = store();
        s.file_write("books/b1/original/My Book.docx", b"hello").unwrap();
        assert!(s.file_exists("books/b1/original/My Book.docx").unwrap());
        assert_eq!(s.file_read("books/b1/original/My Book.docx").unwrap(), b"hello");
        s.file_remove("books/b1").unwrap();
        assert!(!s.file_exists("books/b1/original/My Book.docx").unwrap());
        s.file_remove("books/b1").unwrap();

        assert!(s.file_write("../escape.txt", b"x").is_err());
        assert!(s.file_write("books/../../escape.txt", b"x").is_err());
        assert!(s.file_read("/etc/passwd").is_err());
        assert!(s.file_write("", b"x").is_err());
    }

    #[test]
    fn backups_are_created_and_pruned() {
        let (_dir, s) = store();
        assert!(s.ensure_recent_backup(Duration::from_secs(3600), 3).unwrap().is_none());
        s.execute("CREATE TABLE books (id TEXT PRIMARY KEY)", &[]).unwrap();
        assert!(s.ensure_recent_backup(Duration::from_secs(3600), 3).unwrap().is_none());
        s.execute("INSERT INTO books VALUES ('b1')", &[]).unwrap();

        let first = s.ensure_recent_backup(Duration::from_secs(3600), 3).unwrap();
        assert!(first.is_some(), "a library with books gets its first backup");
        assert!(s.ensure_recent_backup(Duration::from_secs(3600), 3).unwrap().is_none());

        for _ in 0..4 {
            s.backup_now(3).unwrap();
        }
        let backups = s.list_backups().unwrap();
        assert_eq!(backups.len(), 3, "only the newest copies are kept");

        // A backup is a complete, readable database.
        let copy = Connection::open(s.data_dir().join(BACKUP_DIR).join(&backups[0].name)).unwrap();
        let n: i64 = copy.query_row("SELECT count(*) FROM books", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }
}
