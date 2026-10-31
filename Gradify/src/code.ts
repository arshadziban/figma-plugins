// Gradify main thread: paints a soft "blurred blob" gradient behind the
// content of the selected frames (a base fill plus large ellipses with a
// heavy layer blur).

import type { ToMain, ToUI } from "./messages";
import { GradientSpec, Size, hexToRgb, rgbToHex } from "./spec";

figma.showUI(__html__, { width: 360, height: 640, themeColors: false });

const PLUGIN_KEY = "gradify";
const GROUP_NAME = "Gradify background";
const NEW_FRAME_GAP = 100;
const SETTINGS_KEY = "gradify-settings";

type Target = FrameNode | ComponentNode;

function post(msg: ToUI) {
  figma.ui.postMessage(msg);
}

function solid(hex: string, opacity = 1): SolidPaint {
  return { type: "SOLID", color: hexToRgb(hex), opacity };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function selectedFrames(): Target[] {
  return figma.currentPage.selection.filter(
    (n): n is Target => n.type === "FRAME" || n.type === "COMPONENT",
  );
}

function findGradifyGroup(frame: Target): GroupNode | null {
  const g = frame.children.find((c) => c.getPluginData(PLUGIN_KEY) === "background");
  return g && g.type === "GROUP" ? g : null;
}

/** Colour of the first selected non-frame layer with a visible solid fill. */
function selectedColor(): string | null {
  for (const n of figma.currentPage.selection) {
    if (n.type === "FRAME" || n.type === "COMPONENT" || n.type === "SECTION") continue;
    const fill = firstSolid(n);
    if (fill) return rgbToHex(fill.color);
  }
  return null;
}

function firstSolid(node: SceneNode): SolidPaint | null {
  if (!("fills" in node) || !Array.isArray(node.fills)) return null;
  return (node.fills as Paint[]).find((p): p is SolidPaint => p.type === "SOLID" && p.visible !== false) ?? null;
}

function sendSelection() {
  const frames = selectedFrames();
  post({
    type: "selection",
    count: frames.length,
    names: frames.slice(0, 3).map((f) => f.name),
    hasGradify: frames.some((f) => findGradifyGroup(f)),
    color: selectedColor(),
  });
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Builds the background layers inside `frame`, bottom-most, as one locked
 * group. Any earlier Gradify group in the frame is replaced.
 */
function paintFrame(frame: Target, spec: GradientSpec): GroupNode | null {
  const W = frame.width;
  const H = frame.height;
  const blur = Math.max(0, spec.blur) * W;

  findGradifyGroup(frame)?.remove();

  frame.fills = [solid(spec.base)];
  frame.clipsContent = true;

  const layers: (RectangleNode | EllipseNode)[] = [];

  if (spec.wash && spec.wash.opacity > 0) {
    const wash = figma.createRectangle();
    wash.name = "Wash";
    wash.resize(W, H);
    wash.fills = [solid(spec.wash.color, spec.wash.opacity)];
    layers.push(wash);
  }

  spec.blobs.forEach((b, i) => {
    const e = figma.createEllipse();
    e.name = `Blob ${i + 1}`;
    e.resize(Math.max(1, b.w * W), Math.max(1, b.h * H));
    e.x = b.x * W;
    e.y = b.y * H;
    e.fills = [solid(b.color, b.opacity)];
    if (blur > 0) {
      e.effects = [{ type: "LAYER_BLUR", blurType: "NORMAL", radius: blur, visible: true }];
    }
    layers.push(e);
  });

  if (layers.length === 0) return null;

  // In an auto layout frame every new child would join the flow, so pin the
  // layers (and later the group) as absolutely positioned.
  const autoLayout = frame.layoutMode !== "NONE";
  const minX = Math.min(...layers.map((l) => l.x));
  const minY = Math.min(...layers.map((l) => l.y));
  layers.forEach((l) => {
    const { x, y } = l;
    frame.appendChild(l);
    if (autoLayout) l.layoutPositioning = "ABSOLUTE";
    l.x = x;
    l.y = y;
  });
  const group = figma.group(layers, frame, 0);
  group.name = GROUP_NAME;
  group.setPluginData(PLUGIN_KEY, "background");
  if (autoLayout) {
    group.layoutPositioning = "ABSOLUTE";
    group.x = minX;
    group.y = minY;
  }
  group.locked = true;
  return group;
}

/** Free spot to the right of everything on the page. */
function freeSpot(exclude: SceneNode): { x: number; y: number } {
  const nodes = figma.currentPage.children.filter((n) => n !== exclude);
  if (nodes.length === 0) return { x: 0, y: 0 };
  const right = Math.max(...nodes.map((n) => n.x + n.width));
  const top = Math.min(...nodes.map((n) => n.y));
  return { x: right + NEW_FRAME_GAP, y: top };
}

function createFrame(spec: GradientSpec, size: Size): FrameNode {
  const frame = figma.createFrame();
  frame.name = `Gradify – ${spec.name}`;
  frame.resize(size.width, size.height);
  const spot = freeSpot(frame);
  frame.x = spot.x;
  frame.y = spot.y;
  paintFrame(frame, spec);
  return frame;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

figma.on("selectionchange", sendSelection);

figma.ui.onmessage = (msg: ToMain) => {
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
        const frames = selectedFrames();
        if (frames.length === 0) {
          post({ type: "error", message: "Select one or more frames first, or use Create frame." });
          return;
        }
        frames.forEach((f) => paintFrame(f, msg.spec));
        post({ type: "success", message: frames.length === 1 ? `Applied “${msg.spec.name}” to 1 frame.` : `Applied “${msg.spec.name}” to ${frames.length} frames.` });
        sendSelection();
        return;
      }

      case "create": {
        const frame = createFrame(msg.spec, msg.size);
        figma.currentPage.selection = [frame];
        figma.viewport.scrollAndZoomIntoView([frame]);
        post({ type: "success", message: `Created ${Math.round(frame.width)}×${Math.round(frame.height)} frame.` });
        return;
      }

      case "remove": {
        let removed = 0;
        selectedFrames().forEach((f) => {
          const g = findGradifyGroup(f);
          if (g) {
            g.remove();
            removed++;
          }
        });
        post(removed
          ? { type: "success", message: `Removed the gradient from ${removed} frame${removed === 1 ? "" : "s"}.` }
          : { type: "error", message: "No Gradify background in the selection." });
        sendSelection();
        return;
      }

    }
  } catch (err) {
    post({ type: "error", message: `Something went wrong: ${err instanceof Error ? err.message : String(err)}` });
  }
};
