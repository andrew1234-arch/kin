import { C } from "../tokens";

/**
 * The KIN logo, geometry copied exactly from brand/kin-logo-on-light.svg (viewBox 208×72): the mark (one ring
 * around three linked wallets) and the stroke-drawn wordmark. Animation only reveals the original strokes; at
 * full progress this renders the asset itself.
 */
export const LOGO_VB = { w: 208, h: 72 };
export const MARK_T = { tx: -2.254, ty: 2.746, s: 1.10169 };

/** Where a point of the mark (in the mark's own 64×64 space) lands on screen for a logo placed at (x0, y0, height). */
export const markToScreen = (x0: number, y0: number, height: number, px: number, py: number) => {
  const k = height / LOGO_VB.h;
  return { x: x0 + (px * MARK_T.s + MARK_T.tx) * k, y: y0 + (py * MARK_T.s + MARK_T.ty) * k };
};
export const markScale = (height: number) => (height / LOGO_VB.h) * MARK_T.s;

const WORD = ["M10 4 V60", "M37 22 L13 43", "M21 36 L39 60", "M58 24 V60", "M78 60 V24 M78 40 a16 16 0 0 1 32 0 V60"];

export const KinLogo = ({
  x0,
  y0,
  height,
  mark = 1,
  word = [1, 1, 1, 1, 1],
  dot = 1,
}: {
  x0: number;
  y0: number;
  height: number;
  mark?: number;
  /** Per-stroke draw progress of the wordmark k, i, n. */
  word?: number[];
  /** The i's dot, 0→1 scale. */
  dot?: number;
}) => {
  const k = height / LOGO_VB.h;
  return (
    <g transform={`translate(${x0} ${y0}) scale(${k})`}>
      {mark > 0 && (
        <g transform={`translate(${MARK_T.tx} ${MARK_T.ty}) scale(${MARK_T.s})`} opacity={mark}>
          <circle cx="32" cy="32" r="27" fill="none" stroke={C.blue} strokeWidth="5" />
          <g stroke={C.blue} strokeWidth="3" strokeLinecap="round">
            <line x1="32" y1="20" x2="21.6" y2="38" />
            <line x1="21.6" y1="38" x2="42.4" y2="38" />
            <line x1="42.4" y1="38" x2="32" y2="20" />
          </g>
          <g fill={C.blue}>
            <circle cx="32" cy="20" r="6" />
            <circle cx="21.6" cy="38" r="6" />
            <circle cx="42.4" cy="38" r="6" />
          </g>
        </g>
      )}
      <g transform="translate(80 6)">
        <g fill="none" stroke={C.ink} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round">
          {WORD.map((d, i) =>
            word[i] > 0.001 ? (
              <path key={i} d={d} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - Math.min(1, word[i])} />
            ) : null,
          )}
        </g>
        {dot > 0.001 && <circle cx="58" cy="7" r={5.5 * dot} fill={C.ink} />}
      </g>
    </g>
  );
};
