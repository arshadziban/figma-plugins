// Turns an alpha channel into shape geometry: marching squares finds the outline
// with sub-pixel accuracy, then Schneider's curve fitting reduces it to a few
// editable Bézier segments. Pure (no DOM), so smart objects can become real shapes.

type Pt = { x: number; y: number };

export interface TracedShape {
  x: number;
  y: number;
  w: number;
  h: number;
  // Set when the outline is a plain (rounded) rectangle; `data` is empty then.
  cornerRadius?: number;
  data: string; // SVG-style path relative to x/y, even-odd filled
  segments: number;
}

const THRESHOLD = 128;
const MAX_CONTOUR_POINTS = 200000;
const MAX_LOOPS = 64;
const MAX_SEGMENTS = 3000;
const FIT_ERROR = 0.6; // px
const CORNER_ANGLE = (35 * Math.PI) / 180;
const CORNER_WINDOW = 3; // contour points on each side
const TANGENT_WINDOW = 8; // contour points

function contours(alpha: Uint8Array | Uint8ClampedArray, w: number, h: number, stride: number): Pt[][] | null {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : alpha[(y * w + x) * stride]!);
  const W = w + 3;
  // Edge ids: horizontal and vertical grid edges, offset so the -1 padding row/column stays positive.
  const hEdge = (x: number, y: number) => ((y + 1) * W + x + 1) * 2;
  const vEdge = (x: number, y: number) => ((y + 1) * W + x + 1) * 2 + 1;
  const nodes = new Map<number, { p: Pt; links: number[] }>();
  const node = (id: number, x0: number, y0: number, x1: number, y1: number, a: number, b: number) => {
    let n = nodes.get(id);
    if (!n) {
      const t = (THRESHOLD - a) / (b - a);
      n = { p: { x: x0 + (x1 - x0) * t + 0.5, y: y0 + (y1 - y0) * t + 0.5 }, links: [] };
      nodes.set(id, n);
    }
    return n;
  };
  const link = (a: number, b: number) => {
    nodes.get(a)!.links.push(b);
    nodes.get(b)!.links.push(a);
  };

  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const a = at(x, y), b = at(x + 1, y), c = at(x + 1, y + 1), d = at(x, y + 1);
      const bits = (a >= THRESHOLD ? 1 : 0) | (b >= THRESHOLD ? 2 : 0) | (c >= THRESHOLD ? 4 : 0) | (d >= THRESHOLD ? 8 : 0);
      if (bits === 0 || bits === 15) continue;
      if (nodes.size > MAX_CONTOUR_POINTS) return null;
      const top = () => { const id = hEdge(x, y); node(id, x, y, x + 1, y, a, b); return id; };
      const bottom = () => { const id = hEdge(x, y + 1); node(id, x, y + 1, x + 1, y + 1, d, c); return id; };
      const left = () => { const id = vEdge(x, y); node(id, x, y, x, y + 1, a, d); return id; };
      const right = () => { const id = vEdge(x + 1, y); node(id, x + 1, y, x + 1, y + 1, b, c); return id; };
      switch (bits) {
        case 1: case 14: link(top(), left()); break;
        case 2: case 13: link(top(), right()); break;
        case 4: case 11: link(right(), bottom()); break;
        case 8: case 7: link(left(), bottom()); break;
        case 3: case 12: link(left(), right()); break;
        case 6: case 9: link(top(), bottom()); break;
        case 5: case 10: {
          // Saddle: the cell's average decides whether the two filled corners connect.
          const joined = (a + b + c + d) / 4 >= THRESHOLD;
          if ((bits === 5) === joined) { link(top(), right()); link(left(), bottom()); }
          else { link(top(), left()); link(right(), bottom()); }
          break;
        }
      }
    }
  }

  const loops: Pt[][] = [];
  const seen = new Set<number>();
  for (const [start, first] of nodes) {
    if (seen.has(start)) continue;
    const loop: Pt[] = [];
    let prev = -1, cur = start, n = first;
    while (!seen.has(cur)) {
      seen.add(cur);
      loop.push(n.p);
      const next: number = n.links[0] === prev ? n.links[1]! : n.links[0]!;
      prev = cur;
      cur = next;
      n = nodes.get(cur)!;
    }
    loops.push(loop);
  }
  return loops;
}

