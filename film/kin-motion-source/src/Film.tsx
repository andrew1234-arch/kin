import { CameraMotionBlur } from "@remotion/motion-blur";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { ConnectionNetwork, type Link } from "./components/ConnectionNetwork";
import { FundingNode } from "./components/FundingNode";
import { MaskLine, MonoLabel, SceneLabel } from "./components/KineticTypography";
import { KinLogo, LOGO_VB, markScale, markToScreen } from "./components/KinLogo";
import { OrganicPattern, type PlacedShape } from "./components/OrganicPattern";
import { arcMorph, CENTER, radialExit, stretchEnter } from "./components/SceneTransitions";
import { SharedLimit } from "./components/SharedLimit";
import { WalletSymbol } from "./components/WalletSymbol";
import { clamp, drift, lerp, mix, prog, track } from "./lib/anim";
import { mixOrganic, organic, type Organic } from "./lib/organic";
import { PATTERN, WALLET_SOURCES } from "./lib/pattern";
import { C, E, FONT, H, W } from "./tokens";

// ------------------------------------------------------------------ layout constants

/** The network (scenes 3–4): funder at the centre, ten wallets on a circle, the shared limit around them. */
const NC = { x: 1400, y: 560 };
const RW = 300;
const RING = { r: 412, stroke: 14 };
const angle = (i: number) => ((-90 + i * 36) * Math.PI) / 180;
/**
 * Wallet i (left to right in the row) takes circle slot SLOT[i]. The order is preserved going round, so on the way
 * from the row to the circle the ten wallets sweep round together without crossing.
 */
const SLOT = [8, 7, 6, 5, 4, 3, 2, 1, 0, 9];
const slotAngle = (i: number) => angle(SLOT[i]);

/** The emblem (scene 5): the same network, compact, standing on the starting line. */
const LINE_Y = 860;
const EC = { x: 1592, y: 700 };
const EMB = { r: 150, stroke: 10, rw: 90 };

/** The logo (scene 6), centred. */
const LOGO_H = 210;
const LOGO_X0 = W / 2 - (LOGO_VB.w * LOGO_H) / LOGO_VB.h / 2;
const LOGO_Y0 = 352;
const MARK_C = markToScreen(LOGO_X0, LOGO_Y0, LOGO_H, 32, 32);
const MK = markScale(LOGO_H);
const DOTS = [
  markToScreen(LOGO_X0, LOGO_Y0, LOGO_H, 32, 20),
  markToScreen(LOGO_X0, LOGO_Y0, LOGO_H, 21.6, 38),
  markToScreen(LOGO_X0, LOGO_Y0, LOGO_H, 42.4, 38),
];
/** Which of the three mark dots each wallet merges into (nearest by angle: top, lower-left, lower-right). */
const DOT_OF_SLOT = [0, 0, 2, 2, 2, 1, 1, 1, 1, 0];
const DOT_OF = SLOT.map((sl) => DOT_OF_SLOT[sl]);
const LOGO_HANDOVER = 1590;

/** Morph that travels round the network centre (radius and angle interpolated), with an outward bulge. */
function polarMorph(a: Organic, b: Organic, t: number): Organic {
  const m = mixOrganic(a, b, t);
  const ra = Math.hypot(a.x - NC.x, a.y - NC.y);
  const rb = Math.hypot(b.x - NC.x, b.y - NC.y);
  const ta = Math.atan2(a.y - NC.y, a.x - NC.x);
  let d = Math.atan2(b.y - NC.y, b.x - NC.x) - ta;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const r = lerp(ra, rb, t) + Math.sin(Math.PI * t) * 60;
  const th = ta + d * t;
  return { ...m, x: NC.x + r * Math.cos(th), y: NC.y + r * Math.sin(th) };
}

const rowShape = (i: number) => organic({ x: 210 + i * 167, y: 812, w: 118, h: 80, n: 5, wob: 0.01, seed: 100 + i });
const circShape = (i: number) =>
  organic({ x: NC.x + RW * Math.cos(slotAngle(i)), y: NC.y + RW * Math.sin(slotAngle(i)), w: 104, h: 70, n: 5, wob: 0.01, seed: 100 + i });
