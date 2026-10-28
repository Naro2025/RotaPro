import { describe, expect, it } from "vitest";
import {
  daySegments,
  trackSegments,
  visibleSegments,
} from "./timegrid";
import { buildDayShifts } from "./overlap";
import { addDays, formatDate, parseDate, weekDays } from "./date";
import type { Assignment, ShiftTemplate } from "../types";

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

const noche: ShiftTemplate = {
  id: "tpl-n",
  workFormatId: "wf-1",
  code: "N",
  name: "Noche",
  startTime: "22:00",
  endTime: "06:00",
  color: "#000000",
  sortOrder: 2,
};

const asg = (
  id: string,
  shiftTemplateId: string,
  date: string,
  extra?: Partial<Assignment>,
): Assignment => ({
  id,
  uid: `uid-${id}`,
  shiftTemplateId,
  date,
  ...extra,
});

describe("daySegments", () => {
  it("normal: un único segmento sin split", () => {
    const segs = daySegments(
      [asg("a1", mañana.id, "2026-11-02")],
      [mañana],
      parseDate("2026-11-02"),
    );
    expect(segs).toHaveLength(1);
    expect(segs[0].start).toBe(360); // 06:00
    expect(segs[0].end).toBe(840); // 14:00
    expect(segs[0].overnight).toBe(false);
    expect(segs[0].isContinuation).toBe(false);
  });

  it("overnight: cola en su día + continuación en el día siguiente", () => {
    const date = parseDate("2026-11-02");
    const assignments = [asg("a1", noche.id, "2026-11-02")];

    const tail = daySegments(assignments, [noche], date);
    expect(tail).toHaveLength(1);
    expect(tail[0].isContinuation).toBe(false);
    expect(tail[0].start).toBe(1320); // 22:00
    expect(tail[0].end).toBe(1440); // 24:00 (clamp)
    expect(tail[0].overnight).toBe(true);

    const cont = daySegments(assignments, [noche], addDays(date, 1));
    expect(cont).toHaveLength(1);
    expect(cont[0].isContinuation).toBe(true);
    expect(cont[0].start).toBe(0);
    expect(cont[0].end).toBe(360); // 06:00
    expect(cont[0].date).toBe(formatDate(addDays(date, 1)));
    expect(cont[0].startTime).toBe("00:00");
    expect(cont[0].endTime).toBe("06:00");
  });

  it("overnight 22:00–00:00 no genera continuación (no invade el día siguiente)", () => {
    const hastaMedianoche: ShiftTemplate = {
      ...noche,
      endTime: "00:00",
    };
    const date = parseDate("2026-11-02");
    const assignments = [asg("a1", hastaMedianoche.id, "2026-11-02")];

    const tail = daySegments(assignments, [hastaMedianoche], date);
    expect(tail).toHaveLength(1);
    expect(tail[0].end).toBe(1440);

    const cont = daySegments(assignments, [hastaMedianoche], addDays(date, 1));
    expect(cont).toEqual([]);
  });

  it("aplica los tiempos efectivos (override de la asignación gana)", () => {
    const segs = daySegments(
      [asg("a1", mañana.id, "2026-11-02", { startTime: "05:00", endTime: "09:00" })],
      [mañana],
      parseDate("2026-11-02"),
    );
    expect(segs).toHaveLength(1);
    expect(segs[0].start).toBe(300);
    expect(segs[0].end).toBe(540);
    expect(segs[0].startTime).toBe("05:00");
    expect(segs[0].endTime).toBe("09:00");
  });

  it("packing por día: dos turnos solapados side-by-side", () => {
    const temprano: ShiftTemplate = {
      ...mañana,
      id: "tpl-e",
      startTime: "08:00",
      endTime: "16:00",
    };
    const medio: ShiftTemplate = {
      ...mañana,
      id: "tpl-d",
      startTime: "10:00",
      endTime: "12:00",
    };
    const segs = daySegments(
      [
        asg("a1", temprano.id, "2026-11-02"),
        asg("a2", medio.id, "2026-11-02"),
      ],
      [temprano, medio],
      parseDate("2026-11-02"),
    );
    expect(segs).toHaveLength(2);
    expect(segs.every((s) => s.columns === 2)).toBe(true);
    const cols = new Set(segs.map((s) => s.column));
    expect(cols).toEqual(new Set([0, 1]));
  });

  it("la continuación se empaqueta junto a los turnos del propio día", () => {
    const madrugada: ShiftTemplate = {
      ...mañana,
      id: "tpl-mad",
      startTime: "04:00",
      endTime: "08:00",
    };
    // Noche 22:00–06:00 del día anterior → continuación 00:00–06:00 el día X.
    // Madrugada 04:00–08:00 el día X → solapa con la continuación → 2 columnas.
    const dayX = parseDate("2026-11-03");
    const segs = daySegments(
      [
        asg("noche", noche.id, formatDate(addDays(dayX, -1))),
        asg("mad", madrugada.id, formatDate(dayX)),
      ],
      [noche, madrugada],
      dayX,
    );
    expect(segs).toHaveLength(2);
    expect(segs.every((s) => s.columns === 2)).toBe(true);
    const cont = segs.find((s) => s.isContinuation);
    expect(cont).toBeDefined();
    expect(cont!.start).toBe(0);
    expect(cont!.end).toBe(360);
  });

  it("descarta asignaciones sin plantilla resuelta", () => {
    const segs = daySegments(
      [asg("a1", "inexistente", "2026-11-02")],
      [mañana],
      parseDate("2026-11-02"),
    );
    expect(segs).toEqual([]);
  });
});

