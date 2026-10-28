/*
 * Selector de color compartido (turnos personalizados y acento de la app).
 * Ilimitado por tres vías:
 *   1. Grid de ~24 swatches curados por familia (rojos…neutros).
 *   2. `<input type="color">` nativo (cualquier color del sistema, gratis).
 *   3. Combinador cromático: armonías derivadas de `value` vía `colorHarmonies`.
 * Más un input de texto HEX validado (`#RRGGBB`, acepta sin `#`) + preview.
 *
 * Un solo estado fuente: `value`. Todo click/input → `onChange` inmediato.
 * El borrador HEX es solo transitorio (se normaliza y confirma si es válido).
 */
import { useEffect, useState } from "react";
import { colorHarmonies, contrastText, type ColorHarmonies } from "../utils/color";

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
}

/** Paleta curada agrupada por familia (filas etiquetadas). */
const SWATCH_GROUPS: { label: string; colors: string[] }[] = [
  { label: "Rojos", colors: ["#ef4444", "#dc2626", "#b91c1c", "#f87171"] },
  { label: "Naranjas", colors: ["#f97316", "#ea580c", "#fb923c"] },
  { label: "Ámbar", colors: ["#f59e0b", "#d97706", "#fbbf24"] },
  { label: "Verdes", colors: ["#22c55e", "#16a34a", "#4ade80"] },
  { label: "Teales", colors: ["#14b8a6", "#0d9488", "#2dd4bf"] },
  { label: "Azules", colors: ["#3b82f6", "#2563eb", "#0ea5e9", "#0284c7"] },
  { label: "Violetas", colors: ["#8b5cf6", "#6d28d9", "#7c3aed"] },
  { label: "Rosas", colors: ["#ec4899", "#db2777", "#f472b6"] },
  { label: "Neutros", colors: ["#64748b", "#94a3b8", "#334155", "#0f172a"] },
];

/** Filas del combinador cromático (etiqueta + colores derivados de `value`). */
const HARMONY_ROWS: { label: string; get: (h: ColorHarmonies) => string[] }[] = [
  { label: "Complementario", get: (h) => [h.complementary] },
  { label: "Análogos", get: (h) => [...h.analogous] },
  { label: "Triádicos", get: (h) => [...h.triadic] },
  { label: "Monocromáticos", get: (h) => h.monochromatic },
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Normaliza a `#rrggbb` (acepta sin `#`); devuelve "" si es inválido. */
function normalizeHex(raw: string): string {
  const s = raw.trim();
  const withHash = s.startsWith("#") ? s : `#${s}`;
  if (!HEX_RE.test(withHash)) return "";
  return withHash.toLowerCase();
}

interface SwatchProps {
  hex: string;
  active: boolean;
  onSelect: () => void;
}

/** Botón circular de color reutilizable (grid y armonías), tamaño fijo. */
function Swatch({ hex, active, onSelect }: SwatchProps) {
  return (
    <button
      type="button"
      aria-label={`Color ${hex}`}
      aria-pressed={active}
      title={hex}
      onClick={onSelect}
      className={
        "w-5 h-5 shrink-0 rounded-full border transition-transform " +
        (active
          ? "scale-110 border-transparent ring-2 ring-[var(--accent)]"
          : "border-border hover:scale-105")
      }
      style={{ backgroundColor: hex }}
    />
  );
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const [draft, setDraft] = useState(value);

  // Refleja en el input HEX el color actual (swatch, nativo o carga inicial).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const harmonies = colorHarmonies(value);
  const fg = contrastText(value);
  const active = (hex: string) => hex.toLowerCase() === value.toLowerCase();

  const handleHexChange = (raw: string) => {
    setDraft(raw);
    const norm = normalizeHex(raw);
    if (norm) onChange(norm);
  };

  const handleHexBlur = () => {
    if (!normalizeHex(draft)) setDraft(value);
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      {/* 1. Grid de swatches por familia. */}
      <div className="flex flex-col gap-1">
        {SWATCH_GROUPS.map((group) => (
          <div key={group.label} className="flex items-center gap-1.5">
            <span className="w-24 shrink-0 truncate text-[10px] uppercase tracking-wide text-muted">
              {group.label}
            </span>
            <div className="flex min-w-0 flex-wrap gap-2">
              {group.colors.map((c) => (
                <Swatch
                  key={c}
                  hex={c}
                  active={active(c)}
                  onSelect={() => onChange(c)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 2. Selector nativo + 4. input HEX + preview "Ejemplo". */}
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Color personalizado"
          title={value}
          className="h-6 w-8 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
        />
        <input
          type="text"
          value={draft}
          onChange={(e) => handleHexChange(e.target.value)}
          onBlur={handleHexBlur}
          spellCheck={false}
          autoComplete="off"
          placeholder="#RRGGBB"
          aria-label="Color HEX"
          className="w-24 shrink-0 rounded border border-border bg-surface px-1.5 py-1 text-xs text-fg outline-none focus:border-accent"
        />
        <span
          aria-hidden="true"
          className="flex min-w-0 flex-1 items-center justify-center truncate rounded border border-border px-1.5 py-1 text-xs"
          style={{ backgroundColor: value, color: fg }}
        >
          Ejemplo
        </span>
      </div>

      {/* 3. Combinador cromático (armonías derivadas de `value`). */}
      <div className="flex flex-col gap-1">
        {HARMONY_ROWS.map((row) => (
          <div key={row.label} className="flex items-center gap-1.5">
            <span className="w-24 shrink-0 truncate text-[10px] uppercase tracking-wide text-muted">
              {row.label}
            </span>
            <div className="flex min-w-0 flex-wrap gap-2">
              {row.get(harmonies).map((c, i) => (
                <Swatch
                  key={`${c}-${i}`}
                  hex={c}
                  active={active(c)}
                  onSelect={() => onChange(c)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
