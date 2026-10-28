import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { useSchedule } from "../stores/scheduleStore";
import { isoWeek, monthKey, weekDays, weekKey } from "../utils/date";
import { MonthView } from "./MonthView";
import { RangeDialog } from "./RangeDialog";
import { WeekView } from "./WeekView";

type ViewMode = "month" | "week";

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const MONTH_NAMES_SHORT = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function monthTitle(date: Date): string {
  return `${capitalize(MONTH_NAMES[date.getMonth()])} ${date.getFullYear()}`;
}

function weekTitle(date: Date): string {
  const days = weekDays(date);
  const first = days[0];
  const last = days[6];
  const start =
    first.getMonth() === last.getMonth()
      ? `${first.getDate()}`
      : `${first.getDate()} ${MONTH_NAMES_SHORT[first.getMonth()]}`;
  return `${start} – ${last.getDate()} ${MONTH_NAMES_SHORT[last.getMonth()]} ${last.getFullYear()}`;
}

export function CalendarView() {
  const { state, actions } = useSchedule();
  const [mode, setMode] = useState<ViewMode>("month");
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());

  // Rango (año/mes o año/semana ISO) + clave de caché del store.
  const range = useMemo(() => {
    const y = currentDate.getFullYear();
    if (mode === "month") {
      const month = currentDate.getMonth() + 1;
      return { year: y, month, week: 0, key: monthKey(y, month) };
    }
    const iso = isoWeek(currentDate);
    return { year: iso.year, month: 0, week: iso.week, key: weekKey(iso.year, iso.week) };
  }, [mode, currentDate]);

  const data = state.calendarCache[range.key];

  // Carga bajo demanda: reutiliza la caché del store (§5), sin re-fetch.
  useEffect(() => {
    if (data) return;
    if (mode === "month") {
      void actions.loadCalendarMonth(range.year, range.month);
    } else {
      void actions.loadCalendarWeek(range.year, range.week);
    }
  }, [data, mode, range.year, range.month, range.week, actions]);

  const goPrev = useCallback(() => {
    setCurrentDate((d) => {
      const n = new Date(d);
      if (mode === "month") {
        return new Date(n.getFullYear(), n.getMonth() - 1, 1);
      }
      n.setDate(n.getDate() - 7);
      return n;
    });
  }, [mode]);

  const goNext = useCallback(() => {
    setCurrentDate((d) => {
      const n = new Date(d);
      if (mode === "month") {
        return new Date(n.getFullYear(), n.getMonth() + 1, 1);
      }
      n.setDate(n.getDate() + 7);
      return n;
    });
  }, [mode]);

  const goToday = useCallback(() => setCurrentDate(new Date()), []);

  const title = mode === "month" ? monthTitle(currentDate) : weekTitle(currentDate);

  const navBtn =
    "rounded px-2 py-1 text-sm text-muted hover:bg-bg hover:text-fg";
  const toggleBtn = (active: boolean) =>
    "rounded px-2 py-0.5 text-sm " +
    (active ? "bg-accent text-white" : "text-muted hover:text-fg");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-4 py-2">
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={goPrev} className={navBtn} aria-label="Anterior">
            ‹
          </button>
          <button type="button" onClick={goToday} className={navBtn}>
            hoy
          </button>
          <button type="button" onClick={goNext} className={navBtn} aria-label="Siguiente">
            ›
          </button>
        </div>
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold text-fg">
          {title}
        </h2>
        <div className="flex items-center gap-0.5 rounded border border-border p-0.5">
          <button
            type="button"
            onClick={() => setMode("month")}
            className={toggleBtn(mode === "month")}
          >
            Mes
          </button>
          <button
            type="button"
            onClick={() => setMode("week")}
            className={toggleBtn(mode === "week")}
          >
            Semana
          </button>
        </div>
      </header>

      {state.error && (
        <div className="shrink-0 border-b border-border bg-surface px-4 py-1 text-xs text-muted">
          {state.error}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <motion.div
          key={mode}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {mode === "month" ? (
            <MonthView
              date={currentDate}
              data={data}
            />
          ) : (
            <WeekView
              date={currentDate}
              data={data}
            />
          )}
        </motion.div>
        {state.loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg/70">
            <span className="rounded bg-surface px-2 py-1 text-xs text-muted">
              Cargando…
            </span>
          </div>
        )}
      </div>
      <RangeDialog />
    </div>
  );
}
