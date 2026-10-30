// Main thread: reads the selection, walks layers, classifies, exports PNGs, streams slide models to the UI.
// Read-only on the user's document. The single allowed write is the temporary container-background
// clone (and the opt-in opacity probe), both removed in try/finally.
import { classifyBackground, classifyLayer } from './classify';
import type { LayerInfo, PaintInfo } from './classify';
import { solidToColor } from './color';
import { isGoogleFont } from './fonts';
import {
  adjustForStroke,
  clockwiseRotation,
  decideLayout,
  exportScale,
  fitFrame,
  is16x9,
  isFlipped,
  overlaps,
  ptPerPx,
  relativeTo,
  toSlideRect,
  unrotatedBox,
  widenForAutoResize,
} from './geometry';
import type { Fit, Matrix, Rect } from './geometry';
import { uniqueName } from './naming';
import type {
  ExportOptions,
  FrameInfo,
  HAlign,
  ImageObject,
  MainToUi,
  ShapeObject,
  SlideModel,
  SlideObject,
  SlideWarning,
  TextObject,
  UiToMain,
  VAlign,
  WarningKind,
} from './slideModel';
import { segmentsToRuns } from './text';
import type { SegmentInfo } from './text';

const OPACITY_KEY = 'slidesync.exportAppliesOpacity';
const LARGE_FRAME_PX = 4000;
const FRAME_TYPES = new Set(['FRAME', 'COMPONENT']);

/** Containers whose own paint we know how to read. */
type PaintedContainer = FrameNode | ComponentNode | ComponentSetNode | InstanceNode;

class CancelledError extends Error {}

let cancelled = false;
let busy = false;

function send(msg: MainToUi): void {
  figma.ui.postMessage(msg);
}

figma.showUI(__html__, { width: 440, height: 700, themeColors: true });

// ---- Selection ------------------------------------------------------------

/** Frames/components from the selection; sections contribute their child frames. */
function selectedFrames(): { frames: Array<FrameNode | ComponentNode>; ignored: number } {
  const frames: Array<FrameNode | ComponentNode> = [];
  let ignored = 0;
  const take = (n: SceneNode): void => {
    if (n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'INSTANCE') frames.push(n as FrameNode | ComponentNode);
    else ignored++;
  };
  for (const node of figma.currentPage.selection) {
    if (node.type === 'SECTION') {
      for (const child of node.children) if (FRAME_TYPES.has(child.type)) take(child);
    } else take(node);
  }
  // A frame selected together with one of its own ancestors would be exported twice.
  const ids = new Set(frames.map((f) => f.id));
  const hasSelectedAncestor = (f: SceneNode): boolean => {
    for (let p = f.parent; p; p = 'parent' in p ? p.parent : null) if (ids.has(p.id)) return true;
    return false;
  };
  const unique = frames.filter((f) => !hasSelectedAncestor(f));
  return { frames: unique, ignored: ignored + (frames.length - unique.length) };
}

function frameInfo(f: FrameNode | ComponentNode): FrameInfo {
  return { id: f.id, name: f.name, width: Math.round(f.width), height: Math.round(f.height), is16x9: is16x9(f.width, f.height) };
}

function defaultFileName(): string {
  return `my_slide ${new Date().toISOString().slice(0, 10)}`;
}

function describeSelection(): string {
  const sel = figma.currentPage.selection;
  return sel.length === 0 ? 'Nothing selected on this page.' : `Selected: ${sel.map((n) => `${n.name} (${n.type})`).join(', ')}`;
}

async function postSelection(): Promise<void> {
  try {
    await postSelectionUnsafe();
  } catch (e) {
    send({ type: 'error', message: `Selection error: ${errMsg(e)}` });
  }
}

async function postSelectionUnsafe(): Promise<void> {
  const { frames, ignored } = selectedFrames();
  const stored: unknown = await figma.clientStorage.getAsync(OPACITY_KEY).catch(() => undefined);
  send({
    selectionText: describeSelection(),
    type: 'selection',
    frames: frames.map(frameInfo),
    ignored,
    fileName: defaultFileName(),
    opacityApplied: typeof stored === 'boolean' ? stored : null,
  });
  void sendThumbs();
}

