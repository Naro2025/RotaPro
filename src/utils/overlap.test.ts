import { describe, expect, it } from "vitest";
import {
  buildDayShifts,
  packOverlaps,
  shiftMinutes,
  toMinutes,
} from "./overlap";
import type { Assignment, ShiftTemplate } from "../types";

describe("toMinutes", () => {
  it("convierte HH:MM a minutos desde 00:00", () => {
    expect(toMinutes("00:00")).toBe(0);
    expect(toMinutes("09:30")).toBe(570);
    expect(toMinutes("23:59")).toBe(1439);
  });
});

describe("shiftMinutes", () => {
  it("devuelve el rango normal sin clamp", () => {
    expect(shiftMinutes("08:00", "16:00")).toEqual({ start: 480, end: 960 });
  });

  it("clampa el fin a 1440 cuando cruza medianoche", () => {
    expect(shiftMinutes("22:00", "06:00")).toEqual({ start: 1320, end: 1440 });
  });
});

describe("packOverlaps", () => {
  it("disjoint: cada intervalo es su propio cluster de 1 columna", () => {
    const items = [
      { start: 0, end: 5 },
      { start: 5, end: 10 },
      { start: 10, end: 15 },
    ];
    const packed = packOverlaps(items, (i) => i.start, (i) => i.end);
    expect(packed).toHaveLength(3);
    expect(packed.map((p) => p.cluster)).toEqual([0, 1, 2]);
    expect(packed.map((p) => p.column)).toEqual([0, 0, 0]);
    expect(packed.map((p) => p.columns)).toEqual([1, 1, 1]);
  });

  it("solape parcial: 2 columnas en un mismo cluster", () => {
    const items = [
      { start: 0, end: 10 },
      { start: 5, end: 15 },
    ];
    const packed = packOverlaps(items, (i) => i.start, (i) => i.end);
    expect(packed).toHaveLength(2);
    expect(packed.map((p) => p.cluster)).toEqual([0, 0]);
    expect(packed.map((p) => p.column)).toEqual([0, 1]);
    expect(packed.map((p) => p.columns)).toEqual([2, 2]);
  });

  it("triple solape mutuo: 3 columnas", () => {
    const items = [
      { start: 0, end: 10 },
      { start: 0, end: 10 },
      { start: 0, end: 10 },
    ];
    const packed = packOverlaps(items, (i) => i.start, (i) => i.end);
    expect(packed).toHaveLength(3);
    expect(packed.map((p) => p.column)).toEqual([0, 1, 2]);
    expect(packed.map((p) => p.columns)).toEqual([3, 3, 3]);
  });

  it("contenido: 2 columnas (el contenido no comparte carril)", () => {
    const items = [
      { start: 0, end: 20 },
      { start: 5, end: 15 },
    ];
    const packed = packOverlaps(items, (i) => i.start, (i) => i.end);
    expect(packed.map((p) => p.column)).toEqual([0, 1]);
    expect(packed.map((p) => p.columns)).toEqual([2, 2]);
  });

  it("cadena A-B, B-C con A∩C=∅: un cluster transitivo y A reutiliza carril con C", () => {
    const items = [
      { id: "A", start: 0, end: 10 },
      { id: "B", start: 5, end: 15 },
      { id: "C", start: 12, end:20 },
    ];
    const packed = packOverlaps(items, (i) => i.start, (i) => i.end);
    expect(packed).toHaveLength(3);
    expect(packed.map((p) => p.cluster)).toEqual([0, 0, 0]);
    expect(packed.map((p) => p.columns)).toEqual([2, 2, 2]);
    // A (0,10) y C (12,20) no se solapan → comparten carril 0; B ocupa carril 1.
    const byId = new Map(packed.map((p) => [p.item.id, p]));
    expect(byId.get("A")!.column).toBe(0);
    expect(byId.get("C")!.column).toBe(0);
    expect(byId.get("B")!.column).toBe(1);
  });

  it("entrada vacía: array vacío", () => {
    expect(packOverlaps([], () => 0, () => 0)).toEqual([]);
  });

  it("estabilidad de desempate: mismo start/end conserva el orden original", () => {
    const items = [
      { id: "x", start: 10, end: 20 },
      { id: "y", start: 10, end: 20 },
      { id: "z", start: 10, end: 20 },
    ];
    const packed = packOverlaps(items, (i) => i.start, (i) => i.end);
    expect(packed.map((p) => p.item.id)).toEqual(["x", "y", "z"]);
  });
});

describe("buildDayShifts", () => {
  const mañana: ShiftTemplate = {
    id: "tpl-m",
    workFormatId: "wf-1",
    code: "M",
    name: "Mañana",
    startTime: "06:00",
    endTime: "14:00",
    color: "#ffffff",
    sortOrder: 1,
  };
  const tarde: ShiftTemplate = {
    id: "tpl-t",
    workFormatId: "wf-1",
    code: "T",
    name: "Tarde",
    startTime: "14:00",
    endTime: "22:00",
    color: "#000000",
    sortOrder: 2,
  };

  const asg = (partial: Partial<Assignment> & Pick<Assignment, "id">): Assignment => ({
    uid: "uid-1",
    shiftTemplateId: mañana.id,
    date: "2026-11-01",
    ...partial,
  });

  it("descarta asignaciones sin plantilla resuelta", () => {
    const shifts = buildDayShifts(
      [asg({ id: "a1", shiftTemplateId: "inexistente" })],
      [mañana],
    );
    expect(shifts).toEqual([]);
  });

  it("los overrides de la asignación ganan a la plantilla", () => {
    const shifts = buildDayShifts(
      [asg({ id: "a1", startTime: "05:00", endTime: "09:00" })],
      [mañana],
    );
    expect(shifts).toHaveLength(1);
    expect(shifts[0].start).toBe(300); // 05:00
    expect(shifts[0].end).toBe(540); // 09:00
    expect(shifts[0].template).toBe(mañana);
  });

  it("sin override usa los tiempos de la plantilla", () => {
    const shifts = buildDayShifts([asg({ id: "a1" })], [mañana]);
    expect(shifts[0].start).toBe(360); // 06:00
    expect(shifts[0].end).toBe(840); // 14:00
  });

  it("marca la bandera overnight en turnos que cruzan medianoche", () => {
    const noche: ShiftTemplate = {
      ...mañana,
      id: "tpl-n",
      name: "Noche",
      startTime: "22:00",
      endTime: "06:00",
    };
    const shifts = buildDayShifts(
      [asg({ id: "a1", shiftTemplateId: noche.id })],
      [noche],
    );
    expect(shifts).toHaveLength(1);
    expect(shifts[0].overnight).toBe(true);
    expect(shifts[0].end).toBe(1440); // clamp
  });

  it("ordena de forma determinista por hora de inicio", () => {
    const shifts = buildDayShifts(
      [
        asg({ id: "a-tarde", shiftTemplateId: tarde.id }),
        asg({ id: "a-mañana", shiftTemplateId: mañana.id }),
      ],
      [mañana, tarde],
    );
    expect(shifts.map((s) => s.assignment.id)).toEqual(["a-mañana", "a-tarde"]);
  });
});
