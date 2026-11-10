import { organic, type Organic } from "./organic";

/**
 * The KIN organic pattern: deep navy forms on white. Pebbles, capsules, discs, rings, eggs and small dots,
 * packed loosely on a 1920×1080 field with clear white negative space between them.
 *
 * Drawn from the written brief (navy organic shapes, white negative space, irregular rounded silhouettes, varied
 * proportions, circles, hollow forms, elongated forms). Every form is editable here; every scene reuses this list,
 * so tuning it retunes the whole film.
 */
export type Kind = "pebble" | "capsule" | "disc" | "ring" | "egg" | "slab" | "dot";

export interface PatternShape {
  id: number;
  kind: Kind;
  shape: Organic;
}

const pebble = (x: number, y: number, w: number, h: number, rot: number, seed: number) =>
  organic({ x, y, w, h, rot, n: 2.25, wob: 0.075, seed });
const capsule = (x: number, y: number, w: number, h: number, rot: number, seed: number) =>
  organic({ x, y, w, h, rot, n: 5.5, wob: 0.012, seed });
const disc = (x: number, y: number, d: number, seed: number) => organic({ x, y, w: d, h: d, n: 2, seed });
const ringF = (x: number, y: number, d: number, hollow: number, seed: number) =>
  organic({ x, y, w: d, h: d, n: 2, hollow, seed });
const egg = (x: number, y: number, w: number, h: number, rot: number, taper: number, seed: number) =>
  organic({ x, y, w, h, rot, n: 2.3, wob: 0.035, taper, seed });
const slab = (x: number, y: number, w: number, h: number, rot: number, seed: number) =>
  organic({ x, y, w, h, rot, n: 3.8, wob: 0.03, seed });
const dot = (x: number, y: number, d: number, seed: number) => organic({ x, y, w: d, h: d, n: 2, seed });

const defs: [Kind, Organic][] = [
  // band 1
  ["pebble", pebble(150, 120, 300, 230, -12, 3)],
  ["capsule", capsule(468, 92, 330, 112, 0, 4)],
  ["dot", dot(612, 222, 70, 5)],
  ["ring", ringF(800, 150, 240, 0.58, 6)],
  ["egg", egg(1090, 132, 206, 284, 70, 0.3, 7)],
  ["capsule", capsule(1300, 226, 330, 118, -35, 8)],
  ["disc", disc(1538, 96, 168, 9)],
  ["pebble", pebble(1772, 196, 270, 320, 20, 10)],
  // band 2
  ["capsule", capsule(100, 452, 116, 372, 0, 11)],
  ["disc", disc(318, 356, 196, 12)],
  ["slab", slab(574, 470, 290, 236, 8, 13)],
  ["dot", dot(372, 556, 58, 14)],
  ["pebble", pebble(892, 430, 300, 250, -25, 15)],
  ["ring", ringF(1126, 368, 150, 0.5, 16)],
  ["egg", egg(1384, 486, 250, 296, -15, -0.3, 17)],
  ["capsule", capsule(1652, 430, 300, 108, 60, 18)],
  ["dot", dot(1862, 476, 70, 19)],
  // band 3
  ["egg", egg(262, 720, 276, 236, 30, 0.28, 20)],
  ["capsule", capsule(590, 734, 350, 116, -12, 21)],
  ["dot", dot(760, 628, 54, 22)],
  ["ring", ringF(918, 758, 250, 0.62, 23)],
  ["pebble", pebble(1158, 676, 214, 196, 45, 24)],
  ["slab", slab(1418, 752, 250, 196, -20, 25)],
  ["disc", disc(1662, 690, 176, 26)],
  ["capsule", capsule(1848, 830, 116, 350, 10, 27)],
  // band 4
  ["capsule", capsule(118, 972, 300, 110, 25, 28)],
  ["pebble", pebble(446, 962, 270, 206, 5, 29)],
  ["dot", dot(664, 884, 62, 30)],
  ["capsule", capsule(768, 1018, 290, 108, 0, 31)],
  ["egg", egg(1070, 958, 236, 256, 100, 0.25, 32)],
  ["dot", dot(1262, 872, 46, 33)],
  ["pebble", pebble(1376, 996, 268, 210, -10, 34)],
  ["ring", ringF(1662, 980, 184, 0.55, 35)],
  // small dots between the larger forms
  ["dot", dot(990, 270, 42, 36)],
  ["dot", dot(232, 290, 34, 37)],
  ["dot", dot(1516, 300, 40, 38)],
  ["dot", dot(1778, 600, 48, 39)],
  ["dot", dot(712, 330, 28, 40)],
  ["dot", dot(1236, 556, 36, 41)],
  ["dot", dot(452, 832, 32, 42)],
];

export const PATTERN: PatternShape[] = defs.map(([kind, shape], id) => ({ id, kind, shape }));

/** The ten pattern forms that become the ten wallets (chosen across the field, left to right). */
export const WALLET_SOURCES = [0, 9, 17, 10, 12, 21, 13, 14, 22, 23];
