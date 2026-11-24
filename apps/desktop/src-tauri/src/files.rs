//! Scoped file operations and zip handling.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Component, Path};
use std::time::UNIX_EPOCH;

use crate::scope::{Access, Scope};

#[derive(Serialize)]
pub struct Stat {
    pub size: u64,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    #[serde(rename = "mtimeMs")]
    pub mtime_ms: f64,
}

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
}

#[derive(Deserialize)]
pub struct ZipEntry {
    pub src: String,
    pub name: String,
}

fn e(err: io::Error) -> String {
    err.to_string()
}

pub fn read(scope: &Scope, p: &str) -> Result<Vec<u8>, String> {
    fs::read(scope.check(p, Access::Read)?).map_err(e)
}

pub fn write(scope: &Scope, p: &str, data: &[u8]) -> Result<(), String> {
    let path = scope.check(p, Access::Write)?;
    // Write-then-rename so readers never see a half-written file.
    let name = path
        .file_name()
        .ok_or("Ugyldig sti")?
        .to_string_lossy()
        .into_owned();
    let tmp = path.with_file_name(format!("{name}.tmp-{}", std::process::id()));
    {
        let mut f = File::create(&tmp).map_err(e)?;
        f.write_all(data).map_err(e)?;
        f.sync_all().map_err(e)?;
    }
    fs::rename(&tmp, &path).map_err(e)
}

pub fn create_exclusive(scope: &Scope, p: &str, text: &str) -> Result<bool, String> {
    let path = scope.check(p, Access::Write)?;
    match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut f) => {
            f.write_all(text.as_bytes()).map_err(e)?;
            Ok(true)
        }
        Err(err) if err.kind() == io::ErrorKind::AlreadyExists => Ok(false),
        Err(err) => Err(e(err)),
    }
}

pub fn exists(scope: &Scope, p: &str) -> Result<bool, String> {
    Ok(scope.check(p, Access::Read)?.exists())
}

pub fn stat(scope: &Scope, p: &str) -> Result<Option<Stat>, String> {
    let path = scope.check(p, Access::Read)?;
    match fs::metadata(&path) {
        Ok(m) => Ok(Some(Stat {
            size: m.len(),
            is_dir: m.is_dir(),
            mtime_ms: m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as f64)
                .unwrap_or(0.0),
        })),
        Err(_) => Ok(None),
    }
}

pub fn mkdirp(scope: &Scope, p: &str) -> Result<(), String> {
    fs::create_dir_all(scope.check(p, Access::Write)?).map_err(e)
}

pub fn list_dir(scope: &Scope, p: &str) -> Result<Vec<DirEntry>, String> {
    let path = scope.check(p, Access::Read)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(path).map_err(e)? {
        let entry = entry.map_err(e)?;
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir: entry.file_type().map(|t| t.is_dir()).unwrap_or(false),
        });
    }
    Ok(out)
}

pub fn rename(scope: &Scope, from: &str, to: &str) -> Result<(), String> {
    let a = scope.check(from, Access::Write)?;
    let b = scope.check(to, Access::Write)?;
    fs::rename(a, b).map_err(e)
}

pub fn remove(scope: &Scope, p: &str, recursive: bool) -> Result<(), String> {
    let path = scope.check(p, Access::Write)?;
    if recursive && scope.is_rw_root(&path) {
        return Err("En valgt rodmappe kan ikke slettes".into());
    }
    match fs::symlink_metadata(&path) {
        Err(_) => Ok(()),
        Ok(m) if m.is_dir() => {
            if recursive {
                fs::remove_dir_all(&path).map_err(e)
            } else {
                fs::remove_dir(&path).map_err(e)
            }
        }
        Ok(_) => fs::remove_file(&path).map_err(e),
    }
}

pub fn copy(scope: &Scope, from: &str, to: &str) -> Result<(), String> {
    let a = scope.check(from, Access::Read)?;
    let b = scope.check(to, Access::Write)?;
    let mut src = BufReader::new(File::open(a).map_err(e)?);
    let mut dst = BufWriter::new(File::create(&b).map_err(e)?);
    io::copy(&mut src, &mut dst).map_err(e)?;
    dst.into_inner()
        .map_err(|x| x.to_string())?
        .sync_all()
        .map_err(e)
}

