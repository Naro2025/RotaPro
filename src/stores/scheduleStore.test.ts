import { describe, expect, it, vi } from "vitest";

// El reducer es lógica pura: no necesita el API de Tauri. El mock evita
// importar `@tauri-apps/api/core` (que no existe en el entorno de Node).
vi.mock("../api", () => ({}));

import { createAssignmentRangeAction, initialState, monthKey, reducer, weekKey } from "./scheduleStore";
import type { ScheduleState } from "./scheduleStore";
import { monthKey as dateMonthKey, weekKey as dateWeekKey } from "../utils/date";
import type { Assignment, CalendarData, ShiftTemplate } from "../types";

const tplA: ShiftTemplate = {
  id: "tpl-a",
  workFormatId: "wf-1",
  code: "M",
  name: "Mañana",
  startTime: "08:00",
  endTime: "16:00",
  color: "#ffffff",
  sortOrder: 1,
};

const tplB: ShiftTemplate = {
  ...tplA,
  id: "tpl-b",
  name: "Tarde",
};

const asgA: Assignment = {
  id: "asg-a",
  uid: "uid-a",
  shiftTemplateId: "tpl-a",
  date: "2026-11-01",
};

const asgB: Assignment = {
  ...asgA,
  id: "asg-b",
  uid: "uid-b",
  shiftTemplateId: "tpl-b",
};

const calData: CalendarData = { assignments: [asgA], templates: [tplA] };

/** Estado con caché poblada para verificar la invalidación en mutaciones. */
function seededState(): ScheduleState {
  return {
    templates: [tplA],
    assignments: [asgA],
    loading: false,
    error: null,
    calendarCache: { "month:2026-11": calData },
    rangeMode: false,
    rangeDialog: null,
  };
}

describe("reducer — loading/error", () => {
  it("inicia carga limpiando el error", () => {
    const state = reducer(
      { ...initialState, error: "previo" },
      { type: "load/start" },
    );
    expect(state.loading).toBe(true);
    expect(state.error).toBeNull();
  });

  it("marca error y desactiva loading", () => {
    const state = reducer(
      { ...initialState, loading: true },
      { type: "load/error", error: "boom" },
    );
    expect(state.loading).toBe(false);
    expect(state.error).toBe("boom");
  });

  it("load/templates y load/assignments cierran la carga", () => {
    const templates = reducer(initialState, {
      type: "load/templates",
      templates: [tplA],
    });
    expect(templates.loading).toBe(false);
    expect(templates.error).toBeNull();
    expect(templates.templates).toEqual([tplA]);

    const assignments = reducer(initialState, {
      type: "load/assignments",
      assignments: [asgA],
    });
    expect(assignments.loading).toBe(false);
    expect(assignments.assignments).toEqual([asgA]);
  });
});

describe("reducer — load/calendar puebla la caché", () => {
  it("almacena por clave sin borrar claves previas", () => {
    const first = reducer(initialState, {
      type: "load/calendar",
      key: "month:2026-11",
      data: calData,
    });
    const second = reducer(first, {
      type: "load/calendar",
      key: "week:2026-W45",
      data: { assignments: [asgB], templates: [tplB] },
    });

    expect(second.calendarCache["month:2026-11"]).toBe(calData);
    expect(second.calendarCache["week:2026-W45"]).toEqual({
      assignments: [asgB],
      templates: [tplB],
    });
    expect(second.templates).toEqual([tplB]);
    expect(second.assignments).toEqual([asgB]);
    expect(second.loading).toBe(false);
    expect(second.error).toBeNull();
  });
});

