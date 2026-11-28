//! Runs the local AI engine: llama.cpp's `llama-server`, as a separate
//! program on this computer. The engine listens only on the loopback
//! address, on a random port, and requires a random key that only this app
//! knows, so nothing else can use it.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::hardware::quiet;

const LOG_LINES: usize = 300;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EngineBinary {
    /// "custom", "vulkan", "metal", "cpu", "bundled" or "system".
    pub variant: String,
    pub path: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOptions {
    pub binary: String,
    pub model: String,
    /// Context size in tokens.
    pub context: u32,
    /// Number of layers on the graphics card. None lets the engine decide.
    pub gpu_layers: Option<u32>,
    pub threads: Option<u32>,
    /// Do not use any graphics card.
    #[serde(default)]
    pub cpu_only: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub running: bool,
    pub model: Option<String>,
    pub binary: Option<String>,
    pub context: u32,
    pub cpu_only: bool,
    pub log_tail: Vec<String>,
}

struct Running {
    child: Child,
    port: u16,
    key: String,
    options: StartOptions,
    log: Arc<Mutex<VecDeque<String>>>,
}

#[derive(Default)]
pub struct Engine {
    running: Mutex<Option<Running>>,
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

fn exe_name() -> &'static str {
    if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    }
}

/// Reads the version line that `llama-server --version` prints.
pub fn parse_version(output: &str) -> Option<String> {
    output.lines().find_map(|line| line.trim().strip_prefix("version:").map(|v| v.trim().to_string()))
}

fn version_of(binary: &Path) -> Option<String> {
    let mut command = Command::new(binary);
    command.arg("--version");
    if let Some(dir) = binary.parent() {
        command.current_dir(dir);
    }
    let out = quiet(&mut command).output().ok()?;
    let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&out.stderr));
    parse_version(&text)
}

/// Finds every usable engine program, best first:
/// one the publisher pointed to, those shipped with the app, those placed in
/// the library's "engines" folder, and one installed on the system.
pub fn locate(custom_dir: Option<&str>, resource_dir: Option<&Path>, data_dir: &Path) -> Vec<EngineBinary> {
    let mut candidates: Vec<(String, PathBuf)> = Vec::new();
    if let Ok(path) = std::env::var("MANUSCRIPTFORGE_LLAMA_SERVER") {
        candidates.push(("custom".into(), PathBuf::from(path)));
    }
    if let Some(dir) = custom_dir.filter(|d| !d.trim().is_empty()) {
        let dir = PathBuf::from(dir);
        candidates.push(("custom".into(), if dir.is_file() { dir } else { dir.join(exe_name()) }));
    }
    let preferred: &[&str] = if cfg!(target_os = "macos") { &["metal", "cpu"] } else { &["vulkan", "cpu"] };
    for base in [resource_dir.map(|r| r.join("resources").join("llama")), resource_dir.map(|r| r.join("llama")), Some(data_dir.join("engines"))].into_iter().flatten() {
        for variant in preferred {
            candidates.push((variant.to_string(), base.join(variant).join(exe_name())));
        }
        candidates.push(("bundled".into(), base.join(exe_name())));
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            candidates.push(("system".into(), dir.join(exe_name())));
        }
    }
    let mut found: Vec<EngineBinary> = Vec::new();
    for (variant, path) in candidates {
        if !path.is_file() || found.iter().any(|f| Path::new(&f.path) == path) {
            continue;
        }
        found.push(EngineBinary { variant, version: version_of(&path), path: path.to_string_lossy().into_owned() });
    }
    found
}

/// The command line for the engine. `modern` adds options that recent
/// versions understand; older builds are started without them.
pub fn build_args(options: &StartOptions, port: u16, key: &str, modern: bool) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-m".into(),
        options.model.clone(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        port.to_string(),
        "-c".into(),
        options.context.to_string(),
        // One request at a time: the whole context goes to the passage being edited.
        "-np".into(),
        "1".into(),
        "--api-key".into(),
        key.to_string(),
    ];
    if options.cpu_only {
        args.extend(["-ngl".into(), "0".into()]);
    } else if let Some(layers) = options.gpu_layers {
        args.extend(["-ngl".into(), layers.to_string()]);
    }
    if let Some(threads) = options.threads.filter(|t| *t > 0) {
        args.extend(["-t".into(), threads.to_string()]);
    }
    if modern {
        // Never let the engine reach the network, and skip visible "thinking".
        args.extend(["--offline".into(), "--reasoning-budget".into(), "0".into()]);
    }
    args
}

fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Could not find a free port: {e}"))?;
    listener.local_addr().map(|a| a.port()).map_err(|e| format!("Could not find a free port: {e}"))
}

fn random_key() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    // Each RandomState is seeded from the operating system's random source.
    (0..4).map(|_| format!("{:016x}", RandomState::new().build_hasher().finish())).collect()
}

fn capture(stream: impl Read + Send + 'static, log: Arc<Mutex<VecDeque<String>>>) {
    std::thread::spawn(move || {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            if let Ok(mut log) = log.lock() {
                if log.len() >= LOG_LINES {
                    log.pop_front();
                }
                log.push_back(line);
            }
        }
    });
}

fn tail(log: &Arc<Mutex<VecDeque<String>>>, lines: usize) -> Vec<String> {
    log.lock().map(|l| l.iter().rev().take(lines).rev().cloned().collect()).unwrap_or_default()
}

/// Turns the engine's own error output into something a publisher can act on.
fn explain_failure(log: &[String]) -> String {
    let text = log.join("\n").to_lowercase();
    let reason = if text.contains("out of memory") || text.contains("failed to allocate") || text.contains("outofdevicememory") || text.contains("bad_alloc") {
        "There is not enough memory for this model at these settings. Try a smaller model, a smaller context size, or fewer layers on the graphics card."
    } else if text.contains("failed to load model") || text.contains("error loading model") || text.contains("invalid magic") {
        "The engine could not load this model file. The file may be damaged, or too new for this version of the engine."
    } else if text.contains("vulkan") && (text.contains("no devices") || text.contains("failed to initialize") || text.contains("error")) {
        "The graphics card could not be used. Update the graphics driver, or load the model without the graphics card."
    } else {
        "The AI engine stopped while starting."
    };
    let last = log.iter().rev().find(|l| !l.trim().is_empty()).cloned().unwrap_or_default();
    if last.is_empty() {
        reason.to_string()
    } else {
        format!("{reason} (Engine said: {})", last.chars().take(240).collect::<String>())
    }
}

fn agent(read_timeout: Duration) -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(3)).timeout_read(read_timeout).build()
}

enum Launch {
    Ready(Running),
    /// The engine rejected an option it does not know.
    UnknownOption(Vec<String>),
}

