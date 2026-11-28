//! Model files on disk: listing them, and downloading new ones when the
//! publisher asks for it. Downloading is one of only two things in the app
//! that ever uses the network (the other is the optional cloud AI).

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::gguf::{self, GgufMeta};

pub const MODELS_DIR: &str = "models";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFile {
    pub path: String,
    pub file_name: String,
    pub size_bytes: u64,
    /// True when the file lives in the library's own models folder.
    pub in_library: bool,
    pub meta: Option<GgufMeta>,
    /// Why the file could not be read as a model, if it could not.
    pub problem: Option<String>,
}

fn describe(path: &Path, in_library: bool) -> Option<ModelFile> {
    let size_bytes = fs::metadata(path).ok()?.len();
    let (meta, problem) = match gguf::read_file(path) {
        Ok(meta) => (Some(meta), None),
        Err(e) => (None, Some(e)),
    };
    Some(ModelFile {
        path: path.to_string_lossy().into_owned(),
        file_name: path.file_name()?.to_string_lossy().into_owned(),
        size_bytes,
        in_library,
        meta,
        problem,
    })
}

/// Lists the models in the library's models folder plus any model files the
/// publisher added from elsewhere on the computer.
pub fn list(data_dir: &Path, extra_paths: &[String]) -> Vec<ModelFile> {
    let mut out = Vec::new();
    let dir = data_dir.join(MODELS_DIR);
    if let Ok(entries) = fs::read_dir(&dir) {
        let mut paths: Vec<PathBuf> = entries
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("gguf")))
            .collect();
        paths.sort();
        out.extend(paths.iter().filter_map(|p| describe(p, true)));
    }
    for extra in extra_paths {
        let path = Path::new(extra);
        if path.is_file() && !out.iter().any(|m| Path::new(&m.path) == path) {
            out.extend(describe(path, false));
        }
    }
    out
}

/// Deletes a model file. Only files inside the library's models folder can
/// be deleted; files elsewhere on the computer are never touched.
pub fn remove(data_dir: &Path, path: &str) -> Result<(), String> {
    let dir = fs::canonicalize(data_dir.join(MODELS_DIR)).map_err(|e| format!("Could not open the models folder: {e}"))?;
    let target = fs::canonicalize(path).map_err(|e| format!("Could not find the model file: {e}"))?;
    if target.parent() != Some(dir.as_path()) {
        return Err("Only models inside the library's models folder can be deleted here.".to_string());
    }
    fs::remove_file(&target).map_err(|e| format!("Could not delete the model file: {e}"))
}

fn safe_file_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    let ok = !name.is_empty()
        && name.len() <= 200
        && name.to_ascii_lowercase().ends_with(".gguf")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    if ok {
        Ok(name.to_string())
    } else {
        Err("The model file name is not valid.".to_string())
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub received: u64,
    /// Total size in bytes, or 0 when the server did not say.
    pub total: u64,
}