/** Small preview PNGs for the frame list; sent once per frame, sequentially, never while exporting. */
const thumbsSent = new Set<string>();
let thumbsRunning = false;

async function sendThumbs(): Promise<void> {
  if (thumbsRunning) return;
  thumbsRunning = true;
  try {
    for (const frame of selectedFrames().frames) {
      if (busy) break;
      if (thumbsSent.has(frame.id)) continue;
      thumbsSent.add(frame.id);
      try {
        const bytes = await frame.exportAsync({ format: 'PNG', constraint: { type: 'WIDTH', value: 96 } });
        send({ type: 'thumb', id: frame.id, bytes });
      } catch {
        // A missing thumbnail is cosmetic.
      }
    }
  } finally {
    thumbsRunning = false;
  }
}

figma.on('selectionchange', () => void postSelection());

// ---- Messages -------------------------------------------------------------

figma.ui.onmessage = (msg: UiToMain): void => {
  switch (msg.type) {
    case 'ready':
      void postSelection();
      break;
    case 'export':
      void runExport(msg.frameIds, msg.options);
      break;
    case 'cancel':
      cancelled = true;
      break;
    case 'reveal':
      void reveal(msg.nodeId);
      break;
    case 'probe':
      void runOpacityProbe();
      break;
    case 'probe-result':
      void figma.clientStorage.setAsync(OPACITY_KEY, msg.appliesOpacity).then(postSelection);
      break;
  }
};

async function reveal(nodeId: string): Promise<void> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || node.type === 'DOCUMENT' || node.type === 'PAGE') return;
  // Selecting and zooming is a view change, not a document edit.
  figma.currentPage.selection = [node as SceneNode];
  figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
}

// ---- Offscreen helpers ----------------------------------------------------

function offscreenX(): number {
  let right = 0;
  for (const n of figma.currentPage.children) {
    const box = n.absoluteBoundingBox;
    if (box) right = Math.max(right, box.x + box.width);
  }
  return right + 10000;
}

/**
 * Dev-only, user-triggered: renders a 50%-opacity temp rectangle so the UI can read its alpha and
 * tell us whether exportAsync already bakes a node's own opacity. Removed in finally.
 */
async function runOpacityProbe(): Promise<void> {
  let rect: RectangleNode | null = null;
  try {
    rect = figma.createRectangle();
    rect.resize(16, 16);
    rect.x = offscreenX();
    rect.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    rect.opacity = 0.5;
    const bytes = await rect.exportAsync({ format: 'PNG' });
    send({ type: 'probe-bytes', bytes });
  } catch (e) {
    send({ type: 'error', message: `Opacity probe failed: ${errMsg(e)}` });
  } finally {
    if (rect && !rect.removed) rect.remove();
  }
}

// ---- Export context -------------------------------------------------------

