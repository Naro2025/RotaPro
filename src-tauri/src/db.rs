//! SQLite (rusqlite, bundled) + migraciones idempotentes + seeds solo-once.
//! Fuente de verdad: docs/ARCHITECTURE.md §2.

use rusqlite::{params, Connection};
use std::path::Path;
use std::time::Duration;
use uuid::Uuid;

/// DDL del doc (idempotente: CREATE TABLE/INDEX IF NOT EXISTS).
const DDL: &str = r#"
CREATE TABLE IF NOT EXISTS work_formats (
  id         TEXT PRIMARY KEY,               -- UUID v7
  code       TEXT NOT NULL UNIQUE,           -- 'full_time'|'part_time'|'shift_work'|'on_call'
  name       TEXT NOT NULL,                  -- 'Full-time'|'Part-time'|'Por Turnos'|'Guardias/Disponibilidad'
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shift_templates (
  id             TEXT PRIMARY KEY,           -- UUID v7
  work_format_id TEXT NOT NULL REFERENCES work_formats(id) ON DELETE RESTRICT,
  code           TEXT NOT NULL UNIQUE,       -- 'morning'|'afternoon'|'night'|'guard_24h'
  name           TEXT NOT NULL,
  start_time     TEXT NOT NULL,              -- 'HH:MM' hora local
  end_time       TEXT NOT NULL,              -- 'HH:MM'
  color          TEXT NOT NULL,              -- '#RRGGBB'
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS assignments (
  id               TEXT PRIMARY KEY,         -- UUID v7 (interno)
  uid              TEXT NOT NULL UNIQUE,     -- UID estable sync iCal (default = id al crear)
  shift_template_id TEXT NOT NULL REFERENCES shift_templates(id) ON DELETE CASCADE,
  date             TEXT NOT NULL,            -- 'YYYY-MM-DD' hora local
  start_time       TEXT,                     -- override opcional 'HH:MM'
  end_time         TEXT,                     -- override opcional 'HH:MM'
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_assignments_date     ON assignments(date);
CREATE INDEX IF NOT EXISTS idx_assignments_template ON assignments(shift_template_id);
CREATE INDEX IF NOT EXISTS idx_shift_templates_fmt  ON shift_templates(work_format_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,                    -- 'theme'|'accent'|'density'|...
  value TEXT NOT NULL
);
"#;

/// Abre (creando el directorio si hace falta) la base en `app_data_dir/rotapro.db`,
/// aplica PRAGMAs, migraciones y seeds. Devuelve la conexión lista para usar.
pub fn open_db(app_data_dir: &Path) -> Result<Connection, String> {
    std::fs::create_dir_all(app_data_dir)
        .map_err(|e| format!("no se pudo crear el directorio de datos: {e}"))?;

    let db_path = app_data_dir.join("rotapro.db");
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("no se pudo abrir la base de datos: {e}"))?;

    // PRAGMAs del doc + busy_timeout (§5).
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("journal_mode: {e}"))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("foreign_keys: {e}"))?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| format!("busy_timeout: {e}"))?;

    migrate(&conn)?;
    seed(&conn)?;

    Ok(conn)
}

pub(crate) fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(DDL)
        .map_err(|e| format!("migración fallida: {e}"))?;
    migrate_shift_template_emoji(conn)
}

