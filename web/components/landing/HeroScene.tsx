/**
 * The hero illustration: one funder above a floor plane, six wallets it funded resting on the plane,
 * an entity ring closing around them, and unrelated wallets outside the ring. Pure SVG; the entrance
 * is CSS-only and ends in its final state, so nothing depends on JavaScript.
 *
 * It is an illustration of the mechanism, not live data, and is labelled as such where it is used.
 */

const CX = 300;
const FLOOR_Y = 330;

// Six linked wallets on an inner ellipse (rx 132, ry 46). Depth: the further back, the smaller.
const LINKED = [-150, -90, -30, 30, 90, 150].map((deg, i) => {
  const t = (deg * Math.PI) / 180;
  const x = CX + 132 * Math.cos(t);
  const y = FLOOR_Y + 46 * Math.sin(t);
  const r = 11 + ((y - (FLOOR_Y - 46)) / 92) * 5; // 11 at the back, 16 at the front
  return { x, y, r, i };
});

// Wallets with no shared funding: outside the ring, no edges.
const INDEPENDENT = [
  { x: 64, y: 318, r: 10 },
  { x: 540, y: 312, r: 10 },
  { x: 140, y: 404, r: 14 },
  { x: 472, y: 398, r: 13 },
  { x: 430, y: 262, r: 8 },
  { x: 176, y: 266, r: 8 },
];

const FUNDER = { x: CX, y: 176, r: 30 };

export function HeroScene() {
  const byDepth = [...LINKED].sort((a, b) => a.y - b.y);
  return (
    <svg className="hero-scene" viewBox="0 0 600 540" role="img" aria-labelledby="hero-scene-title hero-scene-desc">
      <title id="hero-scene-title">Six wallets, one funder, one entity</title>
      <desc id="hero-scene-desc">
        A single funder is linked to six wallets. Kin groups them inside one entity ring that carries one purchase
        limit. Unrelated wallets outside the ring keep their own limits.
      </desc>
      <defs>
        <radialGradient id="hs-wallet" cx="0.36" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#eef0f5" />
          <stop offset="1" stopColor="#c6cad6" />
        </radialGradient>
        <radialGradient id="hs-indep" cx="0.36" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#fbfbfb" />
          <stop offset="0.6" stopColor="#eceded" />
          <stop offset="1" stopColor="#d4d5d9" />
        </radialGradient>
        <radialGradient id="hs-funder" cx="0.34" cy="0.28" r="0.85">
          <stop offset="0" stopColor="#5a5e6b" />
          <stop offset="0.45" stopColor="#16171c" />
          <stop offset="1" stopColor="#030304" />
        </radialGradient>
        <radialGradient id="hs-shadow">
          <stop offset="0" stopColor="#0a0b0f" stopOpacity="0.22" />
          <stop offset="1" stopColor="#0a0b0f" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* floor plane */}
      <g className="hs-floor">
        <ellipse cx={CX} cy={FLOOR_Y} rx="272" ry="98" fill="none" stroke="#e4e4e1" />
        <ellipse cx={CX} cy={FLOOR_Y} rx="214" ry="77" fill="none" stroke="#ececea" strokeDasharray="2 6" />
      </g>

      {/* unrelated wallets */}
      <g className="hs-indep">
        {INDEPENDENT.map((w, i) => (
          <g key={i} style={{ animationDelay: `${0.25 + i * 0.06}s` }}>
            <ellipse cx={w.x} cy={w.y} rx={w.r * 1.2} ry={w.r * 0.34} fill="url(#hs-shadow)" />
            <circle cx={w.x} cy={w.y - w.r - 1} r={w.r} fill="url(#hs-indep)" stroke="#d3d4d8" strokeWidth="1" />
          </g>
        ))}
      </g>

      {/* the entity ring: drawn last in the sequence */}
      <ellipse
        className="hs-ring"
        cx={CX}
        cy={FLOOR_Y}
        rx="172"
        ry="62"
        fill="none"
        stroke="#2f55e4"
        strokeWidth="2"
        pathLength={1}
      />
      <ellipse className="hs-ring-fill" cx={CX} cy={FLOOR_Y} rx="172" ry="62" fill="#2f55e4" fillOpacity="0.045" />

      {/* funder shadow and stem */}
      <ellipse className="hs-fade" cx={CX} cy={FLOOR_Y} rx="38" ry="10" fill="url(#hs-shadow)" />
      <line className="hs-stem" x1={CX} y1={FUNDER.y + FUNDER.r} x2={CX} y2={FLOOR_Y} stroke="#0a0b0f" strokeOpacity="0.18" strokeDasharray="2 4" />

      {/* funding edges, funder to each wallet's top */}
      <g className="hs-edges">
        {LINKED.map((w) => (
          <line
            key={w.i}
            x1={FUNDER.x}
            y1={FUNDER.y + 8}
            x2={w.x}
            y2={w.y - w.r * 2 - 1}
            pathLength={1}
            style={{ animationDelay: `${0.95 + w.i * 0.07}s` }}
          />
        ))}
      </g>

      {/* linked wallets, back to front */}
      <g className="hs-linked">
        {byDepth.map((w) => (
          <g key={w.i} style={{ animationDelay: `${0.45 + w.i * 0.08}s` }}>
            <ellipse cx={w.x} cy={w.y} rx={w.r * 1.25} ry={w.r * 0.36} fill="url(#hs-shadow)" />
            <circle cx={w.x} cy={w.y - w.r - 1} r={w.r} fill="url(#hs-wallet)" stroke="#2f55e4" strokeOpacity="0.55" strokeWidth="1.25" />
          </g>
        ))}
      </g>

      {/* funder */}
      <g className="hs-funder">
        <circle cx={FUNDER.x} cy={FUNDER.y} r={FUNDER.r} fill="url(#hs-funder)" />
        <ellipse cx={FUNDER.x - 9} cy={FUNDER.y - 12} rx="9" ry="5" fill="#ffffff" fillOpacity="0.16" />
      </g>

      {/* labels */}
      <g className="hs-labels" fontFamily="var(--font-mono), ui-monospace, monospace" fontSize="10.5" letterSpacing="0.12em">
        <text x={FUNDER.x - FUNDER.r - 14} y={FUNDER.y + 4} textAnchor="end" fill="#5d5f68">
          SHARED FUNDER
        </text>
        <text className="hs-ring-label" x={CX} y={FLOOR_Y + 62 + 26} textAnchor="middle" fill="#2f55e4">
          ONE ENTITY · ONE LIMIT
        </text>
        <text x="64" y={318 + 22} textAnchor="middle" fill="#9a9ba3">
          UNRELATED
        </text>
      </g>
    </svg>
  );
}
