// Slide model -> .pptx via PptxGenJS. Runs in the UI iframe and in Node (tests).
import PptxGenJS from 'pptxgenjs';
import type { DeckLayout, ImageObject, ShapeObject, SlideModel, SlideObject, TextObject } from './slideModel';

type Slide = ReturnType<PptxGenJS['addSlide']>;
type Images = Record<string, Uint8Array>;

export function toBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(bin);
  }
  return Buffer.from(bytes).toString('base64');
}

function pngData(images: Images, imageId: string): string {
  const bytes = images[imageId];
  if (!bytes) throw new Error(`Missing image bytes for ${imageId}`);
  return `image/png;base64,${toBase64(bytes)}`;
}

function addImage(slide: Slide, obj: ImageObject, images: Images): void {
  slide.addImage({
    data: pngData(images, obj.imageId),
    x: obj.x,
    y: obj.y,
    w: obj.w,
    h: obj.h,
    objectName: obj.name,
    altText: obj.name,
  });
}

function addShape(pres: PptxGenJS, slide: Slide, obj: ShapeObject): void {
  const type = obj.shape === 'ellipse' ? pres.ShapeType.ellipse : obj.shape === 'roundRect' ? pres.ShapeType.roundRect : pres.ShapeType.rect;
  slide.addShape(type, {
    x: obj.x,
    y: obj.y,
    w: obj.w,
    h: obj.h,
    rotate: obj.rotation,
    objectName: obj.name,
    fill: obj.fill ? { color: obj.fill.hex, transparency: obj.fill.transparency } : { type: 'none' },
    line: obj.line ? { color: obj.line.hex, transparency: obj.line.transparency, width: obj.line.widthPt } : { type: 'none' },
    ...(obj.shape === 'roundRect' ? { rectRadius: obj.radiusIn } : {}),
  });
}

function addText(slide: Slide, obj: TextObject): void {
  const runs = obj.runs.map((r) => ({
    text: r.text,
    options: {
      fontFace: r.fontFace,
      fontSize: r.fontSizePt,
      bold: r.bold,
      italic: r.italic,
      color: r.colorHex,
      transparency: r.transparency,
      charSpacing: r.charSpacingPt,
      ...(r.underline ? { underline: { style: 'sng' as const } } : {}),
      ...(r.strike ? { strike: 'sngStrike' as const } : {}),
      ...(r.hyperlink ? { hyperlink: { url: r.hyperlink } } : {}),
      ...(r.lineSpacingPt !== undefined ? { lineSpacing: r.lineSpacingPt } : {}),
      ...(obj.paragraphSpacingPt > 0 ? { paraSpaceAfter: obj.paragraphSpacingPt } : {}),
    },
  }));
  slide.addText(runs, {
    x: obj.x,
    y: obj.y,
    w: obj.w,
    h: obj.h,
    rotate: obj.rotation,
    align: obj.align,
    valign: obj.valign,
    // Why: PowerPoint/Slides pad text boxes by default; Figma has no padding.
    margin: 0,
    // Why: never shrink or grow the box; Figma's size is the source of truth.
    fit: 'none',
    wrap: true,
    objectName: obj.name,
  });
}

function addObject(pres: PptxGenJS, slide: Slide, obj: SlideObject, images: Images): void {
  if (obj.kind === 'image') addImage(slide, obj, images);
  else if (obj.kind === 'shape') addShape(pres, slide, obj);
  else addText(slide, obj);
}

function addSlideModel(pres: PptxGenJS, model: SlideModel, images: Images): void {
  const slide = pres.addSlide();
  const bg = model.background;
  if (bg.kind === 'solid') slide.background = { color: bg.hex, transparency: bg.transparency };
  for (const obj of model.objects) addObject(pres, slide, obj, images);
  if (model.notes) slide.addNotes(model.notes);
}

/** `images` is the union of all slides' images; ids are unique per deck. */
export async function buildPptx(layout: DeckLayout, slides: ReadonlyArray<SlideModel>, images: Images): Promise<ArrayBuffer> {
  const pres = new PptxGenJS();
  pres.defineLayout({ name: 'SLIDESYNC', width: layout.widthIn, height: layout.heightIn });
  pres.layout = 'SLIDESYNC';
  pres.title = 'SlideSync export';
  for (const s of slides) addSlideModel(pres, s, images);
  return (await pres.write({ outputType: 'arraybuffer' })) as ArrayBuffer;
}