interface Ctx {
  frame: FrameNode | ComponentNode;
  frameBox: Rect;
  clips: boolean;
  fit: Fit;
  options: ExportOptions;
  /** True when exportAsync already applies the node's own opacity (see README, "Opacity"). */
  exportAppliesOpacity: boolean;
  objects: SlideObject[];
  images: Record<string, Uint8Array>;
  warnings: SlideWarning[];
  report: string[];
  usedIds: Set<string>;
  imageCounter: number;
  layerIndex: number;
  layerCount: number;
  frameIndex: number;
  frameCount: number;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function warn(ctx: Ctx, kind: WarningKind, message: string, node?: BaseNode): void {
  const w: SlideWarning = { frameId: ctx.frame.id, kind, message };
  if (node) {
    w.nodeId = node.id;
    w.layerName = node.name;
  }
  ctx.warnings.push(w);
}

function boxOf(node: SceneNode): Rect | null {
  const b = node.absoluteBoundingBox;
  return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
}

function renderBoxOf(node: SceneNode): Rect | null {
  const b = ('absoluteRenderBounds' in node ? node.absoluteRenderBounds : null) ?? node.absoluteBoundingBox;
  return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
}

function matrixOf(node: SceneNode): Matrix {
  const t = node.absoluteTransform;
  return [
    [t[0][0], t[0][1], t[0][2]],
    [t[1][0], t[1][1], t[1][2]],
  ];
}

// ---- Layer description (Figma node -> LayerInfo) --------------------------

function paintInfo(paints: ReadonlyArray<Paint> | PluginAPI['mixed'] | undefined): PaintInfo[] {
  // Groups have no fills at all: that is "no paint", not "unknown paint".
  if (!paints) return [];
  if (paints === figma.mixed) return [{ type: 'OTHER', visible: true }];
  return paints.map((p) => ({
    visible: p.visible !== false,
    type: p.type === 'SOLID' ? 'SOLID' : p.type.startsWith('GRADIENT') ? 'GRADIENT' : p.type === 'IMAGE' ? 'IMAGE' : 'OTHER',
  }));
}

function hasVisibleEffects(node: SceneNode): boolean {
  return 'effects' in node && node.effects.some((e) => e.visible !== false);
}

function descendantsContain(node: SceneNode, pred: (n: SceneNode) => boolean): boolean {
  return 'findAll' in node ? node.findAll(pred).length > 0 : false;
}

function cornerInfo(node: SceneNode): boolean {
  if (!('cornerRadius' in node)) return true;
  return node.cornerRadius !== figma.mixed;
}

/** First visible paint type of each styled segment; segments with no visible fill are ignored. */
function textFillTypes(node: TextNode): Array<PaintInfo['type']> {
  const types: Array<PaintInfo['type']> = [];
  for (const seg of node.getStyledTextSegments(['fills'])) {
    const first = paintInfo(seg.fills).find((p) => p.visible);
    if (first) types.push(first.type);
  }
  return types;
}

function describe(node: SceneNode, options: ExportOptions): LayerInfo {
  const isText = node.type === 'TEXT';
  const fills = 'fills' in node ? node.fills : undefined;
  const strokes = 'strokes' in node ? node.strokes : [];
  const dashes = 'dashPattern' in node ? node.dashPattern : [];
  const weight = 'strokeWeight' in node ? node.strokeWeight : 0;
  const container = 'children' in node;
  let textNonSolid = false;
  let gradientSolid = false;
  let rasterizeFont = false;
  if (isText) {
    // Why per segment: a text layer with mixed fills reports `figma.mixed` for node.fills, so look at each run.
    const firstTypes = textFillTypes(node);
    textNonSolid = firstTypes.some((t) => t !== 'SOLID');
    gradientSolid = textNonSolid && options.gradientText === 'solid' && firstTypes.every((t) => t === 'SOLID' || t === 'GRADIENT');
    const fonts = node.getRangeAllFontNames(0, node.characters.length);
    rasterizeFont = options.rasterizeNonGoogleFonts && fonts.some((f) => !isGoogleFont(f.family));
  }
  return {
    type: node.type,
    visible: node.visible,
    fills: paintInfo(fills),
    strokes: paintInfo(strokes),
    strokeDashed: dashes.length > 0,
    uniformStroke: weight !== figma.mixed,
    hasEffects: hasVisibleEffects(node),
    blendMode: 'blendMode' in node ? node.blendMode : 'NORMAL',
    isMask: 'isMask' in node && node.isMask,
    containsMask: container && node.children.some((c) => 'isMask' in c && c.isMask),
    hasTextDescendant: container && descendantsContain(node, (n) => n.type === 'TEXT' && n.visible),
    hasChildren: container && node.children.length > 0,
    hasVisibleChild: container && node.children.some((c) => c.visible),
    flipped: isFlipped(matrixOf(node)),
    uniformCornerRadius: cornerInfo(node),
    hasArcData: node.type === 'ELLIPSE' && (node.arcData.endingAngle - node.arcData.startingAngle !== Math.PI * 2 || node.arcData.innerRadius > 0),
    textNonSolidFill: textNonSolid,
    ungroup: options.ungroupGroups,
    gradientTextAsSolid: gradientSolid,
    rasterizeFont,
  };
}

// ---- Emitters -------------------------------------------------------------

/** Opacity of every ancestor multiplies in; Figma never bakes ancestors into a child's export. */
function effectiveOpacity(node: SceneNode, inherited: number): number {
  return inherited * ('opacity' in node ? node.opacity : 1);
}

function firstVisibleSolid(paints: ReadonlyArray<Paint> | PluginAPI['mixed']): SolidPaint | null {
  if (paints === figma.mixed) return null;
  for (const p of paints) if (p.visible !== false && p.type === 'SOLID') return p;
  return null;
}

/** Solid paint as-is; gradient paint as the average of its stops (editable-text fallback). */
function firstVisibleColor(paints: ReadonlyArray<Paint> | PluginAPI['mixed']): { color: RGBA; opacity: number } | null {
  if (paints === figma.mixed) return null;
  for (const p of paints) {
    if (p.visible === false) continue;
    if (p.type === 'SOLID') return { color: { ...p.color, a: 1 }, opacity: p.opacity ?? 1 };
    if (p.type.startsWith('GRADIENT') && 'gradientStops' in p && p.gradientStops.length > 0) {
      const n = p.gradientStops.length;
      const sum = p.gradientStops.reduce((acc, s) => ({ r: acc.r + s.color.r, g: acc.g + s.color.g, b: acc.b + s.color.b, a: acc.a + s.color.a }), { r: 0, g: 0, b: 0, a: 0 });
      return { color: { r: sum.r / n, g: sum.g / n, b: sum.b / n, a: sum.a / n }, opacity: p.opacity ?? 1 };
    }
  }
  return null;
}

function register(ctx: Ctx, node: SceneNode, kind: string): { id: string; name: string } {
  const id = uniqueName(node.name, ctx.usedIds);
  ctx.report.push(`${node.name} | ${kind} | ${node.id}`);
  return { id, name: node.name };
}

function makeBox(ctx: Ctx, abs: Rect): Rect {
  return toSlideRect(relativeTo(abs, ctx.frameBox), ctx.fit);
}

function textAlign(node: TextNode): HAlign {
  const map: Record<string, HAlign> = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' };
  return map[node.textAlignHorizontal] ?? 'left';
}

function textValign(node: TextNode): VAlign {
  const map: Record<string, VAlign> = { TOP: 'top', CENTER: 'middle', BOTTOM: 'bottom' };
  return map[node.textAlignVertical] ?? 'top';
}

function segmentInfos(node: TextNode, opacity: number): SegmentInfo[] {
  const segments = node.getStyledTextSegments(['fontName', 'fontSize', 'fontWeight', 'fills', 'textDecoration', 'textCase', 'letterSpacing', 'lineHeight', 'hyperlink']);
  return segments.map((s) => {
    const fill = firstVisibleColor(s.fills);
    const color = fill ? solidToColor(fill.color, fill.opacity, opacity) : { hex: '000000', transparency: 0 };
    const info: SegmentInfo = {
      characters: s.characters,
      fontFamily: s.fontName.family,
      fontStyle: s.fontName.style,
      fontWeight: s.fontWeight,
      fontSizePx: s.fontSize,
      colorHex: color.hex,
      transparency: color.transparency,
      textDecoration: s.textDecoration === 'UNDERLINE' || s.textDecoration === 'STRIKETHROUGH' ? s.textDecoration : 'NONE',
      textCase: s.textCase,
      letterSpacing: { value: s.letterSpacing.value, unit: s.letterSpacing.unit },
      lineHeight: s.lineHeight.unit === 'AUTO' ? { unit: 'AUTO' } : { value: s.lineHeight.value, unit: s.lineHeight.unit },
    };
    if (s.hyperlink && s.hyperlink.type === 'URL') info.hyperlinkUrl = s.hyperlink.value;
    return info;
  });
}

function emitText(ctx: Ctx, node: TextNode, inherited: number): void {
  const opacity = effectiveOpacity(node, inherited);
  const rotation = clockwiseRotation(matrixOf(node));
  const align = textAlign(node);
  let abs = unrotatedBox(matrixOf(node), node.width, node.height);
  // Why: font metrics differ between Figma and PowerPoint/Slides; a little slack avoids new line breaks.
  if (node.textAutoResize === 'WIDTH_AND_HEIGHT' || node.textAutoResize === 'HEIGHT') {
    abs = widenForAutoResize(abs, rotation === 0 ? align : 'center');
  }
  const { id, name } = register(ctx, node, 'text');
  const paragraphSpacing = typeof node.paragraphSpacing === 'number' ? node.paragraphSpacing : 0;
  const obj: TextObject = {
    kind: 'text',
    id,
    name,
    figmaId: node.id,
    ...makeBox(ctx, abs),
    rotation,
    runs: segmentsToRuns(segmentInfos(node, opacity), ptPerPx(ctx.fit)),
    align,
    valign: textValign(node),
    paragraphSpacingPt: Math.round(paragraphSpacing * ptPerPx(ctx.fit) * 100) / 100,
  };
  ctx.objects.push(obj);
}

function strokeOf(node: SceneNode, opacity: number, fit: Fit): ShapeObject['line'] | undefined {
  if (!('strokes' in node) || node.strokeWeight === figma.mixed) return undefined;
  const solid = firstVisibleSolid(node.strokes);
  if (!solid || node.strokeWeight <= 0) return undefined;
  const c = solidToColor(solid.color, solid.opacity ?? 1, opacity);
  return { hex: c.hex, transparency: c.transparency, widthPt: Math.round(node.strokeWeight * ptPerPx(fit) * 100) / 100 };
}

function radiusPx(node: SceneNode): number {
  return 'cornerRadius' in node && typeof node.cornerRadius === 'number' ? node.cornerRadius : 0;
}

/** Native rectangle/ellipse/rounded-rectangle from any node with a plain fill and stroke. */
function emitNativeShape(ctx: Ctx, node: SceneNode, inherited: number, kindLabel: string): void {
  const opacity = effectiveOpacity(node, inherited);
  const fillPaint = 'fills' in node ? firstVisibleSolid(node.fills) : null;
  const line = strokeOf(node, opacity, ctx.fit);
  let abs = unrotatedBox(matrixOf(node), node.width, node.height);
  // Why: PowerPoint centres strokes on the edge; Figma's inside/outside strokes shift the visible box.
  if (line && 'strokeAlign' in node && 'strokeWeight' in node && typeof node.strokeWeight === 'number') {
    abs = adjustForStroke(abs, node.strokeWeight, node.strokeAlign);
  }
  const box = makeBox(ctx, abs);
  const r = radiusPx(node);
  const { id, name } = register(ctx, node, kindLabel);
  const obj: ShapeObject = {
    kind: 'shape',
    id,
    name,
    figmaId: node.id,
    ...box,
    rotation: clockwiseRotation(matrixOf(node)),
    shape: node.type === 'ELLIPSE' ? 'ellipse' : r > 0 ? 'roundRect' : 'rect',
    radiusIn: Math.min(r * ctx.fit.scale, Math.min(box.w, box.h) / 2),
  };
  if (fillPaint) obj.fill = solidToColor(fillPaint.color, fillPaint.opacity ?? 1, opacity);
  if (line) obj.line = line;
  ctx.objects.push(obj);
}

interface ExportResult {
  bytes: Uint8Array;
  /** Absolute canvas rect the PNG covers (render bounds: includes shadow/blur overflow). */
  bounds: Rect;
}

async function exportPng(node: SceneNode, ctx: Ctx, bounds: Rect): Promise<Uint8Array> {
  const scale = exportScale(ctx.fit, ctx.options.resolution, bounds.w, bounds.h);
  return node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
}

function pushImage(ctx: Ctx, node: SceneNode, result: ExportResult, bake: number, label: string): void {
  // Why the frame index: the UI merges every slide's images into one map, so ids must be unique per deck.
  const imageId = `f${ctx.frameIndex}_img${++ctx.imageCounter}`;
  ctx.images[imageId] = result.bytes;
  const { id, name } = register(ctx, node, label);
  const obj: ImageObject = {
    kind: 'image',
    id,
    name,
    figmaId: node.id,
    ...makeBox(ctx, result.bounds),
    rotation: 0, // render bounds are axis-aligned and the PNG already contains the rotation
    imageId,
    bakeOpacity: bake,
  };
  ctx.objects.push(obj);
}

/** Alpha the UI must still bake in: ancestors always, the node's own only if export didn't. */
function bakeFactor(ctx: Ctx, node: SceneNode, inherited: number): number {
  const own = 'opacity' in node ? node.opacity : 1;
  return ctx.exportAppliesOpacity ? inherited : inherited * own;
}

async function emitImage(ctx: Ctx, node: SceneNode, inherited: number, label = 'image'): Promise<void> {
  // Why render bounds: the PNG includes blur/shadow overflow, so placing it by the plain box would shift and squash it.
  const bounds = renderBoxOf(node);
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) {
    warn(ctx, 'skipped', 'Layer has no render bounds; skipped.', node);
    return;
  }
  const bytes = await exportPng(node, ctx, bounds);
  pushImage(ctx, node, { bytes, bounds }, bakeFactor(ctx, node, inherited), label);
}

