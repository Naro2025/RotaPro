import { memo, useCallback, useMemo } from "react";
import { motion } from "motion/react";
import { useSchedule } from "../stores/scheduleStore";
import type { Assignment, CalendarData } from "../types";
import { formatDate, weekDays } from "../utils/date";
import { useDayDrop } from "../hooks/useDayDrop";
import { daySegments, type DaySegment } from "../utils/timegrid";
import { contrastText } from "../utils/color";

// Índice 0..6 con lunes = 0 (coincide con `weekDays`).
const DAY_NAMES = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

/** Horas del eje (00:00–23:00): 24 filas de `--hour-h`. */
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const MIN_CLICKABLE_PCT = 2.5; // altura mínima para que un bloque sea clicable.

interface WeekViewProps {
  date: Date;
  data?: CalendarData;
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

interface TimeBlockProps {
  segment: DaySegment;
  onSelect: (assignment: Assignment) => void;
  onDelete: (assignment: Assignment) => void;
}

/** Bloque absoluto de un turno: posición/altura en % (independiente del píxel).
 *  `memo`: hoja pura (sin hooks/contexto) — salta re-render si `segment` y los
 *  handlers (`useCallback` en `DayColumn`) conservan referencia. */
const TimeBlock = memo(function TimeBlock({ segment, onSelect, onDelete }: TimeBlockProps) {
  const fg = contrastText(segment.template.color);
  const top = (segment.start / 1440) * 100;
  const height = Math.max(((segment.end - segment.start) / 1440) * 100, MIN_CLICKABLE_PCT);
  const left = (segment.column / segment.columns) * 100;
  const width = 100 / segment.columns;

  const timeLabel = segment.isContinuation
    ? `🌙 ${segment.startTime}–${segment.endTime}`
    : segment.overnight
      ? `${segment.startTime}–${segment.endTime} 🌙${segment.endTime}+1`
      : `${segment.startTime}–${segment.endTime}`;

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className={
        "group absolute overflow-hidden rounded-sm border p-px " +
        "transition-shadow duration-150 hover:shadow-md " +
        (segment.isContinuation
          ? "border-dashed border-white/40 opacity-75"
          : "border-white/20")
      }
      style={{
        top: `${top}%`,
        height: `${height}%`,
        left: `${left}%`,
        width: `${width}%`,
        backgroundColor: segment.template.color,
        color: fg,
      }}
    >
      <button
        type="button"
        title={`${segment.template.name} · ${timeLabel}`}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(segment.assignment);
        }}
        className="block h-full w-full truncate text-left text-[10px] leading-tight"
      >
        {segment.template.emoji
          ? `${segment.template.emoji} ${segment.template.name}`
          : segment.template.name}
        <span className="opacity-80"> {timeLabel}</span>
      </button>
      <button
        type="button"
        aria-label={`Eliminar ${segment.template.name}`}
        title={`Eliminar ${segment.template.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete(segment.assignment);
        }}
        className="absolute right-0.5 top-0.5 hidden rounded px-0.5 text-xs leading-none opacity-70 hover:opacity-100 group-hover:block"
        style={{ color: fg }}
      >
        ×
      </button>
    </motion.div>
  );
});

interface DayColumnProps {
  date: Date;
  isToday: boolean;
  assignments: Assignment[];
  templates: CalendarData["templates"];
}

/** Columna de un día del TimeGrid: 24 h de alto, drop-target + bloques.
 *  `memo`: los props (`date`/`assignments`/`templates`) son estables vía
 *  `useMemo` en `WeekView`; `isToday` es primitivo. */
const DayColumn = memo(function DayColumn({ date, isToday, assignments, templates }: DayColumnProps) {
  const { actions } = useSchedule();
  const { isDragOver, onDragOver, onDragLeave, onDrop } = useDayDrop(date);

  const segments = useMemo(
    () => daySegments(assignments, templates, date),
    [assignments, templates, date],
  );

  // Handlers estables (`actions` no cambia en re-renders "de ruido") para que
  // el `memo` de `TimeBlock` sea efectivo.
  const onSelect = useCallback(
    (assignment: Assignment) =>
      actions.openRangeDialog({
        mode: "stretch",
        templateId: assignment.shiftTemplateId,
        date: assignment.date,
      }),
    [actions],
  );
  const onDelete = useCallback(
    (assignment: Assignment) => void actions.deleteAssignment(assignment.id),
    [actions],
  );

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={
        "relative min-w-0 border-l border-border " +
        (isToday ? "bg-accent/5" : "") +
        (isDragOver ? " ring-2 ring-inset ring-[var(--accent)]" : "")
      }
      style={{ height: "calc(24 * var(--hour-h))" }}
    >
      {/* Líneas guía por hora (12:00 algo más marcada). */}
      {HOURS.map((hour) => (
        <div
          key={hour}
          className={
            hour === 12
              ? "border-t-2 border-border"
              : "border-t border-border"
          }
          style={{ height: "var(--hour-h)" }}
        />
      ))}
      {/* Bloques de turno superpuestos. */}
      {segments.map((seg) => (
        <TimeBlock
          key={`${seg.assignment.id}:${seg.isContinuation}`}
          segment={seg}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
});

export function WeekView({ date, data }: WeekViewProps) {
  const assignments = useMemo(
    () => data?.assignments ?? [],
    [data?.assignments],
  );
  const templates = useMemo(
    () => data?.templates ?? [],
    [data?.templates],
  );

  const days = useMemo(() => weekDays(date), [date]);
  const todayKey = formatDate(new Date());

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Cabecera: nombre + fecha por día (lunes→domingo). */}
      <div className="grid shrink-0 grid-cols-[auto_repeat(7,minmax(0,1fr))] border-b border-border bg-surface">
        <div className="w-12 shrink-0" />
        {days.map((day) => {
          const key = formatDate(day);
          const isToday = key === todayKey;
          const weekday = (day.getDay() + 6) % 7;
          return (
            <div
              key={key}
              className="min-w-0 border-l border-border px-1 py-1 text-center"
            >
              <div
                className={
                  "text-xs font-medium " +
                  (isToday ? "text-accent" : "text-muted")
                }
              >
                {DAY_NAMES[weekday]}
              </div>
              <div
                className={
                  "text-lg font-semibold " +
                  (isToday ? "text-accent" : "text-fg")
                }
              >
                {day.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Cuerpo desplazable: eje de tiempo + 7 columnas de día. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-[auto_repeat(7,minmax(0,1fr))]">
          <div className="w-12 shrink-0">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="flex items-start justify-end pr-1 text-[10px] leading-none tabular-nums text-muted"
                style={{ height: "var(--hour-h)" }}
              >
                {formatHour(hour)}
              </div>
            ))}
          </div>
          {days.map((day) => {
            const key = formatDate(day);
            return (
              <DayColumn
                key={key}
                date={day}
                isToday={key === todayKey}
                assignments={assignments}
                templates={templates}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
