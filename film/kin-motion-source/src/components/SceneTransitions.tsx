import { clamp, lerp } from "../lib/anim";
import { mixOrganic, type Organic } from "../lib/organic";
import { H, W } from "../tokens";

/**
 * Transition language. Nothing cuts or cross-fades: shapes leave by flying outward from the composition's centre
 * while shrinking, enter by growing out of a point with a stretch-and-settle, and morph between roles.
 */
export const CENTER = { x: W / 2, y: H / 2 };

/** A shape leaving radially: pushed out by `t` (0→1) and shrinking to nothing. */
export function radialExit(s: Organic, t: number, push = 0.45, spin = 40): Organic {
  const dx = s.x - CENTER.x;
  const dy = s.y - CENTER.y;
  return { ...s, x: s.x + dx * push * t, y: s.y + dy * push * t, s: s.s * (1 - t), rot: s.rot + spin * t };
}

/** A shape arriving: grows from `from` scale while its proportions stretch and then relax into place. */
export function stretchEnter(target: Organic, grow: number, settle: number, pull = 0.3, spin = -55): Organic {
  const dx = CENTER.x - target.x;
  const dy = CENTER.y - target.y;
  const st = 1 - settle;
  return {
    ...target,
    x: target.x + dx * pull * (1 - grow),
    y: target.y + dy * pull * (1 - grow),
    s: target.s * grow,
    rot: target.rot + spin * st,
    w: target.w * (1 + 0.55 * st),
    h: target.h * (1 - 0.4 * st),
  };
}

/** Morph between two shapes with an arcing path (a lift perpendicular to travel), so moves never look linear. */
export function arcMorph(a: Organic, b: Organic, t: number, lift = 0.12): Organic {
  const m = mixOrganic(a, b, t);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const k = Math.sin(Math.PI * clamp(t)) * lift;
  return { ...m, x: m.x - dy * k, y: m.y + dx * k };
}

export const lerpPt = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
});
