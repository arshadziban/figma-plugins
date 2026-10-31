// Shared, Figma-free card types and colour helpers used by both the main
// thread and the UI. Positions and sizes are fractions of the card (x and w
// of its width, y and h of its height); blur, stroke and shadow sizes are
// fractions of the card width, so one spec fits any card size.

export interface Stop {
  color: string;
  opacity: number;
  position: number;
}

/** Linear fill direction: the light corner. */
export type Direction = "tl" | "tr" | "top";

export interface RadialFill {
  /** Colour role, e.g. "highlight" or "accent"; overrides are keyed by it. */
  key: string;
  label: string;
  /** Centre and radius in card fractions (radius is per axis, so it stretches with the card). */
  cx: number;
  cy: number;
  r: number;
  from: { color: string; opacity: number };
  to: { color: string; opacity: number };
}

export interface Glow {
  /** Colour role, "glowBottom" or "glowTop". */
  key: string;
  color: string;
  opacity: number;
  x: number;
  y: number;
  w: number;
  h: number;
  blur: number;
}

export interface CardSpec {
  name: string;
  /** Corner radius as a fraction of the card's short side. */
  radius: number;
  /** A solid fill when it has one stop, otherwise a linear gradient. */
  linear: { stops: Stop[]; direction: Direction };
  radials: RadialFill[];
  stroke: { color: string; opacity: number; weight: number } | null;
  shadow: { color: string; opacity: number; blur: number; y: number; spread: number } | null;
  glows: Glow[];
  sparkle: { color: string; opacity: number; x: number; y: number; size: number; blur: number } | null;
}

export interface Size {
  width: number;
  height: number;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function hexToRgb(hex: string): RGB {
  const clean = hex.replace("#", "").trim();
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean.padEnd(6, "0").slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return { r: 1, g: 1, b: 1 };
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const toHex = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function normHex(v: string): string | null {
  let h = v.trim().replace(/[^0-9a-f]/gi, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return h.length === 6 ? "#" + h.toUpperCase() : null;
}

const WHITE: RGB = { r: 1, g: 1, b: 1 };
const BLACK: RGB = { r: 0, g: 0, b: 0 };
const MAX_INTENSITY = 0.9;

function mix(a: RGB, b: RGB, amount: number): RGB {
  const t = clamp01(amount);
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/**
 * One step of a ShadesMaker scale (5–100, 50 = base). Same formula as
 * ShadesMaker and Gradify, so cards line up with the file's colour scales.
 */
export function shade(baseHex: string, step: number): string {
  const base = hexToRgb(baseHex);
  if (step === 50) return rgbToHex(base);
  if (step < 50) return rgbToHex(mix(base, WHITE, (1 - step / 50) * MAX_INTENSITY));
  return rgbToHex(mix(base, BLACK, ((step - 50) / 50) * MAX_INTENSITY));
}

/** Rotates the hue by `deg`, keeping saturation and lightness (HSL). */
export function hueShift(hex: string, deg: number): string {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return rgbToHex({ r, g, b });
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (((h * 60 + deg) % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex({ r: r1 + m, g: g1 + m, b: b1 + m });
}
