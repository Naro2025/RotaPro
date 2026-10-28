/*
 * Motor de layout de solapamiento puro (sin React, sin DOM).
 *
 * Los chips de turno dentro de una celda del calendario se apilan en vertical
 * plano (orden de llegada del backend). Este módulo añade el empaquetado
 * clásico de calendario: los turnos que se solapan en el día se reparten en
 * carriles side-by-side (anchos 1/columns), mientras que los clusters de
 * turnos no solapados se mantienen apilados a ancho completo.
 *
 * Diseñado para ser reutilizado por WeekView (futuro TimeGrid, chunk B):
 * `packOverlaps` es genérico (no conoce `Assignment` ni `ShiftTemplate`) y
 * solo depende de dos funciones `getStart`/`getEnd` que devuelven minutos.
 */
import type { Assignment, ShiftTemplate } from "../types";
import { isOvernight } from "./date";

/** "HH:MM" → minutos desde 00:00. Formato fijo, horas válidas (sin validar). */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((s) => parseInt(s, 10));
  return h * 60 + m;
}

/**
 * Rango en minutos de un turno dentro del día de la celda.
 * Si cruza medianoche (`end <= start`), `end` se clampa a 1440 (fin del día)
 * para que el packing opere sobre el tramo 22:00→24:00, sin desbordar la celda.
 */
export function shiftMinutes(
  startTime: string,
  endTime: string,
): { start: number; end: number } {
  const start = toMinutes(startTime);
  let end = toMinutes(endTime);
  if (end <= start) end = 1440;
  return { start, end };
}

/** Resultado del empaquetado de un item: carril y tamaño del cluster. */
export interface Packed<T> {
  item: T;
  /** Índice de carril dentro del cluster (0-based). */
  column: number;
  /** Carriles usados por el cluster (ancho de cada chip = 1/columns). */
  columns: number;
  /** Índice del cluster (0-based, en orden de aparición). */
  cluster: number;
}

/**
 * Algoritmo de calendario clásico:
 * 1. Ordenar por (start asc, end desc, índice original asc) — estable.
 * 2. Agrupar clusters por solape transitivo (uniones de intervalos).
 * 3. Dentro de cada cluster, asignación greedy de carriles: cada item va al
 *    primer carril cuyo último ocupante no lo solape. `columns` = carriles
 *    usados por el cluster.
 */
export function packOverlaps<T>(
  items: readonly T[],
  getStart: (t: T) => number,
  getEnd: (t: T) => number,
): Packed<T>[] {
  const indexed = items.map((item, index) => ({
    item,
    index,
    start: getStart(item),
    end: getEnd(item),
  }));
  indexed.sort(
    (a, b) => a.start - b.start || b.end - a.end || a.index - b.index,
  );

  // Fase 1: clusters por solape transitivo (uniones de intervalos).
  const clusters: Array<typeof indexed> = [];
  let current: typeof indexed = [];
  let maxEnd = -Infinity;
  for (const entry of indexed) {
    if (entry.start >= maxEnd) {
      if (current.length > 0) clusters.push(current);
      current = [];
      maxEnd = -Infinity;
    }
    current.push(entry);
    if (entry.end > maxEnd) maxEnd = entry.end;
  }
  if (current.length > 0) clusters.push(current);

  // Fase 2: asignación greedy de carriles dentro de cada cluster.
  const result: Packed<T>[] = [];
  clusters.forEach((entries, clusterIndex) => {
    const laneEnds: number[] = []; // laneEnds[l] = fin del último ocupante.
    const placed = entries.map((entry) => {
      let column = laneEnds.findIndex((laneEnd) => laneEnd <= entry.start);
      if (column === -1) {
        column = laneEnds.length;
        laneEnds.push(entry.end);
      } else {
        laneEnds[column] = entry.end;
      }
      return { entry, column };
    });
    const columns = laneEnds.length;
    for (const { entry, column } of placed) {
      result.push({
        item: entry.item,
        column,
        columns,
        cluster: clusterIndex,
      });
    }
  });

  return result;
}

/** Turno de un día ya resuelto y empaquetado para su render. */
export interface DayShift {
  assignment: Assignment;
  template: ShiftTemplate;
  start: number;
  end: number;
  column: number;
  columns: number;
  cluster: number;
  overnight: boolean;
}

/**
 * Convierte las asignaciones de un día en `DayShift` ordenados (start asc) y
 * empaquetados por solape. Los tiempos efectivos son `assignment.startTime ??
 * template.startTime` (ídem end). Se descartan las asignaciones sin plantilla
 * resuelta (igual que hace `resolveTemplate` devolviendo `undefined`).
 */
export function buildDayShifts(
  assignments: readonly Assignment[],
  templates: readonly ShiftTemplate[],
): DayShift[] {
  const resolved: Array<{
    assignment: Assignment;
    template: ShiftTemplate;
    start: number;
    end: number;
    overnight: boolean;
  }> = [];

  for (const assignment of assignments) {
    const template = templates.find((t) => t.id === assignment.shiftTemplateId);
    if (!template) continue;
    const startTime = assignment.startTime ?? template.startTime;
    const endTime = assignment.endTime ?? template.endTime;
    const { start, end } = shiftMinutes(startTime, endTime);
    resolved.push({
      assignment,
      template,
      start,
      end,
      overnight: isOvernight(startTime, endTime),
    });
  }

  return packOverlaps(
    resolved,
    (s) => s.start,
    (s) => s.end,
  ).map((p) => ({
    assignment: p.item.assignment,
    template: p.item.template,
    start: p.item.start,
    end: p.item.end,
    overnight: p.item.overnight,
    column: p.column,
    columns: p.columns,
    cluster: p.cluster,
  }));
}