// ---- Container backgrounds (the one allowed write) ------------------------

/**
 * Export a container's own paint without its children by cloning it offscreen, emptying the clone,
 * exporting, then removing it in finally. Nothing inside the user's frame is ever edited.
 */
async function exportContainerBackground(ctx: Ctx, node: PaintedContainer, inherited: number): Promise<void> {
  const before = figma.currentPage.children.length;
  let clone: SceneNode | null = null;
  try {
    clone = node.clone();
    // clone() lands beside the original; move it to the page root, far from user content.
    figma.currentPage.appendChild(clone);
    clone.x = offscreenX();
    clone.y = 0;
    let host: PaintedContainer;
    if (clone.type === 'INSTANCE') {
      host = clone.detachInstance();
      clone = host;
    } else host = clone as PaintedContainer;
    for (const child of [...host.children]) child.remove();
    const cloneRender = renderBoxOf(host);
    const cloneBox = boxOf(host);
    const origBox = boxOf(node);
    if (!cloneRender || !cloneBox || !origBox) throw new Error('no bounds');
    const bytes = await exportPng(host, ctx, cloneRender);
    // Map the clone's render overflow back onto the original's position.
    const bounds: Rect = {
      x: origBox.x + (cloneRender.x - cloneBox.x),
      y: origBox.y + (cloneRender.y - cloneBox.y),
      w: cloneRender.w,
      h: cloneRender.h,
    };
    pushImage(ctx, node, { bytes, bounds }, bakeFactor(ctx, node, inherited), 'container background');
  } finally {
    if (clone && !clone.removed) clone.remove();
    const after = figma.currentPage.children.length;
    console.log(`[SlideSync] background clone for ${node.id}: page children ${before} -> ${after}`);
    if (after !== before) warn(ctx, 'clone', 'Page child count changed during export; please check for stray layers.', node);
  }
}

