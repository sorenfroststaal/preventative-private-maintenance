#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::Value;
use std::{
    collections::HashMap,
    path::PathBuf,
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::Mutex,
};
use tauri::{Emitter, DragDropEvent, Manager, State, WindowEvent};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct FileGrants {
    paths: HashMap<String, Vec<PathBuf>>,
    dropped: Vec<PathBuf>,
}

#[tauri::command]
async fn choose_files(app: tauri::AppHandle, purpose: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let picker = app.dialog().file();
        let selected = match purpose.as_str() {
            "open" | "backup" => picker.blocking_pick_folder().map(|p| vec![p]),
            "import" => picker.add_filter("Bilag", &["pdf", "jpg", "jpeg", "png", "heic", "eml", "msg"]).blocking_pick_files(),
            "bankPreview" => picker.add_filter("CSV", &["csv"]).blocking_pick_file().map(|p| vec![p]),
            "restore" => picker.add_filter("Backup", &["zip"]).blocking_pick_file().map(|p| vec![p]),
            _ => return Err("Ukendt filvalg.".into()),
        };
        let paths: Vec<_> = selected.unwrap_or_default().into_iter().filter_map(|p| p.into_path().ok()).filter_map(|p| p.canonicalize().ok()).collect();
        let result = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
        app.state::<Mutex<FileGrants>>().lock().map_err(|e| e.to_string())?.paths.insert(purpose, paths);
        Ok(result)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn take_dropped(grants: State<Mutex<FileGrants>>) -> Result<Vec<String>, String> {
    let mut grants = grants.lock().map_err(|e| e.to_string())?;
    let paths = std::mem::take(&mut grants.dropped);
    let result = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    grants.paths.entry("import".into()).or_default().extend(paths);
    Ok(result)
}

fn authorize(request: &Value, grants: &Mutex<FileGrants>) -> Result<(), String> {
    let action = request["action"].as_str().unwrap_or_default();
    let path = match action {
        "open" | "bankPreview" => request["data"]["path"].as_str(),
        "backup" | "restore" | "import" => request["data"].as_str(),
        "config" | "openRecent" | "login" | "logout" | "createUser" | "createPerson" | "backupDue" |
        "food" | "recipes" | "addStarterCatalog" | "tasks" | "createTask" | "completeTask" | "documents" | "search" | "records" | "inventory" | "orderNote" | "orderClaim" | "deleteItemPart" | "saveRecord" |
        "archiveRecord" | "linkRecord" | "unlinkRecord" | "dashboard" | "vehicleCosts" | "history" | "bankApply" | "export" | "report" | "previewDocument" | "inbox" | "postponeTask" | "documentLinks" | "policyInfo" | "bankTransactions" | "categorize" | "vehicleTemplates" | "addVehicleTemplate" | "privacy" | "setPrivacy" | "bankProfiles" | "saveBankProfile" | "financeYear" => return Ok(()),
        _ => return Err("Ukendt lokal handling.".into()),
    }.ok_or("Der mangler en godkendt sti.")?;
    let guard = grants.lock().map_err(|e| e.to_string())?;
    if guard.paths.get(action).is_some_and(|paths| paths.iter().any(|allowed| {
        allowed.as_os_str() == std::ffi::OsStr::new(path) &&
            allowed.canonicalize().is_ok_and(|current| &current == allowed)
    })) {
        Ok(())
    } else {
        Err("Stien er uden for det godkendte filvalg.".into())
    }
}

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
        authorize(&request, &app.state::<Mutex<FileGrants>>())?;
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
        .manage(Mutex::new(FileGrants::default()))
        .on_window_event(|window, event| {
            if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                if let Ok(mut grants) = window.state::<Mutex<FileGrants>>().lock() {
                    grants.dropped = paths.iter().filter_map(|p| p.canonicalize().ok()).collect();
                    let _ = window.emit("ppm-files-dropped", ());
                }
            }
        })
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
        .invoke_handler(tauri::generate_handler![local_call, choose_files, take_dropped])
        .build(tauri::generate_context!())
        .expect("Could not start PPM")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Ok(mut runtime) = app.state::<Mutex<Runtime>>().lock() {
                    drop(runtime.input.take());
                    let _ = runtime.child.wait();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rejects_webview_paths_and_sql_outside_the_grants() {
        let grants = Mutex::new(FileGrants::default());
        assert!(authorize(&json!({"action":"import","data":"synthetic.pdf"}), &grants).is_err());
        assert!(authorize(&json!({"action":"open","data":{"path":"..","create":true}}), &grants).is_err());
        for sql in ["ATTACH DATABASE ? AS external", "VACUUM INTO ?"] {
            assert!(authorize(&json!({"action":"execute","data":sql}), &grants).is_err());
        }
        let root = std::env::current_dir().unwrap().canonicalize().unwrap();
        grants.lock().unwrap().paths.insert("backup".into(), vec![root.clone()]);
        assert!(authorize(&json!({"action":"backup","data":root}), &grants).is_ok());
        assert!(authorize(&json!({"action":"backup","data":root.join("..")}), &grants).is_err());
    }
}