describe("reducer — acciones CRUD invalidan la caché", () => {
  it("template/created añade y vacía la caché", () => {
    const state = reducer(seededState(), {
      type: "template/created",
      template: tplB,
    });
    expect(state.templates).toEqual([tplA, tplB]);
    expect(state.calendarCache).toEqual({});
  });

  it("template/updated reemplaza por id y vacía la caché", () => {
    const renamed = { ...tplA, name: "Mañana (renombrada)" };
    const state = reducer(seededState(), {
      type: "template/updated",
      template: renamed,
    });
    expect(state.templates).toEqual([renamed]);
    expect(state.calendarCache).toEqual({});
  });

  it("template/deleted filtra por id y vacía la caché", () => {
    const state = reducer(seededState(), {
      type: "template/deleted",
      id: "tpl-a",
    });
    expect(state.templates).toEqual([]);
    expect(state.calendarCache).toEqual({});
  });

  it("assignment/created añade y vacía la caché", () => {
    const state = reducer(seededState(), {
      type: "assignment/created",
      assignment: asgB,
    });
    expect(state.assignments).toEqual([asgA, asgB]);
    expect(state.calendarCache).toEqual({});
  });

  it("assignment/updated reemplaza por id y vacía la caché", () => {
    const moved = { ...asgA, date: "2026-11-02" };
    const state = reducer(seededState(), {
      type: "assignment/updated",
      assignment: moved,
    });
    expect(state.assignments).toEqual([moved]);
    expect(state.calendarCache).toEqual({});
  });

  it("assignment/deleted filtra por id y vacía la caché", () => {
    const state = reducer(seededState(), {
      type: "assignment/deleted",
      id: "asg-a",
    });
    expect(state.assignments).toEqual([]);
    expect(state.calendarCache).toEqual({});
  });
});

describe("reducer — rango de días", () => {
  it("range/toggled alterna rangeMode", () => {
    expect(reducer(initialState, { type: "range/toggled" }).rangeMode).toBe(true);
    const on = { ...initialState, rangeMode: true };
    expect(reducer(on, { type: "range/toggled" }).rangeMode).toBe(false);
  });

  it("range/dialog-opened y range/dialog-closed gestionan el diálogo", () => {
    const dialog = { mode: "new" as const, templateId: "tpl-a", date: "2026-11-01" };
    const opened = reducer(initialState, { type: "range/dialog-opened", dialog });
    expect(opened.rangeDialog).toEqual(dialog);

    const closed = reducer(opened, { type: "range/dialog-closed" });
    expect(closed.rangeDialog).toBeNull();
  });

  it("assignments/created hace merge sin duplicar por id y vacía la caché", () => {
    // `asgA` ya existe en `seededState`; solo debe añadirse `asgB`.
    const state = reducer(seededState(), {
      type: "assignments/created",
      assignments: [asgB, asgA],
    });
    expect(state.assignments).toEqual([asgA, asgB]);
    expect(state.calendarCache).toEqual({});
  });
});

describe("createAssignmentRange action", () => {
  const input = {
    shiftTemplateId: "tpl-b",
    startDate: "2026-11-01",
    endDate: "2026-11-07",
  };

  it("llama a la api y dispara assignments/created con las filas devueltas", async () => {
    const invokeRange = vi.fn().mockResolvedValue([asgB]);
    const dispatch = vi.fn();

    const result = await createAssignmentRangeAction(invokeRange, dispatch, input);

    expect(invokeRange).toHaveBeenCalledWith(input);
    expect(dispatch).toHaveBeenCalledWith({
      type: "assignments/created",
      assignments: [asgB],
    });
    expect(result).toEqual([asgB]);
  });

  it("dispara load/error y devuelve undefined si la api falla", async () => {
    const invokeRange = vi.fn().mockRejectedValue(new Error("boom"));
    const dispatch = vi.fn();

    const result = await createAssignmentRangeAction(invokeRange, dispatch, input);

    expect(dispatch).toHaveBeenCalledWith({ type: "load/error", error: "boom" });
    expect(result).toBeUndefined();
  });
});

describe("claves de caché consistentes con utils/date", () => {
  it("monthKey coincide con date.monthKey", () => {
    expect(monthKey(2026, 10)).toBe(dateMonthKey(2026, 10));
    expect(monthKey(2026, 0)).toBe(dateMonthKey(2026, 0));
  });

  it("weekKey coincide con date.weekKey", () => {
    expect(weekKey(2026, 1)).toBe(dateWeekKey(2026, 1));
    expect(weekKey(2026, 53)).toBe(dateWeekKey(2026, 53));
  });
});
