import { useMemo } from "react";
import type { Assignment, CalendarData } from "../types";
import { formatDate, monthGrid } from "../utils/date";
import { DayCell } from "./DayCell";

const DAY_HEADERS = ["L", "M", "X", "J", "V", "S", "D"];

/** Array vacío estable: `byDate.get(key) ?? []` crearía una referencia nueva
 *  por celda vacía en cada render, rompiendo el `memo` de `DayCell`. */
const EMPTY_ASSIGNMENTS: Assignment[] = [];

interface MonthViewProps {
  date: Date;
  data?: CalendarData;
}

export function MonthView({ date, data }: MonthViewProps) {
  const { byDate, templates } = useMemo(() => {
    const byDate = new Map<string, Assignment[]>();
    for (const a of data?.assignments ?? []) {
      const list = byDate.get(a.date) ?? [];
      list.push(a);
      byDate.set(a.date, list);
    }
    return { byDate, templates: data?.templates ?? [] };
  }, [data]);

  const weeks = useMemo(() => monthGrid(date), [date]);
  const todayKey = formatDate(new Date());

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7 border-b border-border">
        {DAY_HEADERS.map((label) => (
          <div
            key={label}
            className="px-1 py-1 text-center text-xs font-medium text-muted"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {weeks.flat().map((cell) => {
          const key = formatDate(cell);
          return (
            <DayCell
              key={key}
              date={cell}
              assignments={byDate.get(key) ?? EMPTY_ASSIGNMENTS}
              templates={templates}
              isCurrentMonth={cell.getMonth() === date.getMonth()}
              isToday={key === todayKey}
            />
          );
        })}
      </div>
    </div>
  );
}
