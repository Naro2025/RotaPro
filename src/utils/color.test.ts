import { describe, expect, it } from "vitest";
import {
  colorHarmonies,
  contrastText,
  hexToRgb,
  hslToHex,
  rgbToHex,
  rgbToHsl,
} from "./color";

describe("hexToRgb / rgbToHex", () => {
  it("parsea hex de 6 dígitos (con o sin #)", () => {
    expect(hexToRgb("#FF5733")).toEqual({ r: 255, g: 87, b: 51 });
    expect(hexToRgb("0ea5e9")).toEqual({ r: 14, g: 165, b: 233 });
  });

  it("expande notación corta #rgb", () => {
    expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#0a0")).toEqual({ r: 0, g: 170, b: 0 });
  });

  it("devuelve null para entradas inválidas", () => {
    expect(hexToRgb("")).toBeNull();
    expect(hexToRgb("nope")).toBeNull();
    expect(hexToRgb("#12345")).toBeNull();
    expect(hexToRgb("#gggggg")).toBeNull();
  });

  it("serializa a #rrggbb minúsculas", () => {
    expect(rgbToHex({ r: 255, g: 87, b: 51 })).toBe("#ff5733");
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
  });
});

describe("rgbToHsl / hslToHex", () => {
  it("round-trip hex → rgb → hsl → hex es exacto", () => {
    for (const hex of [
      "#FF5733",
      "#0EA5E9",
      "#123456",
      "#ffffff",
      "#000000",
      "#6d28d9",
    ]) {
      const rgb = hexToRgb(hex)!;
      expect(hslToHex(rgbToHsl(rgb))).toBe(hex.toLowerCase());
    }
  });

  it("convierte #FF5733 a HSL esperado", () => {
    const hsl = rgbToHsl(hexToRgb("#FF5733")!);
    expect(hsl.h).toBeCloseTo(10.588, 2);
    expect(hsl.s).toBeCloseTo(1, 5);
    expect(hsl.l).toBeCloseTo(0.6, 5);
  });

  it("trata el gris como acromático (saturación 0)", () => {
    const hsl = rgbToHsl({ r: 128, g: 128, b: 128 });
    expect(hsl.s).toBe(0);
    expect(hslToHex(hsl)).toBe("#808080");
  });
});

describe("contrastText", () => {
  it("usa texto oscuro sobre fondos claros", () => {
    expect(contrastText("#ffffff")).toBe("#0f172a");
    expect(contrastText("#ffff00")).toBe("#0f172a");
  });

  it("usa texto blanco sobre fondos oscuros", () => {
    expect(contrastText("#000000")).toBe("#ffffff");
    expect(contrastText("#ff0000")).toBe("#ffffff");
  });

  it("expande notación hexadecimal corta (#rgb)", () => {
    expect(contrastText("#fff")).toBe("#0f172a");
    expect(contrastText("#000")).toBe("#ffffff");
  });

  it("devuelve texto oscuro por defecto ante color inválido", () => {
    expect(contrastText("not-a-color")).toBe("#0f172a");
    expect(contrastText("#12345")).toBe("#0f172a");
  });
});

describe("colorHarmonies", () => {
  it("calcula armonías exactas para un hex conocido", () => {
    // #FF5733 → matiz ≈10.588°, saturación 1, luminosidad 0.6.
    // Valores derivados con la fórmula HSL estándar (complementario +180°,
    // análogos ±30°, triádicos ±120°, monocromáticos 5 pasos de luminosidad).
    expect(colorHarmonies("#FF5733")).toEqual({
      complementary: "#33dbff",
      analogous: ["#ff3375", "#ffbd33"],
      triadic: ["#33ff57", "#5733ff"],
      monochromatic: ["#4d0d00", "#991b00", "#e62800", "#ff5733", "#ff9680"],
    });
  });

  it("mantiene hue de complementario a 180° del base", () => {
    // #00ff00 (verde puro) → complementario magenta puro.
    expect(colorHarmonies("#00ff00").complementary).toBe("#ff00ff");
  });

  it("el ramal monocromático tiene siempre 5 colores", () => {
    expect(colorHarmonies("#2563eb").monochromatic).toHaveLength(5);
  });

  it("no rompe con entradas inválidas (fallback neutro)", () => {
    const h = colorHarmonies("not-a-color");
    expect(h.complementary).toBe("#888888");
    expect(h.analogous).toEqual(["#888888", "#888888"]);
    expect(h.triadic).toEqual(["#888888", "#888888"]);
    expect(h.monochromatic).toHaveLength(5);
  });
});
