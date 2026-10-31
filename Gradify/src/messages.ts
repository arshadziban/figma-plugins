import type { GradientSpec, Size } from "./spec";
import type { Tweaks } from "./styles";

/** What the UI remembers between runs (figma.clientStorage). */
export interface Settings {
  color: string;
  index: number;
  sizeIndex: number;
  tweaks: Tweaks;
}

export type ToMain =
  | { type: "ready" }
  | { type: "apply"; spec: GradientSpec }
  | { type: "create"; spec: GradientSpec; size: Size }
  | { type: "remove" }
  | { type: "save"; settings: Settings };

export interface SelectionInfo {
  /** Selected frames/components that a gradient can be applied to. */
  count: number;
  names: string[];
  hasGradify: boolean;
  /** Solid fill of the first selected non-frame layer, e.g. a colour swatch. */
  color: string | null;
}

export type ToUI =
  | ({ type: "selection" } & SelectionInfo)
  | { type: "settings"; settings: Settings | null }
  | { type: "success"; message: string }
  | { type: "error"; message: string };
