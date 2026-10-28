/*
 * Utilidades de color puras (sin DOM ni dependencias): conversión
 * RGB↔HSL↔HEX, contraste de texto WCAG y armonías cromáticas.
 * Todo determinista y testable (espejo TS de la lógica que el FE usa para
 * turnos y acento; el combinador cromático es matemática HSL hecha a mano).
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  /** Matiz en grados [0, 360). */
  h: number;
  /** Saturación [0, 1]. */
  s: number;
  /** Luminosidad [0, 1]. */
  l: number;
}

/** Acepta `#rgb`, `#rrggbb` o sin `#`. Devuelve `null` si es inválido. */
const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function clamp255(n: number): number {
  return Math.min(255, Math.max(0, n));
}

/** Parsea un hex (3 o 6 dígitos, con o sin `#`) a RGB. `null` si es inválido. */
export function hexToRgb(hex: string): Rgb | null {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Serializa RGB a `#rrggbb` (minúsculas, componentes clampeados a 0..255). */
export function rgbToHex({ r, g, b }: Rgb): string {
  const to2 = (n: number) =>
    clamp255(Math.round(n)).toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

/** Convierte RGB (0..255) a HSL (h en grados, s/l en [0,1]). */
export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) {
    // Acromático: matiz indefinido → 0, saturación 0.
    return { h: 0, s: 0, l };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) {
    h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  } else if (max === gn) {
    h = ((bn - rn) / d + 2) * 60;
  } else {
    h = ((rn - gn) / d + 4) * 60;
  }
  return { h, s, l };
}

/** Convierte HSL (h grados, s/l en [0,1]) a RGB (0..255). */
function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hh = ((h % 360) + 360) % 360;
  if (s === 0) {
    const v = Math.round(clamp01(l) * 255);
    return { r: v, g: v, b: v };
  }
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hh < 60) {
    rp = c;
    gp = x;
  } else if (hh < 120) {
    rp = x;
    gp = c;
  } else if (hh < 180) {
    gp = c;
    bp = x;
  } else if (hh < 240) {
    gp = x;
    bp = c;
  } else if (hh < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }
  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  };
}

/** Convierte HSL a `#rrggbb` (round-trip exacto con `rgbToHsl`). */
export function hslToHex(hsl: Hsl): string {
  return rgbToHex(hslToRgb(hsl));
}

/**
 * Color de texto (claro/oscuro) con contraste suficiente sobre un fondo hex.
 * Centralizado desde `DayCell.tsx` (lo usan chips del mes y bloques del
 * TimeGrid). Devuelve el oscuro de la paleta (`#0f172a`) sobre fondos claros
 * y blanco (`#ffffff`) sobre fondos oscuros; ante entrada inválida, el oscuro.
 */
export function contrastText(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#0f172a";
  // Luminancia relativa (WCAG) con pesos sRGB.
  const lum = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
  return lum > 150 ? "#0f172a" : "#ffffff";
}

export interface ColorHarmonies {
  /** Matiz +180°. */
  complementary: string;
  /** Matiz −30° / +30°. */
  analogous: [string, string];
  /** Matiz +120° / +240°. */
  triadic: [string, string];
  /** 5 pasos de luminosidad fijos manteniendo matiz y saturación. */
  monochromatic: string[];
}

/** Pasos de luminosidad del ramal monocromático (oscuro → claro). */
const MONO_LIGHTNESS = [0.15, 0.3, 0.45, 0.6, 0.75];

/** Fallback neutro para entradas inválidas (nunca rompe ni devuelve NaN). */
const NEUTRAL_HARMONIES: ColorHarmonies = {
  complementary: "#888888",
  analogous: ["#888888", "#888888"],
  triadic: ["#888888", "#888888"],
  monochromatic: ["#666666", "#777777", "#888888", "#999999", "#aaaaaa"],
};

/**
 * Armonías cromáticas HSL estándar derivadas de `hex`:
 *   - complementario: hue +180°.
 *   - análogos: hue −30° / +30°.
 *   - triádicos: hue +120° / +240°.
 *   - monocromáticos: 5 luminosidades fijas manteniendo hue/saturación.
 * Las rotaciones de hue conservan la saturación y luminosidad del color base.
 * Entrada inválida → fallback neutro (documentado en tests).
 */
export function colorHarmonies(hex: string): ColorHarmonies {
  const rgb = hexToRgb(hex);
  if (!rgb) return NEUTRAL_HARMONIES;
  const { h, s, l } = rgbToHsl(rgb);
  const rotate = (deg: number) =>
    hslToHex({ h: ((h + deg) % 360 + 360) % 360, s, l });
  return {
    complementary: rotate(180),
    analogous: [rotate(-30), rotate(30)],
    triadic: [rotate(120), rotate(240)],
    monochromatic: MONO_LIGHTNESS.map((ml) => hslToHex({ h, s, l: ml })),
  };
}