/// ¿Existe `column` en `table`? Introspección vía `PRAGMA table_info` (col 1 = nombre).
fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| format!("introspección {table}: {e}"))?;
    let cols = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|e| e.to_string())?;
    for col in cols {
        if col.map_err(|e| e.to_string())? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Migración aditiva idempotente (Fase 3.5): añade la columna `emoji` a
/// `shift_templates` solo si aún no existe. BDs previas (`rotapro.db`) la
/// reciben vía `ALTER TABLE` sin pérdida de datos; sin `user_version` y sin
/// tocar columnas existentes.
fn migrate_shift_template_emoji(conn: &Connection) -> Result<(), String> {
    if column_exists(conn, "shift_templates", "emoji")? {
        return Ok(());
    }
    conn.execute(
        "ALTER TABLE shift_templates ADD COLUMN emoji TEXT NOT NULL DEFAULT ''",
        [],
    )
    .map_err(|e| format!("migración emoji: {e}"))?;
    Ok(())
}

/// Seeds SOLO si las tablas están vacías: 4 work_formats + 4 shift_templates.
pub(crate) fn seed(conn: &Connection) -> Result<(), String> {
    seed_work_formats(conn)?;
    seed_shift_templates(conn)?;
    Ok(())
}

fn seed_work_formats(conn: &Connection) -> Result<(), String> {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM work_formats", [], |r| r.get(0))
        .map_err(|e| format!("seed work_formats count: {e}"))?;
    if count > 0 {
        return Ok(());
    }

    let formats = [
        ("full_time", "Full-time", 0),
        ("part_time", "Part-time", 1),
        ("shift_work", "Por Turnos", 2),
        ("on_call", "Guardias/Disponibilidad", 3),
    ];
    for (code, name, sort_order) in formats {
        conn.execute(
            "INSERT INTO work_formats (id, code, name, sort_order) VALUES (?1, ?2, ?3, ?4)",
            params![Uuid::now_v7().to_string(), code, name, sort_order],
        )
        .map_err(|e| format!("seed work_formats: {e}"))?;
    }
    Ok(())
}

fn seed_shift_templates(conn: &Connection) -> Result<(), String> {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM shift_templates", [], |r| r.get(0))
        .map_err(|e| format!("seed shift_templates count: {e}"))?;
    if count > 0 {
        return Ok(());
    }

    // (code, name, start_time, end_time, color, work_format.code, sort_order)
    let templates = [
        ("morning", "Mañana", "06:00", "14:00", "#F59E0B", "shift_work", 0),
        ("afternoon", "Tarde", "14:00", "22:00", "#0EA5E9", "shift_work", 1),
        ("night", "Noche", "22:00", "06:00", "#6D28D9", "shift_work", 2),
        ("guard_24h", "Guardia 24h", "00:00", "23:59", "#EF4444", "on_call", 3),
    ];
    for (code, name, start_time, end_time, color, fmt_code, sort_order) in templates {
        let work_format_id: String = conn
            .query_row(
                "SELECT id FROM work_formats WHERE code = ?1",
                params![fmt_code],
                |r| r.get(0),
            )
            .map_err(|e| format!("seed shift_templates fmt {fmt_code}: {e}"))?;
        conn.execute(
            "INSERT INTO shift_templates (id, work_format_id, code, name, start_time, end_time, color, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                Uuid::now_v7().to_string(),
                work_format_id,
                code,
                name,
                start_time,
                end_time,
                color,
                sort_order
            ],
        )
        .map_err(|e| format!("seed shift_templates: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("rotapro-db-test-{}", Uuid::now_v7()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn open_db_enables_required_pragmas() {
        let dir = temp_dir();
        let conn = open_db(&dir).unwrap();

        let journal: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(journal.to_ascii_lowercase(), "wal");

        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fk, 1);

        let busy: i64 = conn
            .query_row("PRAGMA busy_timeout", [], |r| r.get(0))
            .unwrap();
        assert_eq!(busy, 5000);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ddl_is_idempotent() {
        let dir = temp_dir();
        let conn = open_db(&dir).unwrap();

        // Aplicar la migración dos veces más no debe fallar ni duplicar tablas.
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();

        let tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table'
                   AND name IN ('work_formats','shift_templates','assignments','settings')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tables, 4);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn seeds_are_inserted_only_once() {
        let dir = temp_dir();
        let first = open_db(&dir).unwrap();
        drop(first);
        let conn = open_db(&dir).unwrap();

        let wf_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM work_formats", [], |r| r.get(0))
            .unwrap();
        assert_eq!(wf_count, 4);
        let st_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM shift_templates", [], |r| r.get(0))
            .unwrap();
        assert_eq!(st_count, 4);

        // UUIDs distintos entre sí (4 work_formats y 4 shift_templates).
        let mut wf_ids: Vec<String> = Vec::new();
        let mut stmt = conn
            .prepare("SELECT id FROM work_formats ORDER BY sort_order")
            .unwrap();
        for id in stmt.query_map([], |r| r.get::<_, String>(0)).unwrap() {
            wf_ids.push(id.unwrap());
        }
        assert_eq!(wf_ids.len(), 4);
        for i in 0..wf_ids.len() {
            for j in (i + 1)..wf_ids.len() {
                assert_ne!(wf_ids[i], wf_ids[j]);
            }
        }

        let mut st_ids: Vec<String> = Vec::new();
        let mut stmt = conn
            .prepare("SELECT id FROM shift_templates ORDER BY sort_order")
            .unwrap();
        for id in stmt.query_map([], |r| r.get::<_, String>(0)).unwrap() {
            st_ids.push(id.unwrap());
        }
        assert_eq!(st_ids.len(), 4);
        for i in 0..st_ids.len() {
            for j in (i + 1)..st_ids.len() {
                assert_ne!(st_ids[i], st_ids[j]);
            }
        }

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn emoji_migration_adds_column_to_legacy_schema() {
        // Base in-memory con SOLO el DDL base (esquema "viejo", sin `emoji`).
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(DDL).unwrap();
        assert!(!column_exists(&conn, "shift_templates", "emoji").unwrap());

        // `migrate` añade la columna con default ''.
        migrate(&conn).unwrap();
        assert!(column_exists(&conn, "shift_templates", "emoji").unwrap());

        // Idempotente: una segunda (y tercera) llamada no falla.
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();

        // Filas preexistentes reciben default '' sin pérdida de datos.
        conn.execute(
            "INSERT INTO work_formats (id, code, name, sort_order) VALUES ('wf1','shift_work','Por Turnos',0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO shift_templates (id, work_format_id, code, name, start_time, end_time, color, sort_order)
             VALUES ('t1','wf1','night','Noche','22:00','06:00','#6D28D9',2)",
            [],
        )
        .unwrap();
        let emoji: String = conn
            .query_row(
                "SELECT emoji FROM shift_templates WHERE id = 't1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(emoji, "");
    }
}
