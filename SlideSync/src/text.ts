// Figma text segments -> PptxGenJS-ready runs. No Figma globals.
import type { TextRunModel } from './slideModel';

export interface SegmentInfo {
  characters: string;
  fontFamily: string;
  fontStyle: string;
  fontWeight: number;
  fontSizePx: number;
  /** Resolved solid colour; the caller has already folded in opacities. */
  colorHex: string;
  transparency: number;
  textDecoration: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
  textCase: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE' | 'SMALL_CAPS' | 'SMALL_CAPS_FORCED';
  letterSpacing: { value: number; unit: 'PIXELS' | 'PERCENT' };
  lineHeight: { unit: 'AUTO' } | { value: number; unit: 'PIXELS' | 'PERCENT' };
  hyperlinkUrl?: string;
}

const WEIGHT_SUFFIX: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  500: 'Medium',
  800: 'ExtraBold',
  900: 'Black',
};

/**
 * Slides/PowerPoint only expose Regular+Bold as flags; other weights are separate family names
 * ("Roboto Light"). 600/700 map to the bold flag, which is the closest both apps can express.
 */
export function fontFaceFor(family: string, style: string, weight: number): { fontFace: string; bold: boolean; italic: boolean } {
  const italic = /italic|oblique/i.test(style);
  const suffix = WEIGHT_SUFFIX[weight];
  const bold = weight === 600 || weight === 700;
  return { fontFace: suffix ? `${family} ${suffix}` : family, bold, italic };
}

export function lineHeightToPt(lh: SegmentInfo['lineHeight'], fontSizePx: number, ptPerPx: number): number | undefined {
  if (lh.unit === 'AUTO') return undefined;
  const px = lh.unit === 'PIXELS' ? lh.value : (lh.value / 100) * fontSizePx;
  return round2(px * ptPerPx);
}

export function letterSpacingToPt(ls: SegmentInfo['letterSpacing'], fontSizePx: number, ptPerPx: number): number {
  const px = ls.unit === 'PIXELS' ? ls.value : (ls.value / 100) * fontSizePx;
  return round2(px * ptPerPx);
}

export function applyTextCase(text: string, textCase: SegmentInfo['textCase']): string {
  switch (textCase) {
    case 'UPPER':
      return text.toUpperCase();
    case 'LOWER':
      return text.toLowerCase();
    case 'TITLE':
      return text.toLowerCase().replace(/(^|\s)(\S)/g, (_m, sp: string, ch: string) => sp + ch.toUpperCase());
    default:
      return text;
  }
}

/** Figma uses U+2028 for soft line breaks; PowerPoint wants a paragraph/line break in the run. */
function normalizeBreaks(text: string): string {
  return text.split(String.fromCharCode(0x2028)).join('\n');
}

export function segmentsToRuns(segments: ReadonlyArray<SegmentInfo>, ptPerPx: number): TextRunModel[] {
  return segments.map((s) => {
    const face = fontFaceFor(s.fontFamily, s.fontStyle, s.fontWeight);
    const run: TextRunModel = {
      text: normalizeBreaks(applyTextCase(s.characters, s.textCase)),
      fontFace: face.fontFace,
      fontSizePt: round2(s.fontSizePx * ptPerPx),
      bold: face.bold,
      italic: face.italic,
      colorHex: s.colorHex,
      transparency: s.transparency,
      underline: s.textDecoration === 'UNDERLINE',
      strike: s.textDecoration === 'STRIKETHROUGH',
      charSpacingPt: letterSpacingToPt(s.letterSpacing, s.fontSizePx, ptPerPx),
    };
    const lineSpacing = lineHeightToPt(s.lineHeight, s.fontSizePx, ptPerPx);
    if (lineSpacing !== undefined) run.lineSpacingPt = lineSpacing;
    if (s.hyperlinkUrl) run.hyperlink = s.hyperlinkUrl;
    return run;
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
