import { describe, expect, it } from "vitest";
import { resolveTemplate } from "./DayCell";
import { contrastText } from "../utils/color";
import type { Assignment, ShiftTemplate } from "../types";

describe("contrastText", () => {
  it("usa texto oscuro sobre fondos claros", () => {
    expect(contrastText("#ffffff")).toBe("#0f172a");
    // Amarillo puro: luminancia alta → texto oscuro.
    expect(contrastText("#ffff00")).toBe("#0f172a");
  });

  it("usa texto blanco sobre fondos oscuros", () => {
    expect(contrastText("#000000")).toBe("#ffffff");
    // Rojo puro: luminancia baja → texto blanco.
    expect(contrastText("#ff0000")).toBe("#ffffff");
  });

  it("expande notación hexadecimal corta (#rgb)", () => {
    expect(contrastText("#fff")).toBe("#0f172a");
    expect(contrastText("#000")).toBe("#ffffff");
  });

  it("devuelve texto oscuro por defecto ante color inválido", () => {
    expect(contrastText("not-a-color")).toBe("#0f172a");
    expect(contrastText("#12345")).toBe("#0f172a");
  });
});

describe("resolveTemplate", () => {
  const templates: ShiftTemplate[] = [
    {
      id: "tpl-a",
      workFormatId: "wf-1",
      code: "M",
      name: "Mañana",
      startTime: "08:00",
      endTime: "16:00",
      color: "#ffffff",
      sortOrder: 1,
    },
    {
      id: "tpl-b",
      workFormatId: "wf-1",
      code: "T",
      name: "Tarde",
      startTime: "16:00",
      endTime: "00:00",
      color: "#000000",
      sortOrder: 2,
    },
  ];

  it("devuelve la plantilla por shiftTemplateId", () => {
    const assignment: Assignment = {
      id: "asg-1",
      uid: "uid-1",
      shiftTemplateId: "tpl-b",
      date: "2026-11-01",
    };
    expect(resolveTemplate(assignment, templates)).toBe(templates[1]);
  });

  it("devuelve undefined si no hay plantilla coincidente", () => {
    const assignment: Assignment = {
      id: "asg-1",
      uid: "uid-1",
      shiftTemplateId: "inexistente",
      date: "2026-11-01",
    };
    expect(resolveTemplate(assignment, templates)).toBeUndefined();
  });
});
