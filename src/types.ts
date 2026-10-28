/*
 * Tipos TS espejo de `src-tauri/src/models.rs` y de la tabla de comandos IPC
 * de `docs/ARCHITECTURE.md` §4. Rust snake_case ↔ TS camelCase (Tauri v2 lo
 * convierte automáticamente).
 */

/** Formato laboral (taxonomía fija, seeded). */
export type WorkFormat = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
};

/** Plantilla de turno (Mañana, Tarde, Noche, Guardia 24h). */
export type ShiftTemplate = {
  id: string;
  workFormatId: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  color: string;
  /** Emoji identificador opcional ("" o ausente = sin emoji). Aditivo. */
  emoji?: string;
  sortOrder: number;
  /**
   * Enriquecimiento de API (espejo de `models.rs`): true si cruza medianoche.
   * Opcional y aditivo; la regla sigue DERIVADA en FE vía `isOvernight` de
   * date.ts — esto no es una segunda fuente de verdad.
   */
  isOvernight?: boolean;
};

/** Payload de creación/actualización de plantilla (sin id). */
export type ShiftTemplateInput = Omit<ShiftTemplate, "id" | "code"> & {
  /** Opcional: si se omite, el backend autogenera `custom-<uuid>`. */
  code?: string;
};

/** Asignación plantilla → día (un VEVENT por fila). */
export type Assignment = {
  id: string;
  uid: string;
  shiftTemplateId: string;
  date: string;
  startTime?: string;
  endTime?: string;
  notes?: string;
};

/** Payload de creación/actualización de asignación (sin id ni uid). */
export type AssignmentInput = {
  shiftTemplateId: string;
  date: string;
  startTime?: string;
  endTime?: string;
  notes?: string;
};

/** Payload de creación de un rango de asignaciones (una fila por día). */
export type RangeAssignmentInput = {
  shiftTemplateId: string;
  startDate: string;
  endDate: string;
};

/** Rango de fechas en hora local 'YYYY-MM-DD'. */
export type CalendarRange = {
  start: string;
  end: string;
};

/** Payload denormalizado de una vista (mes/semana). */
export type CalendarData = {
  assignments: Assignment[];
  templates: ShiftTemplate[];
};

/** Entrada clave-valor de `settings`. */
export type Setting = {
  key: string;
  value: string;
};
