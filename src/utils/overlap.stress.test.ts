/*
 * Prueba de estrés (Fase 5, hardening de rendimiento) del motor de solape.
 * Sin dependencias nuevas: ejercita `buildDayShifts`/`packOverlaps` con 300
 * assignments en un mes (≈10/día) y valida corrección + tiempo de cómputo.
 *
 * Umbral de 200 ms deliberadamente generoso (CI-safe): en hardware real el
 * pipeline completo queda muy por debajo; el número medido se imprime para el
 * informe de la Fase 5.
 */
import { describe, expect, it } from "vitest";
import { buildDayShifts, toMinutes } from "./overlap";
import type { Assignment, ShiftTemplate } from "../types";

const YEAR = 2026;
const MONTH = 11; // noviembre 2026 (30 días) → 30 × 10 = 300.

// Espejo de las 4 plantillas seeded (codes/id estables para el test).
const TEMPLATES: ShiftTemplate[] = [
  {
    id: "tpl-morning",
    workFormatId: "wf-shift",
    code: "morning",
    name: "Mañana",
    startTime: "06:00",
    endTime: "14:00",
    color: "#F59E0B",
    sortOrder: 0,
  },
  {
    id: "tpl-afternoon",
    workFormatId: "wf-shift",
    code: "afternoon",
    name: "Tarde",
    startTime: "14:00",
    endTime: "22:00",
    color: "#0EA5E9",
    sortOrder: 1,
  },
  {
    id: "tpl-night",
    workFormatId: "wf-shift",
    code: "night",
    name: "Noche",
    startTime: "22:00",
    endTime: "06:00",
    color: "#6D28D9",
    sortOrder: 2,
  },
  {
    id: "tpl-guard",
    workFormatId: "wf-oncall",
    code: "guard_24h",
    name: "Guardia 24h",
    startTime: "00:00",
    endTime: "23:59",
    color: "#EF4444",
    sortOrder: 3,
  },
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dateKey(day: number): string {
  return `${YEAR}-${pad(MONTH)}-${pad(day)}`;
}

/**
 * Genera 300 assignments deterministas (10/día × 30 días de noviembre).
 * El patrón por día ejercita:
 *  - carriles: 3 mañanas idénticas, 3 tardes idénticas, guardia 24h que se
 *    solapa con todo (fuerza columnas máximas);
 *  - overrides: una mañana 08:00–12:00;
 *  - overnight: 2 noches 22:00–06:00.
 */
function buildDataset(): Assignment[] {
  const assignments: Assignment[] = [];
  let seq = 0;
  for (let day = 1; day <= 30; day++) {
    // 10 posiciones fijas por día.
    const positions: Array<{ template: ShiftTemplate; start?: string; end?: string }> = [
      { template: TEMPLATES[0] }, // mañana
      { template: TEMPLATES[1] }, // tarde
      { template: TEMPLATES[2] }, // noche (overnight)
      { template: TEMPLATES[0] }, // mañana (solape → carril)
      { template: TEMPLATES[0] }, // mañana (triple → 3 carriles)
      { template: TEMPLATES[1] }, // tarde (solape)
      { template: TEMPLATES[3] }, // guardia 24h (solapa con todo)
      { template: TEMPLATES[0], start: "08:00", end: "12:00" }, // override
      { template: TEMPLATES[2] }, // noche (segunda → solape overnight)
      { template: TEMPLATES[1] }, // tarde (triple)
    ];
    for (const p of positions) {
      seq += 1;
      assignments.push({
        id: `asg-${seq}`,
        uid: `uid-${seq}`,
        shiftTemplateId: p.template.id,
        date: dateKey(day),
        startTime: p.start,
        endTime: p.end,
      });
    }
  }
  return assignments;
}

/** Agrupa por día (misma lógica que `MonthView`) y empaqueta cada día. */
function runPipeline(assignments: Assignment[]) {
  const byDate = new Map<string, Assignment[]>();
  for (const a of assignments) {
    const list = byDate.get(a.date) ?? [];
    list.push(a);
    byDate.set(a.date, list);
  }
  const perDay = new Map<string, ReturnType<typeof buildDayShifts>>();
  for (const [key, list] of byDate) {
    perDay.set(key, buildDayShifts(list, TEMPLATES));
  }
  return { byDate, perDay };
}

describe("overlap — estrés 300 assignments/mes", () => {
  const assignments = buildDataset();

  it("corrección: ningún assignment perdido y carriles coherentes", () => {
    expect(assignments).toHaveLength(300);

    const { byDate, perDay } = runPipeline(assignments);

    // 30 días, 10 por día.
    expect(byDate.size).toBe(30);
    for (const list of byDate.values()) {
      expect(list).toHaveLength(10);
    }

    // Ningún assignment perdido (todos resuelven plantilla): 300 shifts.
    let totalShifts = 0;
    const seenIds = new Set<string>();
    for (const [dayKey, shifts] of perDay) {
      totalShifts += shifts.length;
      expect(shifts).toHaveLength(byDate.get(dayKey)!.length);

      // Coherencia de carriles/clusters + orden determinista por start.
      let prevStart = -Infinity;
      const clusterColumns = new Map<number, number>();
      for (const s of shifts) {
        expect(s.column).toBeGreaterThanOrEqual(0);
        expect(s.columns).toBeGreaterThanOrEqual(1);
        expect(s.column).toBeLessThan(s.columns);
        expect(s.cluster).toBeGreaterThanOrEqual(0);
        expect(s.start).toBeGreaterThanOrEqual(prevStart); // orden start asc
        prevStart = s.start;

        // Un cluster = un único `columns` compartido por todos sus miembros.
        if (clusterColumns.has(s.cluster)) {
          expect(s.columns).toBe(clusterColumns.get(s.cluster));
        } else {
          clusterColumns.set(s.cluster, s.columns);
        }

        // Sin duplicados (cada assignment empaquetado una única vez).
        expect(seenIds.has(s.assignment.id)).toBe(false);
        seenIds.add(s.assignment.id);
      }
    }
    expect(totalShifts).toBe(300);
    expect(seenIds.size).toBe(300);

    // Semántica de overrides y overnight en un día concreto (día 1).
    const day1 = perDay.get(dateKey(1))!;
    const override = day1.find((s) => s.assignment.startTime === "08:00")!;
    expect(override.start).toBe(toMinutes("08:00"));
    expect(override.end).toBe(toMinutes("12:00"));
    expect(override.overnight).toBe(false);

    const nights = day1.filter((s) => s.assignment.shiftTemplateId === "tpl-night");
    expect(nights).toHaveLength(2);
    for (const n of nights) {
      expect(n.overnight).toBe(true);
      expect(n.end).toBe(1440); // clamp a fin de día
    }

    // La guardia 24h solapa con todo → el cluster de las mañanas solapadas
    // debe usar varios carriles (columnas > 1 en el cluster que la contiene).
    const guard = day1.find((s) => s.assignment.shiftTemplateId === "tpl-guard")!;
    expect(guard.start).toBe(0);
    expect(guard.end).toBe(toMinutes("23:59"));
    expect(guard.overnight).toBe(false);
    // El cluster de la guardia (solape con mañanas/tardes) usa >1 carril.
    expect(guard.columns).toBeGreaterThan(1);
  });

  it("tiempo: pipeline completo < 200 ms (umbral CI-safe)", () => {
    const started = performance.now();
    const { perDay } = runPipeline(assignments);
    const elapsed = performance.now() - started;

    // Sanity: el pipeline realmente procesó el mes completo.
    expect(perDay.size).toBe(30);

    // Número real para el informe de la Fase 5.
    console.log(
      `[overlap.stress] 300 assignments/mes → ${elapsed.toFixed(2)} ms (pipeline completo)`,
    );

    expect(elapsed).toBeLessThan(200);
  });
});
