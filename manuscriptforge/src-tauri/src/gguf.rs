//! Reads the header of a GGUF model file: its name, size class, quantization
//! and context length. Only the metadata at the start of the file is read,
//! never the model weights.

use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;

use serde::Serialize;

#[derive(Debug, Default, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GgufMeta {
    pub name: Option<String>,
    pub architecture: Option<String>,
    /// For example "32B".
    pub size_label: Option<String>,
    /// For example "Q4_K_M".
    pub quantization: Option<String>,
    /// The longest context the model was trained for, in tokens.
    pub context_length: Option<u64>,
    /// Number of layers, used to estimate how many fit on the graphics card.
    pub block_count: Option<u64>,
    pub languages: Vec<String>,
}

const MAX_STRING: u64 = 16 * 1024 * 1024;
const MAX_ENTRIES: u64 = 200_000;

fn quantization_name(file_type: u64) -> Option<&'static str> {
    Some(match file_type {
        0 => "F32",
        1 => "F16",
        2 => "Q4_0",
        3 => "Q4_1",
        7 => "Q8_0",
        8 => "Q5_0",
        9 => "Q5_1",
        10 => "Q2_K",
        11 => "Q3_K_S",
        12 => "Q3_K_M",
        13 => "Q3_K_L",
        14 => "Q4_K_S",
        15 => "Q4_K_M",
        16 => "Q5_K_S",
        17 => "Q5_K_M",
        18 => "Q6_K",
        19 => "IQ2_XXS",
        20 => "IQ2_XS",
        21 => "Q2_K_S",
        22 => "IQ3_XS",
        23 => "IQ3_XXS",
        24 => "IQ1_S",
        25 => "IQ4_NL",
        26 => "IQ3_S",
        27 => "IQ3_M",
        28 => "IQ2_S",
        29 => "IQ2_M",
        30 => "IQ4_XS",
        31 => "IQ1_M",
        32 => "BF16",
        _ => return None,
    })
}

struct Reader<R: Read + Seek> {
    inner: R,
}

impl<R: Read + Seek> Reader<R> {
    fn bytes<const N: usize>(&mut self) -> Result<[u8; N], String> {
        let mut buf = [0u8; N];
        self.inner.read_exact(&mut buf).map_err(|_| "The file ends unexpectedly.".to_string())?;
        Ok(buf)
    }

    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.bytes()?))
    }

    fn u64(&mut self) -> Result<u64, String> {
        Ok(u64::from_le_bytes(self.bytes()?))
    }

    fn skip(&mut self, n: u64) -> Result<(), String> {
        self.inner.seek(SeekFrom::Current(n as i64)).map(|_| ()).map_err(|_| "The file ends unexpectedly.".to_string())
    }

    fn string(&mut self) -> Result<String, String> {
        let len = self.u64()?;
        if len > MAX_STRING {
            return Err("The file is not a valid GGUF model.".to_string());
        }
        let mut buf = vec![0u8; len as usize];
        self.inner.read_exact(&mut buf).map_err(|_| "The file ends unexpectedly.".to_string())?;
        Ok(String::from_utf8_lossy(&buf).into_owned())
    }

    /// Size in bytes of a fixed-width value type, or None for strings and arrays.
    fn width(value_type: u32) -> Option<u64> {
        match value_type {
            0 | 1 | 7 => Some(1),
            2 | 3 => Some(2),
            4 | 5 | 6 => Some(4),
            10 | 11 | 12 => Some(8),
            _ => None,
        }
    }

    fn skip_value(&mut self, value_type: u32) -> Result<(), String> {
        if let Some(width) = Self::width(value_type) {
            return self.skip(width);
        }
        match value_type {
            8 => {
                let len = self.u64()?;
                self.skip(len)
            }
            9 => {
                let element = self.u32()?;
                let count = self.u64()?;
                if let Some(width) = Self::width(element) {
                    self.skip(width.saturating_mul(count))
                } else if element == 8 {
                    for _ in 0..count {
                        let len = self.u64()?;
                        self.skip(len)?;
                    }
                    Ok(())
                } else {
                    Err("The file is not a valid GGUF model.".to_string())
                }
            }
            _ => Err("The file is not a valid GGUF model.".to_string()),
        }
    }

    /// Reads an integer of any width as u64.
    fn integer(&mut self, value_type: u32) -> Result<Option<u64>, String> {
        Ok(match value_type {
            0 => Some(self.bytes::<1>()?[0] as u64),
            2 => Some(u16::from_le_bytes(self.bytes()?) as u64),
            4 => Some(self.u32()? as u64),
            5 => Some(i32::from_le_bytes(self.bytes()?).max(0) as u64),
            10 => Some(self.u64()?),
            11 => Some(i64::from_le_bytes(self.bytes()?).max(0) as u64),
            other => {
                self.skip_value(other)?;
                None
            }
        })
    }
}

