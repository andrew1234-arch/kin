import type { ScanResult } from "@/lib/types";
import { short } from "@/lib/format";

/**
 * One entity as a picture: funders in the middle, member wallets on a ring, a line for every
 * funding path (dashed = two hops). Readable at phone width; details live in the evidence list.
 */
export function ClusterMap({ entity }: { entity: ScanResult["entities"][number] }) {
  const size = 300;
  const c = size / 2;
  const members = entity.members;
  const funders = entity.funders;
  const rOuter = members.length > 12 ? 126 : 110;
  const rInner = funders.length > 1 ? 36 : 0;
  const pos = new Map<string, { x: number; y: number }>();
  funders.forEach((f, i) => {
    const a = (2 * Math.PI * i) / Math.max(funders.length, 1) - Math.PI / 2;
    pos.set(f.toLowerCase(), { x: c + rInner * Math.cos(a), y: c + rInner * Math.sin(a) });
  });
  members.forEach((m, i) => {
    const a = (2 * Math.PI * i) / members.length - Math.PI / 2;
    if (!pos.has(m.toLowerCase())) pos.set(m.toLowerCase(), { x: c + rOuter * Math.cos(a), y: c + rOuter * Math.sin(a) });
  });
  const edges: { from: string; to: string; hop: number }[] = [];
  const seen = new Set<string>();
  for (const l of entity.links) {
    for (const [w, hop] of [
      [l.a, l.hops[0]],
      [l.b, l.hops[1]],
    ] as const) {
      const k = `${w}-${l.via}`.toLowerCase();
      if (seen.has(k) || w.toLowerCase() === l.via.toLowerCase()) continue;
      seen.add(k);
      edges.push({ from: w.toLowerCase(), to: l.via.toLowerCase(), hop });
    }
  }
  const nodeR = members.length > 16 ? 6 : 8;
  return (
    <svg className="cluster-svg" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${members.length} wallets linked through ${funders.length} funder(s)`}>
      {edges.map((e, i) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        return <line key={i} className={`edge ${e.hop >= 2 ? "edge-hop2" : ""}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
      })}
      {members.map((m) => {
        const p = pos.get(m.toLowerCase())!;
        return (
          <circle key={m} className="member" cx={p.x} cy={p.y} r={nodeR}>
            <title>{m}</title>
          </circle>
        );
      })}
      {funders.map((f) => {
        const p = pos.get(f.toLowerCase())!;
        return (
          <g key={f}>
            <circle className="funder" cx={p.x} cy={p.y} r={12}>
              <title>Funder {f}</title>
            </circle>
            {funders.length === 1 && (
              <text x={p.x} y={p.y + 28} textAnchor="middle">
                {short(f, 3)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
