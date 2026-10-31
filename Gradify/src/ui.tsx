import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { SelectionInfo, Settings, ToMain, ToUI } from "./messages";
import { GradientSpec, Size, normHex } from "./spec";
import { ColorPicker } from "./ColorPicker";
import { Logo } from "./Logo";
import { DEFAULT_TWEAKS, LAYOUT_COUNT, MOOD_NAMES, STYLE_COUNT, Tweaks, moodOf, moodStart, style, tweak } from "./styles";

const DEFAULT_COLOR = "#6B43F0";

// Base colours of the scales in the reference file, as quick picks.
const SWATCHES = ["#A06DFF", "#6B43F0", "#5F4ECA", "#503AEE", "#6C56FF", "#0059DD", "#0368E6", "#49B1F4", "#54B8EC"];

const SIZES: { label: string; size: Size }[] = [
  { label: "Slide · 1280 × 720", size: { width: 1280, height: 720 } },
  { label: "Full HD · 1920 × 1080", size: { width: 1920, height: 1080 } },
  { label: "Desktop · 1440 × 900", size: { width: 1440, height: 900 } },
  { label: "Square · 1080 × 1080", size: { width: 1080, height: 1080 } },
  { label: "Portrait · 1080 × 1350", size: { width: 1080, height: 1350 } },
  { label: "Story · 1080 × 1920", size: { width: 1080, height: 1920 } },
];

const PREVIEW_HEIGHT = 170;

function post(msg: ToMain) {
  parent.postMessage({ pluginMessage: msg }, "*");
}

function hexToRgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ── Gradient rendering ──────────────────────────────────────────────────────
// Blobs are placed in % of the box; only the blur needs the box width.
// Figma's layer blur radius looks roughly like a CSS blur() of half the size.

function GradientView({ spec, style: css }: { spec: GradientSpec; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const blurPx = (spec.blur * width) / 2;
  return (
    <div ref={ref} className="gradient" style={{ background: spec.base, ...css }}>
      {width > 0 && spec.wash && spec.wash.opacity > 0 && (
        <div className="layer" style={{ inset: 0, background: hexToRgba(spec.wash.color, spec.wash.opacity) }} />
      )}
      {width > 0 && spec.blobs.map((b, i) => (
        <div
          key={i}
          className="layer blob"
          style={{
            left: `${b.x * 100}%`,
            top: `${b.y * 100}%`,
            width: `${b.w * 100}%`,
            height: `${b.h * 100}%`,
            background: hexToRgba(b.color, b.opacity),
            filter: `blur(${blurPx}px)`,
          }}
        />
      ))}
    </div>
  );
}

// ── App ─────────────────────────────────────────────────────────────────────

// ── Mood chips + style strip ────────────────────────────────────────────────

function MoodChips({ mood, onPick }: { mood: number; onPick: (m: number) => void }) {
  return (
    <div className="moods">
      {MOOD_NAMES.map((name, m) => (
        <button key={name} className={"chip" + (m === mood ? " active" : "")} onClick={() => onPick(m)}>{name}</button>
      ))}
    </div>
  );
}

/** Thumbnails of every layout in the current mood. */
function StyleStrip({ color, index, tweaks, onPick }: { color: string; index: number; tweaks: Tweaks; onPick: (i: number) => void }) {
  const start = moodStart(moodOf(index));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(".mini.active");
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [index]);

  return (
    <div className="strip" ref={ref}>
      {Array.from({ length: LAYOUT_COUNT }, (_, k) => {
        const i = start + k;
        const sp = tweak(style(color, i), tweaks);
        return (
          <button key={i} className={"mini" + (i === index ? " active" : "")} title={sp.name} onClick={() => onPick(i)}>
            <GradientView spec={sp} style={{ width: "100%", height: "100%", borderRadius: 7 }} />
          </button>
        );
      })}
    </div>
  );
}

// ── Adjust ──────────────────────────────────────────────────────────────────

function Adjust({ tweaks, onChange }: { tweaks: Tweaks; onChange: (t: Tweaks) => void }) {
  const changed = JSON.stringify(tweaks) !== JSON.stringify(DEFAULT_TWEAKS);
  return (
    <div className="card adjust">
      <div className="adjust-head">
        <span>Adjust</span>
        {changed && <button className="link" onClick={() => onChange(DEFAULT_TWEAKS)}>Reset</button>}
      </div>
      <div className="row">
        <label>Intensity</label>
        <input type="range" min={40} max={160} value={Math.round(tweaks.intensity * 100)} onChange={(e) => onChange({ ...tweaks, intensity: Number(e.target.value) / 100 })} />
        <span className="val">{Math.round(tweaks.intensity * 100)}%</span>
      </div>
      <div className="row">
        <label>Softness</label>
        <input type="range" min={50} max={150} value={Math.round(tweaks.softness * 100)} onChange={(e) => onChange({ ...tweaks, softness: Number(e.target.value) / 100 })} />
        <span className="val">{Math.round(tweaks.softness * 100)}%</span>
      </div>
      <div className="row toggles">
        <button className={"toggle" + (tweaks.flipX ? " on" : "")} onClick={() => onChange({ ...tweaks, flipX: !tweaks.flipX })} title="Mirror left ↔ right">
          <svg width="14" height="14" viewBox="0 0 16 16"><path d="M8 2v12M6 4 2 12h4zM10 4l4 8h-4z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          Flip ↔
        </button>
        <button className={"toggle" + (tweaks.flipY ? " on" : "")} onClick={() => onChange({ ...tweaks, flipY: !tweaks.flipY })} title="Mirror top ↕ bottom">
          <svg width="14" height="14" viewBox="0 0 16 16"><path d="M2 8h12M4 6l8-4v4zM4 10l8 4v-4z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          Flip ↕
        </button>
      </div>
    </div>
  );
}

