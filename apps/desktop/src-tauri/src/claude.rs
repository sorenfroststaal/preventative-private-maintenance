//! Claude Desktop integration (spec 06 "Færdigpakkede forbindelser"):
//! - add PPM to Claude Desktop's claude_desktop_config.json (other servers are kept,
//!   a backup is written first), and
//! - a self-test that starts ppm-mcp exactly like an MCP client and does the handshake.
//!
//! All paths are derived here, never taken from the UI.

use serde::Serialize;
use serde_json::{json, Map, Value as Json};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

/// Folders where Claude Desktop keeps claude_desktop_config.json. On Windows the Microsoft
/// Store version redirects %APPDATA% into its package folder, so those are included when
/// they exist.
pub fn claude_config_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            dirs.push(PathBuf::from(appdata).join("Claude"));
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            if let Ok(entries) = std::fs::read_dir(PathBuf::from(local).join("Packages")) {
                for e in entries.flatten() {
                    let name = e.file_name().to_string_lossy().to_string();
                    if name.starts_with("Claude_") || name.starts_with("AnthropicPBC.Claude") {
                        let d = e.path().join("LocalCache").join("Roaming").join("Claude");
                        if d.is_dir() {
                            dirs.push(d);
                        }
                    }
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    if let Ok(home) = std::env::var("HOME") {
        dirs.push(PathBuf::from(home).join("Library/Application Support/Claude"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let base = std::env::var("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|_| std::env::var("HOME").map(|h| PathBuf::from(h).join(".config")));
        if let Ok(b) = base {
            dirs.push(b.join("Claude"));
        }
    }
    dirs
}

/// Adds or replaces `mcpServers.ppm` in the config text. Everything else is kept as it is.
pub fn with_ppm_server(existing: Option<&str>, binary: &str) -> Result<String, String> {
    let mut root: Map<String, Json> = match existing.map(str::trim) {
        None | Some("") => Map::new(),
        Some(text) => match serde_json::from_str::<Json>(text) {
            Ok(Json::Object(m)) => m,
            Ok(_) => return Err("claude_desktop_config.json er ikke et JSON-objekt. Ret filen, eller tilføj PPM manuelt.".into()),
            Err(e) => return Err(format!("claude_desktop_config.json kan ikke læses ({e}). Ret filen, eller tilføj PPM manuelt.")),
        },
    };
    let servers = root
        .entry("mcpServers")
        .or_insert_with(|| Json::Object(Map::new()));
    let Json::Object(servers) = servers else {
        return Err("\"mcpServers\" i claude_desktop_config.json er ikke et objekt.".into());
    };
    servers.insert("ppm".into(), json!({ "command": binary, "args": [] }));
    serde_json::to_string_pretty(&Json::Object(root)).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeConfigResult {
    /// Config files written.
    pub written: Vec<String>,
    /// Backups of files that existed before.
    pub backups: Vec<String>,
    /// True if no Claude Desktop folder was found (the file was created in the default place).
    pub claude_not_found: bool,
}

/// Writes PPM into every Claude Desktop config folder found (or creates the default one).
pub fn add_to_claude_desktop(binary: &Path) -> Result<ClaudeConfigResult, String> {
    let dirs = claude_config_dirs();
    if dirs.is_empty() {
        return Err("Claude Desktops konfigurationsmappe kunne ikke findes.".into());
    }
    let existing: Vec<&PathBuf> = dirs.iter().filter(|d| d.is_dir()).collect();
    let targets: Vec<PathBuf> = if existing.is_empty() {
        vec![dirs[0].clone()]
    } else {
        existing.into_iter().cloned().collect()
    };
    let binary = binary.to_string_lossy().to_string();
    let mut result = ClaudeConfigResult {
        written: vec![],
        backups: vec![],
        claude_not_found: !dirs.iter().any(|d| d.is_dir()),
    };
    for dir in targets {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let file = dir.join("claude_desktop_config.json");
        let current = std::fs::read_to_string(&file).ok();
        let next = with_ppm_server(current.as_deref(), &binary)?;
        if let Some(text) = &current {
            let backup = dir.join("claude_desktop_config.json.ppm-backup");
            std::fs::write(&backup, text).map_err(|e| e.to_string())?;
            result.backups.push(backup.to_string_lossy().to_string());
        }
        let tmp = dir.join("claude_desktop_config.json.ppm-tmp");
        std::fs::write(&tmp, next).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &file).map_err(|e| e.to_string())?;
        result.written.push(file.to_string_lossy().to_string());
    }
    Ok(result)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SelfTest {
    pub server: String,
    pub tools: usize,
    pub instructions_chars: usize,
}

/// Starts the binary like an MCP client (stdio, no arguments, archive from config.json) and
/// does initialize + tools/list. Fails with the server's own message if it exits early.
pub fn mcp_selftest(binary: &Path, timeout: Duration) -> Result<SelfTest, String> {
    let mut child = Command::new(binary)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ppm-mcp kunne ikke startes: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("Ingen stdin")?;
    let stdout = child.stdout.take().ok_or("Ingen stdout")?;
    let stderr = child.stderr.take().ok_or("Ingen stderr")?;
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    let err_reader = std::thread::spawn(move || {
        let mut s = String::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            s.push_str(&line);
            s.push('\n');
        }
        s
    });
    let send = |stdin: &mut std::process::ChildStdin, v: Json| -> Result<(), String> {
        writeln!(stdin, "{v}").map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())
    };
    let wait_for = |id: i64| -> Result<Json, String> {
        loop {
            let line = rx
                .recv_timeout(timeout)
                .map_err(|_| "ppm-mcp svarede ikke.".to_string())?;
            if let Ok(v) = serde_json::from_str::<Json>(&line) {
                if v.get("id").and_then(Json::as_i64) == Some(id) {
                    return Ok(v);
                }
            }
        }
    };
    let outcome = (|| {
        send(
            &mut stdin,
            json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"ppm-selvtest","version":"1"}}}),
        )?;
        let init = wait_for(1)?;
        let result = init.get("result").ok_or_else(|| {
            format!(
                "Fejl fra ppm-mcp: {}",
                init.get("error").unwrap_or(&Json::Null)
            )
        })?;
        send(
            &mut stdin,
            json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
        )?;
        send(
            &mut stdin,
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
        )?;
        let list = wait_for(2)?;
        Ok(SelfTest {
            server: result
                .pointer("/serverInfo/name")
                .and_then(Json::as_str)
                .unwrap_or("?")
                .to_string(),
            tools: list
                .pointer("/result/tools")
                .and_then(Json::as_array)
                .map(Vec::len)
                .unwrap_or(0),
            instructions_chars: result
                .get("instructions")
                .and_then(Json::as_str)
                .map(|s| s.chars().count())
                .unwrap_or(0),
        })
    })();
    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    let stderr_text = err_reader.join().unwrap_or_default();
    outcome.map_err(|e: String| {
        let detail = stderr_text.trim();
        if detail.is_empty() {
            e
        } else {
            format!("{e} {detail}")
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_other_servers_and_settings() {
        let before = r#"{"globalShortcut":"Ctrl+Space","mcpServers":{"other":{"command":"x"}}}"#;
        let after: Json =
            serde_json::from_str(&with_ppm_server(Some(before), r"C:\PPM\ppm-mcp.exe").unwrap())
                .unwrap();
        assert_eq!(after["globalShortcut"], "Ctrl+Space");
        assert_eq!(after["mcpServers"]["other"]["command"], "x");
        assert_eq!(after["mcpServers"]["ppm"]["command"], r"C:\PPM\ppm-mcp.exe");
        // Order of the user's keys is kept.
        let text = with_ppm_server(Some(before), "p").unwrap();
        assert!(text.find("globalShortcut").unwrap() < text.find("mcpServers").unwrap());
    }

    #[test]
    fn creates_config_and_replaces_old_ppm_entry() {
        let fresh: Json =
            serde_json::from_str(&with_ppm_server(None, "/usr/bin/ppm-mcp").unwrap()).unwrap();
        assert_eq!(
            fresh,
            json!({"mcpServers":{"ppm":{"command":"/usr/bin/ppm-mcp","args":[]}}})
        );
        let replaced: Json = serde_json::from_str(
            &with_ppm_server(
                Some(r#"{"mcpServers":{"ppm":{"command":"old","args":["--archive","x"]}}}"#),
                "new",
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            replaced["mcpServers"]["ppm"],
            json!({"command":"new","args":[]})
        );
    }

    #[test]
    fn refuses_broken_config() {
        assert!(with_ppm_server(Some("{ not json"), "p").is_err());
        assert!(with_ppm_server(Some("[1,2]"), "p").is_err());
        assert!(with_ppm_server(Some(r#"{"mcpServers":[]}"#), "p").is_err());
    }

    /// Runs the real built binary when it exists (after `pnpm build:mcp`).
    #[cfg(unix)]
    #[test]
    fn selftest_against_built_binary() {
        let bin = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/mcp/ppm-mcp");
        if !bin.is_file() {
            eprintln!("skipped: {} not built", bin.display());
            return;
        }
        // Without an archive the server must fail with its own explanation.
        let dir = tempfile::tempdir().unwrap();
        let r = std::panic::catch_unwind(|| {
            std::env::set_var("XDG_CONFIG_HOME", dir.path());
            mcp_selftest(&bin, Duration::from_secs(20))
        });
        let r = r.unwrap();
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("config.json"));

        // With an archive in config.json (set PPM_TEST_ARCHIVE to a seed archive): full handshake.
        if let Ok(archive) = std::env::var("PPM_TEST_ARCHIVE") {
            std::fs::create_dir_all(dir.path().join("ppm")).unwrap();
            std::fs::write(dir.path().join("ppm/config.json"), json!({ "archivePath": archive }).to_string()).unwrap();
            let ok = mcp_selftest(&bin, Duration::from_secs(20)).unwrap();
            assert_eq!(ok.server, "ppm");
            assert_eq!(ok.tools, 14);
            assert!(ok.instructions_chars > 0 && ok.instructions_chars < 700);
        }
    }
}
