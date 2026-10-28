/*
 * Store ligero de planificación (sin dependencias nuevas): estado global de
 * plantillas/asignaciones, caché de datos por rango (mes/semana) y acciones
 * CRUD que llaman a `api.ts`. Pensado para el futuro `CalendarView`.
 *
 * El caché se invalida ante cualquier mutación; la vista re-invoca
 * `get_calendar_*` solo al mutar o al cambiar de rango (doc §5).
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import * as api from "../api";
import type {
  Assignment,
  AssignmentInput,
  CalendarData,
  CalendarRange,
  RangeAssignmentInput,
  ShiftTemplate,
  ShiftTemplateInput,
} from "../types";

// ── Claves de caché de rango ───────────────────────────────────────────────

export function monthKey(year: number, month: number): string {
  return `month:${year}-${String(month).padStart(2, "0")}`;
}

export function weekKey(year: number, week: number): string {
  return `week:${year}-W${String(week).padStart(2, "0")}`;
}

// ── Estado y reducer ───────────────────────────────────────────────────────

/** Diálogo de rango ("estirar" un turno a un rango de días). */
export interface RangeDialog {
  mode: "new" | "stretch";
  templateId: string;
  /** Fecha base: día del drop (new) o fecha del assignment clicado (stretch). */
  date: string;
}

export interface ScheduleState {
  templates: ShiftTemplate[];
  assignments: Assignment[];
  loading: boolean;
  error: string | null;
  calendarCache: Record<string, CalendarData>;
  /** Toggle "Rango de días" de la barra del Planner. */
  rangeMode: boolean;
  /** Diálogo de rango abierto (null = cerrado). */
  rangeDialog: RangeDialog | null;
}

export type ScheduleAction =
  | { type: "load/start" }
  | { type: "load/templates"; templates: ShiftTemplate[] }
  | { type: "load/assignments"; assignments: Assignment[] }
  | { type: "load/calendar"; key: string; data: CalendarData }
  | { type: "load/error"; error: string }
  | { type: "template/created"; template: ShiftTemplate }
  | { type: "template/updated"; template: ShiftTemplate }
  | { type: "template/deleted"; id: string }
  | { type: "assignment/created"; assignment: Assignment }
  | { type: "assignments/created"; assignments: Assignment[] }
  | { type: "assignment/updated"; assignment: Assignment }
  | { type: "assignment/deleted"; id: string }
  | { type: "range/toggled" }
  | { type: "range/dialog-opened"; dialog: RangeDialog }
  | { type: "range/dialog-closed" };

export const initialState: ScheduleState = {
  templates: [],
  assignments: [],
  loading: false,
  error: null,
  calendarCache: {},
  rangeMode: false,
  rangeDialog: null,
};

export function reducer(state: ScheduleState, action: ScheduleAction): ScheduleState {
  switch (action.type) {
    case "load/start":
      return { ...state, loading: true, error: null };
    case "load/templates":
      return { ...state, loading: false, error: null, templates: action.templates };
    case "load/assignments":
      return { ...state, loading: false, error: null, assignments: action.assignments };
    case "load/calendar":
      return {
        ...state,
        loading: false,
        error: null,
        templates: action.data.templates,
        assignments: action.data.assignments,
        calendarCache: { ...state.calendarCache, [action.key]: action.data },
      };
    case "load/error":
      return { ...state, loading: false, error: action.error };
    case "template/created":
      return {
        ...state,
        templates: [...state.templates, action.template],
        calendarCache: {},
      };
    case "template/updated":
      return {
        ...state,
        templates: state.templates.map((t) =>
          t.id === action.template.id ? action.template : t,
        ),
        calendarCache: {},
      };
    case "template/deleted":
      return {
        ...state,
        templates: state.templates.filter((t) => t.id !== action.id),
        calendarCache: {},
      };
    case "assignment/created":
      return {
        ...state,
        assignments: [...state.assignments, action.assignment],
        calendarCache: {},
      };
    case "assignments/created": {
      const seen = new Set(state.assignments.map((a) => a.id));
      const fresh = action.assignments.filter((a) => !seen.has(a.id));
      return {
        ...state,
        assignments: [...state.assignments, ...fresh],
        calendarCache: {},
      };
    }
    case "assignment/updated":
      return {
        ...state,
        assignments: state.assignments.map((a) =>
          a.id === action.assignment.id ? action.assignment : a,
        ),
        calendarCache: {},
      };
    case "assignment/deleted":
      return {
        ...state,
        assignments: state.assignments.filter((a) => a.id !== action.id),
        calendarCache: {},
      };
    case "range/toggled":
      return { ...state, rangeMode: !state.rangeMode };
    case "range/dialog-opened":
      return { ...state, rangeDialog: action.dialog };
    case "range/dialog-closed":
      return { ...state, rangeDialog: null };
  }
}

