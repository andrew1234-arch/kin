import { C } from "../tokens";

export interface Link {
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** 0→1 drawn length. */
  draw: number;
  /** Line intensity 0→1. */
  intensity: number;
  /** A travelling pulse along the link, 0→1 position; <0 hides it. */
  pulse?: number;
}

/**
 * Funding links: slightly curved strokes from the funder to each wallet, drawn progressively. The curve bends
 * consistently (clockwise), so ten links read as one system rather than ten straight spokes.
 */
export const ConnectionNetwork = ({ links, color = C.navy, width = 2.5 }: { links: Link[]; color?: string; width?: number }) => (
  <g>
    {links.map((l, i) => {
      if (l.draw <= 0.001 || l.intensity <= 0.001) return null;
      const mx = (l.from.x + l.to.x) / 2;
      const my = (l.from.y + l.to.y) / 2;
      const dx = l.to.x - l.from.x;
      const dy = l.to.y - l.from.y;
      const cx = mx - dy * 0.12;
      const cy = my + dx * 0.12;
      const len = Math.hypot(dx, dy) * 1.03;
      const d = `M${l.from.x},${l.from.y} Q${cx},${cy} ${l.to.x},${l.to.y}`;
      const p = l.pulse ?? -1;
      const bez = (t: number) => ({
        x: (1 - t) * (1 - t) * l.from.x + 2 * (1 - t) * t * cx + t * t * l.to.x,
        y: (1 - t) * (1 - t) * l.from.y + 2 * (1 - t) * t * cy + t * t * l.to.y,
      });
      const head = bez(Math.min(1, l.draw));
      return (
        <g key={i}>
          <path
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={width}
            strokeLinecap="round"
            strokeDasharray={`${len} ${len}`}
            strokeDashoffset={len * (1 - l.draw)}
            opacity={l.intensity}
          />
          {l.draw < 0.999 && <circle cx={head.x} cy={head.y} r={5} fill={C.blue} opacity={l.intensity} />}
          {p >= 0 && p <= 1 && <circle cx={bez(p).x} cy={bez(p).y} r={6} fill={C.blue} />}
        </g>
      );
    })}
  </g>
);
