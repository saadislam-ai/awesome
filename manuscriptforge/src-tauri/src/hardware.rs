//! Finds out what this computer can run: memory, processor, and graphics
//! cards with their memory. This drives the model recommendations.

use std::path::Path;
use std::process::Command;

use serde::Serialize;
use sysinfo::System;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Gpu {
    pub name: String,
    pub vram_bytes: u64,
    pub free_bytes: Option<u64>,
    /// The engine's own name for the device, for example "Vulkan0".
    pub device: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hardware {
    pub ram_bytes: u64,
    pub cpu_name: String,
    pub cpu_cores: usize,
    pub cpu_threads: usize,
    pub gpus: Vec<Gpu>,
    /// Apple Silicon shares one pool of memory between processor and graphics.
    pub unified_memory: bool,
    pub os: String,
    pub arch: String,
    /// Where the graphics information came from: "engine", "system" or "none".
    pub gpu_source: String,
}

const MIB: u64 = 1024 * 1024;

/// Prevents a console window from flashing up when a helper program is run on Windows.
pub fn quiet(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

/// Parses the output of `llama-server --list-devices`, for example:
/// `  Vulkan0: AMD Radeon RX 7900 XTX (24306 MiB, 23000 MiB free)`.
pub fn parse_list_devices(output: &str) -> Vec<Gpu> {
    let mut gpus = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        let Some((device, rest)) = line.split_once(": ") else { continue };
        if device.contains(' ') || !rest.ends_with(')') {
            continue;
        }
        let Some(open) = rest.rfind('(') else { continue };
        let name = rest[..open].trim().to_string();
        let inside = &rest[open + 1..rest.len() - 1];
        let mut numbers = inside.split(',').filter_map(|part| part.trim().split_whitespace().next()?.parse::<u64>().ok());
        let Some(total) = numbers.next() else { continue };
        gpus.push(Gpu { name, vram_bytes: total * MIB, free_bytes: numbers.next().map(|n| n * MIB), device: Some(device.to_string()) });
    }
    gpus
}

/// Parses `reg query ... /s` output for display adapters: the driver
/// description and the 64-bit memory size of each adapter.
pub fn parse_windows_registry(output: &str) -> Vec<Gpu> {
    let mut gpus = Vec::new();
    let mut name: Option<String> = None;
    let mut memory: Option<u64> = None;
    let mut flush = |name: &mut Option<String>, memory: &mut Option<u64>| {
        if let (Some(n), Some(m)) = (name.take(), memory.take()) {
            if m >= 256 * MIB && !gpus.iter().any(|g: &Gpu| g.name == n && g.vram_bytes == m) {
                gpus.push(Gpu { name: n, vram_bytes: m, free_bytes: None, device: None });
            }
        }
        *name = None;
        *memory = None;
    };
    for line in output.lines() {
        if line.starts_with("HKEY_") {
            flush(&mut name, &mut memory);
            continue;
        }
        let mut parts = line.split_whitespace();
        let (Some(key), Some(kind)) = (parts.next(), parts.next()) else { continue };
        let value = parts.collect::<Vec<_>>().join(" ");
        if key == "DriverDesc" && kind == "REG_SZ" {
            name = Some(value);
        } else if key == "HardwareInformation.qwMemorySize" && kind == "REG_QWORD" {
            memory = u64::from_str_radix(value.trim_start_matches("0x"), 16).ok();
        }
    }
    flush(&mut name, &mut memory);
    gpus
}

fn run(program: &str, args: &[&str]) -> Option<String> {
    let output = quiet(Command::new(program).args(args)).output().ok()?;
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    Some(text)
}

/// Asks the engine which devices it can use. This is the most reliable
/// answer, because it is exactly what the engine will see when it runs.
pub fn engine_devices(engine: &Path) -> Vec<Gpu> {
    let mut command = Command::new(engine);
    command.arg("--list-devices");
    if let Some(dir) = engine.parent() {
        command.current_dir(dir);
    }
    match quiet(&mut command).output() {
        Ok(out) => {
            let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
            text.push_str(&String::from_utf8_lossy(&out.stderr));
            parse_list_devices(&text)
        }
        Err(_) => Vec::new(),
    }
}

fn system_gpus() -> Vec<Gpu> {
    if cfg!(target_os = "windows") {
        let key = r"HKLM\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}";
        return run("reg", &["query", key, "/s"]).map(|out| parse_windows_registry(&out)).unwrap_or_default();
    }
    Vec::new()
}

pub fn detect(engine: Option<&Path>) -> Hardware {
    let mut system = System::new();
    system.refresh_memory();
    system.refresh_cpu();
    let ram_bytes = system.total_memory();
    let cpu_name = system.cpus().first().map(|c| c.brand().trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| "Unknown processor".into());
    let cpu_threads = system.cpus().len().max(1);
    let cpu_cores = system.physical_core_count().unwrap_or(cpu_threads);
    let unified_memory = cfg!(all(target_os = "macos", target_arch = "aarch64"));

    let mut gpu_source = "none";
    let mut gpus = engine.map(engine_devices).unwrap_or_default();
    if !gpus.is_empty() {
        gpu_source = "engine";
    } else {
        gpus = system_gpus();
        if !gpus.is_empty() {
            gpu_source = "system";
        } else if unified_memory {
            gpus.push(Gpu { name: "Apple GPU (shares system memory)".into(), vram_bytes: ram_bytes, free_bytes: None, device: None });
            gpu_source = "system";
        }
    }
    Hardware {
        ram_bytes,
        cpu_name,
        cpu_cores,
        cpu_threads,
        gpus,
        unified_memory,
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        gpu_source: gpu_source.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_engine_device_list() {
        let out = "ggml_vulkan: Found 1 Vulkan devices:\nAvailable devices:\n  Vulkan0: AMD Radeon RX 7900 XTX (24306 MiB, 23012 MiB free)\n  Vulkan1: Intel(R) UHD Graphics 770 (16203 MiB, 15000 MiB free)\n";
        let gpus = parse_list_devices(out);
        assert_eq!(gpus.len(), 2);
        assert_eq!(gpus[0], Gpu { name: "AMD Radeon RX 7900 XTX".into(), vram_bytes: 24306 * MIB, free_bytes: Some(23012 * MIB), device: Some("Vulkan0".into()) });
        assert_eq!(gpus[1].name, "Intel(R) UHD Graphics 770");
        assert!(parse_list_devices("Available devices:\n  (none)\n").is_empty());
    }

    #[test]
    fn parses_windows_display_adapters() {
        let out = "\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000\r\n    DriverDesc    REG_SZ    AMD Radeon RX 7900 XTX\r\n    ProviderName    REG_SZ    Advanced Micro Devices, Inc.\r\n    HardwareInformation.qwMemorySize    REG_QWORD    0x5ff000000\r\n    HardwareInformation.MemorySize    REG_DWORD    0xff000000\r\n\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0001\r\n    DriverDesc    REG_SZ    Microsoft Basic Display Adapter\r\n\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000\\UMD\r\n    Something    REG_SZ    x\r\n";
        let gpus = parse_windows_registry(out);
        assert_eq!(gpus, vec![Gpu { name: "AMD Radeon RX 7900 XTX".into(), vram_bytes: 0x5ff000000, free_bytes: None, device: None }]);
    }

    #[test]
    fn detects_this_machine() {
        let hw = detect(None);
        assert!(hw.ram_bytes > 512 * MIB);
        assert!(hw.cpu_threads >= 1 && hw.cpu_cores >= 1);
        assert!(!hw.cpu_name.is_empty());
    }
}
