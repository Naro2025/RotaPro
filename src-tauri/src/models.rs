//! Structs serde espejo de `src/types.ts` (camelCase automático, §4).
//! Rust snake_case ↔ TS camelCase vía `#[serde(rename_all = "camelCase")]`.

use serde::{Deserialize, Serialize};

/// Formato laboral (taxonomía fija, seeded).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkFormat {
    pub id: String,
    pub code: String,
    pub name: String,
    pub sort_order: i64,
}

/// Plantilla de turno (Mañana, Tarde, Noche, Guardia 24h).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftTemplate {
    pub id: String,
    pub work_format_id: String,
    pub code: String,
    pub name: String,
    pub start_time: String,
    pub end_time: String,
    pub color: String,
    /// Emoji identificador opcional ("" = sin emoji). Persistido.
    #[serde(default)]
    pub emoji: String,
    pub sort_order: i64,
    /// Campo computado (no persistido): true si el turno cruza medianoche.
    /// Se calcula en el mapping con `is_overnight(start_time, end_time)`.
    pub is_overnight: bool,
}

/// Payload de creación/edición de plantilla (`Omit<ShiftTemplate, 'id'>`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftTemplateInput {
    pub work_format_id: String,
    /// Opcional: si el FE lo omite, `create_shift_template` autogenera
    /// `custom-<uuid>` (turno personalizado). `#[serde(default)]` lo rellena
    /// con `String::new()` cuando falta en el JSON.
    #[serde(default)]
    pub code: String,
    pub name: String,
    pub start_time: String,
    pub end_time: String,
    pub color: String,
    /// Emoji opcional ("" = sin emoji). Validado ≤16 bytes UTF-8 tras trim.
    #[serde(default)]
    pub emoji: String,
    pub sort_order: i64,
}

/// Asignación plantilla → día (un VEVENT por fila).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Assignment {
    pub id: String,
    pub uid: String,
    pub shift_template_id: String,
    pub date: String,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub notes: Option<String>,
}

/// Payload de creación/edición de asignación.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentInput {
    pub shift_template_id: String,
    pub date: String,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub notes: Option<String>,
}

/// Rango de fechas inclusivo ('YYYY-MM-DD').
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarRange {
    pub start: String,
    pub end: String,
}

/// Payload de creación de un rango de asignaciones: una fila `assignments` por
/// día (evento individual, uid v7 propio). Idempotente por (fecha, plantilla).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeAssignmentInput {
    pub shift_template_id: String,
    pub start_date: String,
    pub end_date: String,
}

/// Payload denormalizado de una vista (mes/semana).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarData {
    pub assignments: Vec<Assignment>,
    pub templates: Vec<ShiftTemplate>,
}

/// Par clave-valor (tema / acento / densidad / ...).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Setting {
    pub key: String,
    pub value: String,
}

/// Deriva si un turno cruza medianoche: `end_time <= start_time`.
/// Comparación lexicográfica segura con formato fijo "HH:MM" (horas válidas,
/// `start != end` ya validado en create/update de plantillas). No se persiste:
/// siempre consistente ante ediciones y sin riesgo de migración.
pub fn is_overnight(start_time: &str, end_time: &str) -> bool {
    end_time <= start_time
}

#[cfg(test)]
mod tests {
    use super::is_overnight;

    #[test]
    fn night_shift_crosses_midnight() {
        assert!(is_overnight("22:00", "06:00"));
    }

    #[test]
    fn day_shift_does_not_cross_midnight() {
        assert!(!is_overnight("08:00", "20:00"));
    }

    #[test]
    fn full_24h_guard_does_not_cross_midnight() {
        assert!(!is_overnight("00:00", "23:59"));
    }

    #[test]
    fn custom_evening_shift_crosses_midnight() {
        assert!(is_overnight("20:00", "06:00"));
    }
}
