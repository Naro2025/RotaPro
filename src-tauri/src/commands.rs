//! Comandos IPC (los 15 de docs/ARCHITECTURE.md §4).
//! Todos retornan `Result<_, String>`. Acceden a la conexión vía `State<AppState>`.
//! La lógica real vive en funciones `*_impl(conn, ...)` para poder testearlas
//! sin necesidad de construir un `AppState`.

use crate::ics::{build_ics, epoch_to_dtstamp, IcsEvent};
use crate::models::{
    is_overnight, Assignment, AssignmentInput, CalendarData, CalendarRange, RangeAssignmentInput,
    Setting, ShiftTemplate, ShiftTemplateInput, WorkFormat,
};
use crate::AppState;
use rusqlite::{params, Connection, Row};
use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use uuid::Uuid;

// ---------- helpers de mapeo de filas ----------

fn row_to_template(row: &Row) -> rusqlite::Result<ShiftTemplate> {
    let start_time: String = row.get(4)?;
    let end_time: String = row.get(5)?;
    let overnight = is_overnight(&start_time, &end_time);
    Ok(ShiftTemplate {
        id: row.get(0)?,
        work_format_id: row.get(1)?,
        code: row.get(2)?,
        name: row.get(3)?,
        start_time,
        end_time,
        color: row.get(6)?,
        sort_order: row.get(7)?,
        emoji: row.get(8)?,
        is_overnight: overnight,
    })
}

fn row_to_assignment(row: &Row) -> rusqlite::Result<Assignment> {
    Ok(Assignment {
        id: row.get(0)?,
        uid: row.get(1)?,
        shift_template_id: row.get(2)?,
        date: row.get(3)?,
        start_time: row.get(4)?,
        end_time: row.get(5)?,
        notes: row.get(6)?,
    })
}

const TEMPLATE_COLS: &str =
    "id, work_format_id, code, name, start_time, end_time, color, sort_order, emoji";
const ASSIGNMENT_COLS: &str = "id, uid, shift_template_id, date, start_time, end_time, notes";

fn query_all_templates(conn: &Connection) -> Result<Vec<ShiftTemplate>, String> {
    let mut stmt = conn
        .prepare(&format!("SELECT {TEMPLATE_COLS} FROM shift_templates ORDER BY sort_order"))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_template)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn query_assignments_range(
    conn: &Connection,
    start: &str,
    end: &str,
) -> Result<Vec<Assignment>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {ASSIGNMENT_COLS} FROM assignments WHERE date BETWEEN ?1 AND ?2 ORDER BY date, id"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![start, end], row_to_assignment)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn calendar_data(conn: &Connection, start: &str, end: &str) -> Result<CalendarData, String> {
    Ok(CalendarData {
        assignments: query_assignments_range(conn, start, end)?,
        templates: query_all_templates(conn)?,
    })
}

// ---------- aritmética de fechas (sin dependencias extra) ----------

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: i64, m: u32) -> i64 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap(y) {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

// Howard Hinnant (public domain): días desde 1970-01-01.
pub(crate) fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

pub(crate) fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (y + if m <= 2 { 1 } else { 0 }, m, d)
}

pub(crate) fn format_date(y: i64, m: i64, d: i64) -> String {
    format!("{y:04}-{m:02}-{d:02}")
}

// Día de la semana (0=domingo..6=sábado), algoritmo de Sakamoto.
fn day_of_week(y: i64, m: i64, d: i64) -> i64 {
    let t = [0i64, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    let y = if m < 3 { y - 1 } else { y };
    (y + y / 4 - y / 100 + y / 400 + t[(m - 1) as usize] + d) % 7
}

/// Chequea el formato estricto `YYYY-MM-DD` (regex manual, sin deps extra).
/// Comparación lexicográfica sobre este formato es suficiente tras validarlo.
fn is_valid_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    bytes[0..4].iter().all(|b| b.is_ascii_digit())
        && bytes[5..7].iter().all(|b| b.is_ascii_digit())
        && bytes[8..10].iter().all(|b| b.is_ascii_digit())
}

/// Parsea `YYYY-MM-DD` (ya validado) a `(año, mes, día)`. Sin `.parse()` para
/// no depender de infallibilidad sobre strings ASCII verificados.
pub(crate) fn parse_date_parts(value: &str) -> (i64, i64, i64) {
    let b = value.as_bytes();
    let y = ((b[0] - b'0') as i64) * 1000
        + ((b[1] - b'0') as i64) * 100
        + ((b[2] - b'0') as i64) * 10
        + (b[3] - b'0') as i64;
    let m = ((b[5] - b'0') as i64) * 10 + (b[6] - b'0') as i64;
    let d = ((b[8] - b'0') as i64) * 10 + (b[9] - b'0') as i64;
    (y, m, d)
}

// ---------- lógica: work_formats ----------

