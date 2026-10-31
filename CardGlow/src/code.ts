// CardGlow main thread: turns selected frames into glossy gradient cards
// (layered linear + radial fills, inside border, soft shadow, rounded corners,
// and a locked group of blurred glows and a light-ray sparkle), creates new
// cards with optional sample content, and turns inner layers into glass.

import type { SelectionInfo, ToMain, ToUI } from "./messages";
import { CardSpec, Direction, Size, hexToRgb, rgbToHex } from "./spec";
import { SAMPLE } from "./sample";
import type { ContentColors } from "./looks";

figma.showUI(__html__, { width: 820, height: 640, themeColors: false });

const PLUGIN_KEY = "cardglow";
const GROUP_NAME = "CardGlow layers";
const SETTINGS_KEY = "cardglow-settings";
const NEW_FRAME_GAP = 100;

type Container = FrameNode | ComponentNode;
type Target = Container | RectangleNode;

function post(msg: ToUI) {
  figma.ui.postMessage(msg);
}

function rgba(hex: string, a: number): RGBA {
  return { ...hexToRgb(hex), a };
}

function solid(hex: string, opacity = 1): SolidPaint {
  return { type: "SOLID", color: hexToRgb(hex), opacity };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function isContainer(n: SceneNode): n is Container {
  return n.type === "FRAME" || n.type === "COMPONENT";
}

function selectedTargets(): Target[] {
  return figma.currentPage.selection.filter((n): n is Target => isContainer(n) || n.type === "RECTANGLE");
}

function findGlowGroup(node: Target): GroupNode | null {
  if (!isContainer(node)) return null;
  const g = node.children.find((c) => c.getPluginData(PLUGIN_KEY) === "layers");
  return g && g.type === "GROUP" ? g : null;
}

function firstSolid(node: SceneNode): SolidPaint | null {
  if (!("fills" in node) || !Array.isArray(node.fills)) return null;
  return (node.fills as Paint[]).find((p): p is SolidPaint => p.type === "SOLID" && p.visible !== false) ?? null;
}

function selectedColor(): string | null {
  for (const n of figma.currentPage.selection) {
    if (isContainer(n) || n.type === "SECTION") continue;
    const fill = firstSolid(n);
    if (fill) return rgbToHex(fill.color);
  }
  return null;
}

type GlassNode = SceneNode & MinimalFillsMixin & MinimalStrokesMixin;

function glassTargets(): GlassNode[] {
  return figma.currentPage.selection.filter((n): n is GlassNode => "fills" in n && "strokes" in n && n.type !== "TEXT");
}

function sendSelection() {
  const targets = selectedTargets();
  const info: SelectionInfo = {
    count: targets.length,
    names: targets.slice(0, 3).map((t) => t.name),
    hasCard: targets.some((t) => t.getPluginData(PLUGIN_KEY) === "card"),
    glassCount: glassTargets().length,
    color: selectedColor(),
  };
  post({ type: "selection", ...info });
}

// ---------------------------------------------------------------------------
// Paints
// ---------------------------------------------------------------------------

// gradientTransform maps the node's unit square onto gradient space, where a
// linear gradient runs along x from 0 to 1 and a radial one is centred at
// (0.5, 0.5) with radius 0.5.
const LINEAR_TRANSFORMS: Record<Direction, Transform> = {
  tl: [[0.5, 0.5, 0], [-0.5, 0.5, 0.5]],
  tr: [[-0.5, 0.5, 0.5], [-0.5, -0.5, 1]],
  top: [[0, 1, 0], [-1, 0, 1]],
};

function fills(spec: CardSpec): Paint[] {
  const paints: Paint[] = [];
  const { stops, direction } = spec.linear;
  if (stops.length === 1 && stops[0]) {
    paints.push(solid(stops[0].color, stops[0].opacity));
  } else {
    paints.push({
      type: "GRADIENT_LINEAR",
      gradientTransform: LINEAR_TRANSFORMS[direction],
      gradientStops: stops.map((s) => ({ position: s.position, color: rgba(s.color, s.opacity) })),
    });
  }
  for (const r of spec.radials) {
    const s = 1 / (2 * r.r);
    paints.push({
      type: "GRADIENT_RADIAL",
      gradientTransform: [[s, 0, 0.5 - r.cx * s], [0, s, 0.5 - r.cy * s]],
      gradientStops: [
        { position: 0, color: rgba(r.from.color, r.from.opacity) },
        { position: 1, color: rgba(r.to.color, r.to.opacity) },
      ],
    });
  }
  return paints;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/** Paints `spec` onto a frame, component or rectangle. Frames also get the glow layers. */
function paintCard(node: Target, spec: CardSpec) {
  const W = node.width;
  const H = node.height;

  node.fills = fills(spec);
  node.cornerRadius = Math.round(spec.radius * Math.min(W, H) * 10) / 10;
  if (spec.stroke) {
    node.strokes = [solid(spec.stroke.color, spec.stroke.opacity)];
    node.strokeWeight = Math.max(1, Math.round(spec.stroke.weight * W * 10) / 10);
    node.strokeAlign = "INSIDE";
  } else {
    node.strokes = [];
  }
  node.effects = spec.shadow
    ? [{
      type: "DROP_SHADOW",
      color: rgba(spec.shadow.color, spec.shadow.opacity),
      offset: { x: 0, y: spec.shadow.y * W },
      radius: spec.shadow.blur * W,
      spread: spec.shadow.spread * W,
      visible: true,
      blendMode: "NORMAL",
      showShadowBehindNode: false,
    }]
    : [];
  node.setPluginData(PLUGIN_KEY, "card");

  if (!isContainer(node)) return;
  node.clipsContent = true;
  findGlowGroup(node)?.remove();

  const layers: (EllipseNode | StarNode)[] = [];
  spec.glows.forEach((g, i) => {
    const e = figma.createEllipse();
    e.name = i === 0 ? "Glow bottom" : i === 1 ? "Glow top" : `Glow ${i + 1}`;
    e.resize(Math.max(1, g.w * W), Math.max(1, g.h * H));
    e.x = g.x * W;
    e.y = g.y * H;
    e.fills = [solid(g.color, g.opacity)];
    e.effects = [{ type: "LAYER_BLUR", blurType: "NORMAL", radius: g.blur * W, visible: true }];
    layers.push(e);
  });
  if (spec.sparkle) {
    // A thin eight-point burst, blurred into a soft ray of light.
    const sp = spec.sparkle;
    const star = figma.createStar();
    star.name = "Sparkle";
    star.pointCount = 8;
    star.innerRadius = 0.16;
    star.resize(sp.size * W, sp.size * W * 1.27);
    star.x = sp.x * W;
    star.y = sp.y * H;
    star.fills = [solid(sp.color, sp.opacity)];
    star.effects = [{ type: "LAYER_BLUR", blurType: "NORMAL", radius: sp.blur * W, visible: true }];
    layers.push(star);
  }
  if (layers.length === 0) return;

  const autoLayout = node.layoutMode !== "NONE";
  const minX = Math.min(...layers.map((l) => l.x));
  const minY = Math.min(...layers.map((l) => l.y));
  layers.forEach((l) => {
    const { x, y } = l;
    node.appendChild(l);
    if (autoLayout) l.layoutPositioning = "ABSOLUTE";
    l.x = x;
    l.y = y;
  });
  const group = figma.group(layers, node, 0);
  group.name = GROUP_NAME;
  group.setPluginData(PLUGIN_KEY, "layers");
  if (autoLayout) {
    group.layoutPositioning = "ABSOLUTE";
    group.x = minX;
    group.y = minY;
  }
  group.locked = true;
}

function removeCard(node: Target): boolean {
  if (node.getPluginData(PLUGIN_KEY) !== "card") return false;
  findGlowGroup(node)?.remove();
  node.fills = [solid("#FFFFFF")];
  node.strokes = [];
  node.effects = [];
  node.setPluginData(PLUGIN_KEY, "");
  return true;
}

function makeGlass(node: GlassNode, scale = 1, color = "#FFFFFF") {
  node.fills = [solid(color, 0.18)];
  node.strokes = [solid(color, 0.4)];
  if ("strokeWeight" in node) node.strokeWeight = Math.max(1, Math.round(1.6 * scale * 10) / 10);
  if ("strokeAlign" in node) node.strokeAlign = "INSIDE";
}

/** Free spot to the right of everything on the page. */
function freeSpot(exclude: SceneNode): { x: number; y: number } {
  const nodes = figma.currentPage.children.filter((n) => n !== exclude);
  if (nodes.length === 0) return { x: 0, y: 0 };
  return { x: Math.max(...nodes.map((n) => n.x + n.width)) + NEW_FRAME_GAP, y: Math.min(...nodes.map((n) => n.y)) };
}

async function loadFont(family: string, styles: string[]): Promise<FontName> {
  for (const style of styles) {
    try {
      const f = { family, style };
      await figma.loadFontAsync(f);
      return f;
    } catch {
      // try the next style
    }
  }
  const f = { family: "Roboto", style: "Regular" };
  await figma.loadFontAsync(f);
  return f;
}

function text(chars: string, font: FontName, size: number, color: string): TextNode {
  const t = figma.createText();
  t.fontName = font;
  t.fontSize = size;
  t.characters = chars;
  t.fills = [solid(color)];
  t.textAlignHorizontal = "CENTER";
  t.textAutoResize = "WIDTH_AND_HEIGHT";
  return t;
}

/**
 * Sample content like the reference cards: a glass icon tile, a title, a
 * lorem ipsum description and three glass step pills with numbered badges. Sizes follow the
 * 527 px reference card.
 */
async function addContent(card: FrameNode, colors: ContentColors) {
  const s = card.width / 527;
  // New text nodes start in Inter Regular, which must be loaded before any edit.
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  const bold = await loadFont("Inter", ["Bold", "Semi Bold"]);
  const semi = await loadFont("Inter", ["Semi Bold", "Medium", "Regular"]);
  const regular = await loadFont("Inter", ["Regular"]);

  const content = figma.createFrame();
  content.name = "Content";
  content.layoutMode = "VERTICAL";
  content.counterAxisAlignItems = "CENTER";
  content.itemSpacing = 16 * s;
  content.fills = [];
  // resize() resets auto layout sizing, so size first, then let height hug.
  content.counterAxisSizingMode = "FIXED";
  content.resize(card.width - 96 * s, 10);
  content.primaryAxisSizingMode = "AUTO";

  const icon = figma.createFrame();
  icon.name = "Icon";
  icon.cornerRadius = 22 * s;
  icon.layoutMode = "HORIZONTAL";
  icon.primaryAxisAlignItems = "CENTER";
  icon.counterAxisAlignItems = "CENTER";
  icon.primaryAxisSizingMode = "FIXED";
  icon.counterAxisSizingMode = "FIXED";
  icon.resize(109 * s, 74 * s);
  makeGlass(icon, s, colors.glass);
  // The reference icon tile is a touch brighter than the pills.
  icon.fills = [solid(colors.glass, 0.2)];
  icon.strokes = [solid(colors.glass, 0.45)];
  const mark = figma.createStar();
  mark.name = "Mark";
  mark.pointCount = 4;
  mark.innerRadius = 0.38;
  mark.resize(34 * s, 34 * s);
  mark.fills = [solid(colors.text)];
  icon.appendChild(mark);
  content.appendChild(icon);

  const title = text(SAMPLE.title, bold, 46 * s, colors.text);
  title.name = "Title";
  content.appendChild(title);

  // Wraps to the content width; height follows the text.
  const body = text(SAMPLE.body, regular, 18 * s, colors.text);
  body.name = "Description";
  body.opacity = 0.85;
  body.lineHeight = { unit: "PERCENT", value: 140 };
  content.appendChild(body);
  body.layoutSizingHorizontal = "FILL";
  body.textAutoResize = "HEIGHT";

  const steps = figma.createFrame();
  steps.name = "Steps";
  steps.layoutMode = "VERTICAL";
  steps.itemSpacing = 13 * s;
  steps.fills = [];
  content.appendChild(steps);
  steps.primaryAxisSizingMode = "AUTO";
  steps.layoutSizingHorizontal = "FILL";

  SAMPLE.steps.forEach((label, i) => {
    const pill = figma.createFrame();
    pill.name = `Step ${i + 1}`;
    pill.layoutMode = "HORIZONTAL";
    pill.counterAxisAlignItems = "CENTER";
    pill.itemSpacing = 17 * s;
    pill.paddingLeft = pill.paddingRight = 15 * s;
    pill.paddingTop = pill.paddingBottom = 14 * s;
    pill.cornerRadius = 34 * s;
    makeGlass(pill, s, colors.glass);
    steps.appendChild(pill);
    pill.layoutSizingHorizontal = "FILL";
    pill.layoutSizingVertical = "HUG";

    const badge = figma.createFrame();
    badge.name = "Number";
    badge.cornerRadius = 19.5 * s;
    badge.fills = [solid(colors.badge)];
    badge.layoutMode = "HORIZONTAL";
    badge.primaryAxisAlignItems = "CENTER";
    badge.counterAxisAlignItems = "CENTER";
    badge.primaryAxisSizingMode = "FIXED";
    badge.counterAxisSizingMode = "FIXED";
    badge.resize(39 * s, 39 * s);
    badge.appendChild(text(String(i + 1), bold, 18 * s, colors.number));
    pill.appendChild(badge);

    const t = text(label, semi, 26 * s, colors.text);
    t.name = "Label";
    t.textAlignHorizontal = "LEFT";
    pill.appendChild(t);
  });

  card.appendChild(content);
  content.x = (card.width - content.width) / 2;
  content.y = Math.max(24 * s, (card.height - content.height) / 2);
}

async function createCard(spec: CardSpec, size: Size, content: boolean, colors: ContentColors): Promise<FrameNode> {
  const card = figma.createFrame();
  card.name = `CardGlow – ${spec.name}`;
  card.resize(size.width, size.height);
  const spot = freeSpot(card);
  card.x = spot.x;
  card.y = spot.y;
  paintCard(card, spec);
  if (content) await addContent(card, colors);
  return card;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

figma.on("selectionchange", sendSelection);

figma.ui.onmessage = async (msg: ToMain) => {
  try {
    switch (msg.type) {
      case "ready":
        sendSelection();
        figma.clientStorage.getAsync(SETTINGS_KEY)
          .then((settings) => post({ type: "settings", settings: settings ?? null }))
          .catch(() => post({ type: "settings", settings: null }));
        return;

      case "save":
        figma.clientStorage.setAsync(SETTINGS_KEY, msg.settings).catch(() => {});
        return;

      case "apply": {
        const targets = selectedTargets();
        if (targets.length === 0) {
          post({ type: "error", message: "Select one or more frames or rectangles first, or use Create card." });
          return;
        }
        targets.forEach((t) => paintCard(t, msg.spec));
        post({ type: "success", message: `Applied “${msg.spec.name}” to ${targets.length} layer${targets.length === 1 ? "" : "s"}.` });
        sendSelection();
        return;
      }

      case "create": {
        const card = await createCard(msg.spec, msg.size, msg.content, msg.colors);
        figma.currentPage.selection = [card];
        figma.viewport.scrollAndZoomIntoView([card]);
        post({ type: "success", message: `Created ${Math.round(card.width)}×${Math.round(card.height)} card.` });
        return;
      }

      case "glass": {
        const nodes = glassTargets();
        if (nodes.length === 0) {
          post({ type: "error", message: "Select the layers to turn into glass, like pills or icon tiles." });
          return;
        }
        nodes.forEach((n) => makeGlass(n, 1, msg.color));
        post({ type: "success", message: `Made ${nodes.length} layer${nodes.length === 1 ? "" : "s"} glass.` });
        return;
      }

      case "remove": {
        const removed = selectedTargets().filter(removeCard).length;
        post(removed
          ? { type: "success", message: `Removed the card style from ${removed} layer${removed === 1 ? "" : "s"}.` }
          : { type: "error", message: "No CardGlow card in the selection." });
        sendSelection();
        return;
      }
    }
  } catch (err) {
    post({ type: "error", message: `Something went wrong: ${err instanceof Error ? err.message : String(err)}` });
  }
};
