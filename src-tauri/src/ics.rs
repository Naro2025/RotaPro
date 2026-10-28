//! Motor de exportación iCalendar (RFC 5545) puro — sin tauri, testeable.
//! Reutiliza la aritmética de fechas de `commands` (Howard Hinnant, sin deps).

use crate::commands::{civil_from_days, days_from_civil, format_date, parse_date_parts};

/// Un VEVENT: assignment + hora efectiva + resumen legible (sin escapar aún).
pub(crate) struct IcsEvent {
    pub uid: String,
    pub date: String,    // 'YYYY-MM-DD'
    pub start: String,   // 'HH:MM' efectivo
    pub end: String,     // 'HH:MM' efectivo
    pub summary: String, // "{emoji} {name}" o name, SIN escapar aún
}

/// Siguiente día de una fecha 'YYYY-MM-DD' (days_from_civil + 1 → civil_from_days).
pub(crate) fn next_day(date: &str) -> String {
    let (y, m, d) = parse_date_parts(date);
    let (ny, nm, nd) = civil_from_days(days_from_civil(y, m, d) + 1);
    format_date(ny, nm, nd)
}

/// Escapado RFC 5545 TEXT: `\` → `\\`, `;` → `\;`, `,` → `\,`, salto → `\n`.
pub(crate) fn escape_text(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            ';' => out.push_str("\\;"),
            ',' => out.push_str("\\,"),
            '\n' => out.push_str("\\n"),
            _ => out.push(ch),
        }
    }
    out
}

/// Plegado RFC 5545: líneas de ≤75 octetos, sin partir codepoints UTF-8
/// (hay emoji en los resúmenes). Las líneas de continuación empiezan con
/// un espacio, que cuenta dentro de los 75 octetos.
pub(crate) fn fold_line(line: &str) -> Vec<String> {
    if line.len() <= 75 {
        return vec![line.to_string()];
    }
    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut first = true;
    for ch in line.chars() {
        // La primera línea no lleva prefijo; las siguientes reservan 1 byte
        // para el espacio de continuación.
        let overhead = if first { 0 } else { 1 };
        if current.len() + overhead + ch.len_utf8() > 75 {
            chunks.push(std::mem::take(&mut current));
            first = false;
        }
        current.push(ch);
    }
    chunks.push(current);
    chunks
        .into_iter()
        .enumerate()
        .map(|(i, c)| if i == 0 { c } else { format!(" {c}") })
        .collect()
}

/// Timestamp UTC 'YYYYMMDDTHHMMSSZ' desde segundos UNIX (epoch 1970-01-01 = día 0).
pub(crate) fn epoch_to_dtstamp(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    let hh = rem / 3_600;
    let mm = (rem % 3_600) / 60;
    let ss = rem % 60;
    format!("{y:04}{m:02}{d:02}T{hh:02}{mm:02}{ss:02}Z")
}

/// 'YYYY-MM-DD' → 'YYYYMMDD' (compacto para DTSTART/DTEND).
fn compact_date(date: &str) -> String {
    date.replace('-', "")
}

/// 'HH:MM' → 'HHMM' (compacto para DTSTART/DTEND).
fn compact_time(time: &str) -> String {
    time.replace(':', "")
}