fn list_work_formats_impl(conn: &Connection) -> Result<Vec<WorkFormat>, String> {
    let mut stmt = conn
        .prepare("SELECT id, code, name, sort_order FROM work_formats ORDER BY sort_order")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(WorkFormat {
                id: r.get(0)?,
                code: r.get(1)?,
                name: r.get(2)?,
                sort_order: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// ---------- lógica: shift_templates ----------

fn list_shift_templates_impl(conn: &Connection) -> Result<Vec<ShiftTemplate>, String> {
    query_all_templates(conn)
}

/// Chequea estrictamente "HH:MM" en formato 24h (regex manual, sin deps extra).
fn is_valid_hhmm(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 5 || bytes[2] != b':' {
        return false;
    }
    let (hh, mm) = (&bytes[0..2], &bytes[3..5]);
    if !hh.iter().all(|b| b.is_ascii_digit()) || !mm.iter().all(|b| b.is_ascii_digit()) {
        return false;
    }
    let hour = (hh[0] - b'0') * 10 + (hh[1] - b'0');
    let minute = (mm[0] - b'0') * 10 + (mm[1] - b'0');
    hour <= 23 && minute <= 59
}

/// Reglas comunes a create/update: nombre (trim no vacío, ≤40 chars) y horas
/// "HH:MM" válidas con inicio ≠ fin.
fn validate_shift_template(input: &ShiftTemplateInput) -> Result<(), String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("el nombre de la plantilla no puede estar vacío".to_string());
    }
    if name.chars().count() > 40 {
        return Err("el nombre de la plantilla no puede superar 40 caracteres".to_string());
    }
    if !is_valid_hhmm(&input.start_time) {
        return Err(format!(
            "hora de inicio inválida: '{}' (se espera HH:MM en formato 24h)",
            input.start_time
        ));
    }
    if !is_valid_hhmm(&input.end_time) {
        return Err(format!(
            "hora de fin inválida: '{}' (se espera HH:MM en formato 24h)",
            input.end_time
        ));
    }
    if input.start_time == input.end_time {
        return Err("la hora de inicio y la de fin no pueden ser iguales".to_string());
    }
    // Emoji: opcional; si viene, se trimea y no puede superar 16 bytes UTF-8
    // (cubre secuencias ZWJ como 🧑‍⚕️).
    if input.emoji.trim().len() > 16 {
        return Err("el emoji de la plantilla no puede superar 16 bytes UTF-8".to_string());
    }
    Ok(())
}

fn create_shift_template_impl(
    conn: &Connection,
    input: ShiftTemplateInput,
) -> Result<ShiftTemplate, String> {
    validate_shift_template(&input)?;
    // Turno personalizado: `code` omitido/blank → autogenerado con prefijo
    // 'custom-' para evitar colisiones UNIQUE y poder distinguirlo en el FE.
    let code = if input.code.trim().is_empty() {
        format!("custom-{}", Uuid::now_v7())
    } else {
        input.code.clone()
    };
    let emoji = input.emoji.trim().to_string();
    let id = Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO shift_templates (id, work_format_id, code, name, start_time, end_time, color, sort_order, emoji)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            input.work_format_id,
            code,
            input.name,
            input.start_time,
            input.end_time,
            input.color,
            input.sort_order,
            emoji
        ],
    )
    .map_err(|e| e.to_string())?;
    let overnight = is_overnight(&input.start_time, &input.end_time);
    Ok(ShiftTemplate {
        id,
        work_format_id: input.work_format_id,
        code,
        name: input.name,
        start_time: input.start_time,
        end_time: input.end_time,
        color: input.color,
        sort_order: input.sort_order,
        emoji,
        is_overnight: overnight,
    })
}

fn update_shift_template_impl(
    conn: &Connection,
    id: String,
    input: ShiftTemplateInput,
) -> Result<ShiftTemplate, String> {
    validate_shift_template(&input)?;
    let emoji = input.emoji.trim().to_string();
    let affected = conn
        .execute(
            "UPDATE shift_templates
             SET work_format_id = ?2, code = ?3, name = ?4, start_time = ?5, end_time = ?6,
                 color = ?7, sort_order = ?8, emoji = ?9,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = ?1",
            params![
                id,
                input.work_format_id,
                input.code,
                input.name,
                input.start_time,
                input.end_time,
                input.color,
                input.sort_order,
                emoji
            ],
        )
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err(format!("plantilla no encontrada: {id}"));
    }
    let overnight = is_overnight(&input.start_time, &input.end_time);
    Ok(ShiftTemplate {
        id,
        work_format_id: input.work_format_id,
        code: input.code,
        name: input.name,
        start_time: input.start_time,
        end_time: input.end_time,
        color: input.color,
        sort_order: input.sort_order,
        emoji,
        is_overnight: overnight,
    })
}

