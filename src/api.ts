/*
 * Wrappers tipados de `invoke` para los 15 comandos IPC definidos en
 * `docs/ARCHITECTURE.md` §4. Nombres de comando en snake_case; payloads en
 * camelCase según la tabla del doc.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  Assignment,
  AssignmentInput,
  CalendarData,
  CalendarRange,
  RangeAssignmentInput,
  Setting,
  ShiftTemplate,
  ShiftTemplateInput,
  WorkFormat,
} from "./types";

// ── work_formats ───────────────────────────────────────────────────────────

export function listWorkFormats(): Promise<WorkFormat[]> {
  return invoke<WorkFormat[]>("list_work_formats");
}

// ── shift_templates ────────────────────────────────────────────────────────

export function listShiftTemplates(): Promise<ShiftTemplate[]> {
  return invoke<ShiftTemplate[]>("list_shift_templates");
}

export function createShiftTemplate(
  input: ShiftTemplateInput,
): Promise<ShiftTemplate> {
  return invoke<ShiftTemplate>("create_shift_template", { input });
}

export function updateShiftTemplate(
  id: string,
  input: ShiftTemplateInput,
): Promise<ShiftTemplate> {
  return invoke<ShiftTemplate>("update_shift_template", { id, input });
}

export function deleteShiftTemplate(id: string): Promise<void> {
  return invoke<void>("delete_shift_template", { id });
}

// ── assignments ────────────────────────────────────────────────────────────

export function listAssignments(
  range: CalendarRange,
): Promise<Assignment[]> {
  return invoke<Assignment[]>("list_assignments", { range });
}

export function createAssignment(
  input: AssignmentInput,
): Promise<Assignment> {
  return invoke<Assignment>("create_assignment", { input });
}

export function createAssignmentsRange(
  input: RangeAssignmentInput,
): Promise<Assignment[]> {
  return invoke<Assignment[]>("create_assignments_range", { input });
}

export function updateAssignment(
  id: string,
  input: AssignmentInput,
): Promise<Assignment> {
  return invoke<Assignment>("update_assignment", { id, input });
}

export function deleteAssignment(id: string): Promise<void> {
  return invoke<void>("delete_assignment", { id });
}

// ── settings ───────────────────────────────────────────────────────────────

export function getSettings(): Promise<Setting[]> {
  return invoke<Setting[]>("get_settings");
}

export function setSetting(key: string, value: string): Promise<void> {
  return invoke<void>("set_setting", { key, value });
}

// ── calendar ───────────────────────────────────────────────────────────────

export function getCalendarMonth(
  year: number,
  month: number,
): Promise<CalendarData> {
  return invoke<CalendarData>("get_calendar_month", { year, month });
}

export function getCalendarWeek(
  year: number,
  week: number,
): Promise<CalendarData> {
  return invoke<CalendarData>("get_calendar_week", { year, week });
}

// ── exportación iCalendar ──────────────────────────────────────────────────

export function exportCalendarIcs(path: string): Promise<void> {
  return invoke<void>("export_calendar_ics", { path });
}
