import { CameraMotionBlur } from "@remotion/motion-blur";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Annotation } from "./components/Annotation";
import { ConnectionNetwork, type Link } from "./components/ConnectionNetwork";
import { FundingNode } from "./components/FundingNode";
import { Grain } from "./components/Grain";
import { Hud } from "./components/Hud";
import { MaskLine, MonoLabel, WhipLine } from "./components/KineticTypography";
import { KinLogo, LOGO_VB, markScale, markToScreen } from "./components/KinLogo";
import { OrganicPattern, type PlacedShape } from "./components/OrganicPattern";
import { arcMorph, CENTER, radialExit, stretchEnter } from "./components/SceneTransitions";
import { SharedLimit } from "./components/SharedLimit";
import { WalletSymbol } from "./components/WalletSymbol";
import { clamp, drift, lerp, mix, prog, track } from "./lib/anim";
import { mixOrganic, organic, type Organic } from "./lib/organic";
import { PATTERN, WALLET_SOURCES } from "./lib/pattern";
import { at, BEAT, CUT, FIELD_BG, fieldAt, INK } from "./timing";
import { C, E, H, W } from "./tokens";

/*
 * KIN · The Fair Starting Line. 16 bars at 128 BPM = exactly 30 s (1,800 frames at 60 fps).
 *
 *   bars  0–1   the pattern assembles, is inspected, turns, floods navy
 *   bars  2–3   the flood bursts; ten forms become ten wallets. ONE PERSON. MULTIPLE [WALLETS].
 *   bars  4–6   the wallets sweep into a circle, the funder lands, links draw on 8th notes. TEN WALLETS. ONE [FUNDER].
 *   bars  7–8   cut to navy: one ring is the shared limit; buys fill it on the beat; the next is refused. ONE SHARED [LIMIT].
 *   bar   9     cut to blue: ENFORCED ONCHAIN.
 *   bars 10–12  cut to white: the network becomes one emblem on one line. ONE FUNDER. ONE LIMIT. ONE [FAIR] STARTING LINE.
 *   bars 13–15  the pattern frames the screen; the ring and three dots become the Kin mark on three beats; the wordmark.
 */

// ------------------------------------------------------------------ layout

const NC = { x: 1450, y: 560 };
const RW = 300;
const RING = { r: 412, stroke: 14 };
const angle = (i: number) => ((-90 + i * 36) * Math.PI) / 180;
/** Wallet i (left to right in the row) takes circle slot SLOT[i]: order is kept, so the sweep never crosses. */
const SLOT = [8, 7, 6, 5, 4, 3, 2, 1, 0, 9];
const slotAngle = (i: number) => angle(SLOT[i]);

const LINE_Y = 860;
const EC = { x: 1592, y: 700 };
const EMB = { r: 150, stroke: 10, rw: 90 };

const LOGO_H = 210;
const LOGO_X0 = W / 2 - (LOGO_VB.w * LOGO_H) / LOGO_VB.h / 2;
const LOGO_Y0 = 340;
const MARK_C = markToScreen(LOGO_X0, LOGO_Y0, LOGO_H, 32, 32);
const MK = markScale(LOGO_H);
const DOTS = [
  markToScreen(LOGO_X0, LOGO_Y0, LOGO_H, 32, 20),
  markToScreen(LOGO_X0, LOGO_Y0, LOGO_H, 21.6, 38),
  markToScreen(LOGO_X0, LOGO_Y0, LOGO_H, 42.4, 38),
];
const DOT_OF_SLOT = [0, 0, 2, 2, 2, 1, 1, 1, 1, 0];
const DOT_OF = SLOT.map((sl) => DOT_OF_SLOT[sl]);
/** The three dots of the mark land on beats 2, 3 and 4 of bar 14. */
const DOT_AT = [at(13, 1), at(13, 2), at(13, 3)];
const LOGO_HANDOVER = Math.round(at(14));
/** Annotation progress: 0→1 appearing from `on`, held at 1, then 1→2 leaving from `off`. */
const showFor = (f: number, on: number, off: number) => (f < off ? Math.min(1, (f - on) / 12) : 1 + (f - off) / 10);