fn delete_shift_template_impl(conn: &Connection, id: String) -> Result<(), String> {
    conn.execute("DELETE FROM shift_templates WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- lógica: assignments ----------

fn list_assignments_impl(conn: &Connection, range: CalendarRange) -> Result<Vec<Assignment>, String> {
    query_assignments_range(conn, &range.start, &range.end)
}

fn create_assignment_impl(
    conn: &Connection,
    input: AssignmentInput,
) -> Result<Assignment, String> {
    // uid = id por defecto (adoptará el UID iCal remoto en el sync futuro).
    let id = Uuid::now_v7().to_string();
    let uid = id.clone();
    conn.execute(
        "INSERT INTO assignments (id, uid, shift_template_id, date, start_time, end_time, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            uid,
            input.shift_template_id,
            input.date,
            input.start_time,
            input.end_time,
            input.notes
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(Assignment {
        id,
        uid,
        shift_template_id: input.shift_template_id,
        date: input.date,
        start_time: input.start_time,
        end_time: input.end_time,
        notes: input.notes,
    })
}

/// Crea UNA fila `assignments` por día en el rango `[start_date, end_date]`
/// (inclusivo). Idempotente: los días que ya tengan un assignment del mismo
/// `shift_template_id` se omiten (no se duplican). Devuelve solo las creadas.
fn create_assignments_range_impl(
    conn: &Connection,
    input: &RangeAssignmentInput,
) -> Result<Vec<Assignment>, String> {
    let start = &input.start_date;
    let end = &input.end_date;

    if !is_valid_date(start) || !is_valid_date(end) {
        return Err("formato de fecha inválido: se espera 'YYYY-MM-DD'".to_string());
    }
    if end < start {
        return Err("end_date no puede ser anterior a start_date".to_string());
    }

    let (sy, sm, sd) = parse_date_parts(start);
    let (ey, em, ed) = parse_date_parts(end);
    let start_days = days_from_civil(sy, sm, sd);
    let end_days = days_from_civil(ey, em, ed);
    let total = end_days - start_days + 1;
    if total > 92 {
        return Err(format!(
            "rango demasiado amplio: {total} días (máximo 92)"
        ));
    }

    // Días ya asignados a esta plantilla dentro del rango (clave de idempotencia).
    let mut stmt = conn
        .prepare(
            "SELECT date FROM assignments
             WHERE shift_template_id = ?1 AND date BETWEEN ?2 AND ?3",
        )
        .map_err(|e| e.to_string())?;
    let existing: HashSet<String> = stmt
        .query_map(params![input.shift_template_id, start, end], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut created: Vec<Assignment> = Vec::new();
    for day in start_days..=end_days {
        let (y, m, d) = civil_from_days(day);
        let date = format_date(y, m, d);
        if existing.contains(&date) {
            continue;
        }
        let id = Uuid::now_v7().to_string();
        let uid = id.clone();
        tx.execute(
            "INSERT INTO assignments (id, uid, shift_template_id, date, start_time, end_time, notes)
             VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL)",
            params![id, uid, input.shift_template_id, date],
        )
        .map_err(|e| e.to_string())?;
        created.push(Assignment {
            id,
            uid,
            shift_template_id: input.shift_template_id.clone(),
            date,
            start_time: None,
            end_time: None,
            notes: None,
        });
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(created)
}

fn update_assignment_impl(
    conn: &Connection,
    id: String,
    input: AssignmentInput,
) -> Result<Assignment, String> {
    let affected = conn
        .execute(
            "UPDATE assignments
             SET shift_template_id = ?2, date = ?3, start_time = ?4, end_time = ?5, notes = ?6,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = ?1",
            params![
                id,
                input.shift_template_id,
                input.date,
                input.start_time,
                input.end_time,
                input.notes
            ],
        )
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err(format!("asignación no encontrada: {id}"));
    }
    let uid: String = conn
        .query_row("SELECT uid FROM assignments WHERE id = ?1", params![id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    Ok(Assignment {
        id,
        uid,
        shift_template_id: input.shift_template_id,
        date: input.date,
        start_time: input.start_time,
        end_time: input.end_time,
        notes: input.notes,
    })
}

fn delete_assignment_impl(conn: &Connection, id: String) -> Result<(), String> {
    conn.execute("DELETE FROM assignments WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- lógica: settings ----------

fn get_settings_impl(conn: &Connection) -> Result<Vec<Setting>, String> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings ORDER BY key")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Setting {
                key: r.get(0)?,
                value: r.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn set_setting_impl(conn: &Connection, key: String, value: String) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- lógica: vistas de calendario ----------

fn get_calendar_month_impl(
    conn: &Connection,
    year: i32,
    month: u32,
) -> Result<CalendarData, String> {
    if !(1..=12).contains(&month) {
        return Err(format!("mes fuera de rango: {month}"));
    }
    let last_day = days_in_month(year as i64, month);
    let start = format!("{year:04}-{month:02}-01");
    let end = format!("{year:04}-{month:02}-{last_day:02}");
    calendar_data(conn, &start, &end)
}

/// Semana ISO: lunes–domingo (semana 1 = la que contiene el 4 de enero).
fn get_calendar_week_impl(conn: &Connection, year: i32, week: u32) -> Result<CalendarData, String> {
    if week == 0 {
        return Err("semana fuera de rango: 0".to_string());
    }
    // Lunes de la semana ISO: retroceder desde el 4 de enero hasta el lunes.
    let jan4 = days_from_civil(year as i64, 1, 4);
    let jan4_dow = day_of_week(year as i64, 1, 4);
    let days_back = (jan4_dow + 6) % 7; // 0 si ya es lunes
    let monday = jan4 - days_back + (week as i64 - 1) * 7;
    let sunday = monday + 6;
    // El lunes visible puede albergar la continuación 00:00→fin de un overnight
    // iniciado el domingo de la semana anterior: ampliamos el inicio del rango
    // un día antes para que esa asignación esté en el estado. `daySegments`/
    // `visibleSegments` del FE ya descartan lo que no cae en la semana visible.
    let range_start = monday - 1;
    let (sy, sm, sd) = civil_from_days(range_start);
    let (ey, em, ed) = civil_from_days(sunday);
    let start = format_date(sy, sm, sd);
    let end = format_date(ey, em, ed);
    calendar_data(conn, &start, &end)
}

// ---------- lógica: exportación iCalendar ----------

/// Exporta TODOS los assignments a un archivo `.ics` (RFC 5545).
/// Hora efectiva = override si existe, si no la de la plantilla; summary =
/// `"{emoji} {name}".trim()` (o solo name si no hay emoji). Si no hay
/// assignments → `Err`. Añade la extensión `.ics` si el path no la lleva.
fn export_calendar_ics_impl(conn: &Connection, path: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!("SELECT {ASSIGNMENT_COLS} FROM assignments ORDER BY date, id"))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_assignment)
        .map_err(|e| e.to_string())?;
    let assignments: Vec<Assignment> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    if assignments.is_empty() {
        return Err("No hay turnos para exportar".to_string());
    }

    let templates: HashMap<String, ShiftTemplate> = query_all_templates(conn)?
        .into_iter()
        .map(|t| (t.id.clone(), t))
        .collect();

    let mut events: Vec<IcsEvent> = Vec::with_capacity(assignments.len());
    for a in &assignments {
        let template = templates
            .get(&a.shift_template_id)
            .ok_or_else(|| format!("plantilla no encontrada: {}", a.shift_template_id))?;
        let start = a
            .start_time
            .clone()
            .unwrap_or_else(|| template.start_time.clone());
        let end = a
            .end_time
            .clone()
            .unwrap_or_else(|| template.end_time.clone());
        // "{emoji} {name}".trim(): sin emoji queda solo el nombre.
        let summary = format!("{} {}", template.emoji, template.name)
            .trim()
            .to_string();
        events.push(IcsEvent {
            uid: a.uid.clone(),
            date: a.date.clone(),
            start,
            end,
            summary,
        });
    }

    let dtstamp = epoch_to_dtstamp(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs(),
    );

    let content = build_ics(&events, &dtstamp);
    let final_path = if path.ends_with(".ics") {
        path.to_string()
    } else {
        format!("{path}.ics")
    };
    std::fs::write(&final_path, content).map_err(|e| e.to_string())
}

// ---------- comandos IPC (wrappers finos) ----------

#[tauri::command]
pub fn list_work_formats(state: State<AppState>) -> Result<Vec<WorkFormat>, String> {
    let conn = state.conn.lock().map_err(|_| "lock envenenado".to_string())?;
    list_work_formats_impl(&conn)
}

#[tauri::command]
pub fn list_shift_templates(state: State<AppState>) -> Result<Vec<ShiftTemplate>, String> {
    let conn = state.conn.lock().map_err(|_| "lock envenenado".to_string())?;
    list_shift_templates_impl(&conn)
}

#[tauri::command]
pub fn create_shift_template(
    state: State<AppState>,
    input: ShiftTemplateInput,
) -> Result<ShiftTemplate, String> {
    let conn = state.conn.lock().map_err(|_| "lock envenenado".to_string())?;
    create_shift_template_impl(&conn, input)
}

#[tauri::command]
pub fn update_shift_template(
    state: State<AppState>,
    id: String,
    input: ShiftTemplateInput,
) -> Result<ShiftTemplate, String> {
    let conn = state.conn.lock().map_err(|_| "lock envenenado".to_string())?;
    update_shift_template_impl(&conn, id, input)
}

#[tauri::command]
pub fn delete_shift_template(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|_| "lock envenenado".to_string())?;
    delete_shift_template_impl(&conn, id)
}

#[tauri::command]
pub fn list_assignments(
    state: State<AppState>,
    range: CalendarRange,
) -> Result<Vec<Assignment>, String> {
    let conn = state.conn.lock().map_err(|_| "lock envenenado".to_string())?;
    list_assignments_impl(&conn, range)
}

#[tauri::command]
pub fn create_assignment(
    state: State<AppState>,
    input: AssignmentInput,
) -> Result<Assignment, String> {
    let conn = state.conn.lock().map_err(|_| "lock envenenado".to_string())?;
    create_assignment_impl(&conn, input)
}

#[tauri::command]
pub fn create_assignments_range(
    state: State<AppState>,
    input: RangeAssignmentInput,
) -> Result<Vec<Assignment>, String> {
    let conn = state.conn.lock().map_err(|_| "lock envenenado".to_string())?;
    create_assignments_range_impl(&conn, &input)
}

#[tauri::command]
pub fn update_assignment(
    state: State<AppState>,
    id: String,
    input: AssignmentInput,
) -> Result<Assignment, String> {
    let conn = state.conn.lock().map_err(|_| "lock envenenado".to_string())?;
    update_assignment_impl(&conn, id, input)
}

#[tauri::command]
pub fn delete_assignment(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|_| "lock envenenado".to_string())?;
    delete_assignment_impl(&conn, id)
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<Vec<Setting>, String> {
    let conn = state.conn.lock().map_err(|_| "lock envenenado".to_string())?;
    get_settings_impl(&conn)
}

#[tauri::command]
pub fn set_setting(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|_| "lock envenenado".to_string())?;
    set_setting_impl(&conn, key, value)
}

#[tauri::command]
pub fn get_calendar_month(
    state: State<AppState>,
    year: i32,
    month: u32,
) -> Result<CalendarData, String> {
    let conn = state.conn.lock().map_err(|_| "lock envenenado".to_string())?;
    get_calendar_month_impl(&conn, year, month)
}

#[tauri::command]
pub fn get_calendar_week(
    state: State<AppState>,
    year: i32,
    week: u32,
) -> Result<CalendarData, String> {
    let conn = state.conn.lock().map_err(|_| "lock envenenado".to_string())?;
    get_calendar_week_impl(&conn, year, week)
}

#[tauri::command]
pub fn export_calendar_ics(state: State<AppState>, path: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|_| "lock envenenado".to_string())?;
    export_calendar_ics_impl(&conn, &path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        db::migrate(&conn).unwrap();
        db::seed(&conn).unwrap();
        conn
    }

    fn template_id(conn: &Connection, code: &str) -> String {
        conn.query_row(
            "SELECT id FROM shift_templates WHERE code = ?1",
            params![code],
            |r| r.get(0),
        )
        .unwrap()
    }

    fn work_format_id(conn: &Connection, code: &str) -> String {
        conn.query_row(
            "SELECT id FROM work_formats WHERE code = ?1",
            params![code],
            |r| r.get(0),
        )
        .unwrap()
    }

    /// Payload válido por defecto (turno 12h 08:00→20:00); los tests pisan
    /// campos concretos con la sintaxis de actualización de struct.
    fn template_input(work_format_id: &str) -> ShiftTemplateInput {
        ShiftTemplateInput {
            work_format_id: work_format_id.to_string(),
            code: String::new(),
            name: "Turno 12h".to_string(),
            start_time: "08:00".to_string(),
            end_time: "20:00".to_string(),
            color: "#F59E0B".to_string(),
            emoji: String::new(),
            sort_order: 100,
        }
    }

    fn create(conn: &Connection, template_id: &str, date: &str) -> Assignment {
        create_assignment_impl(
            conn,
            AssignmentInput {
                shift_template_id: template_id.to_string(),
                date: date.to_string(),
                start_time: None,
                end_time: None,
                notes: None,
            },
        )
        .unwrap()
    }

    fn sorted_dates(data: &CalendarData) -> Vec<String> {
        let mut dates: Vec<String> = data.assignments.iter().map(|a| a.date.clone()).collect();
        dates.sort();
        dates
    }

    #[test]
    fn create_assignment_sets_uid_equal_to_id() {
        let conn = test_conn();
        let tid = template_id(&conn, "morning");
        let a = create(&conn, &tid, "2026-01-05");
        assert!(!a.id.is_empty());
        assert_eq!(a.uid, a.id);

        let uid: String = conn
            .query_row(
                "SELECT uid FROM assignments WHERE id = ?1",
                params![a.id.clone()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(uid, a.id);
    }

    #[test]
    fn create_assignment_survives_reconnect() {
        let path = std::env::temp_dir().join(format!(
            "rotapro_restart_test_{}.db",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path); // limpia restos de una ejecución previa

        let conn = Connection::open(&path).unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        db::migrate(&conn).unwrap();
        db::seed(&conn).unwrap();
        let tid = template_id(&conn, "morning");
        create_assignment_impl(
            &conn,
            AssignmentInput {
                shift_template_id: tid.clone(),
                date: "2026-11-05".to_string(),
                start_time: None,
                end_time: None,
                notes: None,
            },
        )
        .unwrap();
        drop(conn); // cierra: la fila debe persistir en disco

        let conn = Connection::open(&path).unwrap();
        let rows = list_assignments_impl(
            &conn,
            CalendarRange {
                start: "2026-11-01".to_string(),
                end: "2026-11-30".to_string(),
            },
        )
        .unwrap();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].shift_template_id, tid);
        assert_eq!(rows[0].date, "2026-11-05");
        assert!(!rows[0].uid.is_empty());

        drop(conn);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn delete_shift_template_cascades_to_assignments() {
        let conn = test_conn();
        let tid = template_id(&conn, "morning");
        create(&conn, &tid, "2026-01-05");
        create(&conn, &tid, "2026-01-06");

        delete_shift_template_impl(&conn, tid.clone()).unwrap();

        let remaining: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM assignments WHERE shift_template_id = ?1",
                params![tid.clone()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 0);

        let template_remaining: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM shift_templates WHERE id = ?1",
                params![tid],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(template_remaining, 0);
    }

    #[test]
    fn deleting_referenced_work_format_is_restricted() {
        let conn = test_conn();
        // 'shift_work' tiene plantillas seedeadas que lo referencian (ON DELETE RESTRICT).
        let res = conn.execute("DELETE FROM work_formats WHERE code = 'shift_work'", []);
        assert!(res.is_err());

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM work_formats WHERE code = 'shift_work'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn list_assignments_honors_inclusive_date_range() {
        let conn = test_conn();
        let tid = template_id(&conn, "morning");
        create(&conn, &tid, "2026-03-10");
        create(&conn, &tid, "2026-03-11");
        create(&conn, &tid, "2026-03-12");

        // Borde: misma fecha inicio/fin.
        let same_day = list_assignments_impl(
            &conn,
            CalendarRange {
                start: "2026-03-11".into(),
                end: "2026-03-11".into(),
            },
        )
        .unwrap();
        let dates: Vec<String> = same_day.iter().map(|a| a.date.clone()).collect();
        assert_eq!(dates, vec!["2026-03-11".to_string()]);

        let full = list_assignments_impl(
            &conn,
            CalendarRange {
                start: "2026-03-10".into(),
                end: "2026-03-12".into(),
            },
        )
        .unwrap();
        let mut dates: Vec<String> = full.iter().map(|a| a.date.clone()).collect();
        dates.sort();
        assert_eq!(
            dates,
            vec!["2026-03-10", "2026-03-11", "2026-03-12"]
        );
    }

    fn range_input(tid: &str, start: &str, end: &str) -> RangeAssignmentInput {
        RangeAssignmentInput {
            shift_template_id: tid.to_string(),
            start_date: start.to_string(),
            end_date: end.to_string(),
        }
    }

    #[test]
    fn create_assignments_range_creates_one_row_per_day_with_unique_uids() {
        let conn = test_conn();
        let tid = template_id(&conn, "morning");
        let created = create_assignments_range_impl(&conn, &range_input(&tid, "2026-11-01", "2026-11-07"))
            .unwrap();
        assert_eq!(created.len(), 7);

        let mut dates: Vec<String> = created.iter().map(|a| a.date.clone()).collect();
        dates.sort();
        assert_eq!(
            dates,
            vec![
                "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05",
                "2026-11-06", "2026-11-07",
            ]
        );

        // Cada fila: uid == id y únicos entre sí.
        let mut uids: Vec<&str> = created.iter().map(|a| a.uid.as_str()).collect();
        uids.sort();
        uids.dedup();
        assert_eq!(uids.len(), 7);
        for a in &created {
            assert_eq!(a.uid, a.id);
            assert!(a.start_time.is_none());
            assert!(a.end_time.is_none());
            assert!(a.notes.is_none());
        }
    }

    #[test]
    fn create_assignments_range_is_idempotent() {
        let conn = test_conn();
        let tid = template_id(&conn, "morning");
        // Primer rango 1..7.
        let first = create_assignments_range_impl(&conn, &range_input(&tid, "2026-11-01", "2026-11-07"))
            .unwrap();
        assert_eq!(first.len(), 7);

        // Segunda llamada idéntica → 0 filas nuevas.
        let second = create_assignments_range_impl(&conn, &range_input(&tid, "2026-11-01", "2026-11-07"))
            .unwrap();
        assert!(second.is_empty());

        // Solape parcial (5..10): solo 8, 9 y 10 son nuevos.
        let overlap = create_assignments_range_impl(&conn, &range_input(&tid, "2026-11-05", "2026-11-10"))
            .unwrap();
        let mut dates: Vec<String> = overlap.iter().map(|a| a.date.clone()).collect();
        dates.sort();
        assert_eq!(dates, vec!["2026-11-08", "2026-11-09", "2026-11-10"]);

        let total: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM assignments WHERE shift_template_id = ?1",
                params![tid],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(total, 10);
    }

    #[test]
    fn create_assignments_range_rejects_end_before_start() {
        let conn = test_conn();
        let tid = template_id(&conn, "morning");
        let res = create_assignments_range_impl(&conn, &range_input(&tid, "2026-11-07", "2026-11-01"));
        assert!(res.is_err());
    }

    #[test]
    fn create_assignments_range_rejects_malformed_dates() {
        let conn = test_conn();
        let tid = template_id(&conn, "morning");
        for bad in ["2026-1-01", "2026-11-1", "2026/11/01", "20261101", "2026-11-01x"] {
            let res = create_assignments_range_impl(&conn, &range_input(&tid, bad, "2026-11-07"));
            assert!(res.is_err(), "start '{bad}' debería ser rechazada");
            let res = create_assignments_range_impl(&conn, &range_input(&tid, "2026-11-01", bad));
            assert!(res.is_err(), "end '{bad}' debería ser rechazada");
        }
    }

    #[test]
    fn create_assignments_range_rejects_ranges_over_92_days() {
        let conn = test_conn();
        let tid = template_id(&conn, "morning");
        // 2026-01-01 .. 2026-04-03 = 93 días.
        let res = create_assignments_range_impl(&conn, &range_input(&tid, "2026-01-01", "2026-04-03"));
        assert!(res.is_err());

        // Borde: 92 días exactos son válidos (2026-01-01 .. 2026-04-02).
        let ok = create_assignments_range_impl(&conn, &range_input(&tid, "2026-01-01", "2026-04-02"))
            .unwrap();
        assert_eq!(ok.len(), 92);
    }

    #[test]
    fn get_calendar_month_returns_month_range() {
        let conn = test_conn();
        let tid = template_id(&conn, "morning");
        create(&conn, &tid, "2026-01-01");
        create(&conn, &tid, "2026-01-31");
        create(&conn, &tid, "2026-02-01"); // fuera

        let data = get_calendar_month_impl(&conn, 2026, 1).unwrap();
        assert_eq!(sorted_dates(&data), vec!["2026-01-01", "2026-01-31"]);
    }

    #[test]
    fn get_calendar_week_crosses_year_boundary() {
        let conn = test_conn();
        let tid = template_id(&conn, "morning");
        // Semana ISO 1 de 2026 = lunes 2025-12-29 .. domingo 2026-01-04.
        // El rango incluye el domingo anterior (2025-12-28) para permitir al FE
        // dibujar la continuación 00:00→fin de un overnight de esa fecha en la
        // columna del lunes.
        create(&conn, &tid, "2025-12-28"); // domingo anterior (incluido)
        create(&conn, &tid, "2025-12-29"); // lunes (dentro)
        create(&conn, &tid, "2026-01-04"); // domingo (dentro)
        create(&conn, &tid, "2026-01-05"); // lunes siguiente (fuera)

        let data = get_calendar_week_impl(&conn, 2026, 1).unwrap();
        assert_eq!(
            sorted_dates(&data),
            vec!["2025-12-28", "2025-12-29", "2026-01-04"]
        );
    }

    #[test]
    fn list_shift_templates_reports_is_overnight() {
        let conn = test_conn();
        let templates = list_shift_templates_impl(&conn).unwrap();

        let night = templates.iter().find(|t| t.code == "night").unwrap();
        assert!(night.is_overnight);

        let morning = templates.iter().find(|t| t.code == "morning").unwrap();
        assert!(!morning.is_overnight);

        // Guardia 24h (00:00–23:59): end > start → no cruza medianoche.
        let guard = templates.iter().find(|t| t.code == "guard_24h").unwrap();
        assert!(!guard.is_overnight);
    }

    #[test]
    fn list_work_formats_sorted_by_sort_order() {
        let conn = test_conn();
        let formats = list_work_formats_impl(&conn).unwrap();
        let codes: Vec<&str> = formats.iter().map(|f| f.code.as_str()).collect();
        assert_eq!(
            codes,
            vec!["full_time", "part_time", "shift_work", "on_call"]
        );
        let orders: Vec<i64> = formats.iter().map(|f| f.sort_order).collect();
        assert_eq!(orders, vec![0, 1, 2, 3]);
    }

    #[test]
    fn settings_roundtrip() {
        let conn = test_conn();
        set_setting_impl(&conn, "theme".into(), "dark".into()).unwrap();
        set_setting_impl(&conn, "accent".into(), "blue".into()).unwrap();
        set_setting_impl(&conn, "theme".into(), "light".into()).unwrap(); // upsert

        let settings = get_settings_impl(&conn).unwrap();
        let pairs: Vec<(String, String)> = settings
            .iter()
            .map(|s| (s.key.clone(), s.value.clone()))
            .collect();
        assert_eq!(
            pairs,
            vec![
                ("accent".to_string(), "blue".to_string()),
                ("theme".to_string(), "light".to_string()),
            ]
        );
    }

    #[test]
    fn create_shift_template_rejects_invalid_times() {
        let conn = test_conn();
        let fmt = work_format_id(&conn, "shift_work");
        for bad in ["25:00", "8:00", "08:60"] {
            let input = ShiftTemplateInput {
                start_time: bad.to_string(),
                ..template_input(&fmt)
            };
            assert!(
                create_shift_template_impl(&conn, input).is_err(),
                "start_time '{bad}' debería ser rechazado"
            );
        }
        // end_time inválida también.
        let input = ShiftTemplateInput {
            end_time: "24:00".to_string(),
            ..template_input(&fmt)
        };
        assert!(create_shift_template_impl(&conn, input).is_err());
    }

    #[test]
    fn create_shift_template_rejects_start_equal_end() {
        let conn = test_conn();
        let fmt = work_format_id(&conn, "shift_work");
        let input = ShiftTemplateInput {
            end_time: "08:00".to_string(),
            ..template_input(&fmt)
        };
        assert!(create_shift_template_impl(&conn, input).is_err());
    }

    #[test]
    fn create_shift_template_rejects_empty_name() {
        let conn = test_conn();
        let fmt = work_format_id(&conn, "shift_work");
        let input = ShiftTemplateInput {
            name: "   ".to_string(),
            ..template_input(&fmt)
        };
        assert!(create_shift_template_impl(&conn, input).is_err());
    }

    #[test]
    fn create_shift_template_without_code_autogenerates_unique() {
        let conn = test_conn();
        let fmt = work_format_id(&conn, "shift_work");

        let t1 = create_shift_template_impl(&conn, template_input(&fmt)).unwrap();
        assert!(t1.code.starts_with("custom-"));
        assert!(!t1.code.is_empty());

        // Un segundo create sin `code` no debe colisionar con el UNIQUE.
        let t2 = create_shift_template_impl(&conn, template_input(&fmt)).unwrap();
        assert!(t2.code.starts_with("custom-"));
        assert_ne!(t1.code, t2.code);
    }

    #[test]
    fn update_shift_template_applies_same_validation() {
        let conn = test_conn();
        let fmt = work_format_id(&conn, "shift_work");
        let created = create_shift_template_impl(&conn, template_input(&fmt)).unwrap();

        // Hora inválida → Err y la fila permanece intacta.
        let bad_time = ShiftTemplateInput {
            start_time: "25:00".to_string(),
            ..template_input(&fmt)
        };
        assert!(update_shift_template_impl(&conn, created.id.clone(), bad_time).is_err());

        // Nombre vacío → Err.
        let bad_name = ShiftTemplateInput {
            name: "  ".to_string(),
            ..template_input(&fmt)
        };
        assert!(update_shift_template_impl(&conn, created.id.clone(), bad_name).is_err());

        // start == end → Err.
        let equal = ShiftTemplateInput {
            end_time: "08:00".to_string(),
            ..template_input(&fmt)
        };
        assert!(update_shift_template_impl(&conn, created.id.clone(), equal).is_err());

        // Payload válido → actualiza.
        let updated = update_shift_template_impl(&conn, created.id.clone(), template_input(&fmt))
            .unwrap();
        assert_eq!(updated.name, "Turno 12h");
        assert_eq!(updated.start_time, "08:00");
        assert_eq!(updated.end_time, "20:00");
    }

    #[test]
    fn create_shift_template_roundtrips_emoji() {
        let conn = test_conn();
        let fmt = work_format_id(&conn, "shift_work");

        // Con emoji → list lo devuelve intacto.
        let with_emoji = create_shift_template_impl(
            &conn,
            ShiftTemplateInput {
                emoji: "🌙".to_string(),
                ..template_input(&fmt)
            },
        )
        .unwrap();
        assert_eq!(with_emoji.emoji, "🌙");

        let listed = list_shift_templates_impl(&conn).unwrap();
        let found = listed.iter().find(|t| t.id == with_emoji.id).unwrap();
        assert_eq!(found.emoji, "🌙");

        // Sin emoji (campo vacío por defecto) → "".
        let without = create_shift_template_impl(&conn, template_input(&fmt)).unwrap();
        assert_eq!(without.emoji, "");
    }

    #[test]
    fn create_shift_template_rejects_emoji_over_16_bytes_and_trims() {
        let conn = test_conn();
        let fmt = work_format_id(&conn, "shift_work");

        // 17 bytes UTF-8 (4×🌙 de 4 bytes + 1 byte ASCII) → rechazado.
        let too_long = ShiftTemplateInput {
            emoji: "🌙🌙🌙🌙x".to_string(),
            ..template_input(&fmt)
        };
        assert!(create_shift_template_impl(&conn, too_long).is_err());

        // Trim aplicado: "  🌙  " se acepta y persiste como "🌙".
        let padded = ShiftTemplateInput {
            emoji: "  🌙  ".to_string(),
            ..template_input(&fmt)
        };
        let created = create_shift_template_impl(&conn, padded).unwrap();
        assert_eq!(created.emoji, "🌙");
    }

    #[test]
    fn export_calendar_ics_writes_events_with_overnight_and_overrides() {
        let conn = test_conn();
        let morning = template_id(&conn, "morning");
        let night = template_id(&conn, "night");

        // Mañana (normal 06:00→14:00) el 2026-12-31.
        create(&conn, &morning, "2026-12-31");
        // Noche (overnight 22:00→06:00) el 2026-12-31.
        create(&conn, &night, "2026-12-31");
        // Override de horas sobre 'morning' el 2026-12-30.
        create_assignment_impl(
            &conn,
            AssignmentInput {
                shift_template_id: morning.clone(),
                date: "2026-12-30".to_string(),
                start_time: Some("08:00".to_string()),
                end_time: Some("16:00".to_string()),
                notes: None,
            },
        )
        .unwrap();

        let path = std::env::temp_dir().join(format!(
            "rotapro_export_test_{}.ics",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);

        export_calendar_ics_impl(&conn, path.to_str().unwrap()).unwrap();

        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.starts_with("BEGIN:VCALENDAR\r\n"));
        assert!(content.ends_with("END:VCALENDAR\r\n"));
        // CRLF en todas las líneas (sin LF sueltos).
        assert!(!content.replace("\r\n", "").contains('\n'));
        // Tres VEVENT, cada uno con su UID.
        assert_eq!(content.matches("BEGIN:VEVENT").count(), 3);
        assert_eq!(content.matches("UID:").count(), 3);

        // Overrides 2026-12-30 (primero por date, id).
        assert!(content.contains("DTSTART:20261230T080000\r\n"));
        assert!(content.contains("DTEND:20261230T160000\r\n"));
        // Mañana normal.
        assert!(content.contains("DTSTART:20261231T060000\r\n"));
        assert!(content.contains("DTEND:20261231T140000\r\n"));
        // Noche overnight → DTEND al día siguiente (cruce de año).
        assert!(content.contains("DTSTART:20261231T220000\r\n"));
        assert!(content.contains("DTEND:20270101T060000\r\n"));

        // Orden por date: el 2026-12-30 precede al 2026-12-31.
        assert!(content.find("20261230").unwrap() < content.find("20261231").unwrap());

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn export_calendar_ics_errors_on_empty_assignments() {
        let conn = test_conn();
        // El seed crea plantillas pero NINGÚN assignment.
        let path = std::env::temp_dir().join(format!(
            "rotapro_export_empty_test_{}.ics",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);

        let res = export_calendar_ics_impl(&conn, path.to_str().unwrap());
        assert!(res.is_err());
        assert_eq!(res.unwrap_err(), "No hay turnos para exportar");

        let _ = std::fs::remove_file(&path);
    }

    // TEMPORAL Fase 5 — utilidad de estrés; decidir con el usuario si se
    // conserva tras el empaquetado.

    /// Réplica de `app.path().app_data_dir()` (Tauri v2, Linux): la BD REAL de
    /// la app vive en `$XDG_DATA_HOME/com.rotapro.app` o
    /// `~/.local/share/com.rotapro.app`. Mismo path que el setup de `lib.rs`.
    fn real_app_data_dir() -> std::path::PathBuf {
        let identifier = "com.rotapro.app";
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            if !xdg.is_empty() {
                return std::path::PathBuf::from(xdg).join(identifier);
            }
        }
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        std::path::PathBuf::from(home)
            .join(".local")
            .join("share")
            .join(identifier)
    }

    #[test]
    #[ignore]
    fn stress_seed_f5() {
        let dir = real_app_data_dir();
        let conn = db::open_db(&dir).unwrap();
        // Seguridad/idempotencia: migrate + seed ya corren en `open_db` (setup).
        db::migrate(&conn).unwrap();
        db::seed(&conn).unwrap();

        // Idempotente: borra filas previas del marcador antes de sembrar.
        let deleted = conn
            .execute("DELETE FROM assignments WHERE notes = 'STRESS-F5'", [])
            .unwrap();

        // IDs de las 4 plantillas seeded (codes fijos).
        let tpl: Vec<String> = ["morning", "afternoon", "night", "guard_24h"]
            .iter()
            .map(|code| {
                conn.query_row(
                    "SELECT id FROM shift_templates WHERE code = ?1",
                    params![code],
                    |r| r.get(0),
                )
                .unwrap()
            })
            .collect();
        let t_morning = tpl[0].as_str();
        let t_afternoon = tpl[1].as_str();
        let t_night = tpl[2].as_str();
        let t_guard = tpl[3].as_str();

        // Mes ACTUAL (hora local) a partir del reloj del sistema.
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let (y, m, _d) = civil_from_days(now / 86_400);
        let last_day = days_in_month(y, m as u32);
        // 10/día sobre los primeros 30 días del mes (octubre 2026 = 31 días →
        // 300 filas). En meses más cortos se limita a los días reales.
        let days_to_seed = last_day.min(30);

        let mut inserted = 0usize;
        for day in 1..=days_to_seed {
            let date = format_date(y, m as i64, day);
            // Patrón por día (espejo del test TS de estrés): carriles por
            // solape, overrides de horas y overnights.
            let slots: [(&str, Option<&str>, Option<&str>); 10] = [
                (t_morning, None, None),
                (t_afternoon, None, None),
                (t_night, None, None),
                (t_morning, None, None),
                (t_morning, None, None),
                (t_afternoon, None, None),
                (t_guard, None, None),
                (t_morning, Some("08:00"), Some("12:00")),
                (t_night, None, None),
                (t_afternoon, None, None),
            ];
            for (tid, start, end) in slots {
                create_assignment_impl(
                    &conn,
                    AssignmentInput {
                        shift_template_id: tid.to_string(),
                        date: date.clone(),
                        start_time: start.map(String::from),
                        end_time: end.map(String::from),
                        notes: Some("STRESS-F5".to_string()),
                    },
                )
                .unwrap();
                inserted += 1;
            }
        }

        let (min_date, max_date): (String, String) = conn
            .query_row(
                "SELECT MIN(date), MAX(date) FROM assignments WHERE notes = 'STRESS-F5'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        println!(
            "[stress_seed_f5] previas borradas={deleted}, insertadas={inserted}, rango={min_date}..{max_date}"
        );
    }

    #[test]
    #[ignore]
    fn stress_clean_f5() {
        let dir = real_app_data_dir();
        let conn = db::open_db(&dir).unwrap();
        let deleted = conn
            .execute("DELETE FROM assignments WHERE notes = 'STRESS-F5'", [])
            .unwrap();
        println!("[stress_clean_f5] borradas={deleted}");
    }
}
