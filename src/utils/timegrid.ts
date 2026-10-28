/*
 * Utilidades puras para el TimeGrid semanal (WeekView) y la pista temporal
 * de la vista mensual (DayCell). Sin React, sin DOM: solo aritmética de
 * minutos y empaquetado por solape (reutiliza `overlap.ts`).
 *
 * Un turno overnight (ej. 22:00–06:00) se renderiza como DOS segmentos:
 *   - cola en su día de inicio (22:00 → 24:00), `isContinuation: false`;
 *   - continuación en el día siguiente (00:00 → 06:00), `isContinuation: true`.
 * `daySegments` devuelve todo lo que se dibuja en una ÚNICA columna de día
 * (normales + cola del propio día + continuación del día anterior), de modo
 * que el empaquetado de solapes opera sobre un único día y es correcto.
 */
import type { Assignment, ShiftTemplate } from "../types";
import { addDays, formatDate, isOvernight } from "./date";
import { packOverlaps, shiftMinutes, toMinutes, type DayShift } from "./overlap";

/** Segmento de un turno dentro de una columna de día del TimeGrid. */
export interface DaySegment {
  assignment: Assignment;
  template: ShiftTemplate;
  /** Día ('YYYY-MM-DD') de la columna donde se renderiza. */
  date: string;
  /** Minutos desde 00:00 dentro de `date` (0..1440). */
  start: number;
  /** Minutos desde 00:00 dentro de `date` (cola overnight = 1440). */
  end: number;
  /** Inicio efectivo a mostrar ('HH:MM'); en continuación = '00:00'. */
  startTime: string;
  /** Fin efectivo a mostrar ('HH:MM', ej. '06:00' en overnight). */
  endTime: string;
  column: number;
  columns: number;
  cluster: number;
  /** El assignment cruza medianoche (`endTime <= startTime`). */
  overnight: boolean;
  /** Tramo 00:00→end del día siguiente a un overnight (estilo atenuado). */
  isContinuation: boolean;
}

/**
 * Segmentos que se renderizan en la columna del día `date`:
 * - turnos normales asignados a `date` (1 segmento cada uno);
 * - cola (start → 1440) de los overnights asignados a `date`;
 * - continuación (0 → end) de los overnights asignados a `date - 1`.
 * Todos se empaquetan juntos por solape (un único día → packing correcto).
 * Se descartan asignaciones sin plantilla resuelta.
 */
export function daySegments(
  assignments: readonly Assignment[],
  templates: readonly ShiftTemplate[],
  date: Date,
): DaySegment[] {
  const key = formatDate(date);
  const prevKey = formatDate(addDays(date, -1));

  interface Piece {
    assignment: Assignment;
    template: ShiftTemplate;
    start: number;
    end: number;
    startTime: string;
    endTime: string;
    overnight: boolean;
    isContinuation: boolean;
  }
  const pieces: Piece[] = [];

  for (const assignment of assignments) {
    const template = templates.find((t) => t.id === assignment.shiftTemplateId);
    if (!template) continue;
    const startTime = assignment.startTime ?? template.startTime;
    const endTime = assignment.endTime ?? template.endTime;

    if (assignment.date === key) {
      const { start, end } = shiftMinutes(startTime, endTime);
      pieces.push({
        assignment,
        template,
        start,
        end,
        startTime,
        endTime,
        overnight: isOvernight(startTime, endTime),
        isContinuation: false,
      });
    } else if (
      assignment.date === prevKey &&
      isOvernight(startTime, endTime)
    ) {
      const contEnd = toMinutes(endTime);
      // end == 0 (ej. 22:00–00:00) no invade el día siguiente: sin continuación.
      if (contEnd > 0) {
        pieces.push({
          assignment,
          template,
          start: 0,
          end: contEnd,
          startTime: "00:00",
          endTime,
          overnight: true,
          isContinuation: true,
        });
      }
    }
  }

  return packOverlaps(
    pieces,
    (p) => p.start,
    (p) => p.end,
  ).map((p) => ({
    assignment: p.item.assignment,
    template: p.item.template,
    date: key,
    start: p.item.start,
    end: p.item.end,
    startTime: p.item.startTime,
    endTime: p.item.endTime,
    column: p.column,
    columns: p.columns,
    cluster: p.cluster,
    overnight: p.item.overnight,
    isContinuation: p.item.isContinuation,
  }));
}

/**
 * Filtra los segmentos cuyos días no están en la semana visible (lunes→domingo).
 * Útil para descartar continuaciones (o colas) que caen fuera del rango
 * renderizado; `weekDays` se compara por clave 'YYYY-MM-DD'.
 */
export function visibleSegments(
  weekDays: readonly Date[],
  segments: readonly DaySegment[],
): DaySegment[] {
  const visible = new Set(weekDays.map(formatDate));
  return segments.filter((s) => visible.has(s.date));
}

/** Posición de un segmento en la pista 0–24 h de la celda mensual. */
export interface TrackSegment {
  /** Offset izquierdo en % del ancho de la pista. */
  leftPct: number;
  /** Ancho en % de la pista. */
  widthPct: number;
}

/**
 * Convierte los `DayShift` ya empaquetados (y clampados a 1440) de un día en
 * segmentos posicionados de la pista temporal mensual (0 → 24 h = 0 → 100%).
 * No recalcula tiempos: usa `start`/`end` de cada shift.
 */
export function trackSegments(
  shifts: readonly DayShift[],
): TrackSegment[] {
  return shifts.map((s) => ({
    leftPct: (s.start / 1440) * 100,
    widthPct: ((s.end - s.start) / 1440) * 100,
  }));
}
