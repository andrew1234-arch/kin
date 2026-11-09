import { getAddress, type Address, type Hex } from "viem";
import type { Cluster, FundingEdge, Link, LinkReason } from "../types";

/**
 * Weighted entity clustering (EVM), ported from the Nuno cluster engine
 * (github.com/andrew1234-arch/nuno, packages/cluster @ ae62550, MIT) and adapted to Kin's inputs:
 * registered wallets (or a token's early buyers) plus their native-ETH funding edges (hop 1 and 2).
 *
 * Wallet pairs collect weighted evidence; a pair is merged once its total weight reaches 1.0.
 *
 * | Edge                    | Weight | Rule                                                                   |
 * |-------------------------|--------|------------------------------------------------------------------------|
 * | direct_funding          | 1.0    | One wallet in the set sent ETH to another (Kin's own rule)             |
 * | same_direct_funder      | 1.0    | Same non-excluded hop-1 funder, funded within `sameFunderWindowSecs`   |
 * | common_funding_source   | 0.8    | Share any non-excluded funding ancestor within `maxHops` (once/pair)   |
 * | same_block_early_buy    | 0.5    | Bought in the same block, within `earlyBuyBlocks` of the token's start |
 *
 * So one weak signal (a shared 2-hop ancestor, or one shared block) never merges wallets on its own;
 * two weak signals do (0.8 + 0.5, or 0.5 + 0.5 on two blocks).
 *
 * Distribution hubs: a funder or ancestor reaching more than `maxHubFanout` wallets is treated as an
 * airdrop/payout/bot service and stops linking, unless its direct payments look like a farm (median
 * payment ≤ `farmMaxMedianWei`, ≥ `farmShare` of payments within ½×–2× the median, ≥ `farmShare` of
 * recipients getting their first seen funding from it). Excluded addresses (exchanges, bridges,
 * routers) never link. Pure and deterministic: same input, same output.
 */
export interface ClusterOptions {
  maxHops: 1 | 2;
  /** Lower-cased addresses that must never create a link. */
  excluded: Set<string>;
  /** Buys of the scanned token (Scan only) for the same-block early-buy signal. */
  trades?: { wallet: Address; block: bigint; txHash: Hex }[];
  /** First block of the token (deploy block); required with `trades`. */
  createBlock?: bigint;
  /** Blocks after `createBlock` that count as "early" (default 30 ≈ 1 min of Base blocks). */
  earlyBuyBlocks?: number;
  sameFunderWindowSecs?: number;
  maxHubFanout?: number;
  farmMaxMedianWei?: bigint;
  farmShare?: number;
}

export const CLUSTER_WEIGHTS: Record<LinkReason, number> = {
  direct_funding: 1.0,
  same_direct_funder: 1.0,
  common_funding_source: 0.8,
  same_block_early_buy: 0.5,
};
export const UNION_THRESHOLD = 1.0;
export const CLUSTER_DEFAULTS = {
  sameFunderWindowSecs: 24 * 3600,
  maxHubFanout: 50,
  // Nuno used 10 MON; on Base a bundler seeds wallets with small, similar ETH amounts.
  farmMaxMedianWei: 5n * 10n ** 17n,
  farmShare: 0.8,
  earlyBuyBlocks: 30,
};

/** One-line description of the rule, written into evidence files and reports. */
export const CLUSTER_METHOD =
  "weighted links (Nuno engine port): wallet funds wallet 1.0; same hop-1 funder within 24 h 1.0; shared funding " +
  "ancestor within 2 hops 0.8; same-block early buy 0.5; merge at 1.0; exchanges excluded; hubs > 50 wallets " +
  "ignored unless they pay like a farm; contracts and wallets with 10,000+ transactions count as services and link no one";

const MAX_PAIRWISE_GROUP = 256;
const norm = (a: string) => a.toLowerCase();
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

interface Ancestor {
  hops: number;
  txHashes: Hex[];
  /** Timestamp of the wallet's hop-1 payment on this path. */
  firstTime: number;
}