function isPaintedContainer(node: SceneNode): node is PaintedContainer {
  return node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'COMPONENT_SET' || node.type === 'INSTANCE';
}

async function emitContainerBackground(ctx: Ctx, node: SceneNode, info: LayerInfo, inherited: number): Promise<void> {
  const kind = classifyBackground(info);
  if (kind === 'none') return;
  if (kind === 'native') {
    emitNativeShape(ctx, node, inherited, 'container background');
    return;
  }
  if (!isPaintedContainer(node)) {
    warn(ctx, 'effects', 'Group effects cannot be exported without its children; skipped.', node);
    return;
  }
  await exportContainerBackground(ctx, node, inherited);
}

// ---- Walk -----------------------------------------------------------------

function tick(ctx: Ctx): void {
  if (cancelled) throw new CancelledError();
  ctx.layerIndex++;
  send({
    type: 'progress',
    frameIndex: ctx.frameIndex,
    frameCount: ctx.frameCount,
    frameName: ctx.frame.name,
    layerIndex: ctx.layerIndex,
    layerCount: ctx.layerCount,
  });
}

function outsideFrame(ctx: Ctx, node: SceneNode): boolean {
  if (!ctx.clips) return false;
  const box = renderBoxOf(node);
  return box !== null && !overlaps(box, ctx.frameBox);
}

