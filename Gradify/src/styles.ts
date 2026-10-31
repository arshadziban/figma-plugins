// The gradient styles. Every style is built from one colour the user picks:
// a mood decides which steps of that colour's ShadesMaker scale fill the base,
// wash and blobs, and a layout decides where the blobs go.
// 8 moods × 16 layouts = 128 styles, all on a light base, browsed with ◀ ▶.

import { GradientSpec, round3, shade, clamp01 } from "./spec";

// ── Layouts ─────────────────────────────────────────────────────────────────
// Slots run bottom → top. `role` picks one of the mood's three colours and
// `m` scales the mood's opacity for that slot. Glow and Mist are measured
// from the two reference slides.

interface Slot { x: number; y: number; w: number; h: number; role: 0 | 1 | 2; m: number }
interface Layout { name: string; blur: number; slots: Slot[] }

const s = (x: number, y: number, w: number, h: number, role: 0 | 1 | 2, m = 1): Slot => ({ x, y, w, h, role, m });

const LAYOUTS: Layout[] = [
  { name: "Glow", blur: 0.39, slots: [
    s(-0.378, -0.25, 0.696, 1.237, 0), s(0.5, -0.386, 0.696, 1.189, 1), s(0.219, 0.539, 0.696, 1.189, 2),
  ] },
  { name: "Mist", blur: 0.39, slots: [
    s(0.45, -0.821, 0.743, 1.321, 0, 0.65), s(-0.348, 0.422, 0.715, 1.271, 0, 1.2), s(-0.296, -0.535, 0.743, 1.321, 2, 0.8),
    s(0.582, 0.658, 0.643, 1.108, 1, 1.2), s(0.075, -0.366, 0.643, 0.457, 1, 1.1),
  ] },
  { name: "Diagonal", blur: 0.39, slots: [
    s(-0.35, -0.55, 0.8, 1.4, 0), s(0.55, 0.35, 0.8, 1.4, 1), s(0.2, -0.1, 0.5, 0.9, 2, 0.6),
  ] },
  { name: "Dawn", blur: 0.36, slots: [
    s(-0.15, -0.9, 1.3, 1.3, 0), s(-0.3, -0.2, 0.6, 1.0, 1, 0.8), s(0.7, -0.2, 0.6, 1.0, 2, 0.8),
  ] },
  { name: "Rise", blur: 0.36, slots: [
    s(-0.2, 0.55, 0.7, 1.2, 0), s(0.5, 0.6, 0.7, 1.2, 1), s(0.15, 0.85, 0.7, 0.8, 2, 0.9),
  ] },
  { name: "Drift", blur: 0.39, slots: [
    s(-0.55, -0.4, 0.8, 1.8, 0, 1.1), s(-0.3, 0.5, 0.6, 1.0, 1, 0.9), s(0.75, -0.5, 0.5, 0.9, 2, 0.6),
  ] },
  { name: "Orb", blur: 0.33, slots: [
    s(0.2, -0.1, 0.6, 1.2, 0), s(-0.35, -0.55, 0.5, 0.9, 1, 0.7), s(0.85, 0.65, 0.5, 0.9, 2, 0.7),
  ] },
  { name: "Ribbon", blur: 0.3, slots: [
    s(-0.2, 0.25, 1.4, 0.5, 0), s(-0.3, -0.6, 0.7, 0.9, 1, 0.6), s(0.6, 0.75, 0.7, 0.9, 2, 0.6),
  ] },
  { name: "Halo", blur: 0.39, slots: [
    s(-0.4, -0.6, 0.7, 1.2, 0), s(0.7, -0.6, 0.7, 1.2, 1), s(-0.4, 0.6, 0.7, 1.2, 1), s(0.7, 0.6, 0.7, 1.2, 0),
  ] },
  { name: "Split", blur: 0.39, slots: [
    s(-0.5, -0.3, 0.85, 1.6, 0, 1.1), s(0.65, -0.3, 0.85, 1.6, 1, 1.1), s(0.25, 0.7, 0.5, 0.8, 2, 0.6),
  ] },
  // One strong glow in the top-right corner, the rest of the frame stays clean.
  { name: "Corner", blur: 0.36, slots: [
    s(0.45, -0.75, 0.9, 1.6, 0, 1.1), s(0.8, -0.2, 0.45, 0.8, 1, 0.8), s(0.55, 0.25, 0.35, 0.6, 2, 0.5),
  ] },
  // Three blobs in a row across the middle, like a soft wave.
  { name: "Wave", blur: 0.3, slots: [
    s(-0.25, 0.15, 0.55, 0.9, 0), s(0.22, -0.05, 0.55, 0.9, 1), s(0.7, 0.2, 0.55, 0.9, 0, 0.9),
  ] },
  // Light from above the centre, fading downwards.
  { name: "Spotlight", blur: 0.33, slots: [
    s(0.15, -0.85, 0.7, 1.4, 0, 1.1), s(0.3, -0.3, 0.4, 0.7, 2, 0.9), s(0.05, 0.85, 0.9, 0.6, 1, 0.4),
  ] },
  // Colour around all four edges with a clear centre for content.
  { name: "Frame", blur: 0.3, slots: [
    s(-0.1, -0.55, 1.2, 0.75, 0, 0.9), s(-0.1, 0.8, 1.2, 0.75, 0, 0.9),
    s(-0.45, 0, 0.55, 1, 1, 0.8), s(0.9, 0, 0.55, 1, 1, 0.8),
  ] },
  // Six smaller blobs spread over the frame.
  { name: "Scatter", blur: 0.22, slots: [
    s(-0.1, -0.2, 0.35, 0.62, 0), s(0.4, -0.3, 0.3, 0.53, 1, 0.9), s(0.8, -0.1, 0.35, 0.62, 2),
    s(0.05, 0.6, 0.32, 0.57, 1, 0.9), s(0.5, 0.5, 0.3, 0.53, 2), s(0.85, 0.7, 0.32, 0.57, 0, 0.9),
  ] },
  // Two orbs on a diagonal, each with a small highlight.
  { name: "Twin", blur: 0.3, slots: [
    s(-0.05, -0.15, 0.5, 0.89, 0), s(0.55, 0.3, 0.5, 0.89, 1),
    s(0.1, 0.0, 0.2, 0.36, 2, 0.8), s(0.7, 0.45, 0.2, 0.36, 2, 0.8),
  ] },
];

