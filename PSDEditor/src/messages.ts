// Messages and the layer model shared by the UI (which parses the PSD) and the
// main thread (which builds Figma nodes).

export type RGB01 = { r: number; g: number; b: number };

export interface EffectModel {
  kind: "drop" | "inner" | "glow" | "innerGlow";
  color: RGB01;
  opacity: number;
  x: number;
  y: number;
  blur: number;
  spread: number;
}

export interface StrokeModel {
  color: RGB01;
  opacity: number;
  width: number;
  align: "INSIDE" | "CENTER" | "OUTSIDE";
  cap?: "NONE" | "ROUND" | "SQUARE";
  join?: "MITER" | "BEVEL" | "ROUND";
  dashes?: number[];
}

export interface TextRun {
  start: number;
  end: number;
  font: string;
  size: number;
  color: RGB01;
  tracking: number; // px
  lineHeight: number | null; // px, null = auto
  underline: boolean;
  strike: boolean;
  caps: boolean;
}

export interface PathModel {
  data: string; // SVG-style path, relative to the layer's top-left
  rule: "EVENODD" | "NONZERO";
}

export interface LayerModel {
  name: string;
  kind: "group" | "raster" | "text" | "shape" | "smart";
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  hidden: boolean;
  blend: string; // Figma BlendMode
  clipping: boolean;
  effects: EffectModel[];
  stroke?: StrokeModel;
  fill?: { color: RGB01; opacity: number };
  imageId?: number; // PNG sent ahead of the tree
  softAlpha?: boolean; // the image carries its own transparency, so its node's box isn't its outline
  cornerRadius?: number; // smart object traced to a (rounded) rectangle
  children?: LayerModel[];
  // text
  text?: string;
  runs?: TextRun[];
  align?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  boxed?: boolean;
  // shape
  paths?: PathModel[];
}

export interface DocModel {
  name: string;
  width: number;
  height: number;
  layers: LayerModel[];
  warnings: string[];
}

export type ToMain =
  | { type: "image"; id: number; bytes: Uint8Array }
  | { type: "build"; doc: DocModel; keepHidden: boolean }
  | { type: "cancel" };

export type ToUI =
  | { type: "progress"; done: number; total: number; label: string }
  | { type: "done"; created: number; text: number; shapes: number; smart: number; images: number; warnings: string[] }
  | { type: "error"; message: string };