async function processNode(ctx: Ctx, node: SceneNode, inherited: number): Promise<void> {
  tick(ctx);
  if (!node.visible || outsideFrame(ctx, node)) return;
  if (node.width <= 0 && node.height <= 0 && node.type !== 'LINE') return;
  const info = describe(node, ctx.options);
  const cls = classifyLayer(info);
  if (cls.warning) warn(ctx, cls.warning.kind, `${cls.warning.message}`, node);
  if (node.type === 'TEXT' && 'hasMissingFont' in node && node.hasMissingFont) {
    warn(ctx, 'missing-font', 'Font is missing in this file; text metrics may differ.', node);
  }
  switch (cls.kind) {
    case 'skip':
      return;
    case 'text':
      emitText(ctx, node as TextNode, inherited);
      warnNonGoogleFonts(ctx, node as TextNode);
      return;
    case 'shape':
      emitNativeShape(ctx, node, inherited, 'shape');
      return;
    case 'image':
      await emitImage(ctx, node, inherited, cls.reason);
      return;
    case 'container':
      await processContainer(ctx, node as SceneNode & ChildrenMixin, info, inherited);
  }
}

function warnNonGoogleFonts(ctx: Ctx, node: TextNode): void {
  if (node.characters.length === 0) return;
  const families = new Set(node.getRangeAllFontNames(0, node.characters.length).map((f) => f.family));
  for (const family of families) {
    if (!isGoogleFont(family)) warn(ctx, 'font', `Font "${family}" is not a Google Font; Google Slides will substitute it.`, node);
  }
}

