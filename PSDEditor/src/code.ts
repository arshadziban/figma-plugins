// PSDEditor main thread: builds a native, editable Figma layer tree from the
// LayerModel the UI parsed out of the PSD. Text becomes real text, vector
// shapes become vector nodes, groups stay groups, effects become Figma
// effects, and smart objects become shapes filled with their rendered content.

import type { DocModel, EffectModel, LayerModel, ToMain, ToUI } from "./messages";

figma.showUI(__html__, { width: 420, height: 560, themeColors: true });

const post = (m: ToUI) => figma.ui.postMessage(m);
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const images = new Map<number, Uint8Array>();
let cancelled = false;

figma.ui.onmessage = async (msg: ToMain) => {
  if (msg.type === "image") images.set(msg.id, msg.bytes);
  else if (msg.type === "cancel") cancelled = true;
  else if (msg.type === "build") {
    cancelled = false;
    try {
      await build(msg.doc, msg.keepHidden);
    } catch (e) {
      post({ type: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      images.clear();
    }
  }
};

// ── Fonts ───────────────────────────────────────────────

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
let fontIndex: Map<string, FontName> | null = null;
const fontCache = new Map<string, FontName>();
const loaded = new Set<string>();
const missingFonts = new Set<string>();

async function indexFonts() {
  if (fontIndex) return;
  fontIndex = new Map();
  for (const f of await figma.listAvailableFontsAsync()) fontIndex.set(key(f.fontName.family + f.fontName.style), f.fontName);
}

function resolveFont(ps: string): FontName {
  const hit = fontCache.get(ps);
  if (hit) return hit;
  const idx = fontIndex!;
  const k = key(ps);
  const noMt = k.replace(/(mt|ps)$/, "").replace(/(mt|ps)(?=(bold|italic|regular|light|medium))/, "");
  const candidates = [k, noMt, k + "regular", noMt + "regular", k.replace(/mt$/, "") + "regular"];
  let found: FontName | undefined;
  for (const c of candidates) if ((found = idx.get(c))) break;
  if (!found) {
    // family-only match with a style guessed from the name
    const style = /bold/i.test(ps) ? "Bold" : /italic|oblique/i.test(ps) ? "Italic" : "Regular";
    found = idx.get(key("Inter" + style)) ?? { family: "Inter", style: "Regular" };
    if (ps) missingFonts.add(ps);
  }
  fontCache.set(ps, found);
  return found;
}

async function ensureFont(f: FontName) {
  const k = f.family + "/" + f.style;
  if (loaded.has(k)) return;
  await figma.loadFontAsync(f);
  loaded.add(k);
}

// ── Node helpers ────────────────────────────────────────

const solid = (c: { r: number; g: number; b: number }, opacity = 1): SolidPaint => ({ type: "SOLID", color: c, opacity });

function toEffects(list: EffectModel[]): Effect[] {
  return list.map((e): Effect => {
    const base = {
      color: { ...e.color, a: e.opacity },
      offset: { x: e.x, y: e.y },
      radius: Math.max(e.blur, 0),
      spread: Math.max(e.spread, 0),
      visible: true,
      blendMode: "NORMAL" as const,
    };
    return { type: e.kind === "inner" || e.kind === "innerGlow" ? "INNER_SHADOW" : "DROP_SHADOW", ...base } as Effect;
  });
}

interface Stats { created: number; text: number; shapes: number; smart: number; images: number }

let stats: Stats;
let total = 0;
let done = 0;

function countLayers(list: LayerModel[], keepHidden: boolean): number {
  let n = 0;
  for (const l of list) {
    if (l.hidden && !keepHidden) continue;
    n += 1 + (l.children ? countLayers(l.children, keepHidden) : 0);
  }
  return n;
}

async function step(label: string) {
  done++;
  if (done % 4 === 0) {
    post({ type: "progress", done, total, label });
    await tick();
  }
  if (cancelled) throw new Error("Import cancelled");
}

function applyCommon(node: SceneNode & BlendMixin & MinimalBlendMixin, l: LayerModel) {
  node.name = l.name;
  node.opacity = l.opacity;
  if (l.hidden) node.visible = false;
  if ("blendMode" in node) {
    try { node.blendMode = l.blend as BlendMode; } catch { /* unsupported on this node */ }
  }
}

function applyStroke(node: GeometryMixin & { strokeAlign: "CENTER" | "INSIDE" | "OUTSIDE" }, l: LayerModel) {
  const s = l.stroke;
  if (!s) return;
  node.strokes = [solid(s.color, s.opacity)];
  node.strokeWeight = s.width;
  try { node.strokeAlign = s.align; } catch { /* text strokes only allow some alignments */ }
  if (s.join && "strokeJoin" in node) (node as VectorNode).strokeJoin = s.join;
  if (s.dashes && "dashPattern" in node) (node as VectorNode).dashPattern = s.dashes;
}

// A layer's image fill (or solid fill), counted once it's actually used.
function paintFor(l: LayerModel): Paint[] | null {
  const bytes = l.imageId ? images.get(l.imageId) : undefined;
  if (bytes) {
    stats.images++;
    return [{ type: "IMAGE", imageHash: figma.createImage(bytes).hash, scaleMode: "FILL" }];
  }
  return l.fill ? [solid(l.fill.color, l.fill.opacity)] : null;
}

function makeImageRect(l: LayerModel, parent: FrameNode | GroupNode): RectangleNode | null {
  const fills = paintFor(l);
  if (!fills) return null;
  const rect = figma.createRectangle();
  parent.appendChild(rect);
  rect.resize(Math.max(l.w, 1), Math.max(l.h, 1));
  rect.x = l.x;
  rect.y = l.y;
  rect.fills = fills;
  if (l.cornerRadius) rect.cornerRadius = l.cornerRadius;
  return rect;
}

async function makeText(l: LayerModel, parent: FrameNode | GroupNode): Promise<TextNode | null> {
  if (!l.text || !l.runs?.length) return null;
  const t = figma.createText();
  parent.appendChild(t);
  const first = resolveFont(l.runs[0]!.font);
  await ensureFont(first);
  t.fontName = first;
  t.characters = l.text;
  t.textAlignHorizontal = l.align ?? "LEFT";
  for (const r of l.runs) {
    const end = Math.min(r.end, l.text.length);
    if (end <= r.start) continue;
    const f = resolveFont(r.font);
    await ensureFont(f);
    t.setRangeFontName(r.start, end, f);
    t.setRangeFontSize(r.start, end, Math.max(r.size, 1));
    t.setRangeFills(r.start, end, [l.fill ? solid(l.fill.color, l.fill.opacity) : solid(r.color)]);
    if (r.tracking) t.setRangeLetterSpacing(r.start, end, { value: r.tracking, unit: "PIXELS" });
    if (r.lineHeight) t.setRangeLineHeight(r.start, end, { value: r.lineHeight, unit: "PIXELS" });
    if (r.underline) t.setRangeTextDecoration(r.start, end, "UNDERLINE");
    else if (r.strike) t.setRangeTextDecoration(r.start, end, "STRIKETHROUGH");
    if (r.caps) t.setRangeTextCase(r.start, end, "UPPER");
  }
  if (l.boxed) {
    t.textAutoResize = "HEIGHT";
    t.resize(Math.max(l.w, 1), t.height);
  } else {
    t.textAutoResize = "WIDTH_AND_HEIGHT";
  }
  // PSD bounds are the ink box; centre the Figma text box on it
  t.y = l.y + l.h / 2 - t.height / 2;
  t.x = l.align === "CENTER" ? l.x + l.w / 2 - t.width / 2 : l.align === "RIGHT" ? l.x + l.w - t.width : l.x;
  applyStroke(t as any, l);
  stats.text++;
  return t;
}

function makeShape(l: LayerModel, parent: FrameNode | GroupNode): VectorNode | null {
  if (!l.paths?.length) return null;
  const v = figma.createVector();
  parent.appendChild(v);
  v.vectorPaths = l.paths.map((p) => ({ windingRule: p.rule, data: p.data }));
  v.x = l.x;
  v.y = l.y;
  v.fills = paintFor(l) ?? [];
  applyStroke(v, l);
  stats.shapes++;
  return v;
}

// Builds one layer (not its clipping children) as a node inside `parent`.
async function makeNode(l: LayerModel, parent: FrameNode | GroupNode, keepHidden: boolean): Promise<SceneNode | null> {
  await step(l.name);
  let node: SceneNode | null = null;

  if (l.kind === "group") {
    const kids = await makeList(l.children ?? [], parent, keepHidden);
    if (!kids.length) return null;
    const g = figma.group(kids, parent);
    applyCommon(g, l);
    if (l.effects.length) g.effects = toEffects(l.effects);
    return g;
  }

  if (l.kind === "text") node = await makeText(l, parent);
  else if (l.kind === "shape") node = makeShape(l, parent);
  else if (l.kind === "smart" && l.paths) {
    node = makeShape(l, parent);
    if (node) { stats.smart++; stats.shapes--; }
    l = { ...l, name: `${l.name} (smart object)` };
  } else {
    node = makeImageRect(l, parent);
    if (node && l.kind === "smart") stats.smart++;
    // Effects follow the pixels' alpha when applied to a group, not the rect's box.
    if (node && l.effects.length && (l.kind === "raster" || l.softAlpha)) {
      const g = figma.group([node], parent);
      g.name = l.name;
      g.effects = toEffects(l.effects);
      node.name = l.kind === "smart" ? `${l.name} (smart object)` : l.name;
      applyCommon(g, l);
      stats.created++;
      return g;
    }
    if (node && l.kind === "smart") l = { ...l, name: `${l.name} (smart object)` };
  }
  if (!node) return null;
  applyCommon(node as any, l);
  if (l.effects.length && "effects" in node) (node as any).effects = toEffects(l.effects);
  stats.created++;
  return node;
}

// PSD lists are bottom → top; a clipping layer clips to the nearest non-clipping layer below.
async function makeList(list: LayerModel[], parent: FrameNode | GroupNode, keepHidden: boolean): Promise<SceneNode[]> {
  const out: SceneNode[] = [];
  let i = 0;
  while (i < list.length) {
    const l = list[i]!;
    i++;
    const clips: LayerModel[] = [];
    while (i < list.length && list[i]!.clipping) clips.push(list[i++]!);
    if (l.hidden && !keepHidden) continue;

    const base = await makeNode(l, parent, keepHidden);
    if (!base) continue;
    const clipNodes: SceneNode[] = [];
    if (clips.length && l.kind !== "group") {
      const mask = base.clone(); // clones land on the page, so bring it back next to the base
      parent.appendChild(mask);
      mask.x = base.x;
      mask.y = base.y;
      mask.name = `${l.name} (mask)`;
      if ("effects" in mask) (mask as any).effects = [];
      (mask as any).opacity = 1;
      mask.visible = true;
      if ("blendMode" in mask) (mask as any).blendMode = "NORMAL";
      try { (mask as any).isMask = true; } catch { /* keep as plain layer */ }
      for (const c of clips) {
        if (c.hidden && !keepHidden) continue;
        const n = await makeNode(c, parent, keepHidden);
        if (n) clipNodes.push(n);
      }
      const g = figma.group([base, mask, ...clipNodes], parent);
      g.name = `${l.name} (clipped)`;
      out.push(g);
    } else {
      out.push(base);
      for (const c of clips) {
        if (c.hidden && !keepHidden) continue;
        const n = await makeNode(c, parent, keepHidden);
        if (n) out.push(n);
      }
    }
  }
  return out;
}

async function build(doc: DocModel, keepHidden: boolean) {
  stats = { created: 0, text: 0, shapes: 0, smart: 0, images: 0 };
  total = countLayers(doc.layers, keepHidden);
  done = 0;
  missingFonts.clear();
  await indexFonts();

  const page = figma.currentPage;
  const hadContent = page.children.length > 0;
  let right = 0;
  for (const n of page.children) right = Math.max(right, n.x + n.width);

  const frame = figma.createFrame();
  frame.name = doc.name;
  frame.resize(doc.width, doc.height);
  frame.fills = [];
  frame.clipsContent = true;
  // Isolate blending: layers on a transparent PSD backdrop must not blend with the Figma canvas.
  frame.blendMode = "NORMAL";
  frame.x = hadContent ? right + 100 : 0;
  frame.y = 0;

  try {
    await makeList(doc.layers, frame, keepHidden);
  } catch (e) {
    frame.remove();
    throw e;
  }

  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);
  const warnings = [...doc.warnings];
  if (missingFonts.size) warnings.unshift(`Fonts not installed, replaced with Inter: ${[...missingFonts].join(", ")}`);
  post({ type: "done", ...stats, warnings });
}
