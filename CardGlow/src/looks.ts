// Card styles. Each style is built from one colour: a look decides the fills,
// border, shadow and glows (all as steps of that colour's ShadesMaker scale,
// plus a few hue-shifted accents), and a direction decides where the light
// comes from. 8 looks × 3 directions = 24 styles, browsed with ◀ ▶.
//
// Glossy, Velvet and Frost are measured from the three reference cards
// (527 × 516 and 549 × 538): radius ≈ 10.4% of the short side, a 3-stop
// diagonal gradient, a white radial highlight at the top left, blurred glows
// at the top and bottom, and a blurred light-ray sparkle at the top right.

import { CardSpec, Direction, Glow, RadialFill, clamp01, hueShift, round3, shade } from "./spec";

const REF_RADIUS = 0.104;

const HIGHLIGHT = (opacity: number): RadialFill => ({
  key: "highlight", label: "Highlight",
  cx: 0.2, cy: 0.1, r: 0.7,
  from: { color: "#FFFFFF", opacity },
  to: { color: "#FFFFFF", opacity: 0 },
});

const accent = (color: string, opacity: number, cx = 0.9, cy = 0.95, r = 0.6, key = "accent", label = "Accent glow"): RadialFill => ({
  key, label, cx, cy, r,
  from: { color, opacity },
  to: { color, opacity: 0 },
});

// Glows measured from the blue card.
const BOTTOM_GLOW = (color: string, opacity: number): Glow => ({ key: "glowBottom", color, opacity, x: 0.183, y: 0.765, w: 0.72, h: 0.622, blur: 0.624 });
const TOP_GLOW = (color: string, opacity: number): Glow => ({ key: "glowTop", color, opacity, x: 0.225, y: -0.217, w: 0.426, h: 0.435, blur: 0.333 });
const SPARKLE = (opacity: number) => ({ color: "#FFFFFF", opacity, x: 0.723, y: -0.295, size: 0.49, blur: 0.115 });

interface Look {
  name: string;
  build: (c: string) => Omit<CardSpec, "name" | "radius">;
}