async function processContainer(ctx: Ctx, node: SceneNode & ChildrenMixin, info: LayerInfo, inherited: number): Promise<void> {
  await emitContainerBackground(ctx, node, info, inherited);
  const passDown = effectiveOpacity(node, inherited);
  // children are ordered bottom -> top, which is exactly slide z-order.
  for (const child of node.children) {
    try {
      await processNode(ctx, child, passDown);
    } catch (e) {
      if (e instanceof CancelledError) throw e;
      warn(ctx, 'skipped', `Layer skipped: ${errMsg(e)}`, child);
    }
  }
}

// ---- Slide assembly -------------------------------------------------------

async function buildBackground(ctx: Ctx): Promise<SlideModel['background']> {
  const frame = ctx.frame;
  const info = describe(frame, ctx.options);
  const kind = classifyBackground(info);
  if (kind === 'none') return { kind: 'none' };
  const solid = firstVisibleSolid(frame.fills);
  if (kind === 'native' && solid) {
    const c = solidToColor(solid.color, solid.opacity ?? 1);
    if (visibleStroke(frame)) await emitContainerBackground(ctx, frame, info, 1);
    return { kind: 'solid', ...c };
  }
  // Placed as a normal object so it sits at the bottom of the stack.
  await emitContainerBackground(ctx, frame, info, 1);
  return { kind: 'none' };
}

function visibleStroke(node: FrameNode | ComponentNode): boolean {
  return node.strokes.some((s) => s.visible !== false) && typeof node.strokeWeight === 'number' && node.strokeWeight > 0;
}

