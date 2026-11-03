// PSD parsing (UI thread, where canvas is available): turns an ag-psd tree into
// the plain LayerModel tree the main thread builds from. Pixel data goes out
// through `sendImage` as PNG bytes so the tree itself stays small.

import { readPsd, Layer, Color, LayerEffectShadow, UnitsValue, BezierPath } from "ag-psd";
import { traceShape } from "./trace";
import type { DocModel, EffectModel, LayerModel, PathModel, RGB01, StrokeModel, TextRun } from "./messages";

type SendImage = (id: number, bytes: Uint8Array) => Promise<void>;

const BLEND: Record<string, string> = {
  "pass through": "PASS_THROUGH",
  normal: "NORMAL",
  darken: "DARKEN",
  multiply: "MULTIPLY",
  "color burn": "COLOR_BURN",
  "linear burn": "LINEAR_BURN",
  lighten: "LIGHTEN",
  screen: "SCREEN",
  "color dodge": "COLOR_DODGE",
  "linear dodge": "LINEAR_DODGE",
  overlay: "OVERLAY",
  "soft light": "SOFT_LIGHT",
  "hard light": "HARD_LIGHT",
  difference: "DIFFERENCE",
  exclusion: "EXCLUSION",
  hue: "HUE",
  saturation: "SATURATION",
  color: "COLOR",
  luminosity: "LUMINOSITY",
};

// PSDs store colours as floats that can land just past 255; Figma rejects anything above 1.
const unit = (n: number) => Math.min(Math.max(n, 0), 1);

function rgb(c: Color | undefined, fallback: RGB01 = { r: 0, g: 0, b: 0 }): RGB01 {
  if (!c) return fallback;
  const o = c as any;
  if ("fr" in o) return { r: unit(o.fr), g: unit(o.fg), b: unit(o.fb) };
  if ("r" in o) return { r: unit(o.r / 255), g: unit(o.g / 255), b: unit(o.b / 255) };
  if ("k" in o && !("c" in o)) {
    const v = 1 - o.k / 255;
    return { r: v, g: v, b: v };
  }
  if ("c" in o) {
    // CMYK, 0-255 each
    const k = 1 - o.k / 255;
    return { r: (1 - o.c / 255) * k, g: (1 - o.m / 255) * k, b: (1 - o.y / 255) * k };
  }
  return fallback;
}

const px = (u: UnitsValue | undefined, d = 0) => (u ? u.value : d);

function toCanvas(layer: Layer): HTMLCanvasElement | null {
  const data = layer.imageData;
  if (data && data.width > 0 && data.height > 0) {
    const c = document.createElement("canvas");
    c.width = data.width;
    c.height = data.height;
    const img = new ImageData(new Uint8ClampedArray(data.data as Uint8ClampedArray), data.width, data.height);
    c.getContext("2d")!.putImageData(img, 0, 0);
    return c;
  }
  return layer.canvas && layer.canvas.width > 0 ? layer.canvas : null;
}

// Bakes a pixel layer mask into the layer's alpha.
function applyMask(layer: Layer, canvas: HTMLCanvasElement, left = layer.left ?? 0, top = layer.top ?? 0): HTMLCanvasElement {
  const m = layer.mask;
  if (!m || m.disabled) return canvas;
  const mc = m.imageData
    ? (() => {
        const c = document.createElement("canvas");
        c.width = m.imageData!.width;
        c.height = m.imageData!.height;
        c.getContext("2d")!.putImageData(
          new ImageData(new Uint8ClampedArray(m.imageData!.data as Uint8ClampedArray), c.width, c.height), 0, 0);
        return c;
      })()
    : m.canvas;
  if (!mc) return canvas;
  const w = canvas.width, h = canvas.height;
  const def = m.defaultColor ?? 255;
  const mask = document.createElement("canvas");
  mask.width = w;
  mask.height = h;
  const mctx = mask.getContext("2d")!;
  mctx.fillStyle = `rgb(${def},${def},${def})`;
  mctx.fillRect(0, 0, w, h);
  mctx.drawImage(mc, (m.left ?? 0) - left, (m.top ?? 0) - top);
  const md = mctx.getImageData(0, 0, w, h);
  for (let i = 0; i < md.data.length; i += 4) {
    md.data[i + 3] = md.data[i]!; // luminance -> alpha
    md.data[i] = md.data[i + 1] = md.data[i + 2] = 0;
  }
  mctx.putImageData(md, 0, 0);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d")!;
  octx.drawImage(canvas, 0, 0);
  octx.globalCompositeOperation = "destination-in";
  octx.drawImage(mask, 0, 0);
  return out;
}

