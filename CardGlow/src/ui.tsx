import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { SelectionInfo, Settings, ToMain, ToUI } from "./messages";
import { CardSpec, Size, normHex, shade } from "./spec";
import { ColorPicker, ColorPopover } from "./ColorPicker";
import { Logo } from "./Logo";
import { SAMPLE } from "./sample";
import {
  ColorSlot, ContentColors, DEFAULT_TWEAKS, DIRECTION_COUNT, LOOK_NAMES, Overrides, STYLE_COUNT, Tweaks,
  cardStyle, colorSlots, contentColors, lookOf, lookStart, recolor, tweak,
} from "./looks";

const DEFAULT_COLOR = "#2F6BF0";

// The two reference cards plus the base colours of the file's scales.
const SWATCHES = ["#2F6BF0", "#9563FF", "#2B7BF2", "#6B43F0", "#5F4ECA", "#0059DD", "#49B1F4", "#A06DFF", "#503AEE"];

const SIZES: { label: string; size: Size }[] = [
  { label: "Card · 527 × 516", size: { width: 527, height: 516 } },
  { label: "Square · 480 × 480", size: { width: 480, height: 480 } },
  { label: "Wide · 640 × 400", size: { width: 640, height: 400 } },
  { label: "Tall · 420 × 560", size: { width: 420, height: 560 } },
  { label: "Banner · 1200 × 400", size: { width: 1200, height: 400 } },
];

// Room for the card inside the big preview on the left.
const STAGE = { width: 330, height: 330 };

function post(msg: ToMain) {
  parent.postMessage({ pluginMessage: msg }, "*");
}

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ── Card rendering ──────────────────────────────────────────────────────────
// CSS lists backgrounds top first; Figma lists fills bottom first.

const CSS_ANGLE = { tl: "135deg", tr: "225deg", top: "180deg" } as const;

function background(spec: CardSpec): string {
  const layers = spec.radials.map((r) =>
    `radial-gradient(ellipse ${r.r * 100}% ${r.r * 100}% at ${r.cx * 100}% ${r.cy * 100}%, ${rgba(r.from.color, r.from.opacity)} 0%, ${rgba(r.to.color, r.to.opacity)} 100%)`,
  ).reverse();
  const { stops, direction } = spec.linear;
  layers.push(stops.length === 1 && stops[0]
    ? `linear-gradient(${rgba(stops[0].color, stops[0].opacity)}, ${rgba(stops[0].color, stops[0].opacity)})`
    : `linear-gradient(${CSS_ANGLE[direction]}, ${stops.map((s) => `${rgba(s.color, s.opacity)} ${s.position * 100}%`).join(", ")})`);
  return layers.join(", ");
}

const STAR = "polygon(50% 0%, 54% 42%, 85% 15%, 58% 46%, 100% 50%, 58% 54%, 85% 85%, 54% 58%, 50% 100%, 46% 58%, 15% 85%, 42% 54%, 0% 50%, 42% 46%, 15% 15%, 46% 42%)";

