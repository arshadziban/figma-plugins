// Coordinate conversion, scaling and rotation. No Figma globals.

export const SLIDE_WIDTH_IN = 10;
export const SLIDE_HEIGHT_16x9_IN = 5.625;
export const PT_PER_IN = 72;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Figma's 2x3 affine matrix: [[a, c, tx], [b, d, ty]]. */
export type Matrix = readonly [readonly [number, number, number], readonly [number, number, number]];

export interface Fit {
  /** Inches per Figma pixel. */
  scale: number;
  /** Inches of left/top margin when the frame is letterboxed. */
  offsetX: number;
  offsetY: number;
  letterboxed: boolean;
}

export function aspectRatio(w: number, h: number): number {
  return w / h;
}

export function is16x9(w: number, h: number): boolean {
  return Math.abs(aspectRatio(w, h) - 16 / 9) < 0.005;
}

/** Custom layout only when every frame shares one aspect ratio that is not 16:9. */
export function decideLayout(frames: ReadonlyArray<{ w: number; h: number }>): { widthIn: number; heightIn: number; custom: boolean } {
  const first = frames[0];
  const uniform = first !== undefined && frames.every((f) => Math.abs(aspectRatio(f.w, f.h) / aspectRatio(first.w, first.h) - 1) < 0.005);
  if (first && uniform && !is16x9(first.w, first.h)) {
    return { widthIn: SLIDE_WIDTH_IN, heightIn: round(SLIDE_WIDTH_IN * (first.h / first.w), 4), custom: true };
  }
  return { widthIn: SLIDE_WIDTH_IN, heightIn: SLIDE_HEIGHT_16x9_IN, custom: false };
}

/** Fit a frame inside the slide, preserving aspect ratio and centring (letterbox). */
export function fitFrame(frameW: number, frameH: number, slideW: number, slideH: number): Fit {
  const scale = Math.min(slideW / frameW, slideH / frameH);
  const offsetX = (slideW - frameW * scale) / 2;
  const offsetY = (slideH - frameH * scale) / 2;
  return { scale, offsetX, offsetY, letterboxed: offsetX > 1e-6 || offsetY > 1e-6 };
}

/** Points per Figma pixel: 1920px frame on a 10in slide -> 0.375. */
export function ptPerPx(fit: Fit): number {
  return fit.scale * PT_PER_IN;
}

/** Frame-relative Figma pixels -> slide inches. */
export function toSlideRect(rel: Rect, fit: Fit): Rect {
  return {
    x: fit.offsetX + rel.x * fit.scale,
    y: fit.offsetY + rel.y * fit.scale,
    w: rel.w * fit.scale,
    h: rel.h * fit.scale,
  };
}

/** Absolute canvas rect -> frame-relative rect. */
export function relativeTo(abs: Rect, frame: Rect): Rect {
  return { x: abs.x - frame.x, y: abs.y - frame.y, w: abs.w, h: abs.h };
}

/**
 * Clockwise rotation in degrees [0, 360).
 * Figma's matrix for a CCW rotation r is [[cos r, sin r], [-sin r, cos r]] in a y-down space,
 * so clockwise = atan2(m10, m00). Read from the matrix, never from x/y (parent transforms count).
 */
export function clockwiseRotation(m: Matrix): number {
  const deg = (Math.atan2(m[1][0], m[0][0]) * 180) / Math.PI;
  return round(((deg % 360) + 360) % 360, 6) % 360;
}

/** A negative determinant means the node is mirrored. */
export function isFlipped(m: Matrix): boolean {
  return m[0][0] * m[1][1] - m[0][1] * m[1][0] < 0;
}

/**
 * PowerPoint stores an UNROTATED box plus an angle about its centre, so convert via the centre:
 * transform the node's local centre to absolute space, then rebuild the box around it.
 */
export function unrotatedBox(m: Matrix, width: number, height: number): Rect {
  const cx = m[0][0] * (width / 2) + m[0][1] * (height / 2) + m[0][2];
  const cy = m[1][0] * (width / 2) + m[1][1] * (height / 2) + m[1][2];
  return { x: cx - width / 2, y: cy - height / 2, w: width, h: height };
}

/** PowerPoint strokes are centred on the edge; Figma's can sit inside or outside. */
export function adjustForStroke(box: Rect, weight: number, align: 'CENTER' | 'INSIDE' | 'OUTSIDE'): Rect {
  const grow = align === 'OUTSIDE' ? weight / 2 : align === 'INSIDE' ? -weight / 2 : 0;
  return { x: box.x - grow, y: box.y - grow, w: box.w + grow * 2, h: box.h + grow * 2 };
}

/**
 * Widen an auto-resizing text box ~2% so font-metric differences don't change line breaks.
 * Grow in the direction the text is anchored (left-aligned grows right, etc.).
 */
export function widenForAutoResize(box: Rect, align: 'left' | 'center' | 'right' | 'justify', tolerance = 0.02): Rect {
  const extra = box.w * tolerance;
  const dx = align === 'right' ? -extra : align === 'center' ? -extra / 2 : 0;
  return { ...box, x: box.x + dx, w: box.w + extra };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * PNG scale giving `multiplier`x the slide's display resolution (1pt = 1 display px).
 * 1920px frame, 2x -> 0.75. Capped so no side exceeds Figma's export limit.
 */
export function exportScale(fit: Fit, multiplier: number, renderW: number, renderH: number, maxSide = 4096): number {
  const wanted = ptPerPx(fit) * multiplier;
  const cap = maxSide / Math.max(renderW, renderH, 1);
  return round(Math.max(0.01, Math.min(wanted, cap)), 4);
}

export function round(n: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
