import { getAddress, type Address, type Hex } from "viem";
import type { Cluster, FundingEdge, Link } from "../types";

/**
 * Baseline funding-cluster heuristic (EVM). Two wallets are linked when they share a funder
 * within `maxHops` hops, and that funder is not on the exclusion list (exchange hot wallets,
 * bridges, routers). A registered wallet that directly funds another registered wallet is itself
 * the shared funder (it reaches itself at hop 0).
 *
 * NOTE: this is the baseline signal from the build brief. The owner's Nuno cluster engine has not
 * been provided yet; its heuristics will be ported on top of this interface.
 */
export interface ClusterOptions {
  maxHops: 1 | 2;
  /** Lower-cased addresses that must never create a link. */
  excluded: Set<string>;
}

interface Path {
  wallet: Address;
  hops: number;
  txHashes: Hex[];
}

export function clusterByFunding(wallets: Address[], edges: FundingEdge[], opts: ClusterOptions): Cluster[] {
  const norm = (a: string) => a.toLowerCase();
  const walletSet = new Set(wallets.map(norm));
  const isExcluded = (a: string) => opts.excluded.has(norm(a));

  // Incoming edges by recipient, per hop.
  const hop1 = groupBy(edges.filter((e) => e.hop === 1), (e) => norm(e.to));
  const hop2 = groupBy(edges.filter((e) => e.hop === 2), (e) => norm(e.to));

  // funder (lower-case) -> paths from registered wallets to that funder
  const reach = new Map<string, Path[]>();
  const addPath = (funder: string, p: Path) => {
    const list = reach.get(funder) ?? [];
    list.push(p);
    reach.set(funder, list);
  };

  for (const w of wallets) {
    const wl = norm(w);
    addPath(wl, { wallet: getAddress(w), hops: 0, txHashes: [] });
    for (const e1 of hop1.get(wl) ?? []) {
      const f1 = norm(e1.from);
      if (isExcluded(f1) || f1 === wl) continue;
      addPath(f1, { wallet: getAddress(w), hops: 1, txHashes: [e1.txHash] });
      if (opts.maxHops < 2 || walletSet.has(f1)) continue;
      for (const e2 of hop2.get(f1) ?? []) {
        const f2 = norm(e2.from);
        if (isExcluded(f2) || f2 === wl || f2 === f1) continue;
        addPath(f2, { wallet: getAddress(w), hops: 2, txHashes: [e1.txHash, e2.txHash] });
      }
    }
  }

  // Union wallets that share a funder; keep the shortest path per (funder, wallet).
  const uf = new UnionFind(wallets.map(norm));
  const linksByPair = new Map<string, Link[]>();
  const seenPair = new Set<string>();
  const funders = [...reach.keys()].sort();
  for (const funder of funders) {
    const best = new Map<string, Path>();
    for (const p of reach.get(funder)!) {
      const k = norm(p.wallet);
      const cur = best.get(k);
      if (!cur || p.hops < cur.hops) best.set(k, p);
    }
    const paths = [...best.values()].sort((x, y) => x.hops - y.hops || norm(x.wallet).localeCompare(norm(y.wallet)));
    if (paths.length < 2) continue;
    const anchor = paths[0]!;
    for (const other of paths.slice(1)) {
      const pair = [norm(anchor.wallet), norm(other.wallet)].sort().join("|");
      uf.union(norm(anchor.wallet), norm(other.wallet));
      if (seenPair.has(pair)) continue;
      seenPair.add(pair);
      const link: Link = {
        a: anchor.wallet,
        b: other.wallet,
        reason: "shared-funder",
        via: getAddress(funder),
        hops: [anchor.hops, other.hops],
        txHashes: dedupe([...anchor.txHashes, ...other.txHashes]),
      };
      const list = linksByPair.get(pair) ?? [];
      list.push(link);
      linksByPair.set(pair, list);
    }
  }

  // Assemble clusters (size >= 2) with their links.
  const groups = new Map<string, Address[]>();
  for (const w of wallets) {
    const r = uf.find(norm(w));
    const g = groups.get(r) ?? [];
    g.push(getAddress(w));
    groups.set(r, g);
  }
  const clusters: Cluster[] = [];
  for (const [root, members] of groups) {
    if (members.length < 2) continue;
    const links: Link[] = [];
    for (const [pair, ls] of linksByPair) {
      const [a] = pair.split("|");
      if (uf.find(a!) === root) links.push(...ls);
    }
    clusters.push({ members: sortAddrs(members), links });
  }
  return clusters.sort((x, y) => y.members.length - x.members.length || norm(x.members[0]!).localeCompare(norm(y.members[0]!)));
}

class UnionFind {
  private parent = new Map<string, string>();
  constructor(items: string[]) {
    for (const i of items) this.parent.set(i, i);
  }
  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    while (p !== (this.parent.get(p) ?? p)) p = this.parent.get(p)!;
    this.parent.set(x, p);
    return p;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // deterministic: smaller address becomes the root
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const l = m.get(k) ?? [];
    l.push(x);
    m.set(k, l);
  }
  return m;
}

const dedupe = <T>(xs: T[]) => [...new Set(xs)];
export const sortAddrs = (xs: Address[]) => [...xs].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
