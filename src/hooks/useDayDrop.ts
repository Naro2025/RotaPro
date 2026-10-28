/*
 * Lógica de drop-target compartida entre `DayCell` (vista mensual) y `WeekView`
 * (vista semanal). Centralizar `onDragOver`/`onDragLeave`/`onDrop` evita que las
 * dos vistas diverjan: sin `e.preventDefault()` en `onDragOver` el navegador
 * nunca dispara `onDrop` (causa raíz del bug "la vista semanal no acepta
 * drops").
 */
import { useState, type DragEvent } from "react";
import { useSchedule } from "../stores/scheduleStore";
import { formatDate } from "../utils/date";

/** MIME type pactado entre el planner (drag) y las celdas (drop). */
export const TEMPLATE_MIME = "application/x-shift-template";

export interface DayDrop {
  /** `true` mientras un template se arrastra sobre la celda (ring visual). */
  isDragOver: boolean;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
}

/** Drop-target de un día concreto del calendario (mes y semana). */
export function useDayDrop(date: Date): DayDrop {
  const { state, actions } = useSchedule();
  const [isDragOver, setIsDragOver] = useState(false);

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    // Solo limpia al salir realmente de la celda (evita flicker entre hijos).
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    setIsDragOver(false);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const id = e.dataTransfer.getData(TEMPLATE_MIME);
    if (!id) return;
    if (state.rangeMode) {
      // Modo rango: no se asigna directo; se abre el diálogo de rango.
      actions.openRangeDialog({ mode: "new", templateId: id, date: formatDate(date) });
    } else {
      void actions.createAssignment({ shiftTemplateId: id, date: formatDate(date) });
    }
  };

  return { isDragOver, onDragOver, onDragLeave, onDrop };
}
