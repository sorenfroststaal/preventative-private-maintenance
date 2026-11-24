//! File access scope. The webview may only touch:
//! - folders the user picked in a native dialog (read/write, recursively),
//! - files the user picked or dropped onto the window (read only),
//! - siblings of a picked folder named `<folder>.restore-*` / `<folder>.old-*` (restore swap),
//! - the app config file.
//!
//! Paths are normalised lexically; `..` can never escape a root.

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

#[derive(Default)]
pub struct Scope {
    inner: Mutex<ScopeInner>,
}

#[derive(Default)]
struct ScopeInner {
    rw_roots: Vec<PathBuf>,
    read_files: HashSet<PathBuf>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Access {
    Read,
    Write,
}

/// Lexically normalises a path: removes `.`, resolves `..` without touching the disk.
/// Returns None for relative paths or if `..` would climb above the root.
pub fn normalize(p: &Path) -> Option<PathBuf> {
    if !p.is_absolute() {
        return None;
    }
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::Prefix(_) | Component::RootDir => out.push(c.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    return None;
                }
            }
            Component::Normal(n) => out.push(n),
        }
    }
    Some(out)
}

fn eq_path(a: &Path, b: &Path) -> bool {
    if cfg!(windows) {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    } else {
        a == b
    }
}

fn starts_with(path: &Path, root: &Path) -> bool {
    if cfg!(windows) {
        let p = path.to_string_lossy().to_lowercase();
        let r = root.to_string_lossy().to_lowercase();
        let r = r.trim_end_matches('\\');
        p == r || p.starts_with(&format!("{r}\\"))
    } else {
        path.starts_with(root)
    }
}

impl Scope {
    pub fn allow_dir(&self, p: &Path) {
        if let Some(n) = normalize(p) {
            let mut g = self.inner.lock().unwrap();
            if !g.rw_roots.iter().any(|r| eq_path(r, &n)) {
                g.rw_roots.push(n);
            }
        }
    }

    pub fn allow_read_file(&self, p: &Path) {
        if let Some(n) = normalize(p) {
            self.inner.lock().unwrap().read_files.insert(n);
        }
    }

    pub fn is_rw_root(&self, p: &Path) -> bool {
        match normalize(p) {
            Some(n) => self
                .inner
                .lock()
                .unwrap()
                .rw_roots
                .iter()
                .any(|r| eq_path(r, &n)),
            None => false,
        }
    }

    /// Returns the normalised path if access is allowed.
    pub fn check(&self, p: &str, access: Access) -> Result<PathBuf, String> {
        let n = normalize(Path::new(p)).ok_or_else(|| format!("Ugyldig sti: {p}"))?;
        let g = self.inner.lock().unwrap();
        for root in &g.rw_roots {
            if starts_with(&n, root) {
                return Ok(n);
            }
            // Restore swap siblings: <root>.restore-<ts> and <root>.old-<ts>
            if let (Some(parent), Some(name)) = (root.parent(), root.file_name()) {
                let name = name.to_string_lossy();
                let restore = parent.join(format!("{name}.restore-"));
                let old = parent.join(format!("{name}.old-"));
                let ns = n.to_string_lossy();
                for prefix in [restore, old] {
                    let ps = prefix.to_string_lossy();
                    let matches = if cfg!(windows) {
                        ns.to_lowercase().starts_with(&ps.to_lowercase())
                    } else {
                        ns.starts_with(ps.as_ref())
                    };
                    if matches {
                        return Ok(n);
                    }
                }
            }
        }
        if access == Access::Read && g.read_files.iter().any(|f| eq_path(f, &n)) {
            return Ok(n);
        }
        Err(format!("Adgang nægtet: {p}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn scope_rules() {
        let s = Scope::default();
        s.allow_dir(Path::new("/home/a/arkiv"));
        s.allow_read_file(Path::new("/home/a/Downloads/kvittering.pdf"));
        assert!(s.check("/home/a/arkiv/bilag/x.pdf", Access::Write).is_ok());
        assert!(s.check("/home/a/arkiv", Access::Write).is_ok());
        assert!(s.check("/home/a/arkiv/../secret", Access::Read).is_err());
        assert!(s.check("/home/a/arkivX/file", Access::Read).is_err());
        assert!(s
            .check("/home/a/arkiv.restore-123/arkiv.sqlite", Access::Write)
            .is_ok());
        assert!(s.check("/home/a/arkiv.old-123", Access::Write).is_ok());
        assert!(s
            .check("/home/a/Downloads/kvittering.pdf", Access::Read)
            .is_ok());
        assert!(s
            .check("/home/a/Downloads/kvittering.pdf", Access::Write)
            .is_err());
        assert!(s
            .check("/home/a/Downloads/other.pdf", Access::Read)
            .is_err());
        assert!(s.check("relative/path", Access::Read).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn normalize_parent() {
        assert_eq!(
            normalize(Path::new("/a/b/../c")).unwrap(),
            PathBuf::from("/a/c")
        );
        assert_eq!(
            normalize(Path::new("/a/./b")).unwrap(),
            PathBuf::from("/a/b")
        );
    }
}
