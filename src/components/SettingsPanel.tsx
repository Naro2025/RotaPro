/*
 * Panel de personalización de apariencia (drawer lateral derecho).
 *
 * - Modo: Claro / Oscuro / Sincronizado con SO (control segmentado).
 * - Acento: selector compartido `ColorPicker` (ilimitado: grid + nativo + armonías).
 * - Densidad: Compacta / Normal / Relajada (con descripción del efecto).
 * - Exportar: diálogo nativo de guardado (plugin-dialog) → export_calendar_ics (.ics).
 *
 * No persiste nada por sí mismo: los setters vienen de `useTheme` (App.tsx)
 * y aplican en vivo + persisten vía `set_setting`. El panel solo es UI.
 */
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { save } from "@tauri-apps/plugin-dialog";
import { exportCalendarIcs } from "../api";
import type { Density, ThemePreference } from "../hooks/useTheme";
import { ColorPicker } from "./ColorPicker";

const THEME_OPTIONS: SegmentOption<ThemePreference>[] = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
  { value: "system", label: "SO" },
];

const DENSITY_OPTIONS: SegmentOption<Density>[] = [
  { value: "compact", label: "Compacta" },
  { value: "normal", label: "Normal" },
  { value: "relaxed", label: "Relajada" },
];

const DENSITY_HINTS: Record<Density, string> = {
  compact: "Reduce interlineado y relleno de la grilla.",
  normal: "Espaciado equilibrado por defecto.",
  relaxed: "Más aire entre filas y celdas.",
};

interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex items-center gap-0.5 rounded-lg border border-border bg-bg p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={
              "flex-1 rounded-md px-2 py-1 text-sm transition-colors " +
              (active ? "bg-accent text-white" : "text-muted hover:text-fg")
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  theme: ThemePreference;
  accent: string;
  density: Density;
  setTheme: (theme: ThemePreference) => void;
  setAccent: (accent: string) => void;
  setDensity: (density: Density) => void;
}

export function SettingsPanel({
  open,
  onClose,
  theme,
  accent,
  density,
  setTheme,
  setAccent,
  setDensity,
}: SettingsPanelProps) {
  // Cierra con Escape (accesible).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const [exportStatus, setExportStatus] = useState("");

  // Auto-clear del mensaje de exportación (~4 s).
  useEffect(() => {
    if (!exportStatus) return;
    const timer = window.setTimeout(() => setExportStatus(""), 4000);
    return () => window.clearTimeout(timer);
  }, [exportStatus]);

  async function handleExport() {
    try {
      const path = await save({
        defaultPath: "rotapro",
        filters: [{ name: "iCalendar", extensions: ["ics"] }],
      });
      if (!path) return; // cancelado
      await exportCalendarIcs(path);
      const name = path.split(/[\\/]/).pop() ?? path;
      setExportStatus(`✓ Exportado a ${name}`);
    } catch (error) {
      setExportStatus(`Error al exportar: ${String(error)}`);
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Overlay clicable para cerrar */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40"
      />
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-label="Apariencia"
        initial={{ opacity: 0, scale: 0.98, y: 4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="fixed inset-y-0 right-0 z-50 flex w-80 max-w-[85vw] flex-col border-l border-border bg-surface shadow-xl"
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <h2 className="text-sm font-semibold text-fg">Apariencia</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded p-1.5 text-muted hover:bg-bg hover:text-fg"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
          {/* Modo */}
          <section>
            <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
              Modo
            </h3>
            <Segmented
              options={THEME_OPTIONS}
              value={theme}
              onChange={setTheme}
              ariaLabel="Modo de tema"
            />
            <p className="mt-1.5 text-xs text-muted">
              {theme === "system"
                ? "Sigue el tema del sistema operativo."
                : theme === "dark"
                  ? "Tema oscuro para entornos con poca luz."
                  : "Tema claro con alto contraste."}
            </p>
          </section>

          {/* Acento */}
          <section>
            <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
              Acento
            </h3>
            <ColorPicker value={accent} onChange={setAccent} />
          </section>

          {/* Densidad */}
          <section>
            <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
              Densidad
            </h3>
            <Segmented
              options={DENSITY_OPTIONS}
              value={density}
              onChange={setDensity}
              ariaLabel="Densidad"
            />
            <p className="mt-1.5 text-xs text-muted">{DENSITY_HINTS[density]}</p>
          </section>

          {/* Exportar */}
          <section>
            <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
              Exportar
            </h3>
            <button
              type="button"
              onClick={handleExport}
              className="rounded-md border border-border px-2 py-1 text-sm text-fg transition-colors hover:border-accent hover:bg-accent hover:text-white"
            >
              Exportar a iCal
            </button>
            <p className="mt-1.5 text-xs text-muted">{exportStatus}</p>
          </section>
        </div>
      </motion.aside>
    </>
  );
}