const LOOKS: Look[] = [
  {
    name: "Glossy",
    build: (c) => ({
      linear: { direction: "tl", stops: [
        { color: shade(c, 35), opacity: 1, position: 0 },
        { color: c, opacity: 1, position: 0.55 },
        { color: shade(c, 68), opacity: 1, position: 1 },
      ] },
      radials: [accent(shade(hueShift(c, -30), 25), 0.55), HIGHLIGHT(0.42)],
      stroke: { color: shade(c, 62), opacity: 1, weight: 0.0021 },
      shadow: { color: shade(c, 60), opacity: 0.18, blur: 0.097, y: 0.043, spread: 0 },
      glows: [BOTTOM_GLOW("#FFFFFF", 0.95), TOP_GLOW(shade(c, 30), 1)],
      sparkle: SPARKLE(0.5),
    }),
  },
  {
    name: "Velvet",
    build: (c) => ({
      linear: { direction: "tl", stops: [
        { color: shade(c, 30), opacity: 1, position: 0 },
        { color: c, opacity: 1, position: 0.55 },
        { color: shade(c, 68), opacity: 1, position: 1 },
      ] },
      radials: [
        { key: "core", label: "Core glow", cx: 0.9, cy: 0.95, r: 0.96, from: { color: shade(c, 40), opacity: 1 }, to: { color: shade(c, 58), opacity: 1 } },
        HIGHLIGHT(0.42),
      ],
      stroke: { color: shade(c, 75), opacity: 1, weight: 0.0021 },
      shadow: { color: shade(c, 60), opacity: 0.18, blur: 0.097, y: 0.043, spread: 0 },
      glows: [
        { key: "glowBottom", color: shade(c, 5), opacity: 1, x: 0.382, y: 0.814, w: 0.586, h: 0.507, blur: 0.624 },
        { key: "glowTop", color: shade(c, 15), opacity: 0.87, x: -0.052, y: -0.247, w: 0.789, h: 0.434, blur: 0.333 },
      ],
      sparkle: SPARKLE(0.5),
    }),
  },
  {
    // The tilted card: a flat fill, a bright glass border and a deep soft shadow.
    name: "Frost",
    build: (c) => ({
      linear: { direction: "tl", stops: [{ color: c, opacity: 1, position: 0 }] },
      radials: [],
      stroke: { color: "#FFFFFF", opacity: 0.55, weight: 0.0055 },
      shadow: { color: shade(c, 85), opacity: 0.15, blur: 0.166, y: 0.083, spread: -0.021 },
      glows: [BOTTOM_GLOW("#FFFFFF", 0.95), TOP_GLOW(shade(c, 30), 1)],
      sparkle: SPARKLE(0.5),
    }),
  },
  {
    name: "Deep",
    build: (c) => ({
      linear: { direction: "tl", stops: [
        { color: c, opacity: 1, position: 0 },
        { color: shade(c, 68), opacity: 1, position: 0.55 },
        { color: shade(c, 85), opacity: 1, position: 1 },
      ] },
      radials: [accent(shade(hueShift(c, -30), 35), 0.45), HIGHLIGHT(0.22)],
      stroke: { color: shade(c, 85), opacity: 1, weight: 0.0021 },
      shadow: { color: shade(c, 80), opacity: 0.3, blur: 0.12, y: 0.05, spread: 0 },
      glows: [BOTTOM_GLOW(shade(c, 30), 0.55), TOP_GLOW(shade(c, 35), 0.9)],
      sparkle: SPARKLE(0.35),
    }),
  },
  {
    name: "Aurora",
    build: (c) => ({
      linear: { direction: "tl", stops: [
        { color: shade(hueShift(c, 35), 30), opacity: 1, position: 0 },
        { color: c, opacity: 1, position: 0.55 },
        { color: shade(hueShift(c, -35), 65), opacity: 1, position: 1 },
      ] },
      radials: [
        accent(shade(hueShift(c, -60), 25), 0.6),
        accent(shade(hueShift(c, 60), 25), 0.45, 0.05, 0.9, 0.5, "accent2", "Second accent"),
        HIGHLIGHT(0.42),
      ],
      stroke: { color: shade(c, 62), opacity: 1, weight: 0.0021 },
      shadow: { color: shade(c, 60), opacity: 0.2, blur: 0.1, y: 0.045, spread: 0 },
      glows: [BOTTOM_GLOW("#FFFFFF", 0.85), TOP_GLOW(shade(hueShift(c, 35), 25), 1)],
      sparkle: SPARKLE(0.5),
    }),
  },
  {
    name: "Pastel",
    build: (c) => ({
      linear: { direction: "tl", stops: [
        { color: shade(c, 10), opacity: 1, position: 0 },
        { color: shade(c, 25), opacity: 1, position: 0.55 },
        { color: shade(c, 40), opacity: 1, position: 1 },
      ] },
      radials: [HIGHLIGHT(0.6)],
      stroke: { color: "#FFFFFF", opacity: 0.7, weight: 0.004 },
      shadow: { color: shade(c, 50), opacity: 0.12, blur: 0.1, y: 0.04, spread: 0 },
      glows: [BOTTOM_GLOW("#FFFFFF", 0.95), TOP_GLOW(shade(c, 15), 1)],
      sparkle: SPARKLE(0.6),
    }),
  },
  {
    name: "Neon",
    build: (c) => ({
      linear: { direction: "tl", stops: [
        { color: shade(c, 40), opacity: 1, position: 0 },
        { color: c, opacity: 1, position: 0.55 },
        { color: shade(c, 62), opacity: 1, position: 1 },
      ] },
      radials: [accent(shade(hueShift(c, 25), 20), 0.8, 0.9, 0.95, 0.65), HIGHLIGHT(0.5)],
      stroke: { color: shade(c, 20), opacity: 0.9, weight: 0.004 },
      shadow: { color: c, opacity: 0.4, blur: 0.12, y: 0.04, spread: 0 },
      glows: [{ ...BOTTOM_GLOW("#FFFFFF", 1), x: 0.1, w: 0.85 }, TOP_GLOW(shade(c, 20), 1)],
      sparkle: SPARKLE(0.7),
    }),
  },
  {
    name: "Satin",
    build: (c) => ({
      linear: { direction: "tl", stops: [
        { color: shade(c, 35), opacity: 1, position: 0 },
        { color: shade(c, 62), opacity: 1, position: 1 },
      ] },
      radials: [{ key: "highlight", label: "Highlight", cx: 0.5, cy: 0, r: 0.8, from: { color: "#FFFFFF", opacity: 0.3 }, to: { color: "#FFFFFF", opacity: 0 } }],
      stroke: { color: shade(c, 65), opacity: 1, weight: 0.0021 },
      shadow: { color: shade(c, 70), opacity: 0.2, blur: 0.1, y: 0.045, spread: 0 },
      glows: [],
      sparkle: SPARKLE(0.45),
    }),
  },
];

