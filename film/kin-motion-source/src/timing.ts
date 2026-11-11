import { C } from "./tokens";

/**
 * The film runs on a musical grid: 128 BPM, 4/4. One bar = 1.875 s = 112.5 frames at 60 fps, and 16 bars are
 * exactly 30 s. Cuts land on bar lines, accents on beats; the score (scripts/sound.py) uses the same grid.
 */
export const BPM = 128;
export const BEAT = (60 / BPM) * 60; // 28.125 frames
export const BAR = BEAT * 4; // 112.5 frames
export const BARS = 16;
/** Frame of bar n (0-based), beat b (0-3), plus an optional fraction of a beat. */
export const at = (bar: number, beat = 0) => bar * BAR + beat * BEAT;
export const barOf = (f: number) => Math.min(BARS - 1, Math.floor(f / BAR));
export const beatOf = (f: number) => Math.floor((f % BAR) / BEAT);

/** Colour fields, cut on bar lines: white, then navy for the mechanism, one blue bar for the stamp, white again. */
export type Field = "white" | "navy" | "blue";
export const CUT = { navy: Math.round(at(7)), blue: Math.round(at(9)), white: Math.round(at(10)) };
export function fieldAt(f: number): Field {
  if (f >= CUT.navy && f < CUT.blue) return "navy";
  if (f >= CUT.blue && f < CUT.white) return "blue";
  return "white";
}
export const FIELD_BG: Record<Field, string> = { white: C.white, navy: C.navy, blue: C.blue };
/** Foreground ink and accent on each field. */
export const INK: Record<Field, { fg: string; faint: string; accent: string }> = {
  white: { fg: C.navy, faint: "rgba(16,47,89,0.48)", accent: C.blue },
  navy: { fg: C.white, faint: "rgba(255,255,255,0.5)", accent: C.blueLight },
  blue: { fg: C.white, faint: "rgba(255,255,255,0.62)", accent: C.white },
};

/** Scene names shown in the HUD (bar ranges). */
export const SCENES: { from: number; index: string; title: string }[] = [
  { from: 0, index: "01", title: "THE PATTERN" },
  { from: 2, index: "02", title: "THE PROBLEM" },
  { from: 4, index: "03", title: "THE LINK" },
  { from: 7, index: "04", title: "THE LIMIT" },
  { from: 10, index: "05", title: "THE FAIR STARTING LINE" },
  { from: 13, index: "06", title: "KIN" },
];
export const sceneOfBar = (b: number) => [...SCENES].reverse().find((s) => b >= s.from)!;
