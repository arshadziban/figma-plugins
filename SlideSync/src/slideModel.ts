// The typed intermediate model shared by the main thread and the UI.
// Plain JSON only (images travel separately as Uint8Array) so it survives postMessage.

export type WarningKind =
  | 'unsupported'
  | 'font'
  | 'missing-font'
  | 'letterbox'
  | 'mask'
  | 'gradient-text'
  | 'effects'
  | 'blend'
  | 'size'
  | 'skipped'
  | 'clone';

export interface SlideWarning {
  frameId: string;
  kind: WarningKind;
  message: string;
  /** Figma node to reveal when the warning is clicked. */
  nodeId?: string;
  layerName?: string;
}

export type ObjectKind = 'text' | 'shape' | 'image';

interface ObjectBase {
  /** Sanitized, unique id for internal use. */
  id: string;
  /** Original Figma layer name; shown in the Selection Pane / alt text. */
  name: string;
  figmaId: string;
  /** Inches, relative to the slide's top-left. For rotated objects: the UNROTATED box. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, clockwise (PowerPoint convention). */
  rotation: number;
}

export interface TextRunModel {
  text: string;
  fontFace: string;
  fontSizePt: number;
  bold: boolean;
  italic: boolean;
  colorHex: string;
  /** 0 = opaque, 100 = invisible (PptxGenJS convention). */
  transparency: number;
  underline: boolean;
  strike: boolean;
  hyperlink?: string;
  charSpacingPt: number;
  lineSpacingPt?: number;
}

export type HAlign = 'left' | 'center' | 'right' | 'justify';
export type VAlign = 'top' | 'middle' | 'bottom';

export interface TextObject extends ObjectBase {
  kind: 'text';
  runs: TextRunModel[];
  align: HAlign;
  valign: VAlign;
  paragraphSpacingPt: number;
}

export type ShapeType = 'rect' | 'roundRect' | 'ellipse';

export interface ShapeObject extends ObjectBase {
  kind: 'shape';
  shape: ShapeType;
  fill?: { hex: string; transparency: number };
  line?: { hex: string; transparency: number; widthPt: number };
  /** Inches. Only meaningful for roundRect. */
  radiusIn: number;
}

export interface ImageObject extends ObjectBase {
  kind: 'image';
  /** Key into the slide's image map. */
  imageId: string;
  /** Alpha multiplier the UI must bake into the PNG (1 = leave untouched). */
  bakeOpacity: number;
}

export type SlideObject = TextObject | ShapeObject | ImageObject;

export type SlideBackground =
  | { kind: 'none' }
  | { kind: 'solid'; hex: string; transparency: number }
  | { kind: 'image'; imageId: string };

export interface SlideModel {
  frameId: string;
  frameName: string;
  background: SlideBackground;
  /** Bottom to top. A background image, if any, is emitted as the first object instead. */
  objects: SlideObject[];
  warnings: SlideWarning[];
  /** Layer report for the speaker notes, when enabled. */
  notes?: string;
}

export interface DeckLayout {
  widthIn: number;
  heightIn: number;
}

export interface ExportOptions {
  /** PNG resolution multiplier relative to the slide's display size (1, 2 or 3). */
  resolution: 1 | 2 | 3;
  rasterizeNonGoogleFonts: boolean;
  /** 'solid' keeps gradient text editable using its average colour; 'image' keeps the look. */
  gradientText: 'image' | 'solid';
  layerReport: boolean;
  filename: string;
}

export interface FrameInfo {
  id: string;
  name: string;
  width: number;
  height: number;
  is16x9: boolean;
}

// ---- Messages -------------------------------------------------------------

export type MainToUi =
  | { type: 'selection'; selectionText: string; frames: FrameInfo[]; ignored: number; fileName: string; opacityApplied: boolean | null }
  | { type: 'start'; layout: DeckLayout; slideCount: number }
  | { type: 'progress'; frameIndex: number; frameCount: number; frameName: string; layerIndex: number; layerCount: number }
  | { type: 'slide'; slide: SlideModel; images: Record<string, Uint8Array> }
  | { type: 'done' }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }
  | { type: 'probe-bytes'; bytes: Uint8Array }
  | { type: 'thumb'; id: string; bytes: Uint8Array };

export type UiToMain =
  | { type: 'ready' }
  | { type: 'export'; frameIds: string[]; options: ExportOptions }
  | { type: 'cancel' }
  | { type: 'reveal'; nodeId: string }
  | { type: 'probe' }
  | { type: 'probe-result'; appliesOpacity: boolean };
