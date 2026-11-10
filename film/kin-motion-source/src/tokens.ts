import { Easing } from "remotion";

/** Film format: exactly 30 s at 60 fps. */
export const FPS = 60;
export const W = 1920;
export const H = 1080;
export const DURATION = 1800;

/**
 * Colour. Navy and white carry the film; the blue accent is the site's brand blue (web/app/globals.css
 * --kin-blue #2f55e4, and #7d97ff on dark), used only for the limit and the brand.
 */
export const C = {
  navy: "#102F59",
  navyDeep: "#0B2245",
  white: "#FFFFFF",
  paper: "#FBFBFA", // the site's light background
  blue: "#2F55E4",
  blueLight: "#7D97FF",
  ink: "#17171B", // the wordmark colour in brand/kin-logo-on-light.svg
  rule: "rgba(16,47,89,0.18)",
};

/** Type: the site's own faces (Geist, Geist Mono), loaded from public/fonts. */
export const FONT = {
  sans: "Geist, 'Geist Fallback', sans-serif",
  mono: "'Geist Mono', ui-monospace, monospace",
};

/** Layout: a 12-column Swiss grid with 120 px outer margins. */
export const GRID = { margin: 120, cols: 12, gutter: 24 };
export const col = (n: number) => GRID.margin + n * ((W - 2 * GRID.margin + GRID.gutter) / GRID.cols);

/** Scene boundaries (frames). */
export const S = {
  identity: [0, 240],
  problem: [240, 480],
  discovery: [480, 780],
  mechanism: [780, 1140],
  fairness: [1140, 1440],
  brand: [1440, 1800],
} as const;

/** Custom easing curves. */
export const E = {
  /** Fast attack, long settle: most entrances. */
  expoOut: Easing.bezier(0.16, 1, 0.3, 1),
  /** The site's own ease-out (globals.css --ease-out). */
  siteOut: Easing.bezier(0.22, 1, 0.36, 1),
  /** Symmetric, weighty: moves between two resting states. */
  quintInOut: Easing.bezier(0.83, 0, 0.17, 1),
  /** Gentle in-out for long drifts. */
  sineInOut: Easing.bezier(0.37, 0, 0.63, 1),
  /** Accelerating exit. */
  expoIn: Easing.bezier(0.7, 0, 0.84, 0),
  /** A small, controlled overshoot. */
  backOut: Easing.bezier(0.34, 1.32, 0.64, 1),
  linear: (t: number) => t,
};