/// Downloads a model into the models folder.
///
/// The download goes to a ".part" file first and is renamed only when it is
/// complete, so a half-finished download can never be mistaken for a model.
/// If a ".part" file from an earlier attempt exists, the download continues
/// where it stopped. Setting `cancel` stops the download and keeps the part
/// file for later.
pub fn download(
    data_dir: &Path,
    url: &str,
    file_name: &str,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(Progress),
) -> Result<PathBuf, String> {
    if !(url.starts_with("https://") || url.starts_with("http://127.0.0.1:")) {
        return Err("Models can only be downloaded over a secure (https) connection.".to_string());
    }
    let file_name = safe_file_name(file_name)?;
    let dir = data_dir.join(MODELS_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create the models folder: {e}"))?;
    let target = dir.join(&file_name);
    if target.exists() {
        return Err("A model with this file name is already installed.".to_string());
    }
    let part = dir.join(format!("{file_name}.part"));
    let mut have = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(20))
        .timeout_read(Duration::from_secs(60))
        .redirects(8)
        .user_agent("ManuscriptForge")
        // Honour a proxy configured through the usual environment variables,
        // but never for an address on this computer.
        .try_proxy_from_env(!url.starts_with("http://127.0.0.1:"))
        .build();
    let mut request = agent.get(url);
    if have > 0 {
        request = request.set("Range", &format!("bytes={have}-"));
    }
    let response = match request.call() {
        Ok(r) => r,
        // "Range not satisfiable": the part file is already complete or no longer matches. Start over.
        Err(ureq::Error::Status(416, _)) => {
            let _ = fs::remove_file(&part);
            have = 0;
            agent.get(url).call().map_err(friendly)?
        }
        Err(e) => return Err(friendly(e)),
    };
    let resumed = response.status() == 206;
    if !resumed {
        have = 0;
    }
    let remaining: u64 = response.header("Content-Length").and_then(|v| v.parse().ok()).unwrap_or(0);
    let total = if remaining > 0 { have + remaining } else { 0 };

    let mut file = if resumed {
        OpenOptions::new().append(true).open(&part)
    } else {
        File::create(&part)
    }
    .map_err(|e| format!("Could not write the model file: {e}"))?;

    let mut reader = response.into_reader();
    let mut buffer = vec![0u8; 256 * 1024];
    let mut received = have;
    let mut last_report = Instant::now();
    on_progress(Progress { received, total });
    loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = file.flush();
            return Err("cancelled".to_string());
        }
        let n = reader.read(&mut buffer).map_err(|e| format!("The download was interrupted: {e}. Start it again to continue where it stopped."))?;
        if n == 0 {
            break;
        }
        file.write_all(&buffer[..n]).map_err(|e| format!("Could not write the model file (is the disk full?): {e}"))?;
        received += n as u64;
        if last_report.elapsed() >= Duration::from_millis(200) {
            last_report = Instant::now();
            on_progress(Progress { received, total });
        }
    }
    file.flush().map_err(|e| format!("Could not write the model file: {e}"))?;
    drop(file);
    if total > 0 && received != total {
        return Err("The download ended early. Start it again to continue where it stopped.".to_string());
    }
    on_progress(Progress { received, total: received });
    // Make sure what arrived really is a model before it is offered for use.
    if let Err(e) = gguf::read_file(&part) {
        let _ = fs::remove_file(&part);
        return Err(format!("The downloaded file is not a usable model. {e}"));
    }
    fs::rename(&part, &target).map_err(|e| format!("Could not finish the download: {e}"))?;
    Ok(target)
}

