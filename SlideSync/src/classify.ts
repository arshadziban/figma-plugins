// Layer -> output kind. Works on a plain LayerInfo so it never touches Figma globals.
import type { WarningKind } from './slideModel';

export interface PaintInfo {
  type: 'SOLID' | 'GRADIENT' | 'IMAGE' | 'OTHER';
  visible: boolean;
}

export interface LayerInfo {
  /** Figma node type, e.g. "TEXT", "FRAME". */
  type: string;
  visible: boolean;
  fills: PaintInfo[];
  strokes: PaintInfo[];
  strokeDashed: boolean;
  /** False when stroke weights differ per side. */
  uniformStroke: boolean;
  hasEffects: boolean;
  blendMode: string;
  isMask: boolean;
  containsMask: boolean;
  hasTextDescendant: boolean;
  hasChildren: boolean;
  /** Some child is visible (used to drop empty, paintless containers). */
  hasVisibleChild: boolean;
  flipped: boolean;
  uniformCornerRadius: boolean;
  /** Ellipse with a partial sweep / inner radius. */
  hasArcData: boolean;
  /** TEXT only: a visible fill is gradient/image. */
  textNonSolidFill: boolean;
  /** User option: export a group's children separately. */
  ungroup: boolean;
  /** TEXT only: the non-solid fill is a gradient (not an image) and the user chose editable text. */
  gradientTextAsSolid: boolean;
  /** TEXT only: rasterize because its font isn't a Google Font and the option is on. */
  rasterizeFont: boolean;
}

export type OutputKind = 'skip' | 'text' | 'shape' | 'image' | 'container';
export type BackgroundKind = 'none' | 'native' | 'image';

export interface Classification {
  kind: OutputKind;
  reason: string;
  warning?: { kind: WarningKind; message: string };
}

const CONTAINERS = new Set(['GROUP', 'FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION']);
const NATIVE_SHAPES = new Set(['RECTANGLE', 'ELLIPSE']);

export function isContainerType(type: string): boolean {
  return CONTAINERS.has(type);
}

export function isNormalBlend(mode: string): boolean {
  return mode === 'NORMAL' || mode === 'PASS_THROUGH';
}

const visiblePaints = (paints: PaintInfo[]): PaintInfo[] => paints.filter((p) => p.visible);

/** At most one visible paint, and it is solid. Zero paints is allowed. */
function isSimplePaintSet(paints: PaintInfo[]): boolean {
  const v = visiblePaints(paints);
  return v.length === 0 || (v.length === 1 && v[0]?.type === 'SOLID');
}

function image(reason: string, warning?: Classification['warning']): Classification {
  return warning ? { kind: 'image', reason, warning } : { kind: 'image', reason };
}

function classifyText(info: LayerInfo): Classification {
  if (info.textNonSolidFill && info.gradientTextAsSolid) {
    const approx = { kind: 'gradient-text', message: 'Gradient text approximated with its average colour to stay editable.' } as const;
    const rest = classifyText({ ...info, textNonSolidFill: false });
    return rest.kind === 'text' ? { ...rest, warning: approx } : rest;
  }
  if (info.textNonSolidFill) return image('gradient text', { kind: 'gradient-text', message: 'Gradient or image text fill cannot be native; exported as an image.' });
  if (info.flipped) return image('flipped');
  if (info.rasterizeFont) return image('non-google font', { kind: 'font', message: 'Non-Google font rasterized as an image (not editable).' });
  if (info.hasEffects) return image('text effects', { kind: 'effects', message: 'Text has effects (shadow/blur); exported as an image.' });
  if (!isNormalBlend(info.blendMode)) return image('text blend mode', { kind: 'blend', message: 'Text has a blend mode; exported as an image.' });
  return { kind: 'text', reason: 'text' };
}

function nativeShapeEligible(info: LayerInfo): boolean {
  return (
    NATIVE_SHAPES.has(info.type) &&
    isSimplePaintSet(info.fills) &&
    isSimplePaintSet(info.strokes) &&
    visiblePaints(info.strokes).length <= 1 &&
    !info.strokeDashed &&
    info.uniformStroke &&
    !info.hasEffects &&
    isNormalBlend(info.blendMode) &&
    !info.isMask &&
    !info.hasArcData &&
    info.uniformCornerRadius
  );
}

function classifyContainer(info: LayerInfo): Classification {
  if (info.containsMask) {
    return info.hasTextDescendant
      ? image('mask group', { kind: 'mask', message: 'Mask group exported as one image; its text is not editable.' })
      : image('mask group');
  }
  // Mask groups, and groups whose effect/blend belongs to the group as a whole, stay one image above/below.
  const keepsLook = info.hasEffects || !isNormalBlend(info.blendMode);
  if (info.type === 'GROUP' && info.ungroup && !keepsLook && !info.flipped && info.hasVisibleChild) {
    return { kind: 'container', reason: 'ungrouped group' };
  }
  if (!info.hasTextDescendant) {
    const paints = visiblePaints(info.fills).length + visiblePaints(info.strokes).length;
    return paints === 0 && !info.hasEffects && !info.hasVisibleChild ? { kind: 'skip', reason: 'empty container' } : image('container without text');
  }
  if (info.flipped) return image('flipped container', { kind: 'unsupported', message: 'Flipped container with text exported as an image.' });
  if (!isNormalBlend(info.blendMode)) {
    return { kind: 'container', reason: 'container with text', warning: { kind: 'blend', message: 'Container blend mode ignored to keep text editable.' } };
  }
  return { kind: 'container', reason: 'container with text' };
}

export function classifyLayer(info: LayerInfo): Classification {
  if (!info.visible) return { kind: 'skip', reason: 'hidden' };
  if (info.isMask) return image('mask layer');
  if (info.type === 'TEXT') return classifyText(info);
  if (isContainerType(info.type)) return classifyContainer(info);
  if (info.flipped) return image('flipped');
  if (NATIVE_SHAPES.has(info.type)) {
    const paints = visiblePaints(info.fills).length + visiblePaints(info.strokes).length;
    if (paints === 0 && !info.hasEffects) return { kind: 'skip', reason: 'invisible shape' };
    return nativeShapeEligible(info) ? { kind: 'shape', reason: 'plain shape' } : image('complex shape');
  }
  // Vector, boolean op, star, polygon, line and anything unknown.
  return image('vector or other');
}

/**
 * Background of a container we are recursing into (or of the root frame).
 * 'native' = one solid fill + optional solid stroke + uniform radius, no effects.
 */
export function classifyBackground(info: LayerInfo): BackgroundKind {
  const fills = visiblePaints(info.fills);
  const strokes = visiblePaints(info.strokes);
  if (fills.length === 0 && strokes.length === 0 && !info.hasEffects) return 'none';
  if (info.hasEffects) return 'image';
  const native = isSimplePaintSet(info.fills) && isSimplePaintSet(info.strokes) && strokes.length <= 1 && !info.strokeDashed && info.uniformStroke && info.uniformCornerRadius;
  return native ? 'native' : 'image';
}
