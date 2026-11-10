import { C } from "../tokens";

/**
 * The shared limit: one ring around the whole group. The faint track is the limit; the blue arc is what the group
 * has spent against it. The ring is also the KIN mark's ring (one ring = one entity), which is where the film ends.
 */
export const SharedLimit = ({
  x,
  y,
  r,
  stroke,
  track = 1,
  trackOpacity = 0.14,
  fill = 0,
  fillColor = C.blue,
  draw = 1,
  pulse = 0,
}: {
  x: number;
  y: number;
  r: number;
  stroke: number;
  track?: number;
  trackOpacity?: number;
  /** 0→1 share of the limit used (drawn clockwise from 12 o'clock). */
  fill?: number;
  fillColor?: string;
  /** 0→1 how much of the ring outline itself has been drawn. */
  draw?: number;
  /** 0→1 enforcement pulse: a brief outward echo of the ring. */
  pulse?: number;
}) => {
  if (r <= 0.5) return null;
  const circ = 2 * Math.PI * r;
  const rot = `rotate(-90 ${x} ${y})`;
  return (
    <g>
      {track > 0 && (
        <circle
          cx={x}
          cy={y}
          r={r}
          fill="none"
          stroke={C.navy}
          strokeWidth={stroke}
          opacity={trackOpacity * track}
          strokeDasharray={`${circ * draw} ${circ}`}
          transform={rot}
        />
      )}
      {fill > 0 && (
        <circle
          cx={x}
          cy={y}
          r={r}
          fill="none"
          stroke={fillColor}
          strokeWidth={stroke}
          strokeLinecap={fill < 0.999 ? "round" : "butt"}
          strokeDasharray={`${circ * Math.min(1, fill)} ${circ}`}
          transform={rot}
        />
      )}
      {pulse > 0 && pulse < 1 && (
        <circle
          cx={x}
          cy={y}
          r={r + stroke * 0.5 + 60 * pulse}
          fill="none"
          stroke={fillColor}
          strokeWidth={Math.max(0.5, stroke * 0.5 * (1 - pulse))}
          opacity={1 - pulse}
        />
      )}
    </g>
  );
};
