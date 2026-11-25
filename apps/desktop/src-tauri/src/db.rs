//! SQLite access for the webview. One connection per handle; the TypeScript side
//! serialises calls (SerializedDb), so BEGIN/COMMIT across calls are safe.

use rusqlite::limits::Limit;
use rusqlite::types::{Value, ValueRef};
use rusqlite::{Connection, OpenFlags};
use serde_json::{Map, Number, Value as Json};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use crate::scope::{Access, Scope};

#[derive(Default)]
pub struct Dbs {
    next: AtomicU32,
    conns: Mutex<HashMap<u32, Connection>>,
}

fn to_sql(v: &Json) -> Value {
    match v {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(*b as i64),
        Json::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Integer(i)
            } else {
                Value::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        Json::String(s) => Value::Text(s.clone()),
        other => Value::Text(other.to_string()),
    }
}

fn to_json(v: ValueRef) -> Json {
    match v {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f).map(Json::Number).unwrap_or(Json::Null),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Json::Array(b.iter().map(|x| Json::Number((*x).into())).collect()),
    }
}

impl Dbs {
    pub fn open(&self, scope: &Scope, path: &str, readonly: bool) -> Result<u32, String> {
        let p = scope.check(
            path,
            if readonly {
                Access::Read
            } else {
                Access::Write
            },
        )?;
        let flags = if readonly {
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX
        } else {
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX
        };
        let conn = Connection::open_with_flags(&p, flags).map_err(|e| e.to_string())?;
        // The webview must not reach other database files.
        conn.set_limit(Limit::SQLITE_LIMIT_ATTACHED, 0);
        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        self.conns.lock().unwrap().insert(id, conn);
        Ok(id)
    }

    pub fn close(&self, id: u32) -> Result<(), String> {
        if let Some(c) = self.conns.lock().unwrap().remove(&id) {
            c.close().map_err(|(_, e)| e.to_string())?;
        }
        Ok(())
    }

    pub fn close_all(&self) {
        for (_, c) in self.conns.lock().unwrap().drain() {
            let _ = c.close();
        }
    }

