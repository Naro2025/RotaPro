import { describe, expect, it } from "vitest";
import {
  addDays,
  diffDays,
  formatDate,
  isoWeek,
  isOvernight,
  monthGrid,
  monthKey,
  parseDate,
  startOfWeek,
  weekKey,
} from "./date";

describe("startOfWeek", () => {
  it("devuelve el lunes de la semana que contiene la fecha", () => {
    // Lunes se devuelve a sí mismo.
    expect(formatDate(startOfWeek(new Date(2026, 0, 5)))).toBe("2026-01-05");
    // Mitad de semana (jueves) retrocede al lunes.
    expect(formatDate(startOfWeek(new Date(2026, 0, 8)))).toBe("2026-01-05");
    // Domingo retrocede al lunes anterior.
    expect(formatDate(startOfWeek(new Date(2026, 0, 4)))).toBe("2025-12-29");
  });
});

describe("monthGrid", () => {
  it("genera 6 semanas y la primera celda es el lunes anterior al mes", () => {
    const grid = monthGrid(new Date(2026, 10, 1)); // Noviembre 2026
    expect(grid).toHaveLength(6);
    for (const week of grid) {
      expect(week).toHaveLength(7);
    }
    expect(formatDate(grid[0][0])).toBe("2026-10-26");
    expect(formatDate(grid[0][6])).toBe("2026-11-01"); // domingo, cierre semana 1
    expect(formatDate(grid[5][6])).toBe("2026-12-06"); // domingo, cierre semana 6
  });
});

describe("isoWeek", () => {
  it("asigna la semana 1 de 2026 al rango 29-dic-2025 … 4-ene-2026", () => {
    const expected = { year: 2026, week: 1 };
    expect(isoWeek(new Date(2025, 11, 29))).toEqual(expected);
    expect(isoWeek(new Date(2026, 0, 1))).toEqual(expected);
    expect(isoWeek(new Date(2026, 0, 4))).toEqual(expected);
  });

  it("asigna el 28-dic-2025 a la semana 52 de 2025 y el 5-ene-2026 a la semana 2", () => {
    expect(isoWeek(new Date(2025, 11, 28))).toEqual({ year: 2025, week: 52 });
    expect(isoWeek(new Date(2026, 0, 5))).toEqual({ year: 2026, week: 2 });
  });
});

describe("formatDate y claves de caché", () => {
  it("formatea con relleno de ceros en hora local", () => {
    expect(formatDate(new Date(2026, 9, 6))).toBe("2026-10-06");
    expect(formatDate(new Date(2026, 0, 1))).toBe("2026-01-01");
  });

  it("genera claves de mes y semana con formato estable", () => {
    expect(monthKey(2026, 10)).toBe("month:2026-10");
    expect(monthKey(2026, 0)).toBe("month:2026-00");
    expect(weekKey(2026, 1)).toBe("week:2026-W01");
    expect(weekKey(2026, 53)).toBe("week:2026-W53");
  });
});

describe("parseDate", () => {
  it("construye un Date local desde 'YYYY-MM-DD'", () => {
    expect(formatDate(parseDate("2026-11-07"))).toBe("2026-11-07");
    expect(formatDate(parseDate("2026-01-01"))).toBe("2026-01-01");
  });
});

describe("addDays y diffDays", () => {
  it("addDays suma días sin mutar el original y sin hora", () => {
    const base = new Date(2026, 10, 1);
    const next = addDays(base, 6);
    expect(formatDate(next)).toBe("2026-11-07");
    expect(formatDate(base)).toBe("2026-11-01"); // inmutable
  });

  it("diffDays devuelve la distancia en días (b - a)", () => {
    expect(diffDays(parseDate("2026-11-01"), parseDate("2026-11-07"))).toBe(6);
    expect(diffDays(parseDate("2026-11-07"), parseDate("2026-11-01"))).toBe(-6);
    expect(diffDays(parseDate("2026-11-03"), parseDate("2026-11-03"))).toBe(0);
  });

  it("cruza límites de mes y de año", () => {
    expect(diffDays(parseDate("2026-01-30"), parseDate("2026-02-02"))).toBe(3);
    expect(addDays(parseDate("2025-12-30"), 2)).toEqual(parseDate("2026-01-01"));
  });
});

describe("isOvernight", () => {
  it("detecta turnos que cruzan medianoche", () => {
    expect(isOvernight("22:00", "06:00")).toBe(true); // Noche
    expect(isOvernight("20:00", "06:00")).toBe(true); // custom overnight
  });

  it("no marca turnos diurnos ni guardia 24h", () => {
    expect(isOvernight("08:00", "20:00")).toBe(false); // diurno
    expect(isOvernight("00:00", "23:59")).toBe(false); // guardia 24h
  });
});
