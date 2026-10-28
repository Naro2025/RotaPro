/*
 * Hook de tema: lee settings (theme/accent/density) vía `api.ts` al montar y
 * aplica en <html>:
 *   - `data-theme`  → "light" | "dark" (la preferencia "system" se resuelve
 *                     con `prefers-color-scheme` y escucha cambios).
 *   - `--accent`    → CSS custom property desde el setting `accent`.
 *   - `data-density`→ "compact" | "normal" | "relaxed".
 *
 * En dev (sin backend) los `invoke` lanzan error: se capturan y se usan los
 * valores por defecto. `setTheme`/`setAccent`/`setDensity` persisten con
 * `set_setting`, tolerando fallos de red igualmente.
 */
import { useCallback, useEffect, useState } from "react";
import { getSettings, setSetting } from "../api";

export type ThemePreference = "light" | "dark" | "system";
export type Density = "compact" | "normal" | "relaxed";

const THEME_KEY = "theme";
const ACCENT_KEY = "accent";
const DENSITY_KEY = "density";

const DEFAULT_THEME: ThemePreference = "system";
const DEFAULT_ACCENT = "#2563eb";
const DEFAULT_DENSITY: Density = "normal";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function isTheme(value: string): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function isDensity(value: string): value is Density {
  return value === "compact" || value === "normal" || value === "relaxed";
}

function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "system") {
    return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
  }
  return preference;
}

function applyDom(theme: ThemePreference, accent: string, density: Density) {
  const root = document.documentElement;
  root.setAttribute("data-theme", resolveTheme(theme));
  root.style.setProperty("--accent", accent);
  root.setAttribute("data-density", density);
}

export interface ThemeState {
  theme: ThemePreference;
  accent: string;
  density: Density;
  setTheme: (theme: ThemePreference) => void;
  setAccent: (accent: string) => void;
  setDensity: (density: Density) => void;
}

export function useTheme(): ThemeState {
  const [theme, setThemeState] = useState<ThemePreference>(DEFAULT_THEME);
  const [accent, setAccentState] = useState<string>(DEFAULT_ACCENT);
  const [density, setDensityState] = useState<Density>(DEFAULT_DENSITY);

  // Carga inicial desde settings (con fallback a defaults en dev).
  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((settings) => {
        if (cancelled) return;
        let nextTheme = DEFAULT_THEME;
        let nextAccent = DEFAULT_ACCENT;
        let nextDensity = DEFAULT_DENSITY;
        for (const { key, value } of settings) {
          if (key === THEME_KEY && isTheme(value)) nextTheme = value;
          else if (key === ACCENT_KEY && value) nextAccent = value;
          else if (key === DENSITY_KEY && isDensity(value)) nextDensity = value;
        }
        setThemeState(nextTheme);
        setAccentState(nextAccent);
        setDensityState(nextDensity);
      })
      .catch(() => {
        // Sin backend: mantener defaults.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Aplica tokens al DOM cuando cambian los valores.
  useEffect(() => {
    applyDom(theme, accent, density);
  }, [theme, accent, density]);

  // Resuelve "system" con prefers-color-scheme y escucha cambios.
  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia(DARK_QUERY);
    const onChange = () => {
      document.documentElement.setAttribute(
        "data-theme",
        resolveTheme("system"),
      );
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    setSetting(THEME_KEY, next).catch(() => {
      // Persistencia no disponible (dev): el estado local ya aplica.
    });
  }, []);

  const setAccent = useCallback((next: string) => {
    setAccentState(next);
    setSetting(ACCENT_KEY, next).catch(() => {});
  }, []);

  const setDensity = useCallback((next: Density) => {
    setDensityState(next);
    setSetting(DENSITY_KEY, next).catch(() => {});
  }, []);

  return { theme, accent, density, setTheme, setAccent, setDensity };
}
