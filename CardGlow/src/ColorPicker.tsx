// Custom colour picker. The native <input type="color"> opens the browser's
// own popup inside Figma's iframe, which is unstyled and covers the panel, so
// this draws a compact saturation/brightness area and hue slider instead.

import { useEffect, useRef, useState } from "react";
import { clamp01, normHex } from "./spec";

interface HSV { h: number; s: number; v: number }

function hexToHsv(hex: string): HSV {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

function hsvToHex({ h, s, v }: HSV): string {
  const f = (k: number) => {
    const x = (k + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(x, 4 - x, 1));
  };
  return "#" + [f(5), f(3), f(1)].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Calls `onMove` with the pointer's 0–1 position inside the element while dragging. */
function useDrag(onMove: (x: number, y: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const move = useRef(onMove);
  move.current = onMove;

  const handle = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    move.current(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height));
  };
  return {
    ref,
    onPointerDown: (e: React.PointerEvent) => {
      (e.target as Element).setPointerCapture(e.pointerId);
      handle(e);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (e.buttons) handle(e);
    },
  };
}

function HexInput({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [text, setText] = useState(value.slice(1));
  useEffect(() => setText(value.slice(1)), [value]);
  return (
    <label className="hex-field">
      <span>#</span>
      <input
        maxLength={6}
        value={text}
        spellCheck={false}
        onChange={(e) => {
          const t = e.target.value.replace(/[^0-9a-f]/gi, "").toUpperCase();
          setText(t);
          if (t.length === 6) onChange("#" + t);
        }}
        onBlur={() => {
          const h = normHex(text);
          if (h) onChange(h);
          else setText(value.slice(1));
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

export function ColorPopover({ value, onChange, onClose, ignore = ".swatch-btn", palette, title, inline }: {
  value: string;
  onChange: (hex: string) => void;
  onClose: () => void;
  /** Clicks on elements matching this selector don't close the popover (its own opener). */
  ignore?: string;
  /** Quick-pick colours shown above the picker. */
  palette?: { name: string; colors: string[] }[];
  /** What is being edited, e.g. "Border". */
  title?: string;
  /** Sit in the page flow (under the clicked colour) instead of floating. */
  inline?: boolean;
}) {
  // Keep HSV locally so hue survives greys and black, where hex loses it.
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (hsvToHex(hsv) !== value) setHsv(hexToHsv(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (ref.current && !ref.current.contains(t) && !t.closest(ignore)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, ignore]);

  const set = (next: HSV) => {
    setHsv(next);
    onChange(hsvToHex(next));
  };
  const area = useDrag((x, y) => set({ ...hsv, s: x, v: 1 - y }));
  const hue = useDrag((x) => set({ ...hsv, h: Math.min(359.9, x * 360) }));
  const pure = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  const pick = (hex: string) => {
    setHsv(hexToHsv(hex));
    onChange(hex);
  };

  return (
    <div className={"picker" + (inline ? " inline" : "")} ref={ref} onKeyDown={(e) => e.stopPropagation()}>
      {title && <div className="picker-title"><i style={{ background: value }} />{title}</div>}
      {palette?.map((row) => (
        <div key={row.name} className="palette">
          <div className="palette-name">{row.name}</div>
          <div className="palette-dots">
            {row.colors.map((c, i) => (
              <button
                key={c + i}
                className={"palette-dot" + (c === value ? " active" : "")}
                style={{ background: c }}
                title={c}
                onClick={() => pick(c)}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="sv" {...area} style={{ background: pure }}>
        <div className="sv-white" />
        <div className="sv-black" />
        <div className="knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }} />
      </div>
      <div className="hue" {...hue}>
        <div className="knob small" style={{ left: `${(hsv.h / 360) * 100}%`, background: pure }} />
      </div>
      <div className="picker-row">
        <div className="picker-preview" style={{ background: value }} />
        <HexInput value={value} onChange={pick} />
        <button className="ghost-btn" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

export function ColorPicker({ value, onChange, swatches, fromSelection }: {
  value: string;
  onChange: (hex: string) => void;
  swatches: string[];
  fromSelection: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="card color-card">
      <div className="row">
        <button className={"swatch-btn" + (open ? " open" : "")} style={{ background: value }} onClick={() => setOpen((o) => !o)} title="Edit colour" />
        <div className="color-meta">
          <div className="label">Your colour</div>
          <HexInput value={value} onChange={onChange} />
        </div>
        {fromSelection && fromSelection !== value && (
          <button className="ghost-btn use-sel" onClick={() => onChange(fromSelection)} title="Use the fill of the selected layer">
            <i style={{ background: fromSelection }} /> Use selection
          </button>
        )}
      </div>
      <div className="swatches">
        {swatches.map((c) => (
          <button key={c} className={"dot" + (c === value ? " active" : "")} style={{ background: c }} title={c} onClick={() => onChange(c)} />
        ))}
      </div>
      {open && <ColorPopover value={value} onChange={onChange} onClose={() => setOpen(false)} />}
    </div>
  );
}