const DIRECTIONS: { id: Direction; label: string }[] = [
  { id: "tl", label: "Left light" },
  { id: "tr", label: "Right light" },
  { id: "top", label: "Top light" },
];

export const LOOK_NAMES = LOOKS.map((l) => l.name);
export const DIRECTION_COUNT = DIRECTIONS.length;
export const STYLE_COUNT = LOOKS.length * DIRECTIONS.length;

export function lookOf(index: number): number {
  return Math.floor(index / DIRECTIONS.length);
}

export function lookStart(look: number): number {
  return look * DIRECTIONS.length;
}

/** Mirrors a spec left ↔ right (light from the top right). */
function mirror(spec: CardSpec): CardSpec {
  return {
    ...spec,
    radials: spec.radials.map((r) => ({ ...r, cx: round3(1 - r.cx) })),
    glows: spec.glows.map((g) => ({ ...g, x: round3(1 - g.x - g.w) })),
    sparkle: spec.sparkle ? { ...spec.sparkle, x: round3(1 - spec.sparkle.x - spec.sparkle.size) } : null,
  };
}

/** Light from the top: radials and glows centred horizontally. */
function fromTop(spec: CardSpec): CardSpec {
  return {
    ...spec,
    radials: spec.radials.map((r) => ({ ...r, cx: 0.5 })),
    glows: spec.glows.map((g) => ({ ...g, x: round3((1 - g.w) / 2) })),
  };
}

/** Style `index` (0 to STYLE_COUNT - 1) for `color`. ▶ changes the direction first, then the look. */
export function cardStyle(color: string, index: number): CardSpec {
  const i = ((index % STYLE_COUNT) + STYLE_COUNT) % STYLE_COUNT;
  const look = LOOKS[lookOf(i)]!;
  const dir = DIRECTIONS[i % DIRECTIONS.length]!;
  const base: CardSpec = { name: `${look.name} · ${dir.label}`, radius: REF_RADIUS, ...look.build(color) };
  base.linear = { ...base.linear, direction: dir.id };
  if (dir.id === "tr") return mirror(base);
  if (dir.id === "top") return fromTop(base);
  return base;
}

// ── Tweaks ──────────────────────────────────────────────────────────────────

export interface Tweaks {
  /** Corner radius as a fraction of the short side (0–0.3). */
  radius: number;
  glows: boolean;
  sparkle: boolean;
  shadow: boolean;
  border: boolean;
  /** Multiplies glow, sparkle and radial opacity (0.4–1.6). */
  shine: number;
}

export const DEFAULT_TWEAKS: Tweaks = { radius: REF_RADIUS, glows: true, sparkle: true, shadow: true, border: true, shine: 1 };

export function tweak(spec: CardSpec, t: Tweaks): CardSpec {
  const k = (o: number) => round3(clamp01(o * t.shine));
  return {
    ...spec,
    radius: t.radius,
    radials: spec.radials.map((r) => ({ ...r, from: { ...r.from, opacity: k(r.from.opacity) }, to: { ...r.to, opacity: r.to.opacity === 1 ? 1 : k(r.to.opacity) } })),
    glows: t.glows ? spec.glows.map((g) => ({ ...g, opacity: k(g.opacity) })) : [],
    sparkle: t.sparkle && spec.sparkle ? { ...spec.sparkle, opacity: k(spec.sparkle.opacity) } : null,
    shadow: t.shadow ? spec.shadow : null,
    stroke: t.border ? spec.stroke : null,
  };
}