fn friendly(error: ureq::Error) -> String {
    match error {
        ureq::Error::Status(404, _) => "The model file was not found at that address. It may have been moved.".to_string(),
        ureq::Error::Status(401 | 403, _) => "The server refused the download. This model may need an account or licence agreement on its website.".to_string(),
        ureq::Error::Status(code, _) => format!("The server answered with an error ({code}). Try again later."),
        ureq::Error::Transport(t) => format!("Could not connect. Check the internet connection. ({t})"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;
    use std::sync::Arc;

    /// A tiny local web server that serves one file and honours Range requests.
    fn serve(body: Vec<u8>, requests: usize) -> (String, std::thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://127.0.0.1:{}/model.gguf", listener.local_addr().unwrap().port());
        let handle = std::thread::spawn(move || {
            let mut seen = Vec::new();
            for _ in 0..requests {
                let (mut stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut range = String::new();
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line.trim().is_empty() {
                        break;
                    }
                    if line.to_ascii_lowercase().starts_with("range:") {
                        range = line.trim().to_string();
                    }
                }
                seen.push(range.clone());
                let start: usize = range.split('=').nth(1).and_then(|r| r.trim_end_matches('-').parse().ok()).unwrap_or(0);
                let slice = &body[start.min(body.len())..];
                let status = if range.is_empty() { "200 OK" } else { "206 Partial Content" };
                let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", slice.len());
                // Send slowly enough that a test can cancel part-way.
                for chunk in slice.chunks(64 * 1024) {
                    if stream.write_all(chunk).is_err() {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(15));
                }
            }
            seen
        });
        (url, handle)
    }

    fn model_bytes(extra: usize) -> Vec<u8> {
        let mut bytes = crate::gguf::tests::sample();
        bytes.extend((0..extra).map(|i| (i % 251) as u8));
        bytes
    }

    #[test]
    fn downloads_a_model_and_reports_progress() {
        let dir = tempfile::tempdir().unwrap();
        let body = model_bytes(700_000);
        let (url, server) = serve(body.clone(), 1);
        let mut reports = Vec::new();
        let path = download(dir.path(), &url, "test-model.gguf", &AtomicBool::new(false), |p| reports.push(p)).unwrap();
        server.join().unwrap();
        assert_eq!(fs::read(&path).unwrap(), body);
        assert!(!dir.path().join("models/test-model.gguf.part").exists());
        assert_eq!(reports.last().unwrap().received, body.len() as u64);
        assert_eq!(reports.first().unwrap().total, body.len() as u64);

        let listed = list(dir.path(), &[]);
        assert_eq!(listed.len(), 1);
        assert!(listed[0].in_library);
        assert_eq!(listed[0].meta.as_ref().unwrap().quantization.as_deref(), Some("Q4_K_M"));
        assert!(download(dir.path(), &url, "test-model.gguf", &AtomicBool::new(false), |_| {}).unwrap_err().contains("already installed"));
    }

    #[test]
    fn a_cancelled_download_continues_where_it_stopped() {
        let dir = tempfile::tempdir().unwrap();
        let body = model_bytes(3_000_000);
        let (url, server) = serve(body.clone(), 2);
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        let first = download(dir.path(), &url, "big.gguf", &cancel, move |p| {
            if p.received > 600_000 {
                flag.store(true, Ordering::SeqCst);
            }
        });
        assert_eq!(first.unwrap_err(), "cancelled");
        let part = dir.path().join("models/big.gguf.part");
        let have = fs::metadata(&part).unwrap().len();
        assert!(have > 600_000 && have < body.len() as u64, "a part file is kept: {have}");
        assert!(list(dir.path(), &[]).is_empty(), "an unfinished download is not listed as a model");

        let path = download(dir.path(), &url, "big.gguf", &AtomicBool::new(false), |_| {}).unwrap();
        let seen = server.join().unwrap();
        assert_eq!(seen[1], format!("Range: bytes={have}-"));
        assert_eq!(fs::read(&path).unwrap(), body, "the resumed file is identical to the original");
    }

    #[test]
    fn refuses_bad_names_insecure_addresses_and_non_models() {
        let dir = tempfile::tempdir().unwrap();
        let no = AtomicBool::new(false);
        assert!(download(dir.path(), "http://example.com/m.gguf", "m.gguf", &no, |_| {}).unwrap_err().contains("secure"));
        assert!(download(dir.path(), "https://example.com/m.gguf", "../evil.gguf", &no, |_| {}).is_err());
        assert!(download(dir.path(), "https://example.com/m.gguf", "model.exe", &no, |_| {}).is_err());
        let (url, server) = serve(b"<html>Not a model</html>".to_vec(), 1);
        assert!(download(dir.path(), &url, "fake.gguf", &no, |_| {}).unwrap_err().contains("not a usable model"));
        server.join().unwrap();
        assert!(!dir.path().join("models/fake.gguf").exists());
        assert!(!dir.path().join("models/fake.gguf.part").exists());
    }

    /// Downloads from a real server over https when a small model address is
    /// given in MF_TEST_DOWNLOAD_URL, then repeats the download from a
    /// half-finished part file and checks both results are identical.
    #[test]
    fn downloads_and_resumes_from_a_real_server() {
        let Ok(url) = std::env::var("MF_TEST_DOWNLOAD_URL") else { return };
        let first = tempfile::tempdir().unwrap();
        let whole = download(first.path(), &url, "real.gguf", &AtomicBool::new(false), |_| {}).unwrap();
        let bytes = fs::read(&whole).unwrap();
        assert!(bytes.len() > 100_000);

        let second = tempfile::tempdir().unwrap();
        fs::create_dir_all(second.path().join("models")).unwrap();
        fs::write(second.path().join("models/real.gguf.part"), &bytes[..bytes.len() / 2]).unwrap();
        let mut first_report = None;
        let resumed = download(second.path(), &url, "real.gguf", &AtomicBool::new(false), |p| {
            first_report.get_or_insert(p);
        })
        .unwrap();
        assert_eq!(first_report.unwrap().received, (bytes.len() / 2) as u64, "the download continued from the part file");
        assert_eq!(fs::read(resumed).unwrap(), bytes);
    }

    #[test]
    fn only_deletes_models_inside_the_library() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("models")).unwrap();
        let inside = dir.path().join("models/a.gguf");
        let outside = dir.path().join("elsewhere.gguf");
        fs::write(&inside, crate::gguf::tests::sample()).unwrap();
        fs::write(&outside, crate::gguf::tests::sample()).unwrap();
        let listed = list(dir.path(), &[outside.to_string_lossy().into_owned(), "/does/not/exist.gguf".into()]);
        assert_eq!(listed.iter().map(|m| m.in_library).collect::<Vec<_>>(), vec![true, false]);
        assert!(remove(dir.path(), &outside.to_string_lossy()).is_err());
        assert!(outside.exists());
        remove(dir.path(), &inside.to_string_lossy()).unwrap();
        assert!(!inside.exists());
    }
}
