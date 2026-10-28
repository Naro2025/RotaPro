/*
 * Diálogo de "estiramiento" de un turno a un rango de días.
 *
 * Se abre en dos modos (store `rangeDialog`):
 * - "new": al soltar un turno con el toggle "Rango de días" activo. Base = día
 *   del drop; el input date define el final del rango (mínimo = base).
 * - "stretch": al hacer click en el chip de un assignment existente. Base =
 *   fecha de ese assignment; el input define el nuevo final (mínimo = base+1).
 *
 * Ambos llaman al MISMO comando idempotente `create_assignments_range`: los
 * días que ya tengan un assignment de la misma plantilla no se duplican.
 * Escape y click en el overlay cierran sin efectos.
 */
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useSchedule } from "../stores/scheduleStore";
import { addDays, diffDays, formatDate, parseDate } from "../utils/date";

/** Cap del backend (mismo límite validado en FE, sin llamar al backend). */
const MAX_DAYS = 92;

export function RangeDialog() {
  const { state, actions } = useSchedule();
  const dialog = state.rangeDialog;

  const template = dialog
    ? state.templates.find((t) => t.id === dialog.templateId)
    : undefined;
  const templateName = template?.name ?? "turno";

  const baseDate = dialog ? parseDate(dialog.date) : null;
  const minDate =
    baseDate && dialog?.mode === "stretch" ? addDays(baseDate, 1) : baseDate;
  const minStr = minDate ? formatDate(minDate) : "";

  const [endValue, setEndValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reinicia el input al abrir/cambiar el diálogo.
  useEffect(() => {
    if (dialog) {
      setEndValue(minStr);
      setSubmitting(false);
    }
    // `dialog` es un objeto nuevo en cada apertura → resetea de forma fiable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog]);

  // Cierra con Escape (accesible).
  useEffect(() => {
    if (!dialog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") actions.closeRangeDialog();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, actions]);

  if (!dialog || !baseDate) return null;

  const endDate = endValue ? parseDate(endValue) : null;
  const validEnd = endDate !== null && endDate >= minDate!;
  const days = validEnd ? diffDays(baseDate, endDate!) + 1 : 0;
  const overCap = days > MAX_DAYS;

  const confirmDisabled = !validEnd || overCap || submitting;
  const confirmLabel = dialog.mode === "new" ? "Asignar" : "Estirar";

  const handleConfirm = async () => {
    if (confirmDisabled || !endDate) return;
    setSubmitting(true);
    await actions.createAssignmentRange({
      shiftTemplateId: dialog.templateId,
      startDate: dialog.date,
      endDate: formatDate(endDate),
    });
    actions.closeRangeDialog();
  };

  const title =
    dialog.mode === "new"
      ? `Asignar ${templateName} · del ${dialog.date}`
      : `Estirar ${templateName} hasta`;

  return (
    <>
      {/* Overlay clicable para cerrar */}
      <div
        aria-hidden="true"
        onClick={() => actions.closeRangeDialog()}
        className="fixed inset-0 z-40 bg-black/40"
      />
      {/* Capa de centrado (transform estático) + contenedor animado. */}
      <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2">
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.98, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="w-72 max-w-[90vw] rounded-lg border border-border bg-surface p-4 shadow-xl"
        >
          <h2 className="text-sm font-semibold text-fg">{title}</h2>

          <div className="mt-3 flex flex-col gap-2">
            <label className="text-xs text-muted" htmlFor="range-end-date">
              {dialog.mode === "new" ? "hasta" : "nueva fecha de fin"}
            </label>
            <input
              id="range-end-date"
              type="date"
              min={minStr}
              value={endValue}
              onChange={(e) => setEndValue(e.target.value)}
              autoFocus
              className="rounded border border-border bg-bg px-2 py-1 text-sm text-fg outline-none focus:border-accent"
            />
            {validEnd && (
              <span className="text-xs text-muted">
                {days} {days === 1 ? "día" : "días"}
              </span>
            )}
            {overCap && (
              <p role="alert" className="text-xs text-red-500">
                El rango máximo es de {MAX_DAYS} días.
              </p>
            )}
          </div>

          <div className="mt-4 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => actions.closeRangeDialog()}
              disabled={submitting}
              className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:text-fg"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={confirmDisabled}
              className="rounded bg-accent px-2 py-0.5 text-xs font-medium text-white disabled:opacity-60"
            >
              {submitting ? "Creando…" : confirmLabel}
            </button>
          </div>
        </motion.div>
      </div>
    </>
  );
}