    fn with<T>(
        &self,
        id: u32,
        f: impl FnOnce(&Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let g = self.conns.lock().unwrap();
        let c = g.get(&id).ok_or("Databasen er ikke åben")?;
        f(c)
    }

    pub fn select(
        &self,
        id: u32,
        sql: &str,
        params: &[Json],
    ) -> Result<Vec<Map<String, Json>>, String> {
        self.with(id, |c| {
            let mut stmt = c.prepare(sql).map_err(|e| e.to_string())?;
            let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
            let vals: Vec<Value> = params.iter().map(to_sql).collect();
            let mut rows = stmt
                .query(rusqlite::params_from_iter(vals.iter()))
                .map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            while let Some(r) = rows.next().map_err(|e| e.to_string())? {
                let mut m = Map::new();
                for (i, n) in names.iter().enumerate() {
                    m.insert(n.clone(), to_json(r.get_ref(i).map_err(|e| e.to_string())?));
                }
                out.push(m);
            }
            Ok(out)
        })
    }

    pub fn execute(
        &self,
        scope: &Scope,
        id: u32,
        sql: &str,
        params: &[Json],
    ) -> Result<u64, String> {
        if check_vacuum_into(scope, sql)? {
            // VACUUM INTO attaches the target internally, so allow exactly one
            // attachment for this single, path-checked statement.
            return self.with(id, |c| {
                c.set_limit(Limit::SQLITE_LIMIT_ATTACHED, 1);
                let r = c.execute_batch(sql).map_err(|e| e.to_string());
                c.set_limit(Limit::SQLITE_LIMIT_ATTACHED, 0);
                r.map(|_| 0)
            });
        }
        self.with(id, |c| {
            let mut stmt = c.prepare(sql).map_err(|e| e.to_string())?;
            let vals: Vec<Value> = params.iter().map(to_sql).collect();
            if stmt.column_count() > 0 {
                // e.g. PRAGMA busy_timeout = 5000 returns a row; drain it.
                let mut rows = stmt
                    .query(rusqlite::params_from_iter(vals.iter()))
                    .map_err(|e| e.to_string())?;
                while rows.next().map_err(|e| e.to_string())?.is_some() {}
                return Ok(0);
            }
            stmt.execute(rusqlite::params_from_iter(vals.iter()))
                .map(|n| n as u64)
                .map_err(|e| e.to_string())
        })
    }

    pub fn execute_script(&self, id: u32, sql: &str) -> Result<(), String> {
        if has_forbidden_keyword(sql) {
            return Err("VACUUM/ATTACH er ikke tilladt i scripts".into());
        }
        self.with(id, |c| c.execute_batch(sql).map_err(|e| e.to_string()))
    }
}

/// True if the SQL contains the keyword VACUUM or ATTACH as a token. String literals,
/// quoted identifiers and comments are skipped, so the schema's `'attach_document'`
/// (a value in a CHECK constraint) does not count.
fn has_forbidden_keyword(sql: &str) -> bool {
    let b = sql.as_bytes();
    let mut i = 0;
    let mut word = String::new();
    let check = |w: &mut String| {
        let hit = w.eq_ignore_ascii_case("VACUUM") || w.eq_ignore_ascii_case("ATTACH");
        w.clear();
        hit
    };
    while i < b.len() {
        let c = b[i];
        match c {
            b'\'' | b'"' | b'`' => {
                if check(&mut word) {
                    return true;
                }
                // Skip the quoted text; a doubled quote is an escaped quote.
                i += 1;
                while i < b.len() {
                    if b[i] == c {
                        if i + 1 < b.len() && b[i + 1] == c {
                            i += 2;
                            continue;
                        }
                        break;
                    }
                    i += 1;
                }
            }
            b'[' => {
                if check(&mut word) {
                    return true;
                }
                while i < b.len() && b[i] != b']' {
                    i += 1;
                }
            }
            b'-' if i + 1 < b.len() && b[i + 1] == b'-' => {
                if check(&mut word) {
                    return true;
                }
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
            }
            b'/' if i + 1 < b.len() && b[i + 1] == b'*' => {
                if check(&mut word) {
                    return true;
                }
                i += 2;
                while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                    i += 1;
                }
                i += 1;
            }
            _ if c.is_ascii_alphanumeric() || c == b'_' || c >= 0x80 => word.push(c as char),
            _ => {
                if check(&mut word) {
                    return true;
                }
            }
        }
        i += 1;
    }
    check(&mut word)
}