export function clusterByFunding(wallets: Address[], edges: FundingEdge[], opts: ClusterOptions): Cluster[] {
  const cfg = { ...CLUSTER_DEFAULTS, ...stripUndefined(opts) };
  const walletSet = new Set(wallets.map(norm));
  const isExcluded = (a: string) => opts.excluded.has(norm(a));
  const links: Link[] = [];

  // Incoming edges by recipient.
  const parents = new Map<string, FundingEdge[]>();
  for (const e of edges) {
    if (e.hop > opts.maxHops) continue;
    const k = norm(e.to);
    const l = parents.get(k) ?? [];
    l.push(e);
    parents.set(k, l);
  }
  const earliestFunding = new Map<string, string>();
  for (const [to, list] of parents) {
    const first = [...list].sort(byTime)[0];
    if (first) earliestFunding.set(to, first.txHash);
  }

  // 1. direct_funding: one wallet in the set funded another.
  for (const w of [...walletSet].sort()) {
    for (const e of [...(parents.get(w) ?? [])].sort(byTime)) {
      const f = norm(e.from);
      if (f === w || !walletSet.has(f) || isExcluded(f)) continue;
      links.push(mk("direct_funding", e.from, e.to, [0, 1], [e.txHash], e.from));
    }
  }

  // 2. same_direct_funder: chain of wallets funded by one origin, consecutive payments within the window.
  const byFunder = new Map<string, FundingEdge[]>();
  for (const w of walletSet) {
    for (const e of parents.get(w) ?? []) {
      const f = norm(e.from);
      if (f === w || isExcluded(f)) continue;
      const l = byFunder.get(f) ?? [];
      l.push(e);
      byFunder.set(f, l);
    }
  }
  const hubs = new Set<string>();
  for (const funder of [...byFunder.keys()].sort()) {
    const first = firstPaymentPerWallet(byFunder.get(funder)!);
    if (isHub(first.length, cfg) && !looksLikeFarm(first, earliestFunding, cfg)) {
      hubs.add(funder);
      continue;
    }
    first.sort((x, y) => byTime(x, y) || norm(x.to).localeCompare(norm(y.to)));
    for (let i = 1; i < first.length; i++) {
      const a = first[i - 1]!;
      const b = first[i]!;
      if (b.timestamp - a.timestamp > cfg.sameFunderWindowSecs) continue;
      links.push(mk("same_direct_funder", a.to, b.to, [1, 1], [a.txHash, b.txHash], a.from));
    }
  }

  // 3. common_funding_source: shared ancestor within maxHops, one link per pair (shortest path kept).
  const ancestors = new Map<string, Map<string, Ancestor>>();
  for (const w of walletSet) {
    const anc = new Map<string, Ancestor>();
    let frontier: { addr: string; path: Hex[]; t: number }[] = [{ addr: w, path: [], t: 0 }];
    for (let hop = 1; hop <= opts.maxHops && frontier.length; hop++) {
      const next: typeof frontier = [];
      for (const { addr, path, t } of frontier) {
        for (const e of [...(parents.get(addr) ?? [])].sort(byTime)) {
          const o = norm(e.from);
          if (o === addr || o === w || isExcluded(o) || anc.has(o)) continue;
          const p = [...path, e.txHash];
          const ft = hop === 1 ? e.timestamp : t;
          anc.set(o, { hops: hop, txHashes: p, firstTime: ft });
          next.push({ addr: o, path: p, t: ft });
        }
      }
      frontier = next;
    }
    ancestors.set(w, anc);
  }
  const bySource = new Map<string, { wallet: string; a: Ancestor }[]>();
  for (const [w, anc] of ancestors)
    for (const [src, a] of anc) {
      const l = bySource.get(src) ?? [];
      l.push({ wallet: w, a });
      bySource.set(src, l);
    }
  const commonByPair = new Map<string, Link>();
  for (const src of [...bySource.keys()].sort()) {
    const group = bySource.get(src)!.sort((x, y) => x.wallet.localeCompare(y.wallet));
    if (group.length < 2 || hubs.has(src) || isHub(group.length, cfg)) continue;
    const pairs: [number, number][] = [];
    if (group.length <= MAX_PAIRWISE_GROUP) {
      for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) pairs.push([i, j]);
    } else for (let i = 1; i < group.length; i++) pairs.push([i - 1, i]);
    for (const [i, j] of pairs) {
      const x = group[i]!;
      const y = group[j]!;
      // Two direct children of one funder within the window are already a same_direct_funder pair.
      if (x.a.hops === 1 && y.a.hops === 1 && Math.abs(x.a.firstTime - y.a.firstTime) <= cfg.sameFunderWindowSecs) continue;
      const k = pairKey(x.wallet, y.wallet);
      const prev = commonByPair.get(k);
      const total = x.a.hops + y.a.hops;
      if (prev && prev.hops[0] + prev.hops[1] <= total) continue;
      commonByPair.set(k, mk("common_funding_source", x.wallet, y.wallet, [x.a.hops, y.a.hops], dedupe([...x.a.txHashes, ...y.a.txHashes]), src));
    }
  }
  links.push(...commonByPair.values());

  // 4. same_block_early_buy (Scan only).
  if (opts.trades && opts.createBlock !== undefined) {
    const last = opts.createBlock + BigInt(cfg.earlyBuyBlocks);
    const byBlock = new Map<string, Map<string, Hex>>();
    for (const t of opts.trades) {
      const w = norm(t.wallet);
      if (!walletSet.has(w) || t.block > last) continue;
      const k = t.block.toString();
      const m = byBlock.get(k) ?? new Map<string, Hex>();
      if (!m.has(w)) m.set(w, t.txHash);
      byBlock.set(k, m);
    }
    for (const [block, m] of [...byBlock].sort((x, y) => (BigInt(x[0]) < BigInt(y[0]) ? -1 : 1))) {
      const ws = [...m.keys()].sort();
      if (ws.length < 2) continue;
      const pairs: [number, number][] = [];
      if (ws.length <= MAX_PAIRWISE_GROUP) {
        for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) pairs.push([i, j]);
      } else for (let i = 1; i < ws.length; i++) pairs.push([i - 1, i]);
      for (const [i, j] of pairs) {
        const l = mk("same_block_early_buy", ws[i]!, ws[j]!, [0, 0], [m.get(ws[i]!)!, m.get(ws[j]!)!]);
        l.block = block;
        links.push(l);
      }
    }
  }

  // Weigh each pair from its evidence and union the pairs that reach the threshold.
  const byPair = new Map<string, Link[]>();
  for (const l of links) {
    const k = pairKey(norm(l.a), norm(l.b));
    const list = byPair.get(k) ?? [];
    list.push(l);
    byPair.set(k, list);
  }
  const uf = new UnionFind([...walletSet]);
  const accepted: Link[] = [];
  for (const k of [...byPair.keys()].sort()) {
    const ls = byPair.get(k)!;
    if (pairWeight(ls) + 1e-9 < UNION_THRESHOLD) continue;
    const [a, b] = k.split("|");
    uf.union(a!, b!);
    accepted.push(...ls);
  }

  const groups = new Map<string, Address[]>();
  for (const w of wallets) {
    const r = uf.find(norm(w));
    const g = groups.get(r) ?? [];
    if (!g.some((x) => norm(x) === norm(w))) g.push(getAddress(w));
    groups.set(r, g);
  }
  const clusters: Cluster[] = [];
  for (const [root, members] of groups) {
    if (members.length < 2) continue;
    clusters.push({ members: sortAddrs(members), links: accepted.filter((l) => uf.find(norm(l.a)) === root).sort(linkOrder) });
  }
  return clusters.sort((x, y) => y.members.length - x.members.length || norm(x.members[0]!).localeCompare(norm(y.members[0]!)));
}