/// Reads model metadata from the start of a GGUF stream.
pub fn read_meta<R: Read + Seek>(stream: R) -> Result<GgufMeta, String> {
    let mut r = Reader { inner: stream };
    if &r.bytes::<4>()? != b"GGUF" {
        return Err("This is not a GGUF model file.".to_string());
    }
    let version = r.u32()?;
    if !(2..=3).contains(&version) {
        return Err(format!("This GGUF file uses format version {version}, which is not supported."));
    }
    let _tensors = r.u64()?;
    let entries = r.u64()?;
    if entries > MAX_ENTRIES {
        return Err("The file is not a valid GGUF model.".to_string());
    }

    let mut meta = GgufMeta::default();
    let mut context: Vec<(String, u64)> = Vec::new();
    let mut blocks: Vec<(String, u64)> = Vec::new();
    for _ in 0..entries {
        let key = r.string()?;
        let value_type = r.u32()?;
        match key.as_str() {
            "general.name" if value_type == 8 => meta.name = Some(r.string()?),
            "general.architecture" if value_type == 8 => meta.architecture = Some(r.string()?),
            "general.size_label" if value_type == 8 => meta.size_label = Some(r.string()?),
            "general.file_type" => {
                meta.quantization = r.integer(value_type)?.and_then(quantization_name).map(str::to_string);
            }
            "general.languages" if value_type == 9 => {
                let element = r.u32()?;
                let count = r.u64()?;
                if element != 8 || count > 1000 {
                    return Err("The file is not a valid GGUF model.".to_string());
                }
                for _ in 0..count {
                    meta.languages.push(r.string()?);
                }
            }
            _ if key.ends_with(".context_length") => {
                if let Some(n) = r.integer(value_type)? {
                    context.push((key, n));
                }
            }
            _ if key.ends_with(".block_count") => {
                if let Some(n) = r.integer(value_type)? {
                    blocks.push((key, n));
                }
            }
            _ => r.skip_value(value_type)?,
        }
    }
    // Prefer the keys of the model's own architecture ("llama.context_length").
    let pick = |list: &[(String, u64)]| {
        let prefix = meta.architecture.as_deref().map(|a| format!("{a}."));
        list.iter()
            .find(|(k, _)| prefix.as_deref().is_some_and(|p| k.starts_with(p)))
            .or_else(|| list.first())
            .map(|(_, n)| *n)
    };
    meta.context_length = pick(&context);
    meta.block_count = pick(&blocks);
    Ok(meta)
}

pub fn read_file(path: &Path) -> Result<GgufMeta, String> {
    let file = File::open(path).map_err(|e| format!("Could not open the model file: {e}"))?;
    read_meta(BufReader::new(file))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::Cursor;

    fn string(out: &mut Vec<u8>, s: &str) {
        out.extend((s.len() as u64).to_le_bytes());
        out.extend(s.as_bytes());
    }

    /// Builds a small but well-formed GGUF header for tests.
    pub(crate) fn sample() -> Vec<u8> {
        let mut out = Vec::new();
        out.extend(b"GGUF");
        out.extend(3u32.to_le_bytes());
        out.extend(0u64.to_le_bytes());
        out.extend(9u64.to_le_bytes());
        for (key, value) in [("general.architecture", "qwen2"), ("general.name", "Test Model 7B Instruct"), ("general.size_label", "7B")] {
            string(&mut out, key);
            out.extend(8u32.to_le_bytes());
            string(&mut out, value);
        }
        string(&mut out, "general.file_type");
        out.extend(4u32.to_le_bytes());
        out.extend(15u32.to_le_bytes());
        string(&mut out, "qwen2.context_length");
        out.extend(4u32.to_le_bytes());
        out.extend(32768u32.to_le_bytes());
        string(&mut out, "qwen2.block_count");
        out.extend(4u32.to_le_bytes());
        out.extend(28u32.to_le_bytes());
        string(&mut out, "general.languages");
        out.extend(9u32.to_le_bytes());
        out.extend(8u32.to_le_bytes());
        out.extend(2u64.to_le_bytes());
        string(&mut out, "en");
        string(&mut out, "zh");
        // A large vocabulary array and a float array, which must be skipped.
        string(&mut out, "tokenizer.ggml.tokens");
        out.extend(9u32.to_le_bytes());
        out.extend(8u32.to_le_bytes());
        out.extend(3u64.to_le_bytes());
        for token in ["<s>", "hello", "world"] {
            string(&mut out, token);
        }
        string(&mut out, "tokenizer.ggml.scores");
        out.extend(9u32.to_le_bytes());
        out.extend(6u32.to_le_bytes());
        out.extend(3u64.to_le_bytes());
        out.extend([0u8; 12]);
        out
    }

    #[test]
    fn reads_the_metadata_and_skips_the_rest() {
        let meta = read_meta(Cursor::new(sample())).unwrap();
        assert_eq!(
            meta,
            GgufMeta {
                name: Some("Test Model 7B Instruct".into()),
                architecture: Some("qwen2".into()),
                size_label: Some("7B".into()),
                quantization: Some("Q4_K_M".into()),
                context_length: Some(32768),
                block_count: Some(28),
                languages: vec!["en".into(), "zh".into()],
            }
        );
    }

    #[test]
    fn rejects_files_that_are_not_models() {
        assert!(read_meta(Cursor::new(b"PK\x03\x04 not a model".to_vec())).unwrap_err().contains("not a GGUF"));
        let mut truncated = sample();
        truncated.truncate(60);
        assert!(read_meta(Cursor::new(truncated)).is_err());
        let mut absurd = b"GGUF".to_vec();
        absurd.extend(3u32.to_le_bytes());
        absurd.extend(0u64.to_le_bytes());
        absurd.extend(u64::MAX.to_le_bytes());
        assert!(read_meta(Cursor::new(absurd)).is_err());
    }

    /// Reads a real model when one is available (set MF_TEST_MODEL to its path).
    #[test]
    fn reads_a_real_model_file() {
        let Ok(path) = std::env::var("MF_TEST_MODEL") else { return };
        let meta = read_file(Path::new(&path)).unwrap();
        println!("{meta:?}");
        assert!(meta.architecture.is_some());
        assert!(meta.context_length.unwrap() >= 2048);
        assert!(meta.block_count.unwrap() > 0);
        assert!(meta.quantization.is_some());
    }
}