function polarMorph(a: Organic, b: Organic, t: number): Organic {
  const m = mixOrganic(a, b, t);
  const ra = Math.hypot(a.x - NC.x, a.y - NC.y);
  const rb = Math.hypot(b.x - NC.x, b.y - NC.y);
  const ta = Math.atan2(a.y - NC.y, a.x - NC.x);
  let d = Math.atan2(b.y - NC.y, b.x - NC.x) - ta;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const r = lerp(ra, rb, t) + Math.sin(Math.PI * t) * 70;
  const th = ta + d * t;
  return { ...m, x: NC.x + r * Math.cos(th), y: NC.y + r * Math.sin(th) };
}

const rowShape = (i: number) => organic({ x: 210 + i * 167, y: 812, w: 118, h: 80, n: 5, wob: 0.01, seed: 100 + i });
const circShape = (i: number) =>
  organic({ x: NC.x + RW * Math.cos(slotAngle(i)), y: NC.y + RW * Math.sin(slotAngle(i)), w: 104, h: 70, n: 5, wob: 0.01, seed: 100 + i });
const embShape = (i: number) =>
  organic({ x: EC.x + EMB.rw * Math.cos(slotAngle(i)), y: EC.y + EMB.rw * Math.sin(slotAngle(i)), w: 46, h: 31, n: 5, wob: 0.01, seed: 100 + i });
const dotShape = (i: number) => organic({ x: DOTS[DOT_OF[i]].x, y: DOTS[DOT_OF[i]].y, w: 12 * MK, h: 12 * MK, n: 2, seed: 100 + i });

// ------------------------------------------------------------------ the limit: buys land on the beat

/** [arrival frame, wallet, share of the limit]. Five buys fill it exactly; the sixth is refused. */
const BUYS: [number, number, number][] = [
  [at(7, 2), 0, 0.22],
  [at(7, 3), 3, 0.18],
  [at(8, 0), 7, 0.24],
  [at(8, 1), 5, 0.16],
  [at(8, 2), 8, 0.2],
];
const REFUSED = { arrive: at(8, 3), wallet: 2 };
const TRAVEL = 16;
const limitUsed = (f: number) => BUYS.reduce((u, [arr, , sh]) => u + sh * prog(f, arr, arr + 12, E.expoOut), 0);

// ------------------------------------------------------------------ the line and the frame

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
const inField = (s: Organic) => ((s.x - CENTER.x) / 760) ** 2 + ((s.y - 540) / 380) ** 2 < 1;
const FRAME = PATTERN.filter((p) => !inField(p.shape)).map((p) => p.shape);
const RUNNER_TO_FRAME = RUNNERS.map((_, r) => Math.round((r * (FRAME.length - 1)) / (RUNNERS.length - 1)));

/** 1 on each beat in [from, to), decaying over ~10 frames: rhythm for resting compositions. */
const onBeat = (f: number, from: number, to: number, decay = 10) =>
  f >= from && f < to ? Math.max(0, 1 - ((f - from) % BEAT) / decay) : 0;

/** Moments that hit: the camera takes a small kick on each. */
const IMPACTS = [at(2), at(5), CUT.navy, CUT.blue, CUT.white, at(14)];

// ------------------------------------------------------------------ everything that moves (under motion blur)