// ── Colours ─────────────────────────────────────────────────────────────────
// Every colour of a card has a stable key, so a colour the user picks for,
// say, the border stays when they move to another style.

/** Colours of the sample content and of "Make selection glass". */
export interface ContentColors {
  text: string;
  glass: string;
  badge: string;
  number: string;
}

export function defaultContent(color: string): ContentColors {
  return { text: "#FFFFFF", glass: "#FFFFFF", badge: "#FFFFFF", number: color };
}

export type Overrides = Record<string, string>;

export interface ColorSlot {
  key: string;
  label: string;
  color: string;
  group: "Card" | "Glows" | "Content";
}

function stopKeys(count: number): { key: string; label: string }[] {
  if (count === 1) return [{ key: "fill", label: "Fill" }];
  if (count === 2) return [{ key: "start", label: "Gradient start" }, { key: "end", label: "Gradient end" }];
  return [{ key: "start", label: "Gradient start" }, { key: "middle", label: "Gradient middle" }, { key: "end", label: "Gradient end" }];
}

const GLOW_LABELS: Record<string, string> = { glowBottom: "Bottom glow", glowTop: "Top glow" };

/** The colours the current style uses, after overrides, in display order. */
export function colorSlots(spec: CardSpec, content: ContentColors | null): ColorSlot[] {
  const slots: ColorSlot[] = [];
  const keys = stopKeys(spec.linear.stops.length);
  spec.linear.stops.forEach((st, i) => slots.push({ ...keys[i]!, color: st.color, group: "Card" }));
  if (spec.stroke) slots.push({ key: "border", label: "Border", color: spec.stroke.color, group: "Card" });
  if (spec.shadow) slots.push({ key: "shadow", label: "Shadow", color: spec.shadow.color, group: "Card" });
  for (const r of spec.radials) {
    slots.push({ key: r.key, label: r.label, color: r.from.color, group: "Glows" });
    if (r.to.color !== r.from.color) slots.push({ key: `${r.key}Edge`, label: `${r.label} edge`, color: r.to.color, group: "Glows" });
  }
  for (const g of spec.glows) slots.push({ key: g.key, label: GLOW_LABELS[g.key] ?? "Glow", color: g.color, group: "Glows" });
  if (spec.sparkle) slots.push({ key: "sparkle", label: "Sparkle", color: spec.sparkle.color, group: "Glows" });
  if (content) {
    slots.push(
      { key: "text", label: "Text", color: content.text, group: "Content" },
      { key: "glass", label: "Glass", color: content.glass, group: "Content" },
      { key: "badge", label: "Badge", color: content.badge, group: "Content" },
      { key: "number", label: "Badge number", color: content.number, group: "Content" },
    );
  }
  return slots;
}

/** Applies the user's colour choices to a spec. */
export function recolor(spec: CardSpec, o: Overrides): CardSpec {
  const keys = stopKeys(spec.linear.stops.length);
  return {
    ...spec,
    linear: { ...spec.linear, stops: spec.linear.stops.map((st, i) => ({ ...st, color: o[keys[i]!.key] ?? st.color })) },
    radials: spec.radials.map((r) => {
      const sameColor = r.to.color === r.from.color;
      const from = o[r.key] ?? r.from.color;
      const to = sameColor ? from : o[`${r.key}Edge`] ?? r.to.color;
      return { ...r, from: { ...r.from, color: from }, to: { ...r.to, color: to } };
    }),
    stroke: spec.stroke ? { ...spec.stroke, color: o.border ?? spec.stroke.color } : null,
    shadow: spec.shadow ? { ...spec.shadow, color: o.shadow ?? spec.shadow.color } : null,
    glows: spec.glows.map((g) => ({ ...g, color: o[g.key] ?? g.color })),
    sparkle: spec.sparkle ? { ...spec.sparkle, color: o.sparkle ?? spec.sparkle.color } : null,
  };
}

export function contentColors(color: string, o: Overrides): ContentColors {
  const d = defaultContent(color);
  return { text: o.text ?? d.text, glass: o.glass ?? d.glass, badge: o.badge ?? d.badge, number: o.number ?? d.number };
}