// Figma rejects images above 4096px a side; the node keeps the layer's size, so only sharpness is lost.
const MAX_IMAGE = 4096;

function fitForFigma(c: HTMLCanvasElement): HTMLCanvasElement {
  const s = MAX_IMAGE / Math.max(c.width, c.height);
  if (s >= 1) return c;
  const out = document.createElement("canvas");
  out.width = Math.max(Math.round(c.width * s), 1);
  out.height = Math.max(Math.round(c.height * s), 1);
  out.getContext("2d")!.drawImage(c, 0, 0, out.width, out.height);
  return out;
}

// Decodes a smart object's embedded file (PSD/PSB composite, or a PNG/JPEG/etc.) to a canvas.
async function decodeLinked(data: Uint8Array): Promise<HTMLCanvasElement | null> {
  try {
    if (data[0] === 0x38 && data[1] === 0x42 && data[2] === 0x50 && data[3] === 0x53) { // "8BPS"
      const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      const inner = readPsd(buf, { useImageData: true, skipThumbnail: true, skipLayerImageData: true, skipLinkedFilesData: true });
      return toCanvas(inner);
    }
    const bmp = await createImageBitmap(new Blob([data as BlobPart]));
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext("2d")!.drawImage(bmp, 0, 0);
    return c;
  } catch {
    return null; // vector formats (AI, PDF, SVG) can't be decoded here
  }
}

// Places a smart object's content on its transform quad (TL, TR, BR, BL in document pixels).
function placeOnQuad(src: HTMLCanvasElement, q: number[]) {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = q as [number, number, number, number, number, number, number, number];
  const left = Math.floor(Math.min(x0, x1, x2, x3));
  const top = Math.floor(Math.min(y0, y1, y2, y3));
  const c = document.createElement("canvas");
  c.width = Math.max(Math.ceil(Math.max(x0, x1, x2, x3)) - left, 1);
  c.height = Math.max(Math.ceil(Math.max(y0, y1, y2, y3)) - top, 1);
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.setTransform((x1 - x0) / src.width, (y1 - y0) / src.width, (x3 - x0) / src.height, (y3 - y0) / src.height, x0 - left, y0 - top);
  ctx.drawImage(src, 0, 0);
  const skewed = Math.hypot(x0 + x2 - x1 - x3, y0 + y2 - y1 - y3) > 1;
  return { canvas: c, left, top, skewed };
}

// The single colour a canvas shows inside its opaque area, if it has just one.
function uniformColor(c: HTMLCanvasElement): RGB01 | null {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  let r = -1, g = -1, b = -1;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! < 250) continue;
    if (r < 0) { r = d[i]!; g = d[i + 1]!; b = d[i + 2]!; }
    else if (Math.abs(d[i]! - r) > 2 || Math.abs(d[i + 1]! - g) > 2 || Math.abs(d[i + 2]! - b) > 2) return null;
  }
  return r < 0 ? null : { r: r / 255, g: g / 255, b: b / 255 };
}

function crop(c: HTMLCanvasElement, x: number, y: number, w: number, h: number): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = Math.max(Math.ceil(w), 1);
  out.height = Math.max(Math.ceil(h), 1);
  out.getContext("2d")!.drawImage(c, x, y, w, h, 0, 0, out.width, out.height);
  return out;
}

function canvasToPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a))) : reject(new Error("PNG encode failed"))), "image/png"));
}

function shadow(kind: "drop" | "inner", s: LayerEffectShadow): EffectModel | null {
  if (s.enabled === false) return null;
  const size = px(s.size);
  const dist = px(s.distance);
  const a = ((s.angle ?? 120) * Math.PI) / 180;
  return {
    kind,
    color: rgb(s.color),
    opacity: s.opacity ?? 0.75,
    x: Math.cos(a) * dist,
    y: -Math.sin(a) * dist,
    blur: size,
    spread: (size * px(s.choke)) / 100,
  };
}

