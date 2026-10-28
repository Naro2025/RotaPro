/*
 * Celda reutilizable de día: número + chips de asignaciones coloreados.
 * Chunk ⑤ la convirtió en drop-target del planner (drag&drop HTML5 nativo).
 */
import { memo, useMemo } from "react";
import { useSchedule } from "../stores/scheduleStore";
import { motion } from "motion/react";
import type { Assignment, ShiftTemplate } from "../types";
import { contrastText } from "../utils/color";
import { isOvernight } from "../utils/date";
import { buildDayShifts, type DayShift } from "../utils/overlap";
import { trackSegments } from "../utils/timegrid";
import { useDayDrop } from "../hooks/useDayDrop";

/** Resuelve la plantilla de una asignación (por `shiftTemplateId`). */
export function resolveTemplate(
  assignment: Assignment,
  templates: ShiftTemplate[],
): ShiftTemplate | undefined {
  return templates.find((t) => t.id === assignment.shiftTemplateId);
}

interface AssignmentChipProps {
  assignment: Assignment;
  template: ShiftTemplate;
  onSelect?: (assignment: Assignment) => void;
  onDelete?: (assignment: Assignment) => void;
}

/** Chip de asignación: fondo = `template.color`, texto con contraste. */
export function AssignmentChip({
  assignment,
  template,
  onSelect,
  onDelete,
}: AssignmentChipProps) {
  const fg = contrastText(template.color);
  return (
    <motion.div
      className="group relative w-full"
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
    >
      <button
        type="button"
        title={`${template.name} · ${template.startTime}–${template.endTime}`}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.(assignment);
        }}
        className={
          "w-full truncate rounded px-[calc(0.25rem*var(--density))] py-[calc(0.125rem*var(--density))] text-left text-xs leading-tight " +
          "transition-shadow duration-150 group-hover:shadow-md " +
          (onDelete ? "pr-[calc(1rem*var(--density))]" : "")
        }
        style={{
          backgroundColor: template.color,
          color: fg,
        }}
      >
        {template.emoji ? `${template.emoji} ${template.name}` : template.name}
        {isOvernight(template.startTime, template.endTime) && (
          <span
            title={`Termina al día siguiente a las ${template.endTime}`}
            className="opacity-90"
          >
            {" "}🌙{template.endTime}+1
          </span>
        )}
      </button>
      {onDelete && (
        <button
          type="button"
          aria-label={`Eliminar ${template.name}`}
          title={`Eliminar ${template.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(assignment);
          }}
          className="absolute right-[calc(0.25rem*var(--density))] top-1/2 hidden -translate-y-1/2 rounded px-0.5 text-xs leading-none opacity-70 hover:opacity-100 group-hover:block"
          style={{ color: fg }}
        >
          ×
        </button>
      )}
    </motion.div>
  );
}

interface DayCellProps {
  date: Date;
  assignments: Assignment[];
  templates: ShiftTemplate[];
  /** `false` atenúa los días fuera del mes visible. */
  isCurrentMonth?: boolean;
  isToday?: boolean;
}

export const DayCell = memo(function DayCell({
  date,
  assignments,
  templates,
  isCurrentMonth = true,
  isToday = false,
}: DayCellProps) {
  const { actions } = useSchedule();
  const { isDragOver, onDragOver, onDragLeave, onDrop } = useDayDrop(date);

  // Memoiza el cómputo por día (resolución de plantillas + packing de solapes).
  // Con ~10 turnos/día es barato, pero DayCell se re-renderiza ante cualquier
  // cambio del store (contexto) y conviene no re-empaquetar si las entradas no
  // cambiaron de referencia.
  const shifts = useMemo(
    () => buildDayShifts(assignments, templates),
    [assignments, templates],
  );
  const clusters = useMemo(() => {
    const c: DayShift[][] = [];
    for (const shift of shifts) {
      (c[shift.cluster] ??= []).push(shift);
    }
    return c;
  }, [shifts]);

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={
        "flex min-h-0 flex-col gap-1 overflow-hidden border-b border-r border-border p-[var(--cell-padding)] " +
        (isCurrentMonth ? "" : "opacity-40") +
        (isDragOver ? " ring-2 ring-inset ring-[var(--accent)]" : "")
      }
    >
      <span
        className={
          "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-sm " +
          (isToday ? "bg-accent font-semibold text-white" : "text-muted")
        }
      >
        {date.getDate()}
      </span>
      <div className="flex min-h-0 flex-col gap-1 overflow-hidden">
        {clusters.map((cluster) => {
          const columns = cluster[0].columns;
          const byColumn = new Map<number, DayShift>();
          for (const s of cluster) byColumn.set(s.column, s);
          return (
            <div key={cluster[0].cluster} className="flex gap-1">
              {Array.from({ length: columns }, (_, col) => {
                const s = byColumn.get(col);
                return (
                  <div key={col} className="min-w-0 flex-1">
                    {s && (
                      <AssignmentChip
                        assignment={s.assignment}
                        template={s.template}
                        onSelect={() =>
                          actions.openRangeDialog({
                            mode: "stretch",
                            templateId: s.assignment.shiftTemplateId,
                            date: s.assignment.date,
                          })
                        }
                        onDelete={(a) => void actions.deleteAssignment(a.id)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {shifts.length > 0 && (
        <div className="mt-auto shrink-0">
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-[var(--border)]">
            {trackSegments(shifts).map((seg, i) => {
              const s = shifts[i];
              const startTime = s.assignment.startTime ?? s.template.startTime;
              const endTime = s.assignment.endTime ?? s.template.endTime;
              return (
                <div
                  key={s.assignment.id}
                  title={`${s.template.name} · ${startTime}–${endTime}`}
                  className="absolute top-0 h-full"
                  style={{
                    left: `${seg.leftPct}%`,
                    width: `${seg.widthPct}%`,
                    backgroundColor: s.template.color,
                  }}
                />
              );
            })}
            {/* Divisoria sutil AM | PM a mediodía. */}
            <div
              className="absolute top-0 h-full w-px"
              style={{ left: "50%", backgroundColor: "var(--fg-muted)", opacity: 0.4 }}
            />
          </div>
        </div>
      )}
    </div>
  );
});