// ── App ─────────────────────────────────────────────────────────────────────

function validSettings(v: Settings | null): Settings | null {
  if (!v || typeof v !== "object") return null;
  const color = typeof v.color === "string" ? normHex(v.color) : null;
  if (!color) return null;
  const t = v.tweaks ?? DEFAULT_TWEAKS;
  const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === "number" && x >= lo && x <= hi ? x : d);
  return {
    color,
    index: Math.floor(num(v.index, 0, STYLE_COUNT - 1, 0)),
    sizeIndex: Math.floor(num(v.sizeIndex, 0, SIZES.length - 1, 0)),
    tweaks: {
      intensity: num(t.intensity, 0.4, 1.6, 1),
      softness: num(t.softness, 0.5, 1.5, 1),
      flipX: !!t.flipX,
      flipY: !!t.flipY,
    },
  };
}

function App() {
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [index, setIndex] = useState(0);
  const [sizeIndex, setSizeIndex] = useState(0);
  const [tweaks, setTweaks] = useState<Tweaks>(DEFAULT_TWEAKS);
  const [loaded, setLoaded] = useState(false);
  const [selection, setSelection] = useState<SelectionInfo>({ count: 0, names: [], hasGradify: false, color: null });
  const [status, setStatus] = useState<{ text: string; kind: "" | "ok" | "err" }>({ text: "", kind: "" });

  const size = (SIZES[sizeIndex] ?? SIZES[0]!).size;
  const spec = tweak(style(color, index), tweaks);
  const mood = moodOf(index);
  const step = (d: number) => setIndex((i) => (i + d + STYLE_COUNT) % STYLE_COUNT);
  const random = () => {
    setIndex((i) => {
      let n = i;
      while (n === i) n = Math.floor(Math.random() * STYLE_COUNT);
      return n;
    });
  };

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
          setTweaks(s.tweaks);
        }
        setLoaded(true);
      } else if (msg.type === "success") setStatus({ text: msg.message, kind: "ok" });
      else if (msg.type === "error") setStatus({ text: msg.message, kind: "err" });
    };
    post({ type: "ready" });
  }, []);

  // Remember the current choice, once the saved one has been restored.
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => post({ type: "save", settings: { color, index, sizeIndex, tweaks } }), 300);
    return () => clearTimeout(t);
  }, [loaded, color, index, sizeIndex, tweaks]);

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

  const aspect = size.width / size.height;
  const previewWidth = Math.min(1, aspect * PREVIEW_HEIGHT / 260);
  const targetText = selection.count === 0
    ? "No frame selected"
    : `${selection.count} frame${selection.count === 1 ? "" : "s"} · ${selection.names.join(", ")}${selection.count > selection.names.length ? "…" : ""}`;

  return (
    <div className="app">
      <header className="header">
        <Logo color={color} />
        <div>
          <div className="title">Gradify</div>
          <div className="sub">Pick a colour, then flip through {STYLE_COUNT} styles</div>
        </div>
      </header>

      <main className="main">
        <ColorPicker value={color} onChange={setColor} swatches={SWATCHES} fromSelection={selection.color} />

        <MoodChips mood={mood} onPick={(m) => setIndex(moodStart(m) + (index % LAYOUT_COUNT))} />

        <div className="stage">
          <button className="arrow" onClick={() => step(-1)} aria-label="Previous style" title="Previous style (←)">
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div className="preview-box">
            <GradientView
              spec={spec}
              style={{ aspectRatio: `${size.width} / ${size.height}`, width: `${previewWidth * 100}%`, maxHeight: PREVIEW_HEIGHT }}
            />
          </div>
          <button className="arrow" onClick={() => step(1)} aria-label="Next style" title="Next style (→)">
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
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

        <StyleStrip color={color} index={index} tweaks={tweaks} onPick={setIndex} />

        <Adjust tweaks={tweaks} onChange={setTweaks} />
      </main>

      <footer className="footer">
        <div className="row">
          <select value={sizeIndex} onChange={(e) => setSizeIndex(Number(e.target.value))}>
            {SIZES.map((s, i) => <option key={s.label} value={i}>{s.label}</option>)}
          </select>
        </div>
        <div className="target" title={targetText}>{targetText}</div>
        <div className="actions">
          <button className="secondary-btn" onClick={() => post({ type: "create", spec, size })}>Create frame</button>
          <button className="primary-btn" disabled={selection.count === 0} onClick={() => post({ type: "apply", spec })}>Apply to selection</button>
        </div>
        {selection.hasGradify && (
          <button className="ghost-btn" onClick={() => post({ type: "remove" })}>Remove Gradify background</button>
        )}
        <div className={"status " + status.kind}>{status.text}</div>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
