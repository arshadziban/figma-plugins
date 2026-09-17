// Shades Maker — generates a full 5% color scale Auto Layout frame from a
// selected rectangle's fill color.

figma.showUI(__html__, { width: 340, height: 460 });

// ---------------------------------------------------------------------------
// Color math
// ---------------------------------------------------------------------------



function rgbToHex({ r, g, b }: RGB): string {
  const toHex = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Perceived brightness (ITU-R BT.601). Used to pick readable text color. */
function isLight({ r, g, b }: RGB): boolean {
  const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
  return brightness > 0.6;
}

interface ScaleStep {
  step: number; // 5, 10, ..., 100
  color: RGB;
  hex: string;
  label: string; // "5%" ... "100%" or "BASE"
  textColor: RGB;
}

const BLACK: RGB = { r: 0, g: 0, b: 0 };
const WHITE: RGB = { r: 1, g: 1, b: 1 };

/**
 * Standard tint/shade formula (channel + (255-channel)*t for tints,
 * channel*(1-s) for shades), expressed as an RGB mix toward white/black.
 * mix(base, WHITE, t) === base + (white-base)*t === base + (255-base)*t.
 * mix(base, BLACK, s) === base*(1-s) since BLACK is 0.
 */
function mix(a: RGB, b: RGB, amount: number): RGB {
  const t = clamp01(amount);
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

/**
 * Ceiling for the mix fraction. At a full 100% mix, both the tint and shade
 * formulas erase the base color entirely (pure white or pure black), so real
 * tint/shade tools (e.g. maketintsandshades.com) cap intensity below 100% to
 * keep a trace of the original hue. This scales the whole 0-1 range down to
 * [0, MAX_INTENSITY] rather than clipping it, so every step stays distinct.
 */
const MAX_INTENSITY = 0.9;

/**
 * Steps run 5%-100%. Step 50 is the exact base color; steps below it are
 * tints (mixed toward white), steps above it are shades (mixed toward
 * black), using the standard tint/shade percentage formula.
 */
function generateScale(base: RGB): ScaleStep[] {
  const steps: ScaleStep[] = [];
  for (let step = 5; step <= 100; step += 5) {
    let color: RGB;
    if (step === 50) {
      color = base;
    } else if (step < 50) {
      color = mix(base, WHITE, (1 - step / 50) * MAX_INTENSITY);
    } else {
      color = mix(base, BLACK, ((step - 50) / 50) * MAX_INTENSITY);
    }

    steps.push({
      step,
      color,
      hex: rgbToHex(color),
      label: step === 50 ? "BASE" : `${step}%`,
      textColor: isLight(color) ? BLACK : WHITE,
    });
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Selection validation
// ---------------------------------------------------------------------------

function getSelectedBaseColor(): RGB | null {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1) return null;

  const node = selection[0];
  if (!("fills" in node)) return null;

  const fills = node.fills;
  if (fills === figma.mixed || !Array.isArray(fills) || fills.length !== 1) return null;

  const fill = fills[0] as Paint;
  if (fill.type !== "SOLID" || fill.visible === false) return null;

  return fill.color;
}

// ---------------------------------------------------------------------------
// Canvas generation
// ---------------------------------------------------------------------------

const ROW_WIDTH = 320;
const ROW_PADDING = 16;
const ROW_PADDING_VERTICAL = 14;
const BASE_ROW_PADDING_VERTICAL = 64;

async function buildColorScaleFrame(base: RGB): Promise<void> {
  const selection = figma.currentPage.selection[0] as SceneNode;
  const steps = generateScale(base);

  await Promise.all([
    figma.loadFontAsync({ family: "Inter", style: "Medium" }),
  ]);

  const mainFrame = figma.createFrame();
  mainFrame.name = `Shades Maker – ${rgbToHex(base)}`;
  mainFrame.layoutMode = "VERTICAL";
  mainFrame.primaryAxisSizingMode = "AUTO";
  mainFrame.counterAxisSizingMode = "AUTO";
  mainFrame.itemSpacing = 0;
  mainFrame.fills = [];
  mainFrame.strokes = [];
  mainFrame.clipsContent = true;
  mainFrame.cornerRadius = 12;

  for (const step of steps) {
    const row = figma.createFrame();
    row.name = step.label;
    row.layoutMode = "HORIZONTAL";
    row.counterAxisSizingMode = "AUTO";
    row.primaryAxisAlignItems = "SPACE_BETWEEN";
    row.counterAxisAlignItems = "CENTER";
    const verticalPadding = step.label === "BASE" ? BASE_ROW_PADDING_VERTICAL : ROW_PADDING_VERTICAL;
    row.paddingLeft = ROW_PADDING;
    row.paddingRight = ROW_PADDING;
    row.paddingTop = verticalPadding;
    row.paddingBottom = verticalPadding;
    row.itemSpacing = 0;
    row.fills = [{ type: "SOLID", color: step.color }];

    const hexText = figma.createText();
    hexText.fontName = { family: "Inter", style: "Medium" };
    hexText.fontSize = 13;
    hexText.characters = step.hex;
    hexText.fills = [{ type: "SOLID", color: step.textColor }];

    const labelText = figma.createText();
    labelText.fontName = { family: "Inter", style: "Medium" };
    labelText.fontSize = 13;
    labelText.characters = step.label;
    labelText.fills = [{ type: "SOLID", color: step.textColor }];

    row.appendChild(hexText);
    row.appendChild(labelText);

    mainFrame.appendChild(row);

    // Fix the row width now that its children (and thus hug height) exist.
    row.layoutSizingHorizontal = "FIXED";
    row.resize(ROW_WIDTH, row.height);
  }

  figma.currentPage.appendChild(mainFrame);

  // Use absolute page coordinates, not selection.x/y (which are relative to
  // its parent), so the frame lands next to the rectangle even when it's
  // nested inside another frame or group.
  const bounds = selection.absoluteBoundingBox;
  if (bounds) {
    mainFrame.x = bounds.x + bounds.width + 100;
    mainFrame.y = bounds.y;
  } else {
    mainFrame.x = selection.x + selection.width + 100;
    mainFrame.y = selection.y;
  }

  figma.currentPage.selection = [mainFrame];
  figma.viewport.scrollAndZoomIntoView([mainFrame]);
}

// ---------------------------------------------------------------------------
// UI messaging
// ---------------------------------------------------------------------------

/** Sends a small, curated sample of the live scale so the UI preview always
 * reflects the currently selected rectangle's fill color. */
function sendPreview(): void {
  const base = getSelectedBaseColor();
  if (!base) {
    figma.ui.postMessage({ type: "preview", steps: null });
    return;
  }

  const sampleLabels = ["5%", "45%", "BASE", "55%", "100%"];
  const steps = generateScale(base).filter((s) => sampleLabels.includes(s.label));
  figma.ui.postMessage({
    type: "preview",
    steps: steps.map((s) => ({ hex: s.hex, label: s.label, textColor: s.textColor })),
  });
}

figma.on("selectionchange", sendPreview);
sendPreview();

figma.ui.onmessage = async (msg: { type: string }) => {
  if (msg.type === "cancel") {
    figma.closePlugin();
    return;
  }
  if (msg.type !== "generate-scale") return;

  const base = getSelectedBaseColor();
  if (!base) {
    figma.ui.postMessage({
      type: "error",
      message: "Please select a colored rectangle first",
    });
    return;
  }

  try {
    await buildColorScaleFrame(base);
    figma.ui.postMessage({ type: "success", message: "Color scale generated!" });
  } catch (err) {
    figma.ui.postMessage({
      type: "error",
      message: "Something went wrong while generating the scale.",
    });
  }
};
