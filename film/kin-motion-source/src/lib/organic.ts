import { lerp, rand } from "./anim";

/**
 * One parametric family for every organic form in the film: pebbles, capsules, circles, rings, eggs.
 * Because every shape shares the same parameters (and the same number of sampled points), any shape can morph
 * into any other by interpolating parameters; no path-matching library is needed.
 */
export interface Organic {
  x: number;
  y: number;
  /** Full width / height before rotation (px). */
  w: number;
  h: number;
  /** Degrees. */
  rot: number;
  /** Superellipse exponent: 2 = ellipse, 3–6 = rounded slab / capsule. */
  n: number;
  /** Radial irregularity, 0 = geometric, ~0.08 = pebble. */
  wob: number;
  /** Egg / teardrop asymmetry along the height, -0.4..0.4. */
  taper: number;
  /** Inner hole as a fraction of the outer size: 0 = solid, 0.6 = ring. */
  hollow: number;
  /** Seeds the irregularity, so a shape keeps its own silhouette while it moves. */
  seed: number;
  /** Uniform scale applied around (x, y). */
  s: number;
}

export const organic = (p: Partial<Organic> & Pick<Organic, "x" | "y" | "w" | "h">): Organic => ({
  rot: 0,
  n: 2,
  wob: 0,
  taper: 0,
  hollow: 0,
  seed: 1,
  s: 1,
  ...p,
});

export function mixOrganic(a: Organic, b: Organic, t: number): Organic {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    w: lerp(a.w, b.w, t),
    h: lerp(a.h, b.h, t),
    rot: lerp(a.rot, b.rot, t),
    n: lerp(a.n, b.n, t),
    wob: lerp(a.wob, b.wob, t),
    taper: lerp(a.taper, b.taper, t),
    hollow: lerp(a.hollow, b.hollow, t),
    seed: t < 0.5 ? a.seed : b.seed,
    s: lerp(a.s, b.s, t),
  };
}

const N = 96;

function harmonics(seed: number) {
  // Three low harmonics: enough for a hand-cut silhouette, never a jittery blob.
  return [2, 3, 5].map((k, i) => ({
    k,
    amp: [1, 0.55, 0.22][i] * (0.6 + 0.8 * rand(seed * 31 + i)),
    ph: rand(seed * 97 + i * 13) * Math.PI * 2,
  }));
}

function ring(p: Organic, scale: number): [number, number][] {
  const hs = harmonics(p.seed);
  const rx = (p.w / 2) * scale * p.s;
  const ry = (p.h / 2) * scale * p.s;
  const cr = Math.cos((p.rot * Math.PI) / 180);
  const sr = Math.sin((p.rot * Math.PI) / 180);
  const e = 2 / Math.max(0.5, p.n);
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    let x = rx * Math.sign(c) * Math.pow(Math.abs(c), e);
    let y = ry * Math.sign(s) * Math.pow(Math.abs(s), e);
    // Taper: wider at one end (egg / teardrop).
    x *= 1 + p.taper * (y / Math.max(1, ry));
    // Radial irregularity.
    let r = 1;
    for (const h of hs) r += p.wob * h.amp * Math.sin(h.k * t + h.ph);
    x *= r;
    y *= r;
    pts.push([p.x + x * cr - y * sr, p.y + x * sr + y * cr]);
  }
  return pts;
}

/** Closed Catmull-Rom spline through the points, as cubic Béziers. */
function smooth(pts: [number, number][], reverse = false) {
  const P = reverse ? [...pts].reverse() : pts;
  const n = P.length;
  const f = (v: number) => v.toFixed(2);
  let d = `M${f(P[0][0])},${f(P[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n];
    const p1 = P[i];
    const p2 = P[(i + 1) % n];
    const p3 = P[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d + "Z";
}

/** SVG path data (use fill-rule="evenodd" so a hollow shape renders as a ring). */
export function organicPath(p: Organic): string {
  if (p.s <= 0.001 || p.w <= 0.5 || p.h <= 0.5) return "";
  const outer = smooth(ring(p, 1));
  if (p.hollow <= 0.01) return outer;
  return outer + smooth(ring(p, Math.min(0.97, p.hollow)), true);
}
