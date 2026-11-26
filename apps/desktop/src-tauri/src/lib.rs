mod claude;
mod db;
mod files;
mod mobile;
mod scope;

use percent_encoding::percent_decode_str;
use serde::Serialize;
use serde_json::{Map, Value as Json};
use std::path::PathBuf;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use db::Dbs;
use files::{DirEntry, Stat, ZipEntry};
use scope::Scope;

type R<T> = Result<T, String>;

// ---------- app / config ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    pid: u32,
    hostname: String,
    app_version: String,
    config_path: String,
    one_drive_env: Vec<String>,
}

/// %APPDATA%\ppm\config.json on Windows (spec 02); the OS config dir elsewhere.
fn config_path(app: &AppHandle) -> R<PathBuf> {
    Ok(app
        .path()
        .config_dir()
        .map_err(|e| e.to_string())?
        .join("ppm")
        .join("config.json"))
}

/// Files of the packaged AI connection (spec 06 "Færdigpakkede forbindelser"), shipped as
/// resources next to the app. Paths are resolved here and never taken from the UI.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct McpInfo {
    binary_path: Option<String>,
    /// Present when ppm.mcpb can be built (the manifest is installed).
    bundle_path: Option<String>,
}

/// Removes Windows' verbatim prefix (`\\?\C:\…`, `\\?\UNC\server\…`), which the resource
/// and cache dirs can carry. Such paths are shown to the user and pasted into AI client configs.
fn plain_path(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    p
}

fn mcp_resource(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let p = app
        .path()
        .resource_dir()
        .ok()?
        .join("resources")
        .join("mcp")
        .join(name);
    p.is_file().then(|| plain_path(p))
}

#[tauri::command]
fn mcp_info(app: AppHandle) -> McpInfo {
    let exe = if cfg!(windows) {
        "ppm-mcp.exe"
    } else {
        "ppm-mcp"
    };
    McpInfo {
        binary_path: mcp_resource(&app, exe).map(|p| p.to_string_lossy().into_owned()),
        bundle_path: mcp_resource(&app, "mcpb-manifest.json")
            .map(|p| p.to_string_lossy().into_owned()),
    }
}

/// Builds ppm.mcpb (zip with manifest.json and server/) from the installed binary.
fn build_mcpb(app: &AppHandle) -> R<PathBuf> {
    let exe = if cfg!(windows) {
        "ppm-mcp.exe"
    } else {
        "ppm-mcp"
    };
    let manifest = mcp_resource(app, "mcpb-manifest.json")
        .ok_or("mcpb-manifest.json følger ikke med denne installation.")?;
    let binary = mcp_resource(app, exe).ok_or("ppm-mcp følger ikke med denne installation.")?;
    let addon = mcp_resource(app, "better_sqlite3.node")
        .ok_or("better_sqlite3.node følger ikke med denne installation.")?;
    let dir = plain_path(app.path().app_cache_dir().map_err(|e| e.to_string())?);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join("ppm.mcpb");
    let file = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o755);
    for (name, src) in [
        ("manifest.json".to_string(), manifest),
        (format!("server/{exe}"), binary),
        ("server/better_sqlite3.node".to_string(), addon),
    ] {
        zip.start_file(name, opts).map_err(|e| e.to_string())?;
        let mut f = std::fs::File::open(&src).map_err(|e| e.to_string())?;
        std::io::copy(&mut f, &mut zip).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(dest)
}