pub fn sha256(scope: &Scope, p: &str) -> Result<String, String> {
    let path = scope.check(p, Access::Read)?;
    let mut f = BufReader::new(File::open(path).map_err(e)?);
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf).map_err(e)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

const STORED_EXT: [&str; 6] = ["jpg", "jpeg", "png", "heic", "pdf", "zip"];

pub fn zip_create(scope: &Scope, entries: &[ZipEntry], dest: &str) -> Result<(), String> {
    let dest = scope.check(dest, Access::Write)?;
    let file = File::create(&dest).map_err(e)?;
    let mut zip = zip::ZipWriter::new(BufWriter::new(file));
    for entry in entries {
        let src = scope.check(&entry.src, Access::Read)?;
        let ext = entry.name.rsplit('.').next().unwrap_or("").to_lowercase();
        let method = if STORED_EXT.contains(&ext.as_str()) {
            zip::CompressionMethod::Stored
        } else {
            zip::CompressionMethod::Deflated
        };
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(method)
            .large_file(true);
        zip.start_file(entry.name.as_str(), opts)
            .map_err(|x| x.to_string())?;
        let mut f = BufReader::new(File::open(src).map_err(e)?);
        io::copy(&mut f, &mut zip).map_err(e)?;
    }
    zip.finish()
        .map_err(|x| x.to_string())?
        .into_inner()
        .map_err(|x| x.to_string())?
        .sync_all()
        .map_err(e)
}

/// Rejects absolute names, `..`, drive prefixes and backslashes (zip slip).
fn safe_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.contains('\\') || name.contains('\0') {
        return Err(format!("Ugyldigt filnavn i zip: {name}"));
    }
    for c in Path::new(name).components() {
        match c {
            Component::Normal(_) => {}
            _ => return Err(format!("Ugyldigt filnavn i zip: {name}")),
        }
    }
    Ok(())
}

pub fn zip_extract(scope: &Scope, src: &str, dest_dir: &str) -> Result<Vec<String>, String> {
    let src = scope.check(src, Access::Read)?;
    let dest = scope.check(dest_dir, Access::Write)?;
    fs::create_dir_all(&dest).map_err(e)?;
    let mut archive = zip::ZipArchive::new(BufReader::new(File::open(src).map_err(e)?))
        .map_err(|x| x.to_string())?;
    let mut names = Vec::new();
    for i in 0..archive.len() {
        let mut f = archive.by_index(i).map_err(|x| x.to_string())?;
        let name = f.name().to_string();
        if name.ends_with('/') {
            continue;
        }
        safe_name(&name)?;
        let out = dest.join(&name);
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(e)?;
        }
        let mut w = BufWriter::new(File::create(&out).map_err(e)?);
        io::copy(&mut f, &mut w).map_err(e)?;
        names.push(name);
    }
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zip_roundtrip_and_slip() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("arkiv");
        fs::create_dir_all(root.join("bilag")).unwrap();
        let scope = Scope::default();
        scope.allow_dir(&root);
        let a = root.join("bilag/a.pdf");
        fs::write(&a, b"%PDF test").unwrap();
        let z = root.join("b.zip");
        zip_create(
            &scope,
            &[ZipEntry {
                src: a.to_string_lossy().into(),
                name: "bilag/a.pdf".into(),
            }],
            &z.to_string_lossy(),
        )
        .unwrap();
        let out = root.join("out");
        let names = zip_extract(&scope, &z.to_string_lossy(), &out.to_string_lossy()).unwrap();
        assert_eq!(names, vec!["bilag/a.pdf"]);
        assert_eq!(fs::read(out.join("bilag/a.pdf")).unwrap(), b"%PDF test");
        assert_eq!(sha256(&scope, &a.to_string_lossy()).unwrap().len(), 64);
        assert!(safe_name("../x").is_err());
        assert!(safe_name("/etc/passwd").is_err());
        assert!(safe_name("a\\b").is_err());
        assert!(safe_name("bilag/ab/x.pdf").is_ok());
    }

    #[test]
    fn root_cannot_be_removed() {
        let dir = tempfile::tempdir().unwrap();
        let scope = Scope::default();
        scope.allow_dir(dir.path());
        assert!(remove(&scope, &dir.path().to_string_lossy(), true).is_err());
    }
}
