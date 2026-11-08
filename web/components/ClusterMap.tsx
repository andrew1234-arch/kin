import type { Link } from "@/lib/types";
import { short } from "@/lib/format";

/** Anything with members and evidence links: a Kin Scan entity, or an entity from a launch's evidence.json. */
export interface ClusterEntity {
  members: string[];
  links: Link[];
  /** Funders to place in the centre. Derived from the links' `via` when absent (evidence files omit it). */
  funders?: string[];
}

/**
 * One entity as a picture: funders in the middle, member wallets on a ring, a line for every
 * funding path (dashed = two hops) and a dotted line between wallets that bought in the same block.
 * Readable at phone width; details live in the evidence list.
 */
export function ClusterMap({ entity }: { entity: ClusterEntity }) {
  const size = 300;
  const c = size / 2;
  const members = entity.members;
  const funders =
    entity.funders ??
    [...new Set(entity.links.flatMap((l) => (l.via ? [l.via.toLowerCase()] : [])))];
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

  const edges: { from: string; to: string; kind: "hop1" | "hop2" | "block"; title: string }[] = [];
  const seen = new Set<string>();
  for (const l of entity.links) {
    if (!l.via) {
      // Same-block early buy: no funder, so the two wallets are joined directly.
      const k = [l.a, l.b].map((x) => x.toLowerCase()).sort().join("-") + "-block";
      if (seen.has(k)) continue;
      seen.add(k);
      edges.push({ from: l.a.toLowerCase(), to: l.b.toLowerCase(), kind: "block", title: `Same-block early buy${l.block ? `, block ${l.block}` : ""}` });
      continue;
    }
    const via = l.via;
    for (const [w, hop] of [
      [l.a, l.hops[0]],
      [l.b, l.hops[1]],
    ] as const) {
      const k = `${w}-${via}`.toLowerCase();
      if (seen.has(k) || w.toLowerCase() === via.toLowerCase()) continue;
      seen.add(k);
      edges.push({ from: w.toLowerCase(), to: via.toLowerCase(), kind: hop >= 2 ? "hop2" : "hop1", title: `${hop} hop${hop === 1 ? "" : "s"} to ${short(via, 4)}` });
    }
  }
  const nodeR = members.length > 16 ? 6 : 8;
  const funderOnly = funders.filter((f) => !members.some((m) => m.toLowerCase() === f.toLowerCase()));
  return (
    <svg
      className="cluster-svg"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${members.length} wallets linked through ${funderOnly.length} funder${funderOnly.length === 1 ? "" : "s"}`}
    >
      {edges.map((e, i) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        return (
          <line key={i} className={`edge ${e.kind === "hop2" ? "edge-hop2" : e.kind === "block" ? "edge-block" : ""}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}>
            <title>{e.title}</title>
          </line>
        );
      })}
      {members.map((m) => {
        const p = pos.get(m.toLowerCase())!;
        return (
          <circle key={m} className="member" cx={p.x} cy={p.y} r={nodeR}>
            <title>{m}</title>
          </circle>
        );
      })}
      {funderOnly.map((f) => {
        const p = pos.get(f.toLowerCase())!;
        return (
          <g key={f}>
            <circle className="funder" cx={p.x} cy={p.y} r={12}>
              <title>Funder {f}</title>
            </circle>
            {funderOnly.length === 1 && (
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