describe("visibleSegments", () => {
  it("omite la continuación cuyo día siguiente no está en la semana visible", () => {
    // Semana lunes 2026-11-02 → domingo 2026-11-08.
    const days = weekDays(parseDate("2026-11-02"));
    const sunday = days[6]; // 2026-11-08
    const nextMonday = addDays(sunday, 1); // 2026-11-09, fuera de la semana.

    // La continuación del overnight del domingo cae en el lunes siguiente.
    const cont = daySegments(
      [asg("a1", noche.id, formatDate(sunday))],
      [noche],
      nextMonday,
    );
    expect(cont).toHaveLength(1);
    expect(cont[0].isContinuation).toBe(true);

    expect(visibleSegments(days, cont)).toEqual([]);

    // Mientras que la cola del domingo sí es visible.
    const tail = daySegments(
      [asg("a1", noche.id, formatDate(sunday))],
      [noche],
      sunday,
    );
    expect(visibleSegments(days, tail)).toHaveLength(1);
  });
});

describe("trackSegments", () => {
  it("posiciona 06:00–14:00 en left 25% y ancho ~33.33%", () => {
    const shifts = buildDayShifts(
      [asg("a1", mañana.id, "2026-11-02")],
      [mañana],
    );
    const track = trackSegments(shifts);
    expect(track).toHaveLength(1);
    expect(track[0].leftPct).toBeCloseTo(25, 5); // 360/1440
    expect(track[0].widthPct).toBeCloseTo(100 / 3, 5); // 480/1440
  });

  it("un shift de día completo cubre el 100% de la pista", () => {
    const completo: ShiftTemplate = {
      ...mañana,
      id: "tpl-c",
      startTime: "00:00",
      endTime: "23:59",
    };
    const shifts = buildDayShifts(
      [asg("a1", completo.id, "2026-11-02")],
      [completo],
    );
    expect(trackSegments(shifts)[0]).toEqual({ leftPct: 0, widthPct: (1439 / 1440) * 100 });
  });

  it("el overnight clampado no desborda la pista (fin = 100%)", () => {
    const shifts = buildDayShifts(
      [asg("a1", noche.id, "2026-11-02")],
      [noche],
    );
    const track = trackSegments(shifts);
    expect(track[0].leftPct).toBeCloseTo((1320 / 1440) * 100, 5);
    expect(track[0].widthPct).toBeCloseTo(((1440 - 1320) / 1440) * 100, 5);
  });
});
