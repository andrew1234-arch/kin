import { E } from "../tokens";

export type Ease = (t: number) => number;

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 0→1 progress of `frame` through [start, end], eased. */
export const prog = (frame: number, start: number, end: number, ease: Ease = E.expoOut) =>
  ease(clamp((frame - start) / Math.max(1, end - start)));

/**
 * Keyframe track: [[frame, value, easeIntoThisKey?], ...]. Holds the first value before the first key and the last
 * value after the last key. Deterministic: depends on the frame only.
 */
export type Key = [number, number, Ease?];
export function track(frame: number, keys: Key[]): number {
  if (frame <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [f1, v1, ease] = keys[i];
    const [f0, v0] = keys[i - 1];
    if (frame <= f1) return lerp(v0, v1, (ease ?? E.quintInOut)(clamp((frame - f0) / Math.max(1, f1 - f0))));
  }
  return keys[keys.length - 1][1];
}

/** Mix two hex colours. */
export function mix(a: string, b: string, t: number) {
  const pa = hex(a);
  const pb = hex(b);
  const c = pa.map((v, i) => Math.round(lerp(v, pb[i], clamp(t))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
const hex = (h: string) => {
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};

/** Deterministic pseudo-random in [0, 1) from an integer seed (mulberry32). */
export function rand(seed: number) {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Stagger helper: the start frame of item i. */
export const stagger = (start: number, i: number, step: number) => start + i * step;

/** A slow, deterministic drift (pixels) for idle motion, so resting compositions still breathe. */
export const drift = (frame: number, seed: number, amp = 6, period = 240) =>
  Math.sin((frame / period) * Math.PI * 2 + seed * 1.7) * amp;
