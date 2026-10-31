// Shared, Figma-free types and colour helpers used by both the main thread
// and the UI. Every x / y / w / h / blur is a fraction of the frame (blur of
// its width), so one spec fits any frame size.

export interface Blob {
  color: string;
  opacity: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Wash {
  color: string;
  opacity: number;
}

export interface GradientSpec {
  name: string;
  base: string;
  blur: number;
  wash: Wash | null;
  blobs: Blob[];
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
 * ShadesMaker, so steps match the colour scales in the reference file:
 * the Blue Mist slide uses #0059DD's 5% (#CFDFF9) and 30% (#5C95E9) steps.
 */
export function shade(baseHex: string, step: number): string {
  const base = hexToRgb(baseHex);
  if (step === 50) return rgbToHex(base);
  if (step < 50) return rgbToHex(mix(base, WHITE, (1 - step / 50) * MAX_INTENSITY));
  return rgbToHex(mix(base, BLACK, ((step - 50) / 50) * MAX_INTENSITY));
}

/** Perceived brightness (ITU-R BT.601), 0–1. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
