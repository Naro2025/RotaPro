/*
 * Panel lateral "Planificador de Turnos": plantillas agrupadas por formato
 * laboral, arrastrables (DnD HTML5 nativo) hacia las celdas del calendario.
 * Usa el store para las plantillas (`state.templates` + `loadTemplates`) y
 * `api.listWorkFormats()` para la taxonomía de formatos (estado local).
 * Además permite crear turnos personalizados (duración dinámica) y borrar
 * solo los custom (`code` con prefijo "custom-").
 */
import {
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import { motion } from "motion/react";
import * as api from "../api";
import { TEMPLATE_MIME } from "../hooks/useDayDrop";
import { useSchedule } from "../stores/scheduleStore";
import type { ShiftTemplate, WorkFormat } from "../types";
import { isOvernight } from "../utils/date";
import { ColorPicker } from "./ColorPicker";

/** Quick-picks de emoji para el campo de identidad del turno. */
const EMOJI_PICKS = ["🌙", "☀️", "🌇", "🏥", "🚑", "🛏️", "🧑‍⚕️", "⚙️"];

interface TemplateChipProps {
  template: ShiftTemplate;
  /** Si la tarjeta está siendo arrastrada ahora (elevación visual). */
  dragging?: boolean;
  /** Se dispara al iniciar el drag (solo feedback visual, el DnD lo hace el `<li>`). */
  onDragStart?: () => void;
  /** Se dispara al terminar/cancelar el drag. */
  onDragEnd?: () => void;
  /** Si está presente, muestra el botón "×" (solo plantillas custom). */
  onDelete?: () => void;
}

/** Chip de plantilla arrastrable: swatch de color + nombre + horario. */
function TemplateChip({
  template,
  dragging = false,
  onDragStart,
  onDragEnd,
  onDelete,
}: TemplateChipProps) {
  const handleDragStart = (e: DragEvent<HTMLLIElement>) => {
    e.dataTransfer.setData(TEMPLATE_MIME, template.id);
    e.dataTransfer.effectAllowed = "copy";
    onDragStart?.();
  };

  return (
    <li
      draggable
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      aria-label={`Arrastrar ${template.name} (${template.startTime}–${template.endTime})`}
      title={`${template.name} · ${template.startTime}–${template.endTime}`}
      className="list-none"
    >
      <motion.div
        animate={dragging ? { scale: 1.03 } : { scale: 1 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className={
          "flex cursor-grab items-center gap-2 rounded border border-border bg-bg px-2 py-1.5 text-xs " +
          "transition-shadow duration-150 hover:border-accent active:cursor-grabbing " +
          (dragging ? "shadow-lg" : "")
        }
      >
        <span
          aria-hidden="true"
          className="size-3 shrink-0 rounded-full border border-border"
          style={{ backgroundColor: template.color }}
        />
        <span className="min-w-0 flex-1 truncate text-fg">{template.name}</span>
        {isOvernight(template.startTime, template.endTime) && (
          <span
            role="img"
            aria-label={`Termina al día siguiente a las ${template.endTime}`}
            title={`Termina al día siguiente a las ${template.endTime}`}
            className="shrink-0 text-xs"
          >
            🌙
          </span>
        )}
        <span className="shrink-0 font-mono text-muted">
          {template.startTime}–{template.endTime}
        </span>
        {onDelete && (
          <button
            type="button"
            aria-label={`Eliminar ${template.name}`}
            title={`Eliminar ${template.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="shrink-0 rounded px-0.5 text-muted opacity-60 transition-opacity hover:opacity-100 hover:text-fg"
          >
            ×
          </button>
        )}
      </motion.div>
    </li>
  );
}

interface ShiftTemplateFormProps {
  formatId: string;
  onCancel: () => void;
  onCreated: () => void;
}

/** Mini-form inline para crear un turno personalizado en un formato. */
function ShiftTemplateForm({
  formatId,
  onCancel,
  onCreated,
}: ShiftTemplateFormProps) {
  const { state, actions } = useSchedule();
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [color, setColor] = useState("#F59E0B");
  const [emoji, setEmoji] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setFailed(false);
    try {
      const created = await actions.createTemplate({
        workFormatId: formatId,
        name: name.trim(),
        startTime,
        endTime,
        color,
        emoji: emoji.trim(),
        sortOrder: 100,
      });
      if (created) {
        onCreated();
      } else {
        // El mensaje descriptivo del backend queda en `state.error`.
        setFailed(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    "rounded border border-border bg-surface px-1.5 py-1 text-xs text-fg outline-none focus:border-accent";

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-1 flex flex-col gap-1.5 rounded border border-border bg-bg p-2"
    >
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nombre del turno"
        maxLength={40}
        required
        autoFocus
        className={inputCls}
        aria-label="Nombre del turno"
      />
      <div className="flex items-center gap-1.5">
        <label className="shrink-0 text-xs text-muted" htmlFor={`start-${formatId}`}>
          Inicio
        </label>
        <input
          id={`start-${formatId}`}
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          required
          className={inputCls}
        />
        <label className="shrink-0 text-xs text-muted" htmlFor={`end-${formatId}`}>
          Fin
        </label>
        <input
          id={`end-${formatId}`}
          type="time"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          required
          className={inputCls}
        />
      </div>
      <ColorPicker value={color} onChange={setColor} />
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          placeholder="Emoji (opcional)"
          aria-label="Emoji del turno"
          className={inputCls + " w-28"}
        />
        <div className="flex items-center gap-0.5">
          {EMOJI_PICKS.map((pick) => (
            <button
              key={pick}
              type="button"
              aria-label={`Emoji ${pick}`}
              aria-pressed={emoji === pick}
              title={pick}
              onClick={() => setEmoji(emoji === pick ? "" : pick)}
              className={
                "rounded px-0.5 text-sm leading-none transition-transform " +
                (emoji === pick
                  ? "bg-accent/20 ring-1 ring-[var(--accent)]"
                  : "hover:scale-110")
              }
            >
              {pick}
            </button>
          ))}
        </div>
      </div>
      {failed && state.error && (
        <p role="alert" className="text-xs text-red-500">
          {state.error}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:text-fg"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-accent px-2 py-0.5 text-xs font-medium text-white disabled:opacity-60"
        >
          {submitting ? "Creando…" : "Crear"}
        </button>
      </div>
    </form>
  );
}

export function Planner() {
  const { state, actions } = useSchedule();
  const [formats, setFormats] = useState<WorkFormat[]>([]);
  const [openFormFormatId, setOpenFormFormatId] = useState<string | null>(null);
  // Plantilla actualmente en arrastre (feedback visual de elevación).
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Plantillas vía el store; formatos (taxonomía) vía api local. En dev (sin
  // backend) ambos fallan silenciosamente y el panel queda vacío.
  useEffect(() => {
    void actions.loadTemplates();
    api
      .listWorkFormats()
      .then(setFormats)
      .catch(() => {
        // Sin backend: mantenemos la lista vacía.
      });
  }, [actions]);

  const templatesByFormat = useMemo(() => {
    const map = new Map<string, ShiftTemplate[]>();
    for (const template of state.templates) {
      const list = map.get(template.workFormatId) ?? [];
      list.push(template);
      map.set(template.workFormatId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return map;
  }, [state.templates]);

  const sortedFormats = useMemo(
    () => [...formats].sort((a, b) => a.sortOrder - b.sortOrder),
    [formats],
  );

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <h2 className="min-w-0 truncate text-sm font-semibold text-fg">
          Planificador de Turnos
        </h2>
        <span
          className="shrink-0 rounded-full bg-bg px-2 py-0.5 text-xs text-muted"
          aria-label={`${state.templates.length} plantillas`}
        >
          {state.templates.length}
        </span>
      </header>
      <label className="flex shrink-0 cursor-pointer items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-xs text-fg">Rango de días</span>
        <input
          type="checkbox"
          checked={state.rangeMode}
          onChange={() => actions.toggleRangeMode()}
          aria-label="Rango de días"
          className="size-4 accent-[var(--accent)]"
        />
      </label>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        {sortedFormats.map((format) => {
          const templates = templatesByFormat.get(format.id) ?? [];
          const formOpen = openFormFormatId === format.id;
          return (
            <section key={format.id} aria-label={format.name}>
              <div className="mb-1 flex items-center justify-between px-1">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
                  {format.name}
                </h3>
                <button
                  type="button"
                  onClick={() =>
                    setOpenFormFormatId(formOpen ? null : format.id)
                  }
                  aria-expanded={formOpen}
                  className="rounded px-1 py-0.5 text-xs font-medium text-muted hover:text-accent"
                >
                  {formOpen ? "–" : "+ Turno"}
                </button>
              </div>
              {formOpen && (
                <ShiftTemplateForm
                  formatId={format.id}
                  onCancel={() => setOpenFormFormatId(null)}
                  onCreated={() => setOpenFormFormatId(null)}
                />
              )}
              {templates.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {templates.map((template) => (
                    <TemplateChip
                      key={template.id}
                      template={template}
                      dragging={draggingId === template.id}
                      onDragStart={() => setDraggingId(template.id)}
                      onDragEnd={() => setDraggingId(null)}
                      onDelete={
                        template.code.startsWith("custom-")
                          ? () => void actions.deleteTemplate(template.id)
                          : undefined
                      }
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
