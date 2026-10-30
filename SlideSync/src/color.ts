// Figma RGBA -> hex + transparency. No Figma globals.

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface PptxColor {
  hex: string;
  /** 0 = opaque, 100 = invisible. */
  transparency: number;
}

function channel(v: number): string {
  const n = Math.max(0, Math.min(255, Math.round(v * 255)));
  return n.toString(16).padStart(2, '0').toUpperCase();
}

export function rgbToHex(c: RGB): string {
  return channel(c.r) + channel(c.g) + channel(c.b);
}

export function opacityToTransparency(opacity: number): number {
  return Math.round((1 - Math.max(0, Math.min(1, opacity))) * 100);
}

/** Paint opacity, colour alpha and every layer opacity multiply into one transparency. */
export function solidToColor(c: RGB & { a?: number }, ...opacities: number[]): PptxColor {
  const combined = opacities.reduce((acc, o) => acc * o, c.a ?? 1);
  return { hex: rgbToHex(c), transparency: opacityToTransparency(combined) };
}