/// Genera el .ics completo. CRLF (`\r\n`) en TODAS las líneas, incluida la
/// última. Un VEVENT por assignment, en el orden en que llegan (`date, id`).
/// DTSTART/DTEND flotantes en hora local: sin 'Z' y sin TZID (coherente con
/// la decisión tz-free del doc §1).
pub(crate) fn build_ics(events: &[IcsEvent], dtstamp: &str) -> String {
    let mut out = String::new();
    out.push_str("BEGIN:VCALENDAR\r\n");
    out.push_str("VERSION:2.0\r\n");
    out.push_str("PRODID:-//RotaPro//ES\r\n");
    out.push_str("CALSCALE:GREGORIAN\r\n");
    out.push_str("METHOD:PUBLISH\r\n");
    for ev in events {
        let dtstart = format!("{}T{}00", compact_date(&ev.date), compact_time(&ev.start));
        // DTEND al día siguiente si cruza medianoche (end <= start).
        let end_date = if ev.end <= ev.start {
            next_day(&ev.date)
        } else {
            ev.date.clone()
        };
        let dtend = format!("{}T{}00", compact_date(&end_date), compact_time(&ev.end));

        out.push_str("BEGIN:VEVENT\r\n");
        out.push_str(&format!("UID:{}\r\n", ev.uid));
        out.push_str(&format!("DTSTAMP:{}\r\n", dtstamp));
        out.push_str(&format!("DTSTART:{}\r\n", dtstart));
        out.push_str(&format!("DTEND:{}\r\n", dtend));
        // Plegar la línea COMPLETA (SUMMARY: incluido en el cómputo de 75 octetos).
        let folded = fold_line(&format!("SUMMARY:{}", escape_text(&ev.summary)));
        for line in &folded {
            out.push_str(&format!("{line}\r\n"));
        }
        out.push_str("END:VEVENT\r\n");
    }
    out.push_str("END:VCALENDAR\r\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn next_day_crosses_month_and_year_boundaries() {
        assert_eq!(next_day("2026-01-31"), "2026-02-01");
        assert_eq!(next_day("2026-12-31"), "2027-01-01");
    }

    #[test]
    fn next_day_handles_leap_years() {
        assert_eq!(next_day("2024-02-28"), "2024-02-29"); // bisiesto
        assert_eq!(next_day("2023-02-28"), "2023-03-01"); // no bisiesto
    }

    #[test]
    fn escape_text_escapes_rfc5545_specials() {
        assert_eq!(escape_text("a,b"), "a\\,b");
        assert_eq!(escape_text("a;b"), "a\\;b");
        assert_eq!(escape_text("a\\b"), "a\\\\b");
        assert_eq!(escape_text("a\nb"), "a\\nb");
    }

    #[test]
    fn fold_line_limits_octets_and_keeps_utf8_intact() {
        // 160 'a' → primera línea de 75 + dos continuaciones.
        let folded = fold_line(&"a".repeat(160));
        assert_eq!(folded.len(), 3);
        for line in &folded {
            assert!(line.len() <= 75, "línea de {} octetos", line.len());
        }
        assert_eq!(folded[0], "a".repeat(75));
        assert_eq!(folded[1], format!(" {}", "a".repeat(74)));
        assert_eq!(folded[2], format!(" {}", "a".repeat(11)));

        // Emoji (4 bytes UTF-8) no debe partirse: 73 'x' + 🌙 = 77 octetos.
        let emoji_line = format!("{}🌙", "x".repeat(73));
        let folded_emoji = fold_line(&emoji_line);
        assert_eq!(folded_emoji.len(), 2);
        assert_eq!(folded_emoji[0], "x".repeat(73));
        assert_eq!(folded_emoji[1], " 🌙");
    }

    #[test]
    fn epoch_to_dtstamp_utc_boundaries() {
        assert_eq!(epoch_to_dtstamp(0), "19700101T000000Z");
        assert_eq!(epoch_to_dtstamp(86_399), "19700101T235959Z");
        assert_eq!(epoch_to_dtstamp(86_400), "19700102T000000Z");
    }

    #[test]
    fn build_ics_emits_full_calendar_with_overnight_next_day() {
        let events = vec![
            IcsEvent {
                uid: "uid-day".to_string(),
                date: "2026-12-31".to_string(),
                start: "06:00".to_string(),
                end: "14:00".to_string(),
                summary: "Mañana".to_string(),
            },
            IcsEvent {
                uid: "uid-night".to_string(),
                date: "2026-12-31".to_string(),
                start: "22:00".to_string(),
                end: "06:00".to_string(),
                summary: "🌙 Noche".to_string(),
            },
        ];
        let ics = build_ics(&events, "20270101T000000Z");

        assert!(ics.starts_with("BEGIN:VCALENDAR\r\n"));
        assert!(ics.ends_with("END:VCALENDAR\r\n"));
        assert!(ics.contains("PRODID:-//RotaPro//ES\r\n"));
        assert!(ics.contains("METHOD:PUBLISH\r\n"));

        assert!(ics.contains("UID:uid-day\r\n"));
        assert!(ics.contains("UID:uid-night\r\n"));
        assert!(ics.contains("DTSTAMP:20270101T000000Z\r\n"));
        assert!(ics.contains("DTSTART:20261231T060000\r\n"));
        assert!(ics.contains("DTEND:20261231T140000\r\n"));
        assert!(ics.contains("DTSTART:20261231T220000\r\n"));
        // Overnight → DTEND al día siguiente (cruce de año).
        assert!(ics.contains("DTEND:20270101T060000\r\n"));
        assert!(ics.contains("SUMMARY:🌙 Noche\r\n"));

        // Orden preservado (tal y como llegan del SQL `date, id`).
        assert!(ics.find("UID:uid-day").unwrap() < ics.find("UID:uid-night").unwrap());

        // CRLF: no debe quedar ningún LF suelto sin CR.
        assert!(!ics.replace("\r\n", "").contains('\n'));
    }

    #[test]
    fn build_ics_folds_summary_within_75_octets_including_property_name() {
        // Summary largo (100+ chars) con coma (para comprobar el escape) y
        // un emoji final (UTF-8 multibyte).
        let summary = format!("Turno largo de noche, cobertura {}🌙", "a".repeat(100));
        let events = vec![IcsEvent {
            uid: "uid-long".to_string(),
            date: "2026-10-27".to_string(),
            start: "22:00".to_string(),
            end: "06:00".to_string(),
            summary: summary.clone(),
        }];
        let ics = build_ics(&events, "20270101T000000Z");

        // Líneas físicas, sin la cadena vacía final que deja el CRLF terminal.
        let lines: Vec<&str> = ics.split("\r\n").filter(|l| !l.is_empty()).collect();

        // (1) TODAS las líneas ≤ 75 octetos (line.len() son bytes en Rust).
        for line in &lines {
            assert!(line.len() <= 75, "línea de {} octetos", line.len());
        }

        // (2) La línea "SUMMARY:" es la primera del grupo plegado del VEVENT:
        //     lleva el nombre de propiedad (no un espacio de continuación).
        let begin_idx = lines.iter().position(|l| *l == "BEGIN:VEVENT").unwrap();
        let summary_idx = lines.iter().position(|l| l.starts_with("SUMMARY:")).unwrap();
        assert!(summary_idx > begin_idx);

        // (3) Reconstituir el valor: chunk inicial sin "SUMMARY:" + los
        //     siguientes sin su espacio inicial, concatenados == escape_text.
        let mut reconstructed = String::new();
        let mut first = true;
        for line in lines.iter().skip(summary_idx) {
            if *line == "END:VEVENT" {
                break;
            }
            if first {
                reconstructed.push_str(line.strip_prefix("SUMMARY:").unwrap());
                first = false;
            } else {
                reconstructed.push_str(line.strip_prefix(' ').unwrap());
            }
        }
        assert_eq!(reconstructed, escape_text(&summary));
    }
}