function effectsOf(layer: Layer): EffectModel[] {
  const e = layer.effects;
  if (!e || e.disabled) return [];
  const out: EffectModel[] = [];
  for (const s of e.dropShadow ?? []) { const m = shadow("drop", s); if (m) out.push(m); }
  for (const s of e.innerShadow ?? []) { const m = shadow("inner", s); if (m) out.push(m); }
  if (e.outerGlow && e.outerGlow.enabled !== false) {
    const g = e.outerGlow;
    out.push({ kind: "glow", color: rgb(g.color, { r: 1, g: 1, b: 0.75 }), opacity: g.opacity ?? 0.75, x: 0, y: 0, blur: px(g.size), spread: (px(g.size) * px(g.choke)) / 100 });
  }
  if (e.innerGlow && e.innerGlow.enabled !== false) {
    const g = e.innerGlow;
    out.push({ kind: "innerGlow", color: rgb(g.color, { r: 1, g: 1, b: 0.75 }), opacity: g.opacity ?? 0.75, x: 0, y: 0, blur: px(g.size), spread: 0 });
  }
  return out;
}

function strokeEffect(layer: Layer): StrokeModel | undefined {
  const s = layer.effects?.stroke?.find((x) => x.enabled !== false && (x.fillType ?? "color") === "color");
  if (!s || layer.effects?.disabled) return undefined;
  return {
    color: rgb(s.color),
    opacity: s.opacity ?? 1,
    width: px(s.size, 1),
    align: s.position === "inside" ? "INSIDE" : s.position === "outside" ? "OUTSIDE" : "CENTER",
  };
}

function fillEffect(layer: Layer) {
  const f = layer.effects?.solidFill?.find((x) => x.enabled !== false);
  if (!f || layer.effects?.disabled) return undefined;
  return { color: rgb(f.color), opacity: f.opacity ?? 1 };
}

function pathsOf(list: BezierPath[]): { paths: PathModel[]; x: number; y: number; w: number; h: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of list) {
    for (const k of p.knots) {
      for (let i = 0; i < 6; i += 2) {
        minX = Math.min(minX, k.points[i]!); maxX = Math.max(maxX, k.points[i]!);
        minY = Math.min(minY, k.points[i + 1]!); maxY = Math.max(maxY, k.points[i + 1]!);
      }
    }
  }
  if (!isFinite(minX)) return null;
  const f = (n: number) => +n.toFixed(3);
  const paths: PathModel[] = [];
  for (const p of list) {
    if (p.knots.length < 2) continue;
    const pt = (i: number, j: number) => `${f(p.knots[i]!.points[j]! - minX)} ${f(p.knots[i]!.points[j + 1]! - minY)}`;
    let d = `M ${pt(0, 2)}`;
    const n = p.knots.length;
    const segs = p.open ? n - 1 : n;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n;
      d += ` C ${pt(i, 4)} ${pt(j, 0)} ${pt(j, 2)}`;
    }
    if (!p.open) d += " Z";
    paths.push({ data: d, rule: p.fillRule === "non-zero" ? "NONZERO" : "EVENODD" });
  }
  if (!paths.length) return null;
  return { paths, x: minX, y: minY, w: Math.max(maxX - minX, 0.01), h: Math.max(maxY - minY, 0.01) };
}

function textRuns(layer: Layer): { runs: TextRun[]; scale: number } {
  const t = layer.text!;
  const tr = t.transform;
  const scale = tr ? Math.hypot(tr[0]!, tr[1]!) || 1 : 1;
  const base = t.style ?? {};
  const make = (s: typeof base, start: number, end: number): TextRun => {
    const st = { ...base, ...s };
    const size = (st.fontSize ?? 12) * scale;
    return {
      start,
      end,
      font: st.font?.name ?? "",
      size,
      color: rgb(st.fillColor),
      tracking: ((st.tracking ?? 0) / 1000) * size,
      lineHeight: st.autoLeading === false && st.leading ? st.leading * scale : null,
      underline: !!st.underline,
      strike: !!st.strikethrough,
      caps: (st.fontCaps ?? 0) === 2,
    };
  };
  const runs: TextRun[] = [];
  if (t.styleRuns?.length) {
    let pos = 0;
    for (const r of t.styleRuns) {
      if (r.length > 0) runs.push(make(r.style, pos, pos + r.length));
      pos += r.length;
    }
  }
  if (!runs.length) runs.push(make({}, 0, t.text.length));
  return { runs, scale };
}