/** A pair's total weight: funding edges count once per type; same-block buys once per distinct block. */
export function pairWeight(links: Link[]): number {
  const keys = new Map<LinkReason, Set<string>>();
  for (const l of links) {
    const s = keys.get(l.reason) ?? new Set<string>();
    s.add(l.reason === "same_block_early_buy" ? (l.block ?? "") : "any");
    keys.set(l.reason, s);
  }
  let w = 0;
  for (const [r, s] of keys) w += CLUSTER_WEIGHTS[r] * s.size;
  return w;
}

/** Farm pattern (from Nuno): tiny, similar payments that are mostly each recipient's first funding. */
export function looksLikeFarm(
  payments: FundingEdge[],
  firstFunding: Map<string, string>,
  cfg: { farmMaxMedianWei: bigint; farmShare: number },
): boolean {
  const values = payments.map((p) => p.value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (values.length === 0) return false;
  const median = values[Math.floor(values.length / 2)]!;
  if (median > cfg.farmMaxMedianWei) return false;
  const similar = values.filter((v) => v * 2n >= median && v <= median * 2n).length;
  const fresh = payments.filter((p) => firstFunding.get(norm(p.to)) === p.txHash).length;
  return similar >= cfg.farmShare * values.length && fresh >= cfg.farmShare * payments.length;
}

const isHub = (n: number, cfg: { maxHubFanout: number }) => cfg.maxHubFanout > 0 && n > cfg.maxHubFanout;
const byTime = (x: FundingEdge, y: FundingEdge) =>
  x.timestamp - y.timestamp || (x.blockNumber < y.blockNumber ? -1 : x.blockNumber > y.blockNumber ? 1 : 0) || x.txHash.localeCompare(y.txHash);

function firstPaymentPerWallet(edges: FundingEdge[]): FundingEdge[] {
  const first = new Map<string, FundingEdge>();
  for (const e of [...edges].sort(byTime)) if (!first.has(norm(e.to))) first.set(norm(e.to), e);
  return [...first.values()];
}

const REASON_ORDER: LinkReason[] = ["direct_funding", "same_direct_funder", "common_funding_source", "same_block_early_buy"];
const linkOrder = (x: Link, y: Link) =>
  REASON_ORDER.indexOf(x.reason) - REASON_ORDER.indexOf(y.reason) || norm(x.a).localeCompare(norm(y.a)) || norm(x.b).localeCompare(norm(y.b));

function mk(reason: LinkReason, a: string, b: string, hops: [number, number], txHashes: Hex[], via?: string): Link {
  const l: Link = { a: getAddress(a), b: getAddress(b), reason, weight: CLUSTER_WEIGHTS[reason], hops, txHashes };
  if (via) l.via = getAddress(via);
  return l;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
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

const dedupe = <T>(xs: T[]) => [...new Set(xs)];
export const sortAddrs = (xs: Address[]) => [...xs].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