function area(loop: Pt[]): number {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!, b = loop[(i + 1) % loop.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

// ── Curve fitting (Schneider, "An Algorithm for Automatically Fitting Digitized Curves") ──

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (a: Pt): Pt => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };

type Cubic = [Pt, Pt, Pt, Pt];

function bez(c: Cubic, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return { x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x, y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y };
}

function generate(p: Pt[], ts: number[], t1: Pt, t2: Pt): Cubic {
  const first = p[0]!, last = p[p.length - 1]!;
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < p.length; i++) {
    const t = ts[i]!, u = 1 - t;
    const b0 = u * u * u, b1 = 3 * t * u * u, b2 = 3 * t * t * u, b3 = t * t * t;
    const a1 = mul(t1, b1), a2 = mul(t2, b2);
    c00 += dot(a1, a1); c01 += dot(a1, a2); c11 += dot(a2, a2);
    const tmp = sub(p[i]!, add(mul(first, b0 + b1), mul(last, b2 + b3)));
    x0 += dot(a1, tmp); x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let a1 = Math.abs(det) > 1e-9 ? (x0 * c11 - x1 * c01) / det : 0;
  let a2 = Math.abs(det) > 1e-9 ? (c00 * x1 - c01 * x0) / det : 0;
  const len = dist(first, last);
  if (a1 < 1e-6 * len || a2 < 1e-6 * len) a1 = a2 = len / 3; // Wu/Barsky heuristic
  return [first, add(first, mul(t1, a1)), add(last, mul(t2, a2)), last];
}

function reparam(c: Cubic, p: Pt[], ts: number[]): number[] {
  const d1 = [mul(sub(c[1], c[0]), 3), mul(sub(c[2], c[1]), 3), mul(sub(c[3], c[2]), 3)] as const;
  const d2 = [mul(sub(d1[1], d1[0]), 2), mul(sub(d1[2], d1[1]), 2)] as const;
  return ts.map((t, i) => {
    const u = 1 - t;
    const q = sub(bez(c, t), p[i]!);
    const q1 = add(add(mul(d1[0], u * u), mul(d1[1], 2 * u * t)), mul(d1[2], t * t));
    const q2 = add(mul(d2[0], u), mul(d2[1], t));
    const den = dot(q1, q1) + dot(q, q2);
    return den ? Math.min(Math.max(t - dot(q, q1) / den, 0), 1) : t;
  });
}

// Distance from q to the infinite line through a and b.
function offLine(q: Pt, a: Pt, b: Pt): number {
  return Math.abs((q.x - a.x) * (b.y - a.y) - (q.y - a.y) * (b.x - a.x)) / (dist(a, b) || 1);
}

const line = (a: Pt, b: Pt): Cubic => [a, add(a, mul(sub(b, a), 1 / 3)), add(a, mul(sub(b, a), 2 / 3)), b];

function fit(p: Pt[], t1: Pt, t2: Pt, err: number, out: Cubic[]) {
  const a = p[0]!, b = p[p.length - 1]!;
  if (p.length === 2 || (dist(a, b) > 0 && p.every((q) => offLine(q, a, b) <= err))) {
    out.push(line(a, b));
    return;
  }
  let ts: number[] = [0];
  for (let i = 1; i < p.length; i++) ts.push(ts[i - 1]! + dist(p[i]!, p[i - 1]!));
  const total = ts[ts.length - 1]! || 1;
  ts = ts.map((t) => t / total);

  let split = Math.floor(p.length / 2);
  for (let iter = 0; iter < 5; iter++) {
    const c = generate(p, ts, t1, t2);
    let worst = 0;
    for (let i = 1; i < p.length - 1; i++) {
      const e = dist(bez(c, ts[i]!), p[i]!);
      if (e > worst) { worst = e; split = i; }
    }
    if (worst <= err) { out.push(c); return; }
    if (worst > err * 8) break;
    ts = reparam(c, p, ts);
  }
  const mid = unit(sub(p[Math.max(split - 1, 0)]!, p[Math.min(split + 1, p.length - 1)]!));
  fit(p.slice(0, split + 1), t1, mid, err, out);
  fit(p.slice(split), mul(mid, -1), t2, err, out);
}

function cornerIndices(loop: Pt[]): number[] {
  const n = loop.length;
  const turn = loop.map((p, i) => {
    const a = sub(p, loop[(i - CORNER_WINDOW + n) % n]!), b = sub(loop[(i + CORNER_WINDOW) % n]!, p);
    return Math.abs(Math.atan2(a.x * b.y - a.y * b.x, dot(a, b)));
  });
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (turn[i]! < CORNER_ANGLE) continue;
    let peak = true;
    for (let k = 1; k <= CORNER_WINDOW && peak; k++) {
      if (turn[(i + k) % n]! > turn[i]! || turn[(i - k + n) % n]! >= turn[i]!) peak = false;
    }
    if (peak) out.push(i);
  }
  return out;
}