const embShape = (i: number) =>
  organic({ x: EC.x + EMB.rw * Math.cos(slotAngle(i)), y: EC.y + EMB.rw * Math.sin(slotAngle(i)), w: 46, h: 31, n: 5, wob: 0.01, seed: 100 + i });
const dotShape = (i: number) =>
  organic({ x: DOTS[DOT_OF[i]].x, y: DOTS[DOT_OF[i]].y, w: 12 * MK, h: 12 * MK, n: 2, seed: 100 + i });

// ------------------------------------------------------------------ scene 4: buys against the shared limit

/** [frame the buy leaves the wallet, wallet, share of the limit]. The last one does not fit and is refused. */
const BUYS: [number, number, number][] = [
  [858, 0, 0.17],
  [884, 3, 0.13],
  [906, 7, 0.21],
  [930, 9, 0.14],
  [952, 5, 0.17],
  [974, 8, 0.18],
];
const REFUSED = { at: 1012, wallet: 2, share: 0.15 };
const TRAVEL = 20;

function limitUsed(f: number) {
  let used = 0;
  for (const [at, , share] of BUYS) used += share * prog(f, at + TRAVEL, at + TRAVEL + 14, E.expoOut);
  return used;
}

// ------------------------------------------------------------------ scene 5 / 6: the starting line and the frame

const RUNNERS: Organic[] = [
  organic({ x: 214, y: 860 - 74, w: 196, h: 150, rot: -6, n: 2.25, wob: 0.075, seed: 3 }),
  organic({ x: 372, y: 860 - 104, w: 76, h: 208, n: 5.5, wob: 0.012, seed: 11 }),
  organic({ x: 508, y: 860 - 70, w: 140, h: 140, n: 2, seed: 12 }),
  organic({ x: 690, y: 860 - 86, w: 172, h: 172, n: 2, hollow: 0.58, seed: 6 }),
  organic({ x: 878, y: 860 - 92, w: 150, h: 184, n: 2.3, wob: 0.035, taper: 0.28, seed: 7 }),
  organic({ x: 1058, y: 860 - 70, w: 176, h: 140, rot: 4, n: 3.8, wob: 0.03, seed: 13 }),
  organic({ x: 1196, y: 860 - 30, w: 60, h: 60, n: 2, seed: 19 }),
  organic({ x: 1338, y: 860 - 40, w: 214, h: 80, n: 5.5, wob: 0.012, seed: 21 }),
];

/** Pattern forms kept for the closing frame: those outside the central field that holds the logo. */
const inField = (s: Organic) => ((s.x - CENTER.x) / 760) ** 2 + ((s.y - 540) / 380) ** 2 < 1;
const FRAME = PATTERN.filter((p) => !inField(p.shape)).map((p) => p.shape);
/** Runner r becomes frame form RUNNER_TO_FRAME[r]. */
const RUNNER_TO_FRAME = RUNNERS.map((_, r) => Math.round((r * (FRAME.length - 1)) / (RUNNERS.length - 1)));

// ------------------------------------------------------------------ the film