// ── Moods ───────────────────────────────────────────────────────────────────
// Scale steps run 5–100 with 50 = the picked colour.

interface Mood {
  name: string;
  base: number | "white";
  wash: { step: number; opacity: number } | null;
  roles: [number, number, number];
  opacity: number;
}

const MOODS: Mood[] = [
  // Like the Violet slide: white with light blobs.
  { name: "Light", base: "white", wash: null, roles: [30, 40, 20], opacity: 0.8 },
  // Like the Blue slide: white, a faint tinted wash, mixed-strength blobs.
  { name: "Airy", base: "white", wash: { step: 5, opacity: 0.25 }, roles: [30, 45, 10], opacity: 0.7 },
  { name: "Soft", base: 5, wash: null, roles: [25, 45, 10], opacity: 0.65 },
  { name: "Vivid", base: "white", wash: null, roles: [50, 35, 20], opacity: 0.75 },
  // Very gentle: barely-there colour on a faint tint.
  { name: "Pastel", base: 10, wash: null, roles: [20, 30, 15], opacity: 0.6 },
  // Frosted look: a stronger tinted wash over light blobs.
  { name: "Glass", base: "white", wash: { step: 10, opacity: 0.4 }, roles: [20, 35, 10], opacity: 0.6 },
  // Your colour at full strength on white.
  { name: "Bold", base: "white", wash: null, roles: [45, 50, 30], opacity: 0.9 },
  // Tinted base with mid-tone blobs.
  { name: "Tone", base: 15, wash: null, roles: [35, 50, 25], opacity: 0.7 },
];

export const MOOD_NAMES = MOODS.map((m) => m.name);
export const LAYOUT_COUNT = LAYOUTS.length;
export const STYLE_COUNT = MOODS.length * LAYOUTS.length;

/** Index of the first style of `mood`. */
export function moodStart(mood: number): number {
  return mood * LAYOUTS.length;
}

export function moodOf(index: number): number {
  return Math.floor(index / LAYOUTS.length);
}

// ── Tweaks ──────────────────────────────────────────────────────────────────
// Adjustments applied on top of any style.

export interface Tweaks {
  /** Multiplies every blob's opacity (0.4–1.6). */
  intensity: number;
  /** Multiplies the blur (0.5–1.5). */
  softness: number;
  flipX: boolean;
  flipY: boolean;
}

export const DEFAULT_TWEAKS: Tweaks = { intensity: 1, softness: 1, flipX: false, flipY: false };

export function tweak(spec: GradientSpec, t: Tweaks): GradientSpec {
  return {
    ...spec,
    blur: round3(spec.blur * t.softness),
    blobs: spec.blobs.map((b) => ({
      ...b,
      opacity: round3(clamp01(b.opacity * t.intensity)),
      x: t.flipX ? round3(1 - b.x - b.w) : b.x,
      y: t.flipY ? round3(1 - b.y - b.h) : b.y,
    })),
  };
}

export interface Style extends GradientSpec {
  index: number;
}

/** Style `index` (0 to STYLE_COUNT - 1) for `color`. Neighbouring indexes change the layout; every LAYOUT_COUNT the mood changes. */
export function style(color: string, index: number): Style {
  const i = ((index % STYLE_COUNT) + STYLE_COUNT) % STYLE_COUNT;
  const layout = LAYOUTS[i % LAYOUTS.length]!;
  const mood = MOODS[Math.floor(i / LAYOUTS.length)]!;
  const roles = mood.roles.map((step) => shade(color, step));
  return {
    index: i,
    name: `${mood.name} ${layout.name}`,
    base: mood.base === "white" ? "#FFFFFF" : shade(color, mood.base),
    blur: layout.blur,
    wash: mood.wash ? { color: shade(color, mood.wash.step), opacity: mood.wash.opacity } : null,
    blobs: layout.slots.map((sl) => ({
      color: roles[sl.role]!,
      opacity: round3(clamp01(mood.opacity * sl.m)),
      x: sl.x, y: sl.y, w: sl.w, h: sl.h,
    })),
  };
}