function SampleContent({ scale, colors }: { scale: number; colors: ContentColors }) {
  const px = (v: number) => `${v * scale}px`;
  return (
    <div className="sample" style={{ padding: `0 ${px(48)}`, gap: px(16), color: colors.text }}>
      <div className="sample-icon" style={{ width: px(109), height: px(74), borderRadius: px(22), borderWidth: Math.max(0.5, 1.6 * scale), background: rgba(colors.glass, 0.2), borderColor: rgba(colors.glass, 0.45) }}>
        <i style={{ background: colors.text, width: px(30), height: px(30), clipPath: "polygon(50% 0%, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0% 50%, 38% 38%)" }} />
      </div>
      <div className="sample-title" style={{ fontSize: px(46) }}>{SAMPLE.title}</div>
      <div className="sample-body" style={{ fontSize: px(18) }}>{SAMPLE.body}</div>
      <div className="sample-steps" style={{ gap: px(13) }}>
        {SAMPLE.steps.map((label, i) => (
          <div key={label} className="sample-pill" style={{ height: px(68), borderRadius: px(34), padding: `0 ${px(15)}`, gap: px(17), borderWidth: Math.max(0.5, 1.6 * scale), background: rgba(colors.glass, 0.18), borderColor: rgba(colors.glass, 0.4) }}>
            <span className="badge" style={{ width: px(39), height: px(39), fontSize: px(18), color: colors.number, background: colors.badge }}>{i + 1}</span>
            <span style={{ fontSize: px(26) }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CardView({ spec, width, height, content }: { spec: CardSpec; width: number; height: number; content?: ContentColors | null }) {
  const W = width;
  const H = height;
  const shadow = spec.shadow ? `0 ${spec.shadow.y * W}px ${spec.shadow.blur * W}px ${spec.shadow.spread * W}px ${rgba(spec.shadow.color, spec.shadow.opacity)}` : "";
  const border = spec.stroke ? `inset 0 0 0 ${Math.max(0.5, spec.stroke.weight * W)}px ${rgba(spec.stroke.color, spec.stroke.opacity)}` : "";

  return (
    <div className="card-view" style={{ width: W, height: H, borderRadius: spec.radius * Math.min(W, H), background: background(spec), boxShadow: shadow }}>
      {spec.glows.map((g, i) => (
        <div key={i} className="glow" style={{
          left: g.x * W, top: g.y * H, width: g.w * W, height: g.h * H,
          background: rgba(g.color, g.opacity), filter: `blur(${(g.blur * W) / 2}px)`,
        }} />
      ))}
      {spec.sparkle && (
        // The blur sits on a wrapper: clip-path on the same element would cut the blur off.
        <div className="glow" style={{
          left: spec.sparkle.x * W, top: spec.sparkle.y * H, width: spec.sparkle.size * W, height: spec.sparkle.size * W * 1.27,
          borderRadius: 0, filter: `blur(${(spec.sparkle.blur * W) / 2}px)`,
        }}>
          <div style={{ width: "100%", height: "100%", background: rgba(spec.sparkle.color, spec.sparkle.opacity), clipPath: STAR }} />
        </div>
      )}
      {content && <SampleContent scale={W / 527} colors={content} />}
      {border && <div className="card-border" style={{ borderRadius: "inherit", boxShadow: border }} />}
    </div>
  );
}

/** Fits a card of `size` into a box, keeping its aspect ratio. */
function fit(size: Size, box: { width: number; height: number }) {
  const k = Math.min(box.width / size.width, box.height / size.height);
  return { width: Math.round(size.width * k), height: Math.round(size.height * k) };
}

// ── Look chips + style strip ────────────────────────────────────────────────

function LookChips({ look, onPick }: { look: number; onPick: (l: number) => void }) {
  return (
    <div className="moods">
      {LOOK_NAMES.map((name, l) => (
        <button key={name} className={"chip" + (l === look ? " active" : "")} onClick={() => onPick(l)}>{name}</button>
      ))}
    </div>
  );
}

function StyleStrip({ color, index, tweaks, overrides, onPick }: { color: string; index: number; tweaks: Tweaks; overrides: Overrides; onPick: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>(".mini.active")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [index]);

  return (
    <div className="strip" ref={ref}>
      {Array.from({ length: STYLE_COUNT }, (_, i) => {
        const sp = recolor(tweak(cardStyle(color, i), tweaks), overrides);
        return (
          <button key={i} className={"mini" + (i === index ? " active" : "")} title={sp.name} onClick={() => onPick(i)}>
            <CardView spec={{ ...sp, shadow: null }} width={34} height={34} />
          </button>
        );
      })}
    </div>
  );
}

// ── Adjust ──────────────────────────────────────────────────────────────────

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return <button className={"toggle" + (on ? " on" : "")} onClick={onClick}><span className="check">{on ? "✓" : ""}</span>{label}</button>;
}

function Adjust({ tweaks, onChange }: { tweaks: Tweaks; onChange: (t: Tweaks) => void }) {
  const changed = JSON.stringify(tweaks) !== JSON.stringify(DEFAULT_TWEAKS);
  const set = (patch: Partial<Tweaks>) => onChange({ ...tweaks, ...patch });
  return (
    <div className="card adjust">
      <div className="adjust-head">
        <span>Adjust</span>
        {changed && <button className="link" onClick={() => onChange(DEFAULT_TWEAKS)}>Reset</button>}
      </div>
      <div className="row">
        <label>Corners</label>
        <input type="range" min={0} max={30} value={Math.round(tweaks.radius * 100)} onChange={(e) => set({ radius: Number(e.target.value) / 100 })} />
        <span className="val">{Math.round(tweaks.radius * 100)}%</span>
      </div>
      <div className="row">
        <label>Shine</label>
        <input type="range" min={40} max={160} value={Math.round(tweaks.shine * 100)} onChange={(e) => set({ shine: Number(e.target.value) / 100 })} />
        <span className="val">{Math.round(tweaks.shine * 100)}%</span>
      </div>
      <div className="toggles">
        <Toggle on={tweaks.glows} label="Glows" onClick={() => set({ glows: !tweaks.glows })} />
        <Toggle on={tweaks.sparkle} label="Sparkle" onClick={() => set({ sparkle: !tweaks.sparkle })} />
        <Toggle on={tweaks.border} label="Border" onClick={() => set({ border: !tweaks.border })} />
        <Toggle on={tweaks.shadow} label="Shadow" onClick={() => set({ shadow: !tweaks.shadow })} />
      </div>
    </div>
  );
}

// ── Colours ─────────────────────────────────────────────────────────────────

const GROUPS: ColorSlot["group"][] = ["Card", "Glows", "Content"];

/** Every colour the current card uses. Click one to change it; edited ones can be reset. */
function ColorsPanel({ base, slots, overrides, onChange }: { base: string; slots: ColorSlot[]; overrides: Overrides; onChange: (o: Overrides) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const active = slots.find((sl) => sl.key === open) ?? null;
  const ref = useRef<HTMLDivElement>(null);

  // Your colour's scale, light to dark, plus the colours this card already uses.
  const palette = [
    { name: "Shades", colors: ["#FFFFFF", ...[10, 20, 30, 40, 50, 60, 70, 80, 90].map((st) => shade(base, st)), "#000000"] },
    { name: "In this card", colors: [...new Set(slots.map((sl) => sl.color))].slice(0, 11) },
  ];

  // The picker opens under the clicked colour; bring it into view in the scrolling area.
  useEffect(() => {
    if (open) ref.current?.querySelector(".picker")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open]);
  const edited = Object.keys(overrides).length;

  const set = (key: string, hex: string) => onChange({ ...overrides, [key]: hex });
  const reset = (key: string) => {
    const { [key]: _, ...rest } = overrides;
    onChange(rest);
  };

  return (
    <div className="card colors" ref={ref}>
      <div className="adjust-head">
        <span>Colours <em>{slots.length}</em></span>
        {edited > 0 && <button className="link" onClick={() => { setOpen(null); onChange({}); }}>Reset all ({edited})</button>}
      </div>
      {GROUPS.map((group) => {
        const items = slots.filter((sl) => sl.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group} className="slot-group">
            <div className="slot-group-name">{group}</div>
            <div className="slots">
              {items.map((sl, i) => (
                <Fragment key={sl.key}>
                <div className={"slot" + (sl.key === open ? " open" : "") + (sl.key in overrides ? " edited" : "")}>
                  <button className="slot-btn" onClick={() => setOpen((k) => (k === sl.key ? null : sl.key))} title={`${sl.label} · ${sl.color}`}>
                    <i style={{ background: sl.color }} />
                    <span className="slot-label">{sl.label}</span>
                  </button>
                  {sl.key in overrides && (
                    <button className="slot-reset" onClick={() => reset(sl.key)} title="Back to the style's colour">×</button>
                  )}
                </div>
                {/* Two slots per row: open the picker after the row that holds the clicked slot. */}
                {active && active.group === group && (i % 2 === 1 || i === items.length - 1) &&
                  Math.floor(items.findIndex((x) => x.key === active.key) / 2) === Math.floor(i / 2) && (
                  <ColorPopover
                    key={active.key}
                    value={active.color}
                    onChange={(hex) => set(active.key, hex)}
                    onClose={() => setOpen(null)}
                    ignore=".slot-btn"
                    palette={palette}
                    title={active.label}
                    inline
                  />
                )}
                </Fragment>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── App ─────────────────────────────────────────────────────────────────────

function validSettings(v: Settings | null): Settings | null {
  if (!v || typeof v !== "object") return null;
  const color = typeof v.color === "string" ? normHex(v.color) : null;
  if (!color) return null;
  const t = (v.tweaks ?? {}) as Partial<Tweaks>;
  const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === "number" && x >= lo && x <= hi ? x : d);
  const bool = (x: unknown, d: boolean) => (typeof x === "boolean" ? x : d);
  const colors: Overrides = {};
  if (v.colors && typeof v.colors === "object") {
    for (const [k, hex] of Object.entries(v.colors)) {
      const h = typeof hex === "string" ? normHex(hex) : null;
      if (h) colors[k] = h;
    }
  }
  return {
    color,
    colors,
    index: Math.floor(num(v.index, 0, STYLE_COUNT - 1, 0)),
    sizeIndex: Math.floor(num(v.sizeIndex, 0, SIZES.length - 1, 0)),
    content: bool(v.content, true),
    tweaks: {
      radius: num(t.radius, 0, 0.3, DEFAULT_TWEAKS.radius),
      shine: num(t.shine, 0.4, 1.6, 1),
      glows: bool(t.glows, true),
      sparkle: bool(t.sparkle, true),
      shadow: bool(t.shadow, true),
      border: bool(t.border, true),
    },
  };
}

function App() {
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [index, setIndex] = useState(0);
  const [sizeIndex, setSizeIndex] = useState(0);
  const [content, setContent] = useState(true);
  const [tweaks, setTweaks] = useState<Tweaks>(DEFAULT_TWEAKS);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [loaded, setLoaded] = useState(false);
  const [selection, setSelection] = useState<SelectionInfo>({ count: 0, names: [], hasCard: false, glassCount: 0, color: null });
  const [status, setStatus] = useState<{ text: string; kind: "" | "ok" | "err" }>({ text: "", kind: "" });

  const size = (SIZES[sizeIndex] ?? SIZES[0]!).size;
  const spec = recolor(tweak(cardStyle(color, index), tweaks), overrides);
  const colors = contentColors(color, overrides);
  const slots = colorSlots(spec, content ? colors : null);
  const look = lookOf(index);
  const step = (d: number) => setIndex((i) => (i + d + STYLE_COUNT) % STYLE_COUNT);
  const random = () => setIndex((i) => {
    let n = i;
    while (n === i) n = Math.floor(Math.random() * STYLE_COUNT);
    return n;
  });

  useEffect(() => {
    window.onmessage = (event: MessageEvent) => {
      const msg = event.data?.pluginMessage as ToUI | undefined;
      if (!msg) return;
      if (msg.type === "selection") setSelection(msg);
      else if (msg.type === "settings") {
        const s = validSettings(msg.settings);
        if (s) {
          setColor(s.color);
          setIndex(s.index);
          setSizeIndex(s.sizeIndex);
          setContent(s.content);
          setTweaks(s.tweaks);
          setOverrides(s.colors);
        }
        setLoaded(true);
      } else if (msg.type === "success") setStatus({ text: msg.message, kind: "ok" });
      else if (msg.type === "error") setStatus({ text: msg.message, kind: "err" });
    };
    post({ type: "ready" });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => post({ type: "save", settings: { color, index, sizeIndex, content, tweaks, colors: overrides } }), 300);
    return () => clearTimeout(t);
  }, [loaded, color, index, sizeIndex, content, tweaks, overrides]);

  // ← / → change the style and R picks a random one, unless the user is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type === "text") return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
      if (e.key === "r" || e.key === "R") random();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const preview = fit(size, STAGE);
  const targetText = selection.count === 0
    ? "No card selected"
    : `${selection.count} layer${selection.count === 1 ? "" : "s"} · ${selection.names.join(", ")}${selection.count > selection.names.length ? "…" : ""}`;

  return (
    <div className="app wide">
      {/* Left: the big preview and every style at a glance. */}
      <section className="left">
        <header className="header">
          <Logo color={color} />
          <div>
            <div className="title">CardGlow</div>
            <div className="sub">Glossy gradient cards from one colour · {STYLE_COUNT} styles</div>
          </div>
        </header>

        <div className="preview-box big">
          <CardView spec={spec} width={preview.width} height={preview.height} content={content ? colors : null} />
          <button className="arrow overlay prev" onClick={() => step(-1)} aria-label="Previous style" title="Previous style (←)">
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className="arrow overlay next" onClick={() => step(1)} aria-label="Next style" title="Next style (→)">
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <span className="size-tag">{size.width} × {size.height}</span>
        </div>
        <div className="style-meta">
          <span className="name">{spec.name}</span>
          <span className="meta-right">
            <span className="count">{index + 1} / {STYLE_COUNT}</span>
            <button className="dice" onClick={random} title="Random style (R)" aria-label="Random style">
              <svg width="14" height="14" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="3" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="5.5" cy="5.5" r="1.1" fill="currentColor" /><circle cx="10.5" cy="10.5" r="1.1" fill="currentColor" /><circle cx="8" cy="8" r="1.1" fill="currentColor" /></svg>
            </button>
          </span>
        </div>
        <div className="progress"><i style={{ width: `${((index + 1) / STYLE_COUNT) * 100}%` }} /></div>

        <StyleStrip color={color} index={index} tweaks={tweaks} overrides={overrides} onPick={setIndex} />
      </section>

      {/* Right: everything that changes the card, and the actions. */}
      <section className="right">
        <main className="main">
          <ColorPicker value={color} onChange={setColor} swatches={SWATCHES} fromSelection={selection.color} />

          <LookChips look={look} onPick={(l) => setIndex(lookStart(l) + (index % DIRECTION_COUNT))} />

          <ColorsPanel base={color} slots={slots} overrides={overrides} onChange={setOverrides} />

          <Adjust tweaks={tweaks} onChange={setTweaks} />
        </main>

        <footer className="footer">
          <div className="row">
            <select value={sizeIndex} onChange={(e) => setSizeIndex(Number(e.target.value))}>
              {SIZES.map((s, i) => <option key={s.label} value={i}>{s.label}</option>)}
            </select>
            <label className="check-row" title="Add an icon tile, a title, lorem ipsum text and three glass step pills to new cards">
              <input type="checkbox" checked={content} onChange={(e) => setContent(e.target.checked)} />
              Sample content
            </label>
          </div>
          <div className="target" title={targetText}>{targetText}</div>
          <div className="actions">
            <button className="secondary-btn" onClick={() => post({ type: "create", spec, size, content, colors })}>Create card</button>
            <button className="primary-btn" disabled={selection.count === 0} onClick={() => post({ type: "apply", spec })}>Apply to selection</button>
          </div>
          <div className="actions small">
            <button className="ghost-btn" disabled={selection.glassCount === 0} onClick={() => post({ type: "glass", color: colors.glass })} title="White 18% fill with a 40% white border, like the step pills">
              Make selection glass
            </button>
            {selection.hasCard && <button className="ghost-btn" onClick={() => post({ type: "remove" })}>Remove card style</button>}
          </div>
          <div className={"status " + status.kind}>{status.text}</div>
        </footer>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