function countLayers(frame: FrameNode | ComponentNode): number {
  return frame.findAll(() => true).length;
}

async function buildSlide(
  frame: FrameNode | ComponentNode,
  options: ExportOptions,
  layout: { widthIn: number; heightIn: number },
  exportAppliesOpacity: boolean,
  frameIndex: number,
  frameCount: number,
): Promise<{ slide: SlideModel; images: Record<string, Uint8Array> }> {
  const box = boxOf(frame);
  if (!box || box.w <= 0 || box.h <= 0) throw new Error('Frame has no size');
  const ctx: Ctx = {
    frame,
    frameBox: box,
    clips: frame.clipsContent,
    fit: fitFrame(box.w, box.h, layout.widthIn, layout.heightIn),
    options,
    exportAppliesOpacity,
    objects: [],
    images: {},
    warnings: [],
    report: [],
    usedIds: new Set<string>(),
    imageCounter: 0,
    layerIndex: 0,
    layerCount: countLayers(frame),
    frameIndex,
    frameCount,
  };
  if (ctx.fit.letterboxed) warn(ctx, 'letterbox', 'Frame aspect ratio differs from the slide; it was letterboxed.', frame);
  if (Math.max(box.w, box.h) > LARGE_FRAME_PX) warn(ctx, 'size', `Frame is larger than ${LARGE_FRAME_PX}px; export may be slow and large.`, frame);

  const background = await safely(ctx, frame, () => buildBackground(ctx), { kind: 'none' } as SlideModel['background']);
  if (frame.children.some((c) => 'isMask' in c && c.isMask)) {
    warn(ctx, 'mask', 'Frame contains a mask; masked layers may render unmasked.', frame);
  }
  for (const child of frame.children) {
    try {
      await processNode(ctx, child, 1);
    } catch (e) {
      if (e instanceof CancelledError) throw e;
      warn(ctx, 'skipped', `Layer skipped: ${errMsg(e)}`, child);
    }
  }

  const slide: SlideModel = { frameId: frame.id, frameName: frame.name, background, objects: ctx.objects, warnings: ctx.warnings };
  if (options.layerReport) {
    slide.notes = ['SlideSync layer report (name | kind | Figma node id)', ...ctx.report, ...(ctx.warnings.length ? ['', 'Warnings:', ...ctx.warnings.map((w) => `- ${w.layerName ?? frame.name}: ${w.message}`)] : [])].join('\n');
  }
  return { slide, images: ctx.images };
}

async function safely<T>(ctx: Ctx, node: SceneNode, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CancelledError) throw e;
    warn(ctx, 'skipped', `Step failed: ${errMsg(e)}`, node);
    return fallback;
  }
}

async function runExport(frameIds: string[], options: ExportOptions): Promise<void> {
  if (busy) return;
  busy = true;
  cancelled = false;
  try {
    const nodes = await Promise.all(frameIds.map((id) => figma.getNodeByIdAsync(id)));
    const frames = nodes.filter((n): n is FrameNode | ComponentNode => n !== null && (n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'INSTANCE'));
    if (frames.length === 0) throw new Error('Select at least one top-level frame.');
    const sizes = frames.map((f) => ({ w: f.width, h: f.height }));
    const layout = decideLayout(sizes);
    const stored: unknown = await figma.clientStorage.getAsync(OPACITY_KEY);
    // Assumption until the probe says otherwise: exportAsync includes the node's own opacity.
    const appliesOpacity = typeof stored === 'boolean' ? stored : true;
    send({ type: 'start', layout: { widthIn: layout.widthIn, heightIn: layout.heightIn }, slideCount: frames.length });
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      if (!frame) continue;
      const { slide, images } = await buildSlide(frame, options, layout, appliesOpacity, i, frames.length);
      send({ type: 'slide', slide, images });
    }
    send({ type: 'done' });
  } catch (e) {
    if (e instanceof CancelledError) send({ type: 'cancelled' });
    else send({ type: 'error', message: errMsg(e) });
  } finally {
    busy = false;
  }
}