/// "Lav ppm.mcpb til Claude Desktop": builds ppm.mcpb and shows it selected in the file
/// manager, so it can be dragged into Claude Desktop. Windows has no file association for
/// .mcpb unless Claude Desktop registers one, so the file is not opened directly.
#[tauri::command]
fn open_mcp_bundle(app: AppHandle) -> R<String> {
    let path = build_mcpb(&app)?;
    #[cfg(windows)]
    {
        let mut arg = std::ffi::OsString::from("/select,");
        arg.push(&path);
        std::process::Command::new("explorer.exe")
            .arg(arg)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg("-R")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(all(unix, not(target_os = "macos")))]
    if let Some(dir) = path.parent() {
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(path.to_string_lossy().into_owned())
}

fn mcp_binary(app: &AppHandle) -> R<PathBuf> {
    let exe = if cfg!(windows) {
        "ppm-mcp.exe"
    } else {
        "ppm-mcp"
    };
    mcp_resource(app, exe).ok_or_else(|| {
        "ppm-mcp følger ikke med denne installation (kun i den installerede app).".to_string()
    })
}

/// "Tilføj PPM til Claude Desktop": writes mcpServers.ppm into claude_desktop_config.json.
#[tauri::command]
fn claude_desktop_add(app: AppHandle) -> R<claude::ClaudeConfigResult> {
    claude::add_to_claude_desktop(&mcp_binary(&app)?)
}

/// "Test forbindelsen": starts ppm-mcp like an MCP client and does the handshake.
#[tauri::command]
async fn mcp_selftest(app: AppHandle) -> R<claude::SelfTest> {
    let bin = mcp_binary(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        claude::mcp_selftest(&bin, std::time::Duration::from_secs(20))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn app_info(app: AppHandle) -> R<AppInfo> {
    let one_drive_env = ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]
        .iter()
        .filter_map(|k| std::env::var(k).ok())
        .collect();
    Ok(AppInfo {
        pid: std::process::id(),
        hostname: gethostname::gethostname().to_string_lossy().into_owned(),
        app_version: app.package_info().version.to_string(),
        config_path: config_path(&app)?.to_string_lossy().into_owned(),
        one_drive_env,
    })
}

#[tauri::command]
fn config_read(app: AppHandle) -> R<Option<String>> {
    let p = config_path(&app)?;
    match std::fs::read_to_string(p) {
        Ok(s) => Ok(Some(s)),
        Err(_) => Ok(None),
    }
}

/// The UI may only store an archive path that the user picked in a native dialog;
/// it can never widen the scope by writing a path of its own (spec 01 "Filadgang").
fn validate_config(scope: &Scope, text: &str) -> R<()> {
    let v: Json = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if let Some(p) = v.get("archivePath").and_then(|x| x.as_str()) {
        if !scope.is_rw_root(std::path::Path::new(p)) {
            return Err("Arkivstien skal være valgt i en dialog".into());
        }
    }
    Ok(())
}

#[tauri::command]
fn config_write(app: AppHandle, scope: State<'_, Scope>, text: String) -> R<()> {
    validate_config(&scope, &text)?;
    let p = config_path(&app)?;
    std::fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(tmp, p).map_err(|e| e.to_string())
}

#[tauri::command]
fn process_alive(pid: u32) -> bool {
    use sysinfo::{Pid, ProcessesToUpdate, System};
    let mut sys = System::new();
    let pid = Pid::from_u32(pid);
    sys.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
    sys.process(pid).is_some()
}

// ---------- dialogs (the only way folders/files enter the scope) ----------

#[tauri::command]
async fn pick_directory(app: AppHandle, title: String) -> R<Option<String>> {
    let picked = app.dialog().file().set_title(title).blocking_pick_folder();
    let Some(p) = picked else { return Ok(None) };
    let p = p.into_path().map_err(|e| e.to_string())?;
    app.state::<Scope>().allow_dir(&p);
    Ok(Some(p.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn pick_files(
    app: AppHandle,
    title: String,
    filter_name: Option<String>,
    extensions: Option<Vec<String>>,
    multiple: bool,
) -> R<Vec<String>> {
    let mut d = app.dialog().file().set_title(title);
    if let (Some(n), Some(exts)) = (filter_name, extensions) {
        let refs: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
        d = d.add_filter(n, &refs);
    }
    let picked = if multiple {
        d.blocking_pick_files().unwrap_or_default()
    } else {
        d.blocking_pick_file().map(|f| vec![f]).unwrap_or_default()
    };
    let scope = app.state::<Scope>();
    let mut out = Vec::new();
    for f in picked {
        let p = f.into_path().map_err(|e| e.to_string())?;
        scope.allow_read_file(&p);
        out.push(p.to_string_lossy().into_owned());
    }
    Ok(out)
}

// ---------- files ----------

#[tauri::command]
fn fs_read(scope: State<'_, Scope>, path: String) -> R<Response> {
    files::read(&scope, &path).map(Response::new)
}

#[tauri::command]
fn fs_read_text(scope: State<'_, Scope>, path: String) -> R<String> {
    let bytes = files::read(&scope, &path)?;
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

/// Raw binary body; the target path is passed URL-encoded in the `x-path` header.
#[tauri::command]
fn fs_write(scope: State<'_, Scope>, request: Request<'_>) -> R<()> {
    let header = request
        .headers()
        .get("x-path")
        .ok_or("x-path mangler")?
        .to_str()
        .map_err(|e| e.to_string())?;
    let path = percent_decode_str(header)
        .decode_utf8()
        .map_err(|e| e.to_string())?;
    match request.body() {
        InvokeBody::Raw(data) => files::write(&scope, &path, data),
        InvokeBody::Json(_) => Err("Forventede binære data".into()),
    }
}

#[tauri::command]
fn fs_write_text(scope: State<'_, Scope>, path: String, text: String) -> R<()> {
    files::write(&scope, &path, text.as_bytes())
}

#[tauri::command]
fn fs_create_exclusive(scope: State<'_, Scope>, path: String, text: String) -> R<bool> {
    files::create_exclusive(&scope, &path, &text)
}

#[tauri::command]
fn fs_exists(scope: State<'_, Scope>, path: String) -> R<bool> {
    files::exists(&scope, &path)
}

#[tauri::command]
fn fs_stat(scope: State<'_, Scope>, path: String) -> R<Option<Stat>> {
    files::stat(&scope, &path)
}

#[tauri::command]
fn fs_mkdirp(scope: State<'_, Scope>, path: String) -> R<()> {
    files::mkdirp(&scope, &path)
}

#[tauri::command]
fn fs_list(scope: State<'_, Scope>, path: String) -> R<Vec<DirEntry>> {
    files::list_dir(&scope, &path)
}

#[tauri::command]
fn fs_rename(scope: State<'_, Scope>, from: String, to: String) -> R<()> {
    files::rename(&scope, &from, &to)
}

#[tauri::command]
fn fs_remove(scope: State<'_, Scope>, path: String, recursive: bool) -> R<()> {
    files::remove(&scope, &path, recursive)
}

#[tauri::command]
async fn fs_copy(app: AppHandle, from: String, to: String) -> R<()> {
    files::copy(&app.state::<Scope>(), &from, &to)
}

#[tauri::command]
async fn fs_sha256(app: AppHandle, path: String) -> R<String> {
    files::sha256(&app.state::<Scope>(), &path)
}

#[tauri::command]
async fn zip_create(app: AppHandle, entries: Vec<ZipEntry>, dest: String) -> R<()> {
    files::zip_create(&app.state::<Scope>(), &entries, &dest)
}

#[tauri::command]
async fn zip_extract(app: AppHandle, src: String, dest: String) -> R<Vec<String>> {
    files::zip_extract(&app.state::<Scope>(), &src, &dest)
}

// ---------- database ----------

#[tauri::command]
fn db_open(scope: State<'_, Scope>, dbs: State<'_, Dbs>, path: String, readonly: bool) -> R<u32> {
    dbs.open(&scope, &path, readonly)
}

#[tauri::command]
fn db_close(dbs: State<'_, Dbs>, handle: u32) -> R<()> {
    dbs.close(handle)
}

#[tauri::command]
async fn db_select(
    app: AppHandle,
    handle: u32,
    sql: String,
    params: Vec<Json>,
) -> R<Vec<Map<String, Json>>> {
    app.state::<Dbs>().select(handle, &sql, &params)
}

#[tauri::command]
async fn db_execute(app: AppHandle, handle: u32, sql: String, params: Vec<Json>) -> R<u64> {
    app.state::<Dbs>()
        .execute(&app.state::<Scope>(), handle, &sql, &params)
}

#[tauri::command]
async fn db_execute_script(app: AppHandle, handle: u32, sql: String) -> R<()> {
    app.state::<Dbs>().execute_script(handle, &sql)
}

/// The archive path from config.json (the archive the app has open).
fn open_archive_path(app: &AppHandle) -> R<String> {
    let text = std::fs::read_to_string(config_path(app)?)
        .map_err(|_| "Intet arkiv er åbent.".to_string())?;
    let v: Json = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    v.get("archivePath")
        .and_then(|x| x.as_str())
        .map(String::from)
        .ok_or_else(|| "Intet arkiv er åbent.".to_string())
}

/// Turns mobile access on: starts `ppm-mcp serve` for the open archive (local network only).
#[tauri::command]
async fn mobile_start(app: AppHandle, port: Option<u16>) -> R<Json> {
    let binary = mcp_binary(&app)?;
    let archive = open_archive_path(&app)?;
    let port = port.unwrap_or(4730);
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        handle
            .state::<mobile::MobileServer>()
            .start(&binary, &archive, port)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn mobile_stop(app: AppHandle) -> R<()> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || handle.state::<mobile::MobileServer>().stop())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn mobile_status(app: AppHandle) -> Option<Json> {
    app.state::<mobile::MobileServer>().status()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Scope::default())
        .manage(Dbs::default())
        .manage(mobile::MobileServer::default())
        .setup(|app| {
            // Re-admit the archive folder chosen in an earlier session.
            if let Ok(p) = config_path(app.handle()) {
                if let Ok(text) = std::fs::read_to_string(p) {
                    if let Ok(v) = serde_json::from_str::<Json>(&text) {
                        if let Some(path) = v.get("archivePath").and_then(|x| x.as_str()) {
                            app.state::<Scope>().allow_dir(std::path::Path::new(path));
                        }
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let scope = window.state::<Scope>();
                let mut files = Vec::new();
                for p in paths {
                    if p.is_file() {
                        scope.allow_read_file(p);
                        files.push(p.to_string_lossy().into_owned());
                    }
                }
                // Emitted only after the scope is updated, so the UI can read the files.
                let _ = window.emit("ppm://files-dropped", files);
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            mcp_info,
            open_mcp_bundle,
            claude_desktop_add,
            mcp_selftest,
            config_read,
            config_write,
            process_alive,
            pick_directory,
            pick_files,
            fs_read,
            fs_read_text,
            fs_write,
            fs_write_text,
            fs_create_exclusive,
            fs_exists,
            fs_stat,
            fs_mkdirp,
            fs_list,
            fs_rename,
            fs_remove,
            fs_copy,
            fs_sha256,
            zip_create,
            zip_extract,
            db_open,
            db_close,
            db_select,
            db_execute,
            db_execute_script,
            mobile_start,
            mobile_stop,
            mobile_status,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Close all connections (checkpoints the WAL) and release our archive lock.
                app.state::<mobile::MobileServer>().stop();
                app.state::<Dbs>().close_all();
                release_own_lock(app);
            }
        });
}

/// Removes `<archive>/.lock` if it was written by this process (spec 02).
fn release_own_lock(app: &AppHandle) {
    let Ok(cfg) = config_path(app) else { return };
    let Ok(text) = std::fs::read_to_string(cfg) else {
        return;
    };
    let Ok(v) = serde_json::from_str::<Json>(&text) else {
        return;
    };
    let Some(root) = v.get("archivePath").and_then(|x| x.as_str()) else {
        return;
    };
    let lock = std::path::Path::new(root).join(".lock");
    let Ok(lock_text) = std::fs::read_to_string(&lock) else {
        return;
    };
    let Ok(info) = serde_json::from_str::<Json>(&lock_text) else {
        return;
    };
    let host = gethostname::gethostname().to_string_lossy().into_owned();
    let same_pid = info.get("pid").and_then(|p| p.as_u64()) == Some(std::process::id() as u64);
    let same_host = info.get("hostname").and_then(|h| h.as_str()) == Some(host.as_str());
    if same_pid && same_host {
        let _ = std::fs::remove_file(lock);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_path_strips_the_verbatim_prefix() {
        assert_eq!(
            plain_path(PathBuf::from(
                r"\\?\C:\Users\a\AppData\Local\PPM\resources\mcp\ppm-mcp.exe"
            )),
            PathBuf::from(r"C:\Users\a\AppData\Local\PPM\resources\mcp\ppm-mcp.exe")
        );
        assert_eq!(
            plain_path(PathBuf::from(r"\\?\UNC\server\share\x")),
            PathBuf::from(r"\\server\share\x")
        );
        assert_eq!(
            plain_path(PathBuf::from("/usr/lib/PPM/resources/mcp/ppm-mcp")),
            PathBuf::from("/usr/lib/PPM/resources/mcp/ppm-mcp")
        );
    }

    #[cfg(unix)]
    #[test]
    fn ui_cannot_widen_scope_through_config() {
        let scope = Scope::default();
        scope.allow_dir(std::path::Path::new("/home/a/arkiv"));
        assert!(validate_config(&scope, r#"{"archivePath":"/home/a/arkiv"}"#).is_ok());
        assert!(validate_config(&scope, r#"{"archivePath":"/etc"}"#).is_err());
        assert!(validate_config(&scope, r#"{"archivePath":"/home/a/arkiv/../../etc"}"#).is_err());
        assert!(validate_config(&scope, r#"{"lastUserId":"x"}"#).is_ok());
        // A rejected config never adds anything to the scope.
        assert!(scope.check("/etc/passwd", scope::Access::Read).is_err());
    }
}
