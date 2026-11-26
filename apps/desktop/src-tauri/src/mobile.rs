//! Mobile access (iPhone web app on the local network): starts and stops `ppm-mcp serve` for the
//! archive the app has open. The server writes one JSON line with its addresses when it is ready and
//! stops when its stdin is closed. It is never started unless the user turns mobile access on.
use serde_json::Value as Json;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

#[derive(Default)]
pub struct MobileServer(Mutex<Option<Running>>);

pub struct Running {
    child: Child,
    stdin: Option<ChildStdin>,
    info: Json,
}

impl MobileServer {
    pub fn status(&self) -> Option<Json> {
        let mut g = self.0.lock().unwrap();
        if let Some(r) = g.as_mut() {
            if matches!(r.child.try_wait(), Ok(Some(_))) {
                *g = None;
                return None;
            }
            return Some(r.info.clone());
        }
        None
    }

    pub fn start(&self, binary: &Path, archive: &str, port: u16) -> Result<Json, String> {
        if let Some(info) = self.status() {
            return Ok(info);
        }
        let mut cmd = Command::new(binary);
        cmd.args(["serve", "--archive", archive, "--port", &port.to_string()])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Mobilserveren kunne ikke starte: {e}"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or("Ingen stdout fra mobilserveren.")?;
        let mut stderr = child.stderr.take();
        let (tx, rx) = mpsc::channel::<Option<String>>();
        std::thread::spawn(move || {
            let mut line = String::new();
            let mut reader = BufReader::new(stdout);
            let ok = reader.read_line(&mut line).map(|n| n > 0).unwrap_or(false);
            let _ = tx.send(if ok { Some(line) } else { None });
            // Keep draining so the server never blocks on a full pipe.
            let mut sink = String::new();
            while reader.read_line(&mut sink).map(|n| n > 0).unwrap_or(false) {
                sink.clear();
            }
        });
        let line = match rx.recv_timeout(Duration::from_secs(30)) {
            Ok(Some(l)) => l,
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                let mut msg = String::new();
                if let Some(e) = stderr.as_mut() {
                    let _ = e.read_to_string(&mut msg);
                }
                let msg = msg.trim().trim_start_matches("ppm-mcp: ").to_string();
                return Err(if msg.is_empty() {
                    "Mobilserveren svarede ikke.".into()
                } else {
                    msg
                });
            }
        };
        let info: Json = serde_json::from_str(line.trim())
            .map_err(|e| format!("Uventet svar fra mobilserveren: {e}"))?;
        let stdin = child.stdin.take();
        *self.0.lock().unwrap() = Some(Running {
            child,
            stdin,
            info: info.clone(),
        });
        Ok(info)
    }

    pub fn stop(&self) {
        if let Some(mut r) = self.0.lock().unwrap().take() {
            drop(r.stdin.take()); // the server stops when stdin closes
            for _ in 0..20 {
                if matches!(r.child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            let _ = r.child.kill();
            let _ = r.child.wait();
        }
    }
}

/// Runs `ppm-mcp addresses`: the private IPv4 addresses and the current network key (router MAC).
pub fn network(binary: &Path) -> Result<Json, String> {
    let mut cmd = Command::new(binary);
    cmd.arg("addresses")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd
        .output()
        .map_err(|e| format!("Netværket kunne ikke læses: {e}"))?;
    parse_network(&String::from_utf8_lossy(&out.stdout))
}

fn parse_network(text: &str) -> Result<Json, String> {
    let v: Json =
        serde_json::from_str(text.trim()).map_err(|e| format!("Uventet svar fra ppm-mcp: {e}"))?;
    if !v.is_object() {
        return Err("Uventet svar fra ppm-mcp.".into());
    }
    Ok(v)
}

#[cfg(test)]
mod network_tests {
    use super::parse_network;

    #[test]
    fn parses_the_network_answer() {
        let v = parse_network(
            "{\"addresses\":[\"192.168.1.23\"],\"network\":\"router:aa:bb:cc:dd:ee:ff\"}\n",
        )
        .unwrap();
        assert_eq!(v["network"], "router:aa:bb:cc:dd:ee:ff");
        assert_eq!(v["addresses"][0], "192.168.1.23");
        assert!(parse_network("ikke json").is_err());
        assert!(parse_network("[1]").is_err());
    }
}
