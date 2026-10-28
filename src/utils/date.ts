/*
 * Utilidades de fechas puras (sin dependencias externas).
 * Todo trabaja en hora local (decisión §6 del doc: single-user, sin timezone).
 * La semana la define el backend: lunes → domingo.
 * Nunca se hace `Date.parse` de strings: solo se formatea/construye con
 * `new Date(y, m, d)` y aritmética de días.
 */

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;

/** Índice de día con lunes = 0 … domingo = 6. */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** Copia del día (sin hora) en fecha local. */
function dayOnly(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Primer día del mes. */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Último día del mes. */
export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/** Lunes de la semana que contiene `date`. */
export function startOfWeek(date: Date): Date {
  const d = dayOnly(date);
  d.setDate(d.getDate() - mondayIndex(d));
  return d;
}

/** Domingo de la semana que contiene `date`. */
export function endOfWeek(date: Date): Date {
  const d = startOfWeek(date);
  d.setDate(d.getDate() + 6);
  return d;
}

/** Los 7 días (lunes → domingo) de la semana que contiene `date`. */
export function weekDays(date: Date): Date[] {
  const start = startOfWeek(date);
  return Array.from({ length: WEEK_DAYS }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

/** Matriz de ~6 semanas (6 filas × 7 días, lunes primero) del mes de `date`. */
export function monthGrid(date: Date): Date[][] {
  const start = startOfWeek(startOfMonth(date));
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < WEEK_DAYS; d++) {
      const cell = new Date(start);
      cell.setDate(start.getDate() + w * WEEK_DAYS + d);
      week.push(cell);
    }
    weeks.push(week);
  }
  return weeks;
}

/** 'YYYY-MM-DD' en hora local. */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parsea 'YYYY-MM-DD' (hora local) a `Date`. No usa `Date.parse`. */
export function parseDate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Suma `n` días a `date` (copia sin hora, no muta). */
export function addDays(date: Date, n: number): Date {
  const d = dayOnly(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** Días enteros entre `a` y `b` (`b - a`), en hora local. */
export function diffDays(a: Date, b: Date): number {
  return Math.round((dayOnly(b).getTime() - dayOnly(a).getTime()) / DAY_MS);
}

/** Número de semana ISO-8601 (lunes primero) y su año ISO. */
export function isoWeek(date: Date): { year: number; week: number } {
  const d = dayOnly(date);
  // Jueves de la semana actual: ancla el año ISO (evita el desfase de enero).
  d.setDate(d.getDate() + 3 - mondayIndex(d));
  const isoYear = d.getFullYear();
  const week1Monday = startOfWeek(new Date(isoYear, 0, 4));
  const week =
    1 + Math.round((d.getTime() - week1Monday.getTime()) / (WEEK_DAYS * DAY_MS));
  return { year: isoYear, week };
}

/** Clave de caché de mes (mismo formato que `scheduleStore.ts`). */
export function monthKey(year: number, month: number): string {
  return `month:${year}-${String(month).padStart(2, "0")}`;
}

/** Clave de caché de semana (mismo formato que `scheduleStore.ts`). */
export function weekKey(year: number, week: number): string {
  return `week:${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * Deriva si un turno cruza medianoche: `end <= start`.
 * Comparación lexicográfica segura con formato fijo "HH:MM" (horas válidas).
 * No se persiste: se calcula sobre la marcha (espejo de `models.rs`).
 */
export function isOvernight(start: string, end: string): boolean {
  return end <= start;
}