/// `VACUUM INTO '<path>'` writes a file; the target must be inside the scope.
/// Returns true if the statement is a (validated) VACUUM INTO.
fn check_vacuum_into(scope: &Scope, sql: &str) -> Result<bool, String> {
    let t = sql.trim_start();
    if !t.to_uppercase().starts_with("VACUUM") {
        return Ok(false);
    }
    let rest = t[6..].trim_start();
    if !rest.to_uppercase().starts_with("INTO") {
        return Ok(false); // plain VACUUM
    }
    let lit = rest[4..].trim();
    if !(lit.starts_with('\'') && lit.ends_with('\'') && lit.len() >= 2) {
        return Err("VACUUM INTO kræver en sti i anførselstegn".into());
    }
    let inner = &lit[1..lit.len() - 1];
    // Only a single quoted literal: no unescaped quote inside, nothing after it.
    if inner.replace("''", "").contains('\'') || inner.contains(';') {
        return Err("Ugyldig VACUUM INTO-sti".into());
    }
    let path = inner.replace("''", "'");
    scope.check(&path, Access::Write)?;
    if Path::new(&path).exists() {
        return Err("Målfilen findes allerede".into());
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forbidden_keywords_are_tokens_not_text() {
        // The normative migrations must pass (they contain 'attach_document' as a value).
        assert!(!has_forbidden_keyword(include_str!(
            "../../../../packages/core/migrations/0001_init.sql"
        )));
        assert!(!has_forbidden_keyword(include_str!(
            "../../../../packages/core/migrations/0002_meal_plan.sql"
        )));
        assert!(!has_forbidden_keyword(
            "CREATE TABLE t (a TEXT CHECK (a IN ('attach','vacuum'))); -- ATTACH\n/* VACUUM */"
        ));
        assert!(!has_forbidden_keyword(
            "CREATE TABLE \"attach\" (x); CREATE TABLE [vacuum] (y);"
        ));
        assert!(has_forbidden_keyword("ATTACH DATABASE 'x.db' AS x"));
        assert!(has_forbidden_keyword("create table a(x); attach 'x' as y;"));
        assert!(has_forbidden_keyword("SELECT 1;\nvacuum"));
        assert!(has_forbidden_keyword(
            "SELECT 'it''s'; VACUUM INTO '/tmp/x'"
        ));
        assert!(!has_forbidden_keyword(
            "CREATE TABLE attachment (id); SELECT vacuumed FROM x"
        ));
    }

    /// Creating an archive runs the migrations through execute_script (regression:
    /// 'attach_document' in schema.sql made archive creation fail in the app).
    #[test]
    fn migrations_run_through_execute_script() {
        let dir = tempfile::tempdir().unwrap();
        let scope = Scope::default();
        scope.allow_dir(dir.path());
        let dbs = Dbs::default();
        let id = dbs
            .open(
                &scope,
                dir.path().join("arkiv.sqlite").to_str().unwrap(),
                false,
            )
            .unwrap();
        dbs.execute_script(
            id,
            include_str!("../../../../packages/core/migrations/0001_init.sql"),
        )
        .unwrap();
        dbs.execute_script(
            id,
            include_str!("../../../../packages/core/migrations/0002_meal_plan.sql"),
        )
        .unwrap();
        assert!(dbs
            .execute_script(id, "ATTACH DATABASE ':memory:' AS x")
            .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn vacuum_into_only_inside_scope_and_attach_blocked() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("arkiv");
        std::fs::create_dir_all(&root).unwrap();
        let scope = Scope::default();
        scope.allow_dir(&root);
        let dbs = Dbs::default();
        let h = dbs
            .open(&scope, &root.join("a.sqlite").to_string_lossy(), false)
            .unwrap();
        dbs.execute(&scope, h, "CREATE TABLE t (x)", &[]).unwrap();
        let inside = root.join("snap.sqlite");
        dbs.execute(
            &scope,
            h,
            &format!("VACUUM INTO '{}'", inside.display()),
            &[],
        )
        .unwrap();
        assert!(inside.exists());
        let outside = dir.path().join("evil.sqlite");
        assert!(dbs
            .execute(
                &scope,
                h,
                &format!("VACUUM INTO '{}'", outside.display()),
                &[]
            )
            .is_err());
        assert!(dbs
            .execute(
                &scope,
                h,
                &format!("ATTACH DATABASE '{}' AS x", outside.display()),
                &[]
            )
            .is_err());
        assert!(dbs
            .execute(
                &scope,
                h,
                &format!(
                    "VACUUM INTO '{}'; ATTACH '{}' AS y",
                    root.join("s2").display(),
                    outside.display()
                ),
                &[]
            )
            .is_err());
        assert!(!outside.exists());
        // Limit is restored after VACUUM INTO.
        assert!(dbs
            .execute(
                &scope,
                h,
                &format!("ATTACH DATABASE '{}' AS z", root.join("z").display()),
                &[]
            )
            .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn transactions_across_calls_use_one_connection() {
        // Spec 01: BEGIN/COMMIT/ROLLBACK sent as separate calls (as SerializedDb does over IPC).
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("arkiv");
        std::fs::create_dir_all(&root).unwrap();
        let scope = Scope::default();
        scope.allow_dir(&root);
        let dbs = Dbs::default();
        let path = root.join("a.sqlite");
        let h = dbs.open(&scope, &path.to_string_lossy(), false).unwrap();
        dbs.execute(&scope, h, "CREATE TABLE t (x INTEGER)", &[])
            .unwrap();
        dbs.execute(&scope, h, "BEGIN IMMEDIATE", &[]).unwrap();
        dbs.execute(
            &scope,
            h,
            "INSERT INTO t VALUES (?)",
            &[serde_json::json!(1)],
        )
        .unwrap();
        dbs.execute(&scope, h, "ROLLBACK", &[]).unwrap();
        dbs.execute(&scope, h, "BEGIN IMMEDIATE", &[]).unwrap();
        dbs.execute(
            &scope,
            h,
            "INSERT INTO t VALUES (?)",
            &[serde_json::json!(2)],
        )
        .unwrap();
        // A second connection must not see uncommitted data.
        let h2 = dbs.open(&scope, &path.to_string_lossy(), true).unwrap();
        assert_eq!(
            dbs.select(h2, "SELECT count(*) AS n FROM t", &[]).unwrap()[0]["n"],
            0
        );
        dbs.execute(&scope, h, "COMMIT", &[]).unwrap();
        let rows = dbs.select(h, "SELECT x FROM t", &[]).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["x"], 2);
        assert_eq!(
            dbs.select(h2, "SELECT count(*) AS n FROM t", &[]).unwrap()[0]["n"],
            1
        );
    }

    #[cfg(unix)]
    #[test]
    fn fts5_and_parameter_types() {
        let dir = tempfile::tempdir().unwrap();
        let scope = Scope::default();
        scope.allow_dir(dir.path());
        let dbs = Dbs::default();
        let h = dbs
            .open(
                &scope,
                &dir.path().join("a.sqlite").to_string_lossy(),
                false,
            )
            .unwrap();
        dbs.execute_script(h, "CREATE VIRTUAL TABLE s USING fts5(title, body, tokenize = 'unicode61 remove_diacritics 0');").unwrap();
        dbs.execute(
            &scope,
            h,
            "INSERT INTO s VALUES (?, ?)",
            &[
                serde_json::json!("Køleskab"),
                serde_json::json!("Rens brønd"),
            ],
        )
        .unwrap();
        let hits = dbs
            .select(
                h,
                "SELECT title FROM s WHERE s MATCH ?",
                &[serde_json::json!("\"brønd\"*")],
            )
            .unwrap();
        assert_eq!(hits[0]["title"], "Køleskab");
        let v = dbs
            .select(
                h,
                "SELECT ? AS i, ? AS f, ? AS n, ? AS t",
                &[
                    serde_json::json!(5),
                    serde_json::json!(1.5),
                    serde_json::Value::Null,
                    serde_json::json!("æøå"),
                ],
            )
            .unwrap();
        assert_eq!(v[0]["i"], 5);
        assert_eq!(v[0]["f"], 1.5);
        assert!(v[0]["n"].is_null());
        assert_eq!(v[0]["t"], "æøå");
        // PRAGMAs that return a row work through execute (applyPragmas uses this).
        dbs.execute(&scope, h, "PRAGMA busy_timeout = 5000", &[])
            .unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn database_outside_scope_cannot_be_opened() {
        let dir = tempfile::tempdir().unwrap();
        let scope = Scope::default();
        scope.allow_dir(&dir.path().join("arkiv"));
        let dbs = Dbs::default();
        assert!(dbs
            .open(
                &scope,
                &dir.path().join("andet.sqlite").to_string_lossy(),
                false
            )
            .is_err());
        assert!(dbs.open(&scope, "/etc/passwd", true).is_err());
    }
}