// ── Acciones expuestas ─────────────────────────────────────────────────────

/**
 * Acción async de creación de rango, exportada para testearla con un mock de
 * `api`. Dispara `assignments/created` (merge) o `load/error` según el caso.
 */
export async function createAssignmentRangeAction(
  invokeRange: (input: RangeAssignmentInput) => Promise<Assignment[]>,
  dispatch: (action: ScheduleAction) => void,
  input: RangeAssignmentInput,
): Promise<Assignment[] | undefined> {
  try {
    const assignments = await invokeRange(input);
    dispatch({ type: "assignments/created", assignments });
    return assignments;
  } catch (err) {
    dispatch({ type: "load/error", error: messageOf(err) });
    return undefined;
  }
}

export interface ScheduleActions {
  loadTemplates: () => Promise<void>;
  loadAssignments: (range: CalendarRange) => Promise<void>;
  loadCalendarMonth: (year: number, month: number) => Promise<void>;
  loadCalendarWeek: (year: number, week: number) => Promise<void>;
  createTemplate: (input: ShiftTemplateInput) => Promise<ShiftTemplate | undefined>;
  updateTemplate: (
    id: string,
    input: ShiftTemplateInput,
  ) => Promise<ShiftTemplate | undefined>;
  deleteTemplate: (id: string) => Promise<void>;
  createAssignment: (input: AssignmentInput) => Promise<Assignment | undefined>;
  createAssignmentRange: (
    input: RangeAssignmentInput,
  ) => Promise<Assignment[] | undefined>;
  updateAssignment: (
    id: string,
    input: AssignmentInput,
  ) => Promise<Assignment | undefined>;
  deleteAssignment: (id: string) => Promise<void>;
  toggleRangeMode: () => void;
  openRangeDialog: (dialog: RangeDialog) => void;
  closeRangeDialog: () => void;
  getCached: (key: string) => CalendarData | undefined;
}

export interface ScheduleContextValue {
  state: ScheduleState;
  actions: ScheduleActions;
}

const ScheduleContext = createContext<ScheduleContextValue | null>(null);