function fitLoop(loop: Pt[]): Cubic[] {
  const corners = cornerIndices(loop);
  const n = loop.length;
  const out: Cubic[] = [];
  const starts = corners.length ? corners : [0];
  const smooth = !corners.length;
  const tangent = (run: Pt[], i: number, dir: 1 | -1) => {
    // Look past the corner's antialiased rounding, which would skew a short tangent.
    const k = Math.max(Math.min(TANGENT_WINDOW, Math.floor((run.length - 1) / 3)), 1);
    return unit(sub(run[dir === 1 ? i + k : i - k]!, run[i]!));
  };
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s]!;
    const to = starts[(s + 1) % starts.length]!;
    const len = ((to - from + n - 1) % n) + 1; // a single start wraps the whole loop
    const run: Pt[] = [];
    for (let i = 0; i <= len; i++) run.push(loop[(from + i) % n]!);
    if (smooth) {
      // No corner to anchor on: use one tangent across the seam so the join stays smooth.
      const t = unit(sub(loop[CORNER_WINDOW % n]!, loop[(n - CORNER_WINDOW) % n]!));
      fit(run, t, mul(t, -1), FIT_ERROR, out);
    } else {
      fit(run, tangent(run, 0, 1), tangent(run, run.length - 1, -1), FIT_ERROR, out);
    }
  }
  return mergeLines(out);
}

const isLine = (c: Cubic) => offLine(c[1], c[0], c[3]) < 0.3 && offLine(c[2], c[0], c[3]) < 0.3;

// Curve splits can break one straight edge into several; join them back up.
function mergeLines(list: Cubic[]): Cubic[] {
  const out: Cubic[] = [];
  for (const c of list) {
    const prev = out[out.length - 1];
    if (prev && isLine(prev) && isLine(c) && offLine(prev[3], prev[0], c[3]) <= FIT_ERROR) out[out.length - 1] = line(prev[0], c[3]);
    else out.push(c);
  }
  const first = out[0], last = out[out.length - 1];
  if (out.length > 2 && first && last && isLine(first) && isLine(last) && offLine(first[0], last[0], first[3]) <= FIT_ERROR) {
    out[0] = line(last[0], first[3]);
    out.pop();
  }
  return out;
}

// If the outline is a rounded rectangle, returns its radius.
function roundedRect(loop: Pt[], x: number, y: number, w: number, h: number): number | null {
  const r = Math.sqrt(Math.max(w * h - area(loop), 0) / (4 - Math.PI));
  if (r * 2 > Math.min(w, h) + 1) return null;
  const hw = w / 2, hh = h / 2, cx = x + hw, cy = y + hh;
  for (const p of loop) {
    const qx = Math.abs(p.x - cx) - hw + r, qy = Math.abs(p.y - cy) - hh + r;
    const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    if (Math.abs(sd) > 1) return null;
  }
  return r < 1 ? 0 : r;
}

// Traces the channel at alpha[(y*w+x)*stride]. Returns null when the alpha is too
// soft or too intricate to be a clean shape (feathering, shadows, cut-out photos).
export function traceShape(alpha: Uint8Array | Uint8ClampedArray, w: number, h: number, stride = 1): TracedShape | null {
  const raw = contours(alpha, w, h, stride);
  if (!raw) return null;
  const loops = raw.filter((l) => area(l) >= 16);
  if (!loops.length || loops.length > MAX_LOOPS) return null;

  let perimeter = 0;
  for (const l of loops) perimeter += l.length;
  let soft = 0;
  for (let i = 0; i < w * h; i++) {
    const a = alpha[i * stride]!;
    if (a > 8 && a < 247) soft++;
  }
  if (soft > perimeter * 6) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of loops) for (const p of l) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const bw = maxX - minX, bh = maxY - minY;
  if (loops.length === 1) {
    const radius = roundedRect(loops[0]!, minX, minY, bw, bh);
    if (radius !== null) return { x: minX, y: minY, w: bw, h: bh, cornerRadius: radius, data: "", segments: 0 };
  }

  const f = (n: number) => +n.toFixed(2);
  const pt = (p: Pt) => `${f(p.x - minX)} ${f(p.y - minY)}`;
  let data = "";
  let segments = 0;
  for (const loop of loops) {
    const cubics = fitLoop(loop);
    segments += cubics.length;
    if (segments > MAX_SEGMENTS) return null;
    data += `${data ? " " : ""}M ${pt(cubics[0]![0])}`;
    for (const c of cubics) {
      // Straight runs become real lines, so they edit like the lines of a drawn shape.
      data += isLine(c) ? ` L ${pt(c[3])}` : ` C ${pt(c[1])} ${pt(c[2])} ${pt(c[3])}`;
    }
    data += " Z";
  }
  return { x: minX, y: minY, w: bw, h: bh, data, segments };
}
