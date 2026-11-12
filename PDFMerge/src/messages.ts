export interface FrameInfo {
  id: string;
  name: string;
  width: number;
  height: number;
}

/** A clickable area inside a frame, in frame-relative px (top-left origin). */
export interface LinkInfo {
  x: number;
  y: number;
  w: number;
  h: number;
  url?: string;
  /** Index (in the merge order) of the page this link jumps to. */
  destIndex?: number;
}

export type MainToUi =
  | { type: 'selection'; frames: FrameInfo[] }
  | { type: 'thumb'; id: string; bytes: Uint8Array }
  | { type: 'page'; index: number; total: number; bytes: Uint8Array; links: LinkInfo[] }
  | { type: 'error'; message: string };

export type UiToMain = { type: 'export'; ids: string[] } | { type: 'cancel' } | { type: 'close' };