export function ScheduleProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const loadTemplates = useCallback(async () => {
    dispatch({ type: "load/start" });
    try {
      const templates = await api.listShiftTemplates();
      dispatch({ type: "load/templates", templates });
    } catch (err) {
      dispatch({ type: "load/error", error: messageOf(err) });
    }
  }, []);

  const loadAssignments = useCallback(async (range: CalendarRange) => {
    dispatch({ type: "load/start" });
    try {
      const assignments = await api.listAssignments(range);
      dispatch({ type: "load/assignments", assignments });
    } catch (err) {
      dispatch({ type: "load/error", error: messageOf(err) });
    }
  }, []);

  const loadCalendarMonth = useCallback(async (year: number, month: number) => {
    dispatch({ type: "load/start" });
    try {
      const data = await api.getCalendarMonth(year, month);
      dispatch({ type: "load/calendar", key: monthKey(year, month), data });
    } catch (err) {
      dispatch({ type: "load/error", error: messageOf(err) });
    }
  }, []);

  const loadCalendarWeek = useCallback(async (year: number, week: number) => {
    dispatch({ type: "load/start" });
    try {
      const data = await api.getCalendarWeek(year, week);
      dispatch({ type: "load/calendar", key: weekKey(year, week), data });
    } catch (err) {
      dispatch({ type: "load/error", error: messageOf(err) });
    }
  }, []);

  const createTemplate = useCallback(async (input: ShiftTemplateInput) => {
    try {
      const template = await api.createShiftTemplate(input);
      dispatch({ type: "template/created", template });
      return template;
    } catch (err) {
      dispatch({ type: "load/error", error: messageOf(err) });
      return undefined;
    }
  }, []);

  const updateTemplate = useCallback(
    async (id: string, input: ShiftTemplateInput) => {
      try {
        const template = await api.updateShiftTemplate(id, input);
        dispatch({ type: "template/updated", template });
        return template;
      } catch (err) {
        dispatch({ type: "load/error", error: messageOf(err) });
        return undefined;
      }
    },
    [],
  );

  const deleteTemplate = useCallback(async (id: string) => {
    try {
      await api.deleteShiftTemplate(id);
      dispatch({ type: "template/deleted", id });
    } catch (err) {
      dispatch({ type: "load/error", error: messageOf(err) });
    }
  }, []);

  const createAssignment = useCallback(async (input: AssignmentInput) => {
    try {
      const assignment = await api.createAssignment(input);
      dispatch({ type: "assignment/created", assignment });
      return assignment;
    } catch (err) {
      dispatch({ type: "load/error", error: messageOf(err) });
      return undefined;
    }
  }, []);

  const createAssignmentRange = useCallback(
    (input: RangeAssignmentInput) =>
      createAssignmentRangeAction(api.createAssignmentsRange, dispatch, input),
    [],
  );

  const toggleRangeMode = useCallback(() => dispatch({ type: "range/toggled" }), []);

  const openRangeDialog = useCallback(
    (dialog: RangeDialog) => dispatch({ type: "range/dialog-opened", dialog }),
    [],
  );

  const closeRangeDialog = useCallback(
    () => dispatch({ type: "range/dialog-closed" }),
    [],
  );

  const updateAssignment = useCallback(
    async (id: string, input: AssignmentInput) => {
      try {
        const assignment = await api.updateAssignment(id, input);
        dispatch({ type: "assignment/updated", assignment });
        return assignment;
      } catch (err) {
        dispatch({ type: "load/error", error: messageOf(err) });
        return undefined;
      }
    },
    [],
  );

  const deleteAssignment = useCallback(async (id: string) => {
    try {
      await api.deleteAssignment(id);
      dispatch({ type: "assignment/deleted", id });
    } catch (err) {
      dispatch({ type: "load/error", error: messageOf(err) });
    }
  }, []);

  const getCached = useCallback(
    (key: string) => state.calendarCache[key],
    [state.calendarCache],
  );

  const actions = useMemo<ScheduleActions>(
    () => ({
      loadTemplates,
      loadAssignments,
      loadCalendarMonth,
      loadCalendarWeek,
      createTemplate,
      updateTemplate,
      deleteTemplate,
      createAssignment,
      createAssignmentRange,
      updateAssignment,
      deleteAssignment,
      toggleRangeMode,
      openRangeDialog,
      closeRangeDialog,
      getCached,
    }),
    [
      loadTemplates,
      loadAssignments,
      loadCalendarMonth,
      loadCalendarWeek,
      createTemplate,
      updateTemplate,
      deleteTemplate,
      createAssignment,
      createAssignmentRange,
      updateAssignment,
      deleteAssignment,
      toggleRangeMode,
      openRangeDialog,
      closeRangeDialog,
      getCached,
    ],
  );

  const value = useMemo<ScheduleContextValue>(
    () => ({ state, actions }),
    [state, actions],
  );

  return createElement(ScheduleContext.Provider, { value }, children);
}

export function useSchedule(): ScheduleContextValue {
  const ctx = useContext(ScheduleContext);
  if (!ctx) {
    throw new Error("useSchedule debe usarse dentro de <ScheduleProvider>");
  }
  return ctx;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
