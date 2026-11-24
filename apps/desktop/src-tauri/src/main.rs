#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::Value;
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::Mutex,
};
use tauri::{Manager, State};

struct Runtime {
    child: Child,
    input: Option<ChildStdin>,
    output: BufReader<ChildStdout>,
}

impl Drop for Runtime {
    fn drop(&mut self) {
        drop(self.input.take());
        let _ = self.child.wait();
    }
}

#[tauri::command]
async fn local_call(app: tauri::AppHandle, request: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state: State<Mutex<Runtime>> = app.state();
        let mut runtime = state.lock().map_err(|error| error.to_string())?;
        let input = runtime.input.as_mut().ok_or("Arkivprocessen er lukket.")?;
        writeln!(input, "{request}").map_err(|error| error.to_string())?;
        let mut response = String::new();
        if runtime.output.read_line(&mut response).map_err(|error| error.to_string())? == 0 {
            return Err("Arkivprocessen stoppede.".into());
        }
        serde_json::from_str(&response).map_err(|error| error.to_string())
    }).await.map_err(|error| error.to_string())?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config = app.path().app_config_dir()?;
            let runtime = if cfg!(debug_assertions) {
                std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("runtime")
            } else {
                app.path().resource_dir()?.join("runtime")
            };
            let program = if cfg!(target_os = "windows") { runtime.join("node.exe") } else { "node".into() };
            let mut command = Command::new(program);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            let mut child = command
                .arg(runtime.join("desktop.mjs"))
                .arg(config)
                .env("PPM_RUNTIME_DIR", &runtime)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()?;
            let input = child.stdin.take();
            let output = BufReader::new(child.stdout.take().ok_or("Arkivprocessens output mangler.")?);
            app.manage(Mutex::new(Runtime { child, input, output }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![local_call])
        .run(tauri::generate_context!())
        .expect("Could not start PPM");
}
