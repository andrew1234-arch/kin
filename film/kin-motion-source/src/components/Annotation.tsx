import { clamp } from "../lib/anim";
import { E, FONT } from "../tokens";

/**
 * A design-tool selection: bounding box with handles, centre crosshair, and live readouts beside it. Used to
 * "inspect" the pattern, the funder and the shared limit, the way a motion designer would.
 */
export const Annotation = ({
  x,
  y,
  w,
  h,
  rot = 0,
  p,
  color,
  faint,
  lines,
  cross = true,
  knock,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
  /** 0→1 appear, 1→2 disappear. */
  p: number;
  color: string;
  faint: string;
  lines: [string, string?];
  cross?: boolean;
  /** Background colour for a knockout behind the readout text, so it reads over shapes. */
  knock?: string;
}) => {
  const ko = knock ? { stroke: knock, strokeWidth: 7, strokeLinejoin: "round" as const, paintOrder: "stroke" } : {};
  if (p <= 0 || p >= 2) return null;
  const a = p <= 1 ? E.expoOut(clamp(p)) : 1 - E.expoIn(clamp(p - 1));
  const k = 1 + 0.18 * (1 - a);
  const hw = (w / 2) * k;
  const hh = (h / 2) * k;
  const hs = 9;
  const handles = [
    [-hw, -hh], [0, -hh], [hw, -hh], [hw, 0], [hw, hh], [0, hh], [-hw, hh], [-hw, 0],
  ];
  return (
    <g opacity={a}>
      <g transform={`translate(${x} ${y}) rotate(${rot})`}>
        <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill="none" stroke={color} strokeWidth={1.5} opacity={0.75} />
        {handles.map(([hx, hy], i) => (
          <rect key={i} x={hx - hs / 2} y={hy - hs / 2} width={hs} height={hs} fill="none" stroke={color} strokeWidth={1.5} />
        ))}
        {cross && (
          <g stroke={color} strokeWidth={1.5}>
            <line x1={-16} y1={0} x2={16} y2={0} />
            <line x1={0} y1={-16} x2={0} y2={16} />
            <circle r={8} fill="none" />
          </g>
        )}
      </g>
      <text x={x + hw + 22} y={y - hh + 10} fontFamily={FONT.mono} fontSize={19} letterSpacing="0.14em" fill={color} fontWeight={600} {...ko}>
        {lines[0]}
      </text>
      {lines[1] && (
        <text x={x + hw + 22} y={y - hh + 40} fontFamily={FONT.mono} fontSize={19} letterSpacing="0.14em" fill={faint} {...ko}>
          {lines[1]}
        </text>
      )}
    </g>
  );
};
