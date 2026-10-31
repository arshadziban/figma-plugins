import type { CardSpec, Size } from "./spec";
import type { ContentColors, Overrides, Tweaks } from "./looks";

/** What the UI remembers between runs (figma.clientStorage). */
export interface Settings {
  color: string;
  index: number;
  sizeIndex: number;
  content: boolean;
  tweaks: Tweaks;
  /** Colours the user picked by hand, keyed by colour role. */
  colors: Overrides;
}

export type ToMain =
  | { type: "ready" }
  | { type: "apply"; spec: CardSpec }
  | { type: "create"; spec: CardSpec; size: Size; content: boolean; colors: ContentColors }
  | { type: "glass"; color: string }
  | { type: "remove" }
  | { type: "save"; settings: Settings };

export interface SelectionInfo {
  /** Selected frames, components and rectangles a card style can be applied to. */
  count: number;
  names: string[];
  hasCard: boolean;
  /** Selected layers that can be turned into glass (anything with fills and strokes). */
  glassCount: number;
  /** Solid fill of the first selected non-frame layer, e.g. a colour swatch. */
  color: string | null;
}

export type ToUI =
  | ({ type: "selection" } & SelectionInfo)
  | { type: "settings"; settings: Settings | null }
  | { type: "success"; message: string }
  | { type: "error"; message: string };