export async function parsePsd(buffer: ArrayBuffer, name: string, sendImage: SendImage, progress: (s: string) => void): Promise<DocModel> {
  const psd = readPsd(buffer, {
    useImageData: true,
    skipThumbnail: true,
    skipCompositeImageData: true,
  });
  const linked = new Map<string, Promise<HTMLCanvasElement | null>>();

  // Smart object -> native shape: the outline comes from its vector mask or is traced from
  // its alpha, and its content becomes the fill. `content` is unmasked; `left`/`top` place it.
  const smartShape = async (layer: Layer, base: LayerModel, content: HTMLCanvasElement, left: number, top: number): Promise<LayerModel> => {
    const masked = applyMask(layer, content, left, top);
    const vector = layer.vectorMask && !layer.vectorMask.disable ? pathsOf(layer.vectorMask.paths) : null;
    let geo: { x: number; y: number; w: number; h: number; paths?: PathModel[]; cornerRadius?: number } | null = vector;
    if (!geo) {
      const alpha = masked.getContext("2d")!.getImageData(0, 0, masked.width, masked.height).data;
      const t = traceShape(alpha.subarray(3), masked.width, masked.height, 4);
      if (t) {
        geo = { x: t.x + left, y: t.y + top, w: t.w, h: t.h, cornerRadius: t.cornerRadius };
        if (t.data) geo.paths = [{ data: t.data, rule: "EVENODD" }];
      }
    }
    // Too soft or intricate for an outline: a rectangle whose image keeps the transparency.
    if (!geo) return { ...base, kind: "smart", x: left, y: top, w: masked.width, h: masked.height, softAlpha: true, imageId: await sendCanvas(masked) };

    const model: LayerModel = { ...base, kind: "smart", ...geo };
    const inside = crop(content, geo.x - left, geo.y - top, geo.w, geo.h);
    const color = uniformColor(crop(masked, geo.x - left, geo.y - top, geo.w, geo.h));
    if (color) model.fill = { color, opacity: 1 };
    else model.imageId = await sendCanvas(inside);
    return model;
  };
  const warnings: string[] = [];
  let nextImage = 1;
  let count = 0;

  const sendCanvas = async (c: HTMLCanvasElement) => {
    const id = nextImage++;
    await sendImage(id, await canvasToPng(fitForFigma(c)));
    return id;
  };

  async function convert(layer: Layer): Promise<LayerModel | null> {
    const lname = layer.name || "Layer";
    const base: LayerModel = {
      name: lname,
      kind: "raster",
      x: layer.left ?? 0,
      y: layer.top ?? 0,
      w: Math.max((layer.right ?? 0) - (layer.left ?? 0), 0),
      h: Math.max((layer.bottom ?? 0) - (layer.top ?? 0), 0),
      opacity: layer.opacity ?? 1,
      hidden: !!layer.hidden,
      blend: BLEND[layer.blendMode ?? "normal"] ?? "NORMAL",
      clipping: !!layer.clipping,
      effects: effectsOf(layer),
    };
    if (layer.blendMode && !BLEND[layer.blendMode]) warnings.push(`"${lname}": blend mode "${layer.blendMode}" has no Figma equivalent, used Normal`);
    if (++count % 5 === 0) progress(`Reading layers… ${count}`);

    if (layer.children) {
      const kids: LayerModel[] = [];
      for (const c of layer.children) {
        const m = await convert(c);
        if (m) kids.push(m);
      }
      if (!kids.length) return null;
      if (layer.mask && !layer.mask.disabled) warnings.push(`"${lname}": group mask ignored`);
      if (layer.blendMode === "pass through" || !layer.blendMode) base.blend = "PASS_THROUGH";
      return { ...base, kind: "group", children: kids };
    }

    if (layer.adjustment) {
      warnings.push(`"${lname}": adjustment layer skipped (no Figma equivalent)`);
      return null;
    }

    // Text
    if (layer.text && layer.text.text) {
      const { runs, scale } = textRuns(layer);
      const just = layer.text.paragraphStyle?.justification ?? "left";
      const box = layer.text.shapeType === "box" && layer.text.boxBounds;
      const tr = layer.text.transform;
      let { x, w } = base;
      if (box && tr) {
        x = tr[4]! + layer.text.boxBounds![0]! * scale;
        w = (layer.text.boxBounds![2]! - layer.text.boxBounds![0]!) * scale;
      }
      return {
        ...base,
        kind: "text",
        x,
        w,
        text: layer.text.text.replace(/\r\n?/g, "\n").replace(/\u0003/g, "\n"),
        runs,
        align: just === "center" || just === "justify-center" ? "CENTER" : just === "right" || just === "justify-right" ? "RIGHT" : just === "justify-all" ? "JUSTIFIED" : "LEFT",
        boxed: !!box,
        stroke: strokeEffect(layer),
        fill: fillEffect(layer),
      };
    }

    const raw = toCanvas(layer);

    // Smart object -> native shape filled with its rendered content
    if (layer.placedLayer) {
      if (raw) return smartShape(layer, base, raw, layer.left ?? 0, layer.top ?? 0);
      {
        // Mockup templates often store no pixels on the layer itself, only the embedded file.
        const p = layer.placedLayer;
        const file = psd.linkedFiles?.find((f) => f.id === p.id);
        if (file?.data && !linked.has(file.id)) linked.set(file.id, decodeLinked(file.data));
        const src = file ? await linked.get(file.id) : null;
        if (!src || p.transform?.length !== 8) { warnings.push(`"${lname}": smart object has no rendered pixels, skipped`); return null; }
        const placed = placeOnQuad(src, p.transform);
        if (placed.skewed) warnings.push(`"${lname}": smart object perspective flattened to its nearest parallelogram`);
        if (p.warp && p.warp.style && p.warp.style !== "none") warnings.push(`"${lname}": smart object warp ignored`);
        return smartShape(layer, base, placed.canvas, placed.left, placed.top);
      }
    }

    const canvas = raw ? applyMask(layer, raw) : null;

    // Vector shape layer -> editable vector
    if (layer.vectorMask && !layer.vectorMask.disable && layer.vectorMask.paths.length) {
      const geo = pathsOf(layer.vectorMask.paths);
      if (geo) {
        const vf = layer.vectorFill;
        const vs = layer.vectorStroke;
        const model: LayerModel = { ...base, kind: "shape", x: geo.x, y: geo.y, w: geo.w, h: geo.h, paths: geo.paths };
        if (vf && vf.type === "color" && vs?.fillEnabled !== false) {
          model.fill = { color: rgb(vf.color), opacity: 1 };
        } else if (vf && vs?.fillEnabled !== false && canvas) {
          // gradient / pattern fills: keep the look as an image fill, geometry stays editable
          model.imageId = await sendCanvas(canvas);
          model.x = base.x; model.y = base.y; model.w = base.w; model.h = base.h;
          model.paths = undefined;
          warnings.push(`"${lname}": gradient/pattern shape imported as an image to keep its look`);
          return { ...model, kind: "raster" };
        }
        const fe = fillEffect(layer);
        if (fe) model.fill = fe;
        if (vs?.strokeEnabled && vs.content?.type === "color") {
          const dashes = vs.lineDashSet?.map((d) => px(d)).filter((d) => d > 0);
          const lw = px(vs.lineWidth, 1);
          model.stroke = {
            color: rgb(vs.content.color),
            opacity: vs.opacity ?? 1,
            width: lw,
            align: vs.lineAlignment === "inside" ? "INSIDE" : vs.lineAlignment === "outside" ? "OUTSIDE" : "CENTER",
            cap: vs.lineCapType === "round" ? "ROUND" : vs.lineCapType === "square" ? "SQUARE" : "NONE",
            join: vs.lineJoinType === "round" ? "ROUND" : vs.lineJoinType === "bevel" ? "BEVEL" : "MITER",
            dashes: dashes?.length ? dashes.map((d) => d * lw) : undefined,
          };
        }
        const se = strokeEffect(layer);
        if (se && !model.stroke) model.stroke = se;
        return model;
      }
    }

    // Plain pixels
    if (!canvas) return null;
    return { ...base, kind: "raster", imageId: await sendCanvas(canvas) };
  }

  const layers: LayerModel[] = [];
  for (const l of psd.children ?? []) {
    const m = await convert(l);
    if (m) layers.push(m);
  }
  if (!layers.length) warnings.push("No layers found; the PSD may be flattened");
  return { name: name.replace(/\.psd$/i, ""), width: psd.width, height: psd.height, layers, warnings };
}