const Scene = () => {
  const f = useCurrentFrame();
  const field = fieldAt(f);
  const ink = INK[field];

  // ---- bars 0–1: the pattern ---------------------------------------------------------------------------------
  const order = [...PATTERN].sort(
    (a, b) => Math.hypot(a.shape.x - CENTER.x, a.shape.y - CENTER.y) - Math.hypot(b.shape.x - CENTER.x, b.shape.y - CENTER.y),
  );
  const rank = new Map(order.map((p, i) => [p.id, i]));
  const big = order.filter((p) => p.kind !== "dot");
  const bigRank = new Map(big.map((p, i) => [p.id, i]));
  const dots = PATTERN.filter((p) => p.kind === "dot");
  const dotRank = new Map(dots.map((p, i) => [p.id, i]));
  const walletIdx = new Map(WALLET_SOURCES.map((id, i) => [id, i]));

  const opening = (id: number, fr = f): Organic | null => {
    const p = PATTERN[id];
    let s: Organic;
    if (p.kind === "dot") {
      const start = at(1) + dotRank.get(id)! * (BEAT / 4); // on 16th notes through bar 2
      const g = prog(fr, start, start + 18, E.backOut);
      if (g <= 0) return null;
      s = { ...p.shape, s: p.shape.s * g };
    } else {
      const start = 2 + bigRank.get(id)! * 2.1;
      const grow = prog(fr, start, start + 26, E.expoOut);
      const settle = prog(fr, start + 4, start + 46, E.quintInOut);
      if (grow <= 0) return null;
      s = stretchEnter(p.shape, grow, settle, 0.34, -70);
    }
    const turn = track(fr, [[at(1), 0], [at(1, 3), -3.4, E.quintInOut]]) * (Math.PI / 180);
    const dx = s.x - CENTER.x;
    const dy = s.y - CENTER.y;
    s = { ...s, x: CENTER.x + dx * Math.cos(turn) - dy * Math.sin(turn), y: CENTER.y + dx * Math.sin(turn) + dy * Math.cos(turn) };
    s.rot += track(fr, [[at(1), 0], [at(1, 3), p.kind === "capsule" ? 16 : 10, E.quintInOut]]);
    s.s *= track(fr, [[at(1, 2), 1], [at(1, 3) + 20, 1.36, E.expoIn], [at(2) + 30, 1.36]]);
    return s;
  };

  const patternShapes: PlacedShape[] = [];
  if (f < at(3)) {
    for (const p of PATTERN) {
      if (walletIdx.has(p.id) && f >= 223) continue;
      let s = opening(p.id);
      if (!s) continue;
      if (f >= 224) {
        const r = rank.get(p.id)!;
        const t = prog(f, 224 + r * 0.6, 224 + r * 0.6 + 22, E.expoIn);
        if (t >= 1) continue;
        s = radialExit(s, t, 0.6, 60);
      }
      patternShapes.push({ key: `p${p.id}`, shape: s, fill: C.navy });
    }
  }
  const inspected = opening(12);

  // ---- the ten wallets ----------------------------------------------------------------------------------------
  const wallets = WALLET_SOURCES.map((srcId, i) => {
    let shape: Organic;
    let form = 0;
    let fill = ink.fg;
    if (f < 223) {
      shape = opening(srcId) ?? { ...PATTERN[srcId].shape, s: 0 };
      fill = C.navy;
    } else {
      const src = opening(srcId, 223)!;
      shape = arcMorph(src, rowShape(i), prog(f, 226 + i * 2, 226 + i * 2 + 40, E.quintInOut), 0.12);
      shape = { ...shape, x: shape.x + (i - 4.5) * 10 * track(f, [[at(3), 0], [at(4), 1, E.sineInOut]]) };
      form = prog(f, 248 + i * 2, 266 + i * 2, E.expoOut);
      if (f >= at(4)) shape = polarMorph(rowShape(i), circShape(i), prog(f, at(4) + i * 1.2, at(4) + i * 1.2 + 64, E.quintInOut));
      if (f >= CUT.white) shape = arcMorph(circShape(i), embShape(i), prog(f, CUT.white + i * 1.5, CUT.white + i * 1.5 + 50, E.quintInOut), 0.08);
      if (f >= at(13)) {
        const k = DOT_OF[i];
        const t4 = prog(f, DOT_AT[k] - 30, DOT_AT[k], E.quintInOut);
        shape = arcMorph(embShape(i), dotShape(i), t4, 0.06);
        form = 1 - prog(f, at(13), at(13) + 20, E.expoOut);
        fill = mix(C.navy, C.blue, t4);
      }
    }
    let pulse = 0;
    for (const [arr, w] of BUYS) if (w === i) pulse = Math.max(pulse, Math.sin(Math.PI * clamp((f - (arr - TRAVEL) + 6) / 16)));
    if (REFUSED.wallet === i) pulse = Math.max(pulse, Math.sin(Math.PI * clamp((f - (REFUSED.arrive - TRAVEL) + 6) / 16)));
    // Resting rows and circles pulse on the beat (bars 4 and 7), a wave across the ten.
    const beat = onBeat(f - i * 1.5, at(3), at(4)) + onBeat(f - i * 1.5, at(6), at(7));
    shape = { ...shape, s: shape.s * (1 + 0.18 * pulse + 0.07 * beat) };
    if (f > at(3) && f < CUT.white) shape = { ...shape, y: shape.y + drift(f, i, 2.4, 140) };
    return { shape, form, fill };
  });

  const hint = track(f, [[at(3, 1), 0], [at(3, 1) + 12, 1, E.expoOut], [at(6, 3), 1], [at(7), 0]]);
  const hintLines = track(f, [[at(3, 2), 0], [at(3, 2) + 14, 0.5, E.expoOut], [at(4), 0.5], [at(4) + 16, 0, E.expoIn]]);
  const hintDraw = prog(f, at(3, 2), at(3, 3), E.expoOut);

  // ---- funder -----------------------------------------------------------------------------------------------
  const rise = prog(f, at(4, 3) - 4, at(5), E.expoOut);
  const toEmb = prog(f, CUT.white, CUT.white + 56, E.quintInOut);
  const toMark = prog(f, at(13), at(13, 3), E.quintInOut);
  const funderPos = (() => {
    let p = { x: NC.x, y: lerp(1240, NC.y, rise) };
    p = { x: lerp(p.x, EC.x, toEmb), y: lerp(p.y, EC.y, toEmb) };
    return { x: lerp(p.x, MARK_C.x, toMark), y: lerp(p.y, MARK_C.y, toMark) };
  })();
  const funderR = track(f, [[at(4, 3) - 4, 0], [at(5), 64, E.backOut], [CUT.white, 64], [CUT.white + 56, 24, E.quintInOut], [at(13), 24], [at(13, 2), 0, E.expoIn]]);

  // ---- links: one per 8th note ---------------------------------------------------------------------------
  const linkOrder = [0, 5, 2, 7, 4, 9, 1, 6, 3, 8];
  const linkStart = (k: number) => at(5) + 6 + k * (BEAT / 2);
  const drawn = linkOrder.filter((_, k) => f >= linkStart(k) + 18).length;
  const links: Link[] = wallets.map((w, i) => {
    const k = linkOrder.indexOf(i);
    const draw = prog(f, linkStart(k), linkStart(k) + 20, E.expoOut);
    const intensity = field === "navy" ? 0.42 : track(f, [[at(5), 1], [at(7), 1], [CUT.white, 0.7], [at(13) - 4, 0.7], [at(13) + 6, 0, E.expoIn]]);
    const dx = w.shape.x - funderPos.x;
    const dy = w.shape.y - funderPos.y;
    const d = Math.hypot(dx, dy) || 1;
    const inset = (w.shape.w * w.shape.s) / 2 + 6;
    return {
      from: { x: funderPos.x + (dx / d) * (funderR + 4), y: funderPos.y + (dy / d) * (funderR + 4) },
      to: { x: w.shape.x - (dx / d) * inset, y: w.shape.y - (dy / d) * inset },
      draw,
      intensity,
      pulse: f >= at(6) && f < at(7) ? (f - (at(6) + k * 7)) / 22 : -1,
    };
  });

  // ---- the shared limit ---------------------------------------------------------------------------------
  const used = limitUsed(f);
  const ringDraw = prog(f, CUT.navy, CUT.navy + 40, E.quintInOut);
  const ring = {
    x: lerp(lerp(NC.x, EC.x, toEmb), MARK_C.x, toMark),
    y: lerp(lerp(NC.y, EC.y, toEmb), MARK_C.y, toMark),
    r: lerp(lerp(RING.r, EMB.r, toEmb), 27 * MK, toMark),
    stroke: lerp(lerp(RING.stroke, EMB.stroke, toEmb), 5 * MK, toMark),
  };
  const hit = REFUSED.arrive;
  const flash = f >= hit ? Math.sin(Math.PI * clamp((f - hit) / 18)) : 0;
  const tokens = [...BUYS.map(([arr, w]) => ({ arr, w, refused: false })), { arr: REFUSED.arrive, w: REFUSED.wallet, refused: true }]
    .map(({ arr, w, refused }) => {
      const t = (f - (arr - TRAVEL)) / TRAVEL;
      if (t < 0) return null;
      const a = slotAngle(w);
      const r0 = RW + 40;
      const r1 = RING.r - RING.stroke / 2 - 12;
      let r: number;
      let op = 1;
      if (!refused) {
        if (t > 1.15) return null;
        r = lerp(r0, r1, E.expoIn(clamp(t)));
        op = 1 - clamp((t - 1) / 0.15);
      } else {
        if (t > 3.2) return null;
        r = t <= 1 ? lerp(r0, r1, E.expoIn(clamp(t))) : lerp(r1, r1 - 90, E.expoOut(clamp((t - 1) / 0.8)));
        op = t <= 1.8 ? 1 : 1 - clamp((t - 1.8) / 1.4);
      }
      return { x: NC.x + r * Math.cos(a), y: NC.y + r * Math.sin(a), a, op, refused, hollow: refused && t > 1 };
    })
    .filter(Boolean) as { x: number; y: number; a: number; op: number; refused: boolean; hollow: boolean }[];

  // ---- the starting line ----------------------------------------------------------------------------------
  const lineDraw = track(f, [[CUT.white + 2, 0], [at(10, 2), 1, E.quintInOut], [at(13), 1], [at(13) + 30, 0, E.expoIn]]);
  const lineBlue = prog(f, at(11), at(11, 2), E.quintInOut);
  const runnerShapes: PlacedShape[] = [];
  if (f >= at(10, 2)) {
    RUNNERS.forEach((r, i) => {
      const st = at(10, 2) + i * (BEAT / 2);
      const up = prog(f, st, st + 24, E.backOut);
      if (up <= 0) return;
      let s: Organic = { ...r, y: r.y + (r.h + 20) * (1 - up) };
      if (f >= at(11, 2) && f < at(13)) {
        // On the line, the forms hop on every beat in a wave from left to right: ready at the start.
        const ph = (f - at(11, 2) - i * 3 + BEAT * 8) % BEAT;
        const hop = f - at(11, 2) - i * 3 >= 0 ? Math.sin(Math.PI * clamp(ph / 15)) : 0;
        s = { ...s, y: s.y - 16 * hop, rot: s.rot + drift(f, i * 5, 3, 160) };
      }
      if (f >= at(13)) s = arcMorph(s, FRAME[RUNNER_TO_FRAME[i]], prog(f, at(13) + i * 3, at(13) + i * 3 + 56, E.quintInOut), 0.16);
      runnerShapes.push({ key: `r${i}`, shape: s, fill: C.navy });
    });
  }
  const frameShapes: PlacedShape[] = [];
  if (f >= at(13)) {
    const taken = new Set(RUNNER_TO_FRAME);
    FRAME.forEach((target, j) => {
      if (taken.has(j)) return;
      const dist = Math.hypot(target.x - CENTER.x, target.y - CENTER.y);
      const start = at(13) + 4 + (dist / 1100) * 26 + (j % 4) * 2;
      const t = prog(f, start, start + 46, E.expoOut);
      if (t <= 0) return;
      const from = { ...target, x: CENTER.x + (target.x - CENTER.x) * 1.8, y: CENTER.y + (target.y - CENTER.y) * 1.8, s: 0.3, rot: target.rot - 70 };
      let s = mixOrganic(from, target, t);
      s = { ...s, x: s.x + drift(f, j, 3, 260), y: s.y + drift(f, j + 9, 3, 300) };
      frameShapes.push({ key: `f${j}`, shape: s, fill: C.navy });
    });
  }

  // ---- logo -----------------------------------------------------------------------------------------------
  const triDraw = prog(f, DOT_AT[2], at(14), E.expoOut);
  const wordP = [0, 1, 2, 3, 4].map((i) => prog(f, at(14) + i * 7, at(14) + i * 7 + 24, E.expoOut));
  const iDot = prog(f, at(14, 1), at(14, 1) + 18, E.backOut);
  const logoBreath = 1 + 0.014 * Math.sin(Math.PI * clamp((f - at(15)) / 50)) * (f > at(15) && f < at(15) + 50 ? 1 : 0);

  // ---- camera: an entrance push, a breath through the middle, and a kick on every impact ------------------
  let cam = track(f, [[0, 1.08], [at(1), 1, E.expoOut], [at(4), 1], [at(7), 1.03, E.sineInOut], [CUT.white, 1], [at(12), 1], [at(13), 1.035, E.sineInOut], [at(13) + 20, 1]]);
  for (const im of IMPACTS) if (f >= im && f < im + 18) cam *= 1 + 0.022 * (1 - E.expoOut(clamp((f - im) / 18)));

  const blueBar = field === "blue";

  return (
    <AbsoluteFill>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }}>
        <g transform={`translate(${CENTER.x} ${CENTER.y}) scale(${cam}) translate(${-CENTER.x} ${-CENTER.y})`}>
          <OrganicPattern shapes={patternShapes} />
          {inspected && (
            <Annotation
              x={inspected.x}
              y={inspected.y}
              w={inspected.w * inspected.s * 1.12}
              h={inspected.h * inspected.s * 1.12}
              rot={inspected.rot}
              p={showFor(f, at(1), at(1, 3))}
              color={C.blue}
              faint={C.navy}
              lines={[`SHAPE PEBBLE`, `ROT ${(((inspected.rot % 360) + 360) % 360).toFixed(1).padStart(5, "0")}°`]}
              knock={C.white}
            />
          )}

          {hintLines > 0.001 &&
            wallets.map((w, i) => (
              <line
                key={i}
                x1={w.shape.x}
                y1={w.shape.y + 44}
                x2={lerp(w.shape.x, NC.x, hintDraw)}
                y2={lerp(w.shape.y + 44, 1240, hintDraw)}
                stroke={C.navy}
                strokeWidth={1.5}
                strokeDasharray="3 9"
                opacity={hintLines}
              />
            ))}

          {!blueBar && f >= CUT.navy && f < LOGO_HANDOVER && (
            <SharedLimit
              x={ring.x}
              y={ring.y}
              r={ring.r}
              stroke={ring.stroke * (1 + 0.8 * flash + 0.35 * onBeat(f, at(11, 2), at(13)))}
              draw={ringDraw}
              track={1 - prog(f, CUT.white, CUT.white + 30)}
              trackColor={ink.fg}
              trackOpacity={field === "navy" ? 0.22 : 0.14}
              fill={f < CUT.white ? used : 1}
              fillColor={field === "navy" ? C.blueLight : C.blue}
              pulse={f >= hit && f < hit + 30 ? (f - hit) / 30 : 0}
            />
          )}

          {!blueBar && <ConnectionNetwork links={links} color={ink.fg} />}
          {!blueBar && (
            <FundingNode
              x={funderPos.x}
              y={funderPos.y}
              r={funderR}
              halo={1 - toEmb}
              fill={f < at(13) ? ink.fg : C.navy}
              knockout={FIELD_BG[field]}
              labelOpacity={track(f, [[at(5, 1), 0], [at(5, 1) + 10, 1], [at(9) - 4, 1], [at(9), 0]])}
            />
          )}

          {!blueBar &&
            tokens.map((t, i) => (
              <rect
                key={i}
                x={t.x - (t.refused ? 24 : 17)}
                y={t.y - (t.refused ? 11 : 7.5)}
                width={t.refused ? 48 : 34}
                height={t.refused ? 22 : 15}
                rx={t.refused ? 11 : 7.5}
                fill={t.hollow ? FIELD_BG[field] : C.blueLight}
                stroke={t.refused ? C.white : "none"}
                strokeWidth={t.refused ? 3 : 0}
                opacity={t.op}
                transform={`rotate(${(t.a * 180) / Math.PI} ${t.x} ${t.y})`}
              />
            ))}

          {!blueBar &&
            f < LOGO_HANDOVER &&
            wallets.map((w, i) => {
              const a = slotAngle(i);
              const outside = prog(f, at(4) + i * 1.2, at(4) + i * 1.2 + 64, E.quintInOut);
              const lp = { x: w.shape.x + lerp(0, Math.cos(a) * 74, outside), y: w.shape.y + lerp(70, Math.sin(a) * 74, outside) };
              return (
                <WalletSymbol
                  key={i}
                  shape={w.shape}
                  fill={w.fill}
                  form={w.form}
                  marker={hint}
                  claspColor={FIELD_BG[field]}
                  labelColor={ink.fg}
                  label={String(i + 1).padStart(2, "0")}
                  labelPos={lp}
                  labelOpacity={track(f, [
                    [at(3) + i * 7, 0],
                    [at(3) + i * 7 + 6, 1],
                    [at(4) - 6, 1],
                    [at(4), 0],
                    [at(5) + i * 7, 0],
                    [at(5) + i * 7 + 8, 1],
                    [at(9) - 6, 1],
                    [at(9), 0],
                  ])}
                />
              );
            })}

          {!blueBar && (
            <Annotation
              x={funderPos.x}
              y={funderPos.y}
              w={funderR * 2 + 40}
              h={funderR * 2 + 40}
              p={showFor(f, at(5, 2), at(6, 3))}
              color={C.blue}
              faint={C.navy}
              lines={["FUNDER 01", `LINKS ${String(drawn).padStart(2, "0")}/10`]}
              cross={false}
            />
          )}
          {field === "navy" && (
            <Annotation
              x={NC.x}
              y={NC.y}
              w={RING.r * 2 + 60}
              h={RING.r * 2 + 60}
              p={showFor(f, at(7, 1), at(9) - 10)}
              color={C.blueLight}
              faint={INK.navy.faint}
              lines={["", ""]}
              cross={false}
            />
          )}

          {f >= DOT_AT[0] - 2 && f < LOGO_HANDOVER && (
            <g stroke={C.blue} strokeWidth={3 * MK} strokeLinecap="round" fill="none">
              {[
                [0, 1],
                [1, 2],
                [2, 0],
              ].map(([a, b], i) => (
                <line key={i} x1={DOTS[a].x} y1={DOTS[a].y} x2={lerp(DOTS[a].x, DOTS[b].x, triDraw)} y2={lerp(DOTS[a].y, DOTS[b].y, triDraw)} />
              ))}
            </g>
          )}
        </g>

        {blueBar && (
          <circle
            cx={1500}
            cy={560}
            r={lerp(380, 560, E.expoOut(clamp((f - CUT.blue) / 60)))}
            fill="none"
            stroke={C.white}
            strokeWidth={3}
            strokeDasharray="2 16"
            opacity={0.35}
            transform={`rotate(${(f - CUT.blue) * 0.4} 1500 560)`}
          />
        )}

        {lineDraw > 0.001 && <line x1={120} y1={LINE_Y} x2={lerp(120, W - 120, lineDraw)} y2={LINE_Y} stroke={C.navy} strokeWidth={3} />}
        {lineBlue > 0 && lineDraw > 0.001 && (
          <line x1={120} y1={LINE_Y} x2={Math.min(lerp(120, W - 120, lineBlue), lerp(120, W - 120, lineDraw))} y2={LINE_Y} stroke={C.blue} strokeWidth={5} />
        )}
        <defs>
          <clipPath id="aboveLine">
            <rect x={0} y={0} width={W} height={f < at(13) ? LINE_Y : H} />
          </clipPath>
        </defs>
        <g clipPath="url(#aboveLine)">
          <OrganicPattern shapes={runnerShapes} />
        </g>
        <OrganicPattern shapes={frameShapes} />

        {f >= LOGO_HANDOVER - 1 && (
          <g transform={`translate(${W / 2} ${LOGO_Y0 + LOGO_H / 2}) scale(${logoBreath}) translate(${-W / 2} ${-(LOGO_Y0 + LOGO_H / 2)})`}>
            <KinLogo x0={LOGO_X0} y0={LOGO_Y0} height={LOGO_H} mark={f >= LOGO_HANDOVER ? 1 : 0} word={wordP} dot={iDot} />
          </g>
        )}
      </svg>

      {/* ------------------------------------------------------------- typography, on the beat */}
      <WhipLine parts={[{ t: "One person." }]} x={114} y={176} size={136} inAt={at(2, 1)} outAt={at(4) - 16} color={C.navy} accent={C.blue} />
      <WhipLine
        parts={[{ t: "Multiple " }, { t: "wallets.", bracket: true }]}
        x={114}
        y={336}
        size={136}
        inAt={at(2, 2)}
        outAt={at(4) - 13}
        color={C.navy}
        accent={C.blue}
        bracketAt={at(2, 3)}
      />

      <WhipLine parts={[{ t: "Ten wallets." }]} x={114} y={318} size={120} inAt={at(4, 1)} outAt={CUT.navy - 15} color={C.navy} accent={C.blue} />
      <WhipLine
        parts={[{ t: "One " }, { t: "funder.", bracket: true }]}
        x={114}
        y={458}
        size={120}
        inAt={at(5)}
        outAt={CUT.navy - 12}
        color={C.navy}
        accent={C.blue}
        bracketAt={at(5, 1)}
      />
      <MonoLabel text="LINKED BY FUNDING, NOT BY IDENTITY" x={120} y={640} inAt={at(6)} outAt={CUT.navy - 14} size={20} />

      {field === "navy" && (
        <>
          <WhipLine parts={[{ t: "One shared" }]} x={114} y={300} size={120} inAt={CUT.navy} color={C.white} accent={C.blueLight} />
          <WhipLine
            parts={[{ t: "limit.", bracket: true }]}
            x={114}
            y={440}
            size={120}
            inAt={at(7, 1)}
            color={C.white}
            accent={C.blueLight}
            bracketAt={at(7, 2)}
          />
          <MonoLabel text="ENTITY 01  ·  10 WALLETS" x={120} y={620} inAt={at(7, 2)} size={20} color={C.white} speed={2.4} />
          <MonoLabel
            text={`LIMIT USED  ${String(Math.round(Math.min(1, used) * 100)).padStart(3, "0")}%`}
            x={120}
            y={656}
            inAt={at(7, 2)}
            size={20}
            color={C.blueLight}
            speed={3}
          />
          <MonoLabel text="OVER THE LIMIT  ·  REFUSED" x={120} y={692} inAt={hit + 1} size={20} color={C.white} speed={3} />
        </>
      )}

      {blueBar && (
        <>
          <WhipLine parts={[{ t: "Enforced" }]} x={110} y={250} size={232} weight={900} inAt={CUT.blue} color={C.white} accent={C.white} tracking={-0.045} />
          <WhipLine parts={[{ t: "onchain." }]} x={110} y={480} size={232} weight={900} inAt={at(9, 1)} color={C.white} accent={C.white} tracking={-0.045} />
          <MonoLabel text="A UNISWAP V4 HOOK IN THE POOL REFUSES ANY BUY OVER THE LIMIT" x={120} y={790} inAt={at(9, 2)} size={21} color={C.white} speed={3.2} />
        </>
      )}

      <WhipLine parts={[{ t: "One funder." }]} x={114} y={150} size={100} inAt={at(10, 1)} outAt={at(13) - 26} color={C.navy} accent={C.blue} />
      <WhipLine parts={[{ t: "One limit." }]} x={114} y={262} size={100} inAt={at(10, 2)} outAt={at(13) - 23} color={C.navy} accent={C.blue} />
      <WhipLine
        parts={[{ t: "One " }, { t: "fair", bracket: true }]}
        x={114}
        y={374}
        size={100}
        inAt={at(11)}
        outAt={at(13) - 20}
        color={C.blue}
        accent={C.blue}
        bracketAt={at(11, 2)}
      />
      <WhipLine parts={[{ t: "starting line." }]} x={114} y={486} size={100} inAt={at(11, 1)} outAt={at(13) - 17} color={C.blue} accent={C.blue} />

      <MonoLabel text="FAIR TOKEN LAUNCHES ON BASE" x={W / 2} y={612} inAt={at(14, 2)} size={22} align="center" dot speed={1.8} />
      <MaskLine text="One fair starting line." x={W / 2} y={664} size={46} weight={500} color={C.navy} inAt={at(14, 3)} align="center" width={1200} dur={30} />
      <MonoLabel text="KINVERSE.VERCEL.APP  ·  LIVE ON BASE SEPOLIA TESTNET" x={W / 2} y={770} inAt={at(15)} size={17} align="center" speed={3} />
    </AbsoluteFill>
  );
};

/** Field colour (cut on bar lines) → everything that moves, under camera motion blur → grain → the HUD. */
export const Film = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: FIELD_BG[fieldAt(f)] }}>
      <CameraMotionBlur samples={12} shutterAngle={200}>
        <Scene />
      </CameraMotionBlur>
      <Grain />
      <Hud />
    </AbsoluteFill>
  );
};