const Layer = ({ part }: { part: "graphics" | "type" }) => {
  const f = useCurrentFrame();

  // ---- scene 1–2: the opening pattern -----------------------------------------------------------------------
  const order = [...PATTERN].sort(
    (a, b) => Math.hypot(a.shape.x - CENTER.x, a.shape.y - CENTER.y) - Math.hypot(b.shape.x - CENTER.x, b.shape.y - CENTER.y),
  );
  const rank = new Map(order.map((p, i) => [p.id, i]));
  const big = order.filter((p) => p.kind !== "dot");
  const bigRank = new Map(big.map((p, i) => [p.id, i]));
  const walletIdx = new Map(WALLET_SOURCES.map((id, i) => [id, i]));

  /** A pattern form during scenes 1–2 (before it either leaves or becomes a wallet). */
  const opening = (id: number, fr = f): Organic | null => {
    const p = PATTERN[id];
    let s: Organic;
    if (p.kind === "dot") {
      // Dots arrive last, between the larger forms, with a small overshoot.
      const start = 118 + ((id * 7) % 11) * 3;
      const g = prog(fr, start, start + 30, E.backOut);
      if (g <= 0) return null;
      s = { ...p.shape, s: p.shape.s * g };
    } else {
      const start = 4 + bigRank.get(id)! * 3.4;
      const grow = prog(fr, start, start + 44, E.expoOut);
      const settle = prog(fr, start + 6, start + 70, E.quintInOut);
      if (grow <= 0) return null;
      s = stretchEnter(p.shape, grow, settle);
    }
    // Reorganise: the whole field turns a few degrees about the centre while each form rotates on its own axis.
    const turn = track(fr, [[140, 0], [218, -3.2, E.quintInOut]]) * (Math.PI / 180);
    const dx = s.x - CENTER.x;
    const dy = s.y - CENTER.y;
    s = { ...s, x: CENTER.x + dx * Math.cos(turn) - dy * Math.sin(turn), y: CENTER.y + dx * Math.sin(turn) + dy * Math.cos(turn) };
    s.rot += track(fr, [[140, 0], [218, p.kind === "capsule" ? 14 : 9, E.quintInOut]]);
    // Fill the screen: the forms swell until navy dominates, then the field opens again.
    const swell = track(fr, [[176, 1], [222, 1.32, E.quintInOut], [256, 1.32]]);
    s.s *= swell;
    return s;
  };

  const patternShapes: PlacedShape[] = [];
  if (f < 360) {
    for (const p of PATTERN) {
      if (walletIdx.has(p.id) && f >= 236) continue; // becomes a wallet from here
      let s = opening(p.id);
      if (!s) continue;
      if (f >= 232) {
        const r = rank.get(p.id)!;
        const t = prog(f, 230 + r * 1.0, 230 + r * 1.0 + 36, E.expoIn);
        if (t >= 1) continue;
        s = radialExit(s, t, 0.5);
      }
      patternShapes.push({ key: `p${p.id}`, shape: s, fill: C.navy });
    }
  }

  // ---- the ten wallets ----------------------------------------------------------------------------------------
  const wallets = WALLET_SOURCES.map((srcId, i) => {
    let shape: Organic;
    let form = 0;
    let fill = C.navy;
    if (f < 236) {
      const o = opening(srcId);
      shape = o ?? { ...PATTERN[srcId].shape, s: 0 };
    } else {
      // Hand-over: the source form exactly as it was at frame 236.
      const src = opening(srcId, 236)!;
      const t1 = prog(f, 240 + i * 4, 240 + i * 4 + 72, E.quintInOut);
      shape = arcMorph(src, rowShape(i), t1, 0.1);
      // The wallets drift apart: ten separate addresses.
      const spread = track(f, [[330, 0], [480, 1, E.sineInOut]]);
      shape = { ...shape, x: shape.x + (i - 4.5) * 9 * spread };
      form = prog(f, 286 + i * 4, 316 + i * 4, E.expoOut);
      if (f >= 488) {
        const t2 = prog(f, 488 + i * 1.5, 488 + i * 1.5 + 92, E.quintInOut);
        shape = polarMorph(rowShape(i), circShape(i), t2);
      }
      if (f >= 1150) {
        const t3 = prog(f, 1150 + i * 3, 1150 + i * 3 + 80, E.quintInOut);
        shape = arcMorph(circShape(i), embShape(i), t3, 0.08);
      }
      if (f >= 1456) {
        const t4 = prog(f, 1456 + i * 1.2, 1456 + i * 1.2 + 96, E.quintInOut);
        shape = arcMorph(embShape(i), dotShape(i), t4, 0.05);
        form = 1 - prog(f, 1456, 1490, E.expoOut);
        fill = mix(C.navy, C.blue, prog(f, 1470, 1540, E.sineInOut));
      }
    }
    // Scene 4: a wallet swells briefly when it buys.
    let pulse = 0;
    for (const [at, w] of BUYS) if (w === i) pulse = Math.max(pulse, Math.sin(Math.PI * clamp((f - at + 6) / 18)));
    if (REFUSED.wallet === i) pulse = Math.max(pulse, Math.sin(Math.PI * clamp((f - REFUSED.at + 6) / 18)));
    shape = { ...shape, s: shape.s * (1 + 0.14 * pulse) };
    // Idle breathing while the wallets rest in the row and the circle.
    if (f > 330 && f < 1150) shape = { ...shape, y: shape.y + drift(f, i, 2.2, 150) };
    return { shape, form, fill };
  });

  // Shared-funding hint (scene 2): the clasps turn blue together.
  const hint = track(f, [[372, 0], [400, 1, E.expoOut], [700, 1], [760, 0]]);
  const hintLines = track(f, [[384, 0], [430, 0.42, E.expoOut], [484, 0.42], [520, 0, E.expoIn]]);
  const hintDraw = prog(f, 384, 444, E.expoOut);

  // ---- funder -----------------------------------------------------------------------------------------------
  const funderPos = (() => {
    const rise = prog(f, 586, 660, E.expoOut);
    let p = { x: lerp(NC.x, NC.x, rise), y: lerp(1200, NC.y, rise) };
    const toEmb = prog(f, 1150, 1240, E.quintInOut);
    p = { x: lerp(p.x, EC.x, toEmb), y: lerp(p.y, EC.y, toEmb) };
    const toMark = prog(f, 1456, 1540, E.quintInOut);
    return { x: lerp(p.x, MARK_C.x, toMark), y: lerp(p.y, MARK_C.y, toMark) };
  })();
  const funderR =
    track(f, [[586, 0], [650, 64, E.backOut], [1150, 64], [1240, 24, E.quintInOut], [1456, 24], [1530, 0, E.expoIn]]);
  const funderLabel = track(f, [[650, 0], [680, 1], [1140, 1], [1160, 0]]);

  // ---- links funder → wallets ----------------------------------------------------------------------------
  const linkOrder = [0, 5, 2, 7, 4, 9, 1, 6, 3, 8];
  const links: Link[] = wallets.map((w, i) => {
    const k = linkOrder.indexOf(i);
    const draw = prog(f, 652 + k * 7, 652 + k * 7 + 30, E.expoOut);
    const intensity =
      track(f, [[652, 1], [760, 1], [800, 0.4, E.sineInOut], [1150, 0.4], [1240, 0.7], [1440, 0.7], [1478, 0, E.expoIn]]);
    const pulseT = (f - (690 + k * 6)) / 26;
    // Stop the link at the wallet's edge.
    const dx = w.shape.x - funderPos.x;
    const dy = w.shape.y - funderPos.y;
    const d = Math.hypot(dx, dy) || 1;
    const inset = (w.shape.w * w.shape.s) / 2 + 6;
    const fr = funderR * 1.0 + 4;
    return {
      from: { x: funderPos.x + (dx / d) * fr, y: funderPos.y + (dy / d) * fr },
      to: { x: w.shape.x - (dx / d) * inset, y: w.shape.y - (dy / d) * inset },
      draw,
      intensity,
      pulse: f < 760 ? pulseT : -1,
    };
  });

  // ---- shared limit ring ----------------------------------------------------------------------------------
  const ringDraw = prog(f, 800, 872, E.quintInOut);
  const used = limitUsed(f);
  const toEmb = prog(f, 1150, 1240, E.quintInOut);
  const toMark = prog(f, 1456, 1556, E.quintInOut);
  const ring = {
    x: lerp(lerp(NC.x, EC.x, toEmb), MARK_C.x, toMark),
    y: lerp(lerp(NC.y, EC.y, toEmb), MARK_C.y, toMark),
    r: lerp(lerp(RING.r, EMB.r, toEmb), 27 * MK, toMark),
    stroke: lerp(lerp(RING.stroke, EMB.stroke, toEmb), 5 * MK, toMark),
  };
  const refusedHit = REFUSED.at + TRAVEL;
  const enforcePulse = clamp((f - refusedHit) / 36);

  // Buy tokens travelling from wallets to the ring.
  const tokens = [...BUYS.map(([at, w]) => ({ at, w, refused: false })), { at: REFUSED.at, w: REFUSED.wallet, refused: true }]
    .map(({ at, w, refused }) => {
      const t = (f - at) / TRAVEL;
      if (t < 0) return null;
      const a = slotAngle(w);
      const r0 = RW + 40;
      const r1 = RING.r - RING.stroke / 2 - 10;
      let r: number;
      let op = 1;
      if (!refused) {
        if (t > 1.2) return null;
        r = lerp(r0, r1, E.expoIn(clamp(t)));
        op = 1 - clamp((t - 1) / 0.2);
      } else {
        if (t > 3.4) return null;
        r = t <= 1 ? lerp(r0, r1, E.expoIn(clamp(t))) : lerp(r1, r1 - 70, E.expoOut(clamp((t - 1) / 0.9)));
        op = t <= 1.6 ? 1 : 1 - clamp((t - 1.6) / 1.4);
      }
      return { x: NC.x + r * Math.cos(a), y: NC.y + r * Math.sin(a), a, op, refused, hollow: refused && t > 1 };
    })
    .filter(Boolean) as { x: number; y: number; a: number; op: number; refused: boolean; hollow: boolean }[];

  // ---- scene 5: the starting line -------------------------------------------------------------------------
  const lineDraw = track(f, [[1226, 0], [1292, 1, E.quintInOut], [1446, 1], [1500, 0, E.expoIn]]);
  const runnerShapes: PlacedShape[] = [];
  if (f >= 1240 && f < LOGO_HANDOVER + 400) {
    RUNNERS.forEach((r, i) => {
      const rise = prog(f, 1246 + i * 6, 1246 + i * 6 + 46, E.backOut);
      if (rise <= 0) return;
      const h = (r.h / 2) * 2 + 20;
      let s: Organic = { ...r, y: r.y + h * (1 - rise) };
      if (f >= 1300) {
        const k = clamp((f - 1300) / 30);
        s = { ...s, rot: s.rot + drift(f, i * 5, 3, 170) * k, s: s.s * (1 + 0.025 * Math.sin((f - 1300) / 26 + i)) * 1 };
      }
      if (f >= 1452) {
        const t = prog(f, 1452 + i * 4, 1452 + i * 4 + 96, E.quintInOut);
        s = arcMorph(s, FRAME[RUNNER_TO_FRAME[i]], t, 0.14);
      }
      runnerShapes.push({ key: `r${i}`, shape: s, fill: C.navy });
    });
  }
  // Closing frame: the remaining pattern forms arrive from outside and settle around the logo.
  const frameShapes: PlacedShape[] = [];
  if (f >= 1460) {
    const taken = new Set(RUNNER_TO_FRAME);
    FRAME.forEach((target, j) => {
      if (taken.has(j)) return;
      const dist = Math.hypot(target.x - CENTER.x, target.y - CENTER.y);
      const start = 1468 + (dist / 1100) * 40 + (j % 4) * 3;
      const t = prog(f, start, start + 70, E.expoOut);
      if (t <= 0) return;
      const from = { ...target, x: CENTER.x + (target.x - CENTER.x) * 1.7, y: CENTER.y + (target.y - CENTER.y) * 1.7, s: 0.4, rot: target.rot - 50 };
      let s = mixOrganic(from, target, t);
      s = { ...s, x: s.x + drift(f, j, 3, 260), y: s.y + drift(f, j + 9, 3, 300) };
      frameShapes.push({ key: `f${j}`, shape: s, fill: C.navy });
    });
    // Runners keep breathing in their new places.
  }

  // ---- logo ------------------------------------------------------------------------------------------------
  const triDraw = prog(f, 1528, 1576, E.expoOut);
  const wordP = [0, 1, 2, 3, 4].map((i) => prog(f, 1568 + i * 9, 1568 + i * 9 + 34, E.expoOut));
  const iDot = prog(f, 1604, 1626, E.backOut);
  const logoBreath = 1 + 0.012 * Math.sin(Math.PI * clamp((f - 1700) / 60)) * (f > 1700 && f < 1760 ? 1 : 0);

  // ---- camera: barely-there scale drift, so resting frames still feel alive -----------------------------
  const cam = track(f, [[0, 1.05], [230, 1, E.expoOut], [480, 1], [780, 1.025, E.sineInOut], [1140, 1.0, E.sineInOut]]);

  if (part === "graphics") {
    return (
      <AbsoluteFill>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }}>
        <g transform={`translate(${CENTER.x} ${CENTER.y}) scale(${cam}) translate(${-CENTER.x} ${-CENTER.y})`}>
          <OrganicPattern shapes={patternShapes} />

          {/* scene 2: faint lines hinting at a common source below the frame */}
          {hintLines > 0.001 &&
            wallets.map((w, i) => (
              <line
                key={i}
                x1={w.shape.x}
                y1={w.shape.y + 44}
                x2={lerp(w.shape.x, NC.x, hintDraw)}
                y2={lerp(w.shape.y + 44, 1200, hintDraw)}
                stroke={C.navy}
                strokeWidth={1.5}
                strokeDasharray="3 9"
                opacity={hintLines}
              />
            ))}

          {/* scene 4–6: the shared limit */}
          {f >= 800 && f < LOGO_HANDOVER && (
            <SharedLimit
              x={ring.x}
              y={ring.y}
              r={ring.r}
              stroke={ring.stroke * (1 + 0.7 * Math.sin(Math.PI * clamp((f - refusedHit) / 22)) * (f >= refusedHit ? 1 : 0))}
              draw={ringDraw}
              track={1 - prog(f, 1150, 1200)}
              fill={f < 1150 ? used : 1}
              pulse={f >= refusedHit && f < refusedHit + 36 ? enforcePulse : 0}
            />
          )}

          <ConnectionNetwork links={links} />
          <FundingNode x={funderPos.x} y={funderPos.y} r={funderR} halo={1 - toEmb} labelOpacity={funderLabel} />

          {/* buy tokens */}
          {tokens.map((t, i) => (
            <rect
              key={i}
              x={t.x - (t.refused ? 22 : 16)}
              y={t.y - (t.refused ? 10 : 7)}
              width={t.refused ? 44 : 32}
              height={t.refused ? 20 : 14}
              rx={t.refused ? 10 : 7}
              fill={t.hollow ? C.white : C.blue}
              stroke={t.refused ? C.navy : "none"}
              strokeWidth={t.refused ? 2.5 : 0}
              opacity={t.op}
              transform={`rotate(${(t.a * 180) / Math.PI} ${t.x} ${t.y})`}
            />
          ))}

          {f < LOGO_HANDOVER &&
            wallets.map((w, i) => {
              const a = slotAngle(i);
              const outside = prog(f, 488 + i * 1.5, 488 + i * 1.5 + 92, E.quintInOut);
              const dx = Math.cos(a);
              const dy = Math.sin(a);
              const lp = {
                x: w.shape.x + lerp(0, dx * 74, outside),
                y: w.shape.y + lerp(70, dy * 74, outside),
              };
              return (
                <WalletSymbol
                  key={i}
                  shape={w.shape}
                  fill={w.fill}
                  form={w.form}
                  marker={hint}
                  label={String(i + 1).padStart(2, "0")}
                  labelPos={lp}
                  labelOpacity={track(f, [[352 + i * 5, 0], [362 + i * 5, 1], [478, 1], [494, 0], [600 + i * 3, 0], [624 + i * 3, 1], [780, 1], [800, 0]])}
                />
              );
            })}

          {/* the mark's triangle, drawn as the wallets settle into three */}
          {f >= 1528 && f < LOGO_HANDOVER && (
            <g stroke={C.blue} strokeWidth={3 * MK} strokeLinecap="round" fill="none">
              {[
                [0, 1],
                [1, 2],
                [2, 0],
              ].map(([a, b], i) => (
                <line
                  key={i}
                  x1={DOTS[a].x}
                  y1={DOTS[a].y}
                  x2={lerp(DOTS[a].x, DOTS[b].x, triDraw)}
                  y2={lerp(DOTS[a].y, DOTS[b].y, triDraw)}
                />
              ))}
            </g>
          )}
          {f >= 1528 && f < LOGO_HANDOVER && (
            <g fill={C.blue}>
              {DOTS.map((d, i) => (
                <circle key={i} cx={d.x} cy={d.y} r={6 * MK * prog(f, 1540, 1556)} />
              ))}
            </g>
          )}
        </g>

        {/* scene 5: the starting line */}
        {lineDraw > 0.001 && (
          <line x1={120} y1={LINE_Y} x2={lerp(120, W - 120, lineDraw)} y2={LINE_Y} stroke={C.navy} strokeWidth={3} />
        )}
        {f >= 1300 && lineDraw > 0.001 && (
          <line
            x1={120}
            y1={LINE_Y}
            x2={Math.min(lerp(120, W - 120, prog(f, 1306, 1370, E.quintInOut)), lerp(120, W - 120, lineDraw))}
            y2={LINE_Y}
            stroke={C.blue}
            strokeWidth={5}
          />
        )}
        <defs>
          <clipPath id="aboveLine">
            <rect x={0} y={0} width={W} height={f < 1452 ? LINE_Y : H} />
          </clipPath>
        </defs>
        <g clipPath="url(#aboveLine)">
          <OrganicPattern shapes={runnerShapes} />
        </g>
        <OrganicPattern shapes={frameShapes} />

        {/* scene 6: the logo (the original geometry; the mark takes over from the assembled pieces) */}
        {f >= 1560 && (
          <g transform={`translate(${W / 2} ${LOGO_Y0 + LOGO_H / 2}) scale(${logoBreath}) translate(${-W / 2} ${-(LOGO_Y0 + LOGO_H / 2)})`}>
            <KinLogo x0={LOGO_X0} y0={LOGO_Y0} height={LOGO_H} mark={f >= LOGO_HANDOVER ? 1 : 0} word={wordP} dot={iDot} />
          </g>
        )}
      </svg>

      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill>
      {/* ------------------------------------------------------------- typography */}
      <SceneLabel index="01" title="THE PROBLEM" inAt={262} outAt={462} />
      <MaskLine text="One person." x={114} y={170} size={176} inAt={318} outAt={452} />
      <MaskLine text="Multiple wallets." x={114} y={372} size={176} inAt={336} outAt={458} />

      <SceneLabel index="02" title="THE LINK" inAt={492} outAt={768} />
      <MaskLine text="Ten wallets." x={114} y={318} size={142} inAt={566} outAt={772} />
      <MaskLine text="One funder." x={114} y={488} size={142} inAt={668} outAt={778} />
      <MonoLabel text="LINKED BY FUNDING, NOT BY IDENTITY" x={122} y={700} inAt={716} outAt={770} size={19} />

      <SceneLabel index="03" title="THE LIMIT" inAt={792} outAt={1128} />
      <MaskLine text="One shared" x={114} y={262} size={142} inAt={812} outAt={1132} />
      <MaskLine text="limit." x={114} y={430} size={142} inAt={826} outAt={1136} />
      <MaskLine text="Enforced onchain." x={118} y={640} size={66} color={C.blue} inAt={1020} outAt={1138} dur={40} />
      <MonoLabel text="A UNISWAP V4 HOOK IN THE POOL" x={122} y={742} inAt={1040} outAt={1132} size={18} />
      <MonoLabel text="REFUSES ANY BUY OVER THE LIMIT" x={122} y={774} inAt={1052} outAt={1132} size={18} />
      <MonoLabel
        text={`LIMIT USED  ${String(Math.round(Math.min(1, used) * 100)).padStart(3, " ")}%`}
        x={NC.x}
        y={NC.y + RING.r + 36}
        inAt={850}
        outAt={1128}
        size={17}
        align="center"
        speed={4}
      />
      <MonoLabel text="OVER THE LIMIT: REFUSED" x={1092} y={900} inAt={refusedHit + 2} outAt={1124} size={17} align="right" speed={3} color={C.navy} />

      <SceneLabel index="04" title="THE FAIR STARTING LINE" inAt={1160} outAt={1438} />
      <MaskLine text="One funder." x={114} y={150} size={118} inAt={1184} outAt={1442} />
      <MaskLine text="One limit." x={114} y={290} size={118} inAt={1214} outAt={1446} />
      <MaskLine text="One fair starting line." x={114} y={430} size={118} color={C.blue} inAt={1300} outAt={1452} />

      <MonoLabel text="FAIR TOKEN LAUNCHES ON BASE" x={W / 2} y={622} inAt={1626} size={22} align="center" dot speed={1.6} />
      <MaskLine text="One fair starting line." x={W / 2} y={676} size={44} weight={500} color={C.navy} inAt={1660} align="center" width={1200} dur={40} />
      <MonoLabel text="KINVERSE.VERCEL.APP  ·  LIVE ON BASE SEPOLIA TESTNET" x={W / 2} y={776} inAt={1690} size={17} align="center" speed={3} color={C.navy} />
    </AbsoluteFill>
  );
};

/** The film: graphics with camera-style motion blur (sub-frame samples), typography on top, crisp. */
export const Film = () => (
  <AbsoluteFill style={{ backgroundColor: C.white }}>
    <CameraMotionBlur samples={12} shutterAngle={180}>
      <Layer part="graphics" />
    </CameraMotionBlur>
    <Layer part="type" />
  </AbsoluteFill>
);