fn launch(options: &StartOptions, modern: bool, timeout: Duration) -> Result<Launch, String> {
    let binary = PathBuf::from(&options.binary);
    if !binary.is_file() {
        return Err("The AI engine program was not found.".to_string());
    }
    if !Path::new(&options.model).is_file() {
        return Err("The model file was not found. It may have been moved or deleted.".to_string());
    }
    let port = free_port()?;
    let key = random_key();
    let mut command = Command::new(&binary);
    command.args(build_args(options, port, &key, modern)).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // The engine's helper libraries sit next to it.
    if let Some(dir) = binary.parent() {
        command.current_dir(dir);
    }
    let mut child = quiet(&mut command).spawn().map_err(|e| format!("The AI engine could not be started: {e}"))?;
    let log = Arc::new(Mutex::new(VecDeque::new()));
    if let Some(out) = child.stdout.take() {
        capture(out, log.clone());
    }
    if let Some(err) = child.stderr.take() {
        capture(err, log.clone());
    }

    let health = format!("http://127.0.0.1:{port}/health");
    let client = agent(Duration::from_secs(5));
    let started = Instant::now();
    loop {
        if let Ok(Some(_)) = child.try_wait() {
            // Give the log readers a moment to collect the last lines.
            std::thread::sleep(Duration::from_millis(150));
            let lines = tail(&log, 40);
            let text = lines.join("\n").to_lowercase();
            if modern && (text.contains("invalid argument") || text.contains("unknown argument") || text.contains("error: unknown")) {
                return Ok(Launch::UnknownOption(lines));
            }
            return Err(explain_failure(&lines));
        }
        if let Ok(response) = client.get(&health).call() {
            if response.status() == 200 {
                return Ok(Launch::Ready(Running { child, port, key, options: options.clone(), log }));
            }
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err("The model took too long to load and was stopped.".to_string());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

impl Engine {
    /// Loads a model, replacing any model that is already loaded. Returns once
    /// the engine is ready to answer, which can take a while for a large model.
    pub fn start(&self, options: StartOptions) -> Result<EngineStatus, String> {
        self.stop();
        let timeout = Duration::from_secs(600);
        let running = match launch(&options, true, timeout)? {
            Launch::Ready(r) => r,
            // An older engine build: start it again without the newer options.
            Launch::UnknownOption(_) => match launch(&options, false, timeout)? {
                Launch::Ready(r) => r,
                Launch::UnknownOption(lines) => return Err(explain_failure(&lines)),
            },
        };
        *self.running.lock().map_err(|_| "Internal error".to_string())? = Some(running);
        Ok(self.status())
    }

    pub fn stop(&self) {
        if let Ok(mut guard) = self.running.lock() {
            if let Some(mut running) = guard.take() {
                let _ = running.child.kill();
                let _ = running.child.wait();
            }
        }
    }

    pub fn status(&self) -> EngineStatus {
        let Ok(mut guard) = self.running.lock() else { return EngineStatus::default() };
        // Notice an engine that has stopped by itself.
        if let Some(running) = guard.as_mut() {
            if let Ok(Some(_)) = running.child.try_wait() {
                let log_tail = tail(&running.log, 30);
                *guard = None;
                return EngineStatus { log_tail, ..EngineStatus::default() };
            }
        }
        match guard.as_ref() {
            Some(r) => EngineStatus {
                running: true,
                model: Some(r.options.model.clone()),
                binary: Some(r.options.binary.clone()),
                context: r.options.context,
                cpu_only: r.options.cpu_only,
                log_tail: tail(&r.log, 30),
            },
            None => EngineStatus::default(),
        }
    }

    fn endpoint(&self) -> Result<(u16, String), String> {
        let guard = self.running.lock().map_err(|_| "Internal error".to_string())?;
        guard.as_ref().map(|r| (r.port, r.key.clone())).ok_or_else(|| "engine-not-running".to_string())
    }

    /// Sends a chat request to the engine and passes the streamed reply on,
    /// piece by piece, as it arrives. `request_id` lets the request be
    /// cancelled from elsewhere.
    pub fn chat(&self, request_id: &str, body: &str, mut on_data: impl FnMut(&str)) -> Result<(), String> {
        let (port, key) = self.endpoint()?;
        let cancel = Arc::new(AtomicBool::new(false));
        if let Ok(mut cancels) = self.cancels.lock() {
            cancels.insert(request_id.to_string(), cancel.clone());
        }
        let result = (|| {
            let response = agent(Duration::from_secs(900))
                .post(&format!("http://127.0.0.1:{port}/v1/chat/completions"))
                .set("Authorization", &format!("Bearer {key}"))
                .set("Content-Type", "application/json")
                .send_string(body);
            let response = match response {
                Ok(r) => r,
                Err(ureq::Error::Status(code, r)) => {
                    let detail = r.into_string().unwrap_or_default();
                    return Err(format!("engine-refused:{code}:{}", detail.chars().take(400).collect::<String>()));
                }
                Err(ureq::Error::Transport(_)) => return Err("engine-not-running".to_string()),
            };
            let mut reader = BufReader::new(response.into_reader());
            let mut line = String::new();
            loop {
                if cancel.load(Ordering::SeqCst) {
                    // Dropping the connection makes the engine stop generating.
                    return Err("cancelled".to_string());
                }
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => return Ok(()),
                    Ok(_) => on_data(&line),
                    Err(_) if cancel.load(Ordering::SeqCst) => return Err("cancelled".to_string()),
                    Err(_) => return Err("engine-not-running".to_string()),
                }
            }
        })();
        if let Ok(mut cancels) = self.cancels.lock() {
            cancels.remove(request_id);
        }
        result
    }

    pub fn cancel(&self, request_id: &str) {
        if let Ok(cancels) = self.cancels.lock() {
            if let Some(flag) = cancels.get(request_id) {
                flag.store(true, Ordering::SeqCst);
            }
        }
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> StartOptions {
        StartOptions { binary: "/opt/llama/llama-server".into(), model: "/models/m.gguf".into(), context: 8192, gpu_layers: None, threads: None, cpu_only: false }
    }

    #[test]
    fn builds_the_command_line() {
        let args = build_args(&options(), 4321, "secret", true).join(" ");
        assert_eq!(args, "-m /models/m.gguf --host 127.0.0.1 --port 4321 -c 8192 -np 1 --api-key secret --offline --reasoning-budget 0");
        let manual = build_args(&StartOptions { gpu_layers: Some(20), threads: Some(8), ..options() }, 1, "k", false).join(" ");
        assert!(manual.ends_with("--api-key k -ngl 20 -t 8"));
        let cpu = build_args(&StartOptions { gpu_layers: Some(20), cpu_only: true, ..options() }, 1, "k", false).join(" ");
        assert!(cpu.contains("-ngl 0") && !cpu.contains("-ngl 20"));
    }

    #[test]
    fn reads_the_engine_version() {
        assert_eq!(parse_version("version: 6123 (abc1234)\nbuilt with MSVC for x64\n").as_deref(), Some("6123 (abc1234)"));
        assert_eq!(parse_version("nothing here"), None);
    }

    #[test]
    fn explains_common_failures_in_plain_language() {
        let oom = explain_failure(&["ggml_vulkan: Device memory allocation failed: ErrorOutOfDeviceMemory".into()]);
        assert!(oom.contains("not enough memory"));
        let bad = explain_failure(&["llama_model_load: error loading model: invalid magic".into()]);
        assert!(bad.contains("could not load this model file"));
        assert!(explain_failure(&[]).contains("stopped while starting"));
    }

    #[test]
    fn keys_are_long_and_different_each_time() {
        let a = random_key();
        assert_eq!(a.len(), 64);
        assert_ne!(a, random_key());
    }

    #[test]
    fn reports_missing_files_clearly() {
        let engine = Engine::default();
        assert!(engine.start(options()).unwrap_err().contains("engine program was not found"));
        assert!(!engine.status().running);
        assert_eq!(engine.chat("r1", "{}", |_| {}).unwrap_err(), "engine-not-running");
    }

    /// Runs a real engine with a real model when both are available:
    /// set MF_TEST_LLAMA_SERVER and MF_TEST_MODEL to their paths.
    #[test]
    fn runs_a_real_engine_end_to_end() {
        let (Ok(binary), Ok(model)) = (std::env::var("MF_TEST_LLAMA_SERVER"), std::env::var("MF_TEST_MODEL")) else { return };
        assert!(parse_version(&String::from_utf8_lossy(&Command::new(&binary).arg("--version").output().unwrap().stderr)).is_some());
        let engine = Arc::new(Engine::default());
        let status = engine.start(StartOptions { binary, model, context: 4096, gpu_layers: None, threads: None, cpu_only: false }).unwrap();
        assert!(status.running);

        let body = r#"{"messages":[{"role":"user","content":"Reply with the single word: hello"}],"max_tokens":16,"stream":true,"temperature":0}"#;
        let mut stream = String::new();
        engine.chat("r1", body, |data| stream.push_str(data)).unwrap();
        assert!(stream.contains("data: "), "the reply is streamed as events");
        assert!(stream.to_lowercase().contains("hello"), "the model answered: {stream}");
        assert!(stream.contains("[DONE]"));

        // A long reply can be cancelled part-way.
        let long = r#"{"messages":[{"role":"user","content":"Count slowly from 1 to 500, one number per line."}],"max_tokens":2000,"stream":true}"#;
        let canceller = engine.clone();
        let mut pieces = 0;
        let started = Instant::now();
        let result = engine.chat("r2", long, |_| {
            pieces += 1;
            if pieces == 12 {
                canceller.cancel("r2");
            }
        });
        assert_eq!(result.unwrap_err(), "cancelled");
        assert!(started.elapsed() < Duration::from_secs(60));

        // The engine is still usable after a cancelled request.
        let mut again = String::new();
        engine.chat("r3", body, |data| again.push_str(data)).unwrap();
        assert!(again.contains("[DONE]"));

        engine.stop();
        assert!(!engine.status().running);
        assert_eq!(engine.chat("r4", body, |_| {}).unwrap_err(), "engine-not-running");
    }
}
