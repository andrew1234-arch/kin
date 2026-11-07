import { describe, expect, test } from "bun:test";
import { clusterByFunding } from "../src/cluster/cluster";
import type { FundingEdge } from "../src/types";
import { addr, sandboxScenario, txh } from "./scenario";

describe("clusterByFunding", () => {
  test("20 wallets with one funder collapse into one cluster, every link has tx hashes", () => {
    const s = sandboxScenario();
    const clusters = clusterByFunding(s.wallets.map((w) => w.wallet), s.edges, {
      maxHops: 2,
      excluded: new Set([s.exchange.toLowerCase()]),
    });
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.members.length).toBe(20);
    expect(clusters[0]!.links.length).toBe(19);
    for (const l of clusters[0]!.links) {
      expect(l.via).toBe(s.funder);
      expect(l.txHashes.length).toBe(2);
    }
  });

  test("an excluded exchange hot wallet does not create a link", () => {
    const s = sandboxScenario();
    const withoutExclusion = clusterByFunding(s.wallets.map((w) => w.wallet), s.edges, { maxHops: 1, excluded: new Set() });
    // Without the exclusion list, alice and fresh-0 would be falsely linked through the exchange.
    expect(withoutExclusion.some((c) => c.members.includes(s.alice) && c.members.includes(s.fresh[0]!))).toBe(true);

    const withExclusion = clusterByFunding(s.wallets.map((w) => w.wallet), s.edges, {
      maxHops: 1,
      excluded: new Set([s.exchange.toLowerCase()]),
    });
    expect(withExclusion.some((c) => c.members.includes(s.alice))).toBe(false);
  });

  test("two-hop shared funder links wallets, one-hop setting does not", () => {
    const root = addr("root-funder");
    const mid1 = addr("mid-1");
    const mid2 = addr("mid-2");
    const w1 = addr("w1");
    const w2 = addr("w2");
    const edges: FundingEdge[] = [
      { from: mid1, to: w1, txHash: txh("m1w1"), blockNumber: 5n, timestamp: 5, value: 1n, hop: 1 },
      { from: mid2, to: w2, txHash: txh("m2w2"), blockNumber: 6n, timestamp: 6, value: 1n, hop: 1 },
      { from: root, to: mid1, txHash: txh("rm1"), blockNumber: 3n, timestamp: 3, value: 2n, hop: 2 },
      { from: root, to: mid2, txHash: txh("rm2"), blockNumber: 4n, timestamp: 4, value: 2n, hop: 2 },
    ];
    expect(clusterByFunding([w1, w2], edges, { maxHops: 1, excluded: new Set() }).length).toBe(0);
    // A shared 2-hop ancestor alone is a weak signal (0.8) and does not merge (Nuno weights).
    expect(clusterByFunding([w1, w2], edges, { maxHops: 2, excluded: new Set() }).length).toBe(0);
    // Plus one same-block early buy (0.5) it does.
    const trades = [
      { wallet: w1, block: 101n, txHash: txh("buy-w1") },
      { wallet: w2, block: 101n, txHash: txh("buy-w2") },
    ];
    const c = clusterByFunding([w1, w2], edges, { maxHops: 2, excluded: new Set(), trades, createBlock: 100n });
    expect(c.length).toBe(1);
    const common = c[0]!.links.find((l) => l.reason === "common_funding_source")!;
    expect(common.via).toBe(root);
    expect(common.hops).toEqual([2, 2]);
    expect(common.txHashes.length).toBe(4);
    expect(c[0]!.links.some((l) => l.reason === "same_block_early_buy" && l.block === "101")).toBe(true);
  });

  test("one shared early block does not merge; two do; late blocks do not count", () => {
    const w1 = addr("sb1");
    const w2 = addr("sb2");
    const t = (w: string, b: bigint) => ({ wallet: w as `0x${string}`, block: b, txHash: txh(`${w}-${b}`) });
    const one = clusterByFunding([w1, w2], [], { maxHops: 2, excluded: new Set(), trades: [t(w1, 101n), t(w2, 101n)], createBlock: 100n });
    expect(one.length).toBe(0);
    const two = clusterByFunding([w1, w2], [], {
      maxHops: 2, excluded: new Set(), createBlock: 100n,
      trades: [t(w1, 101n), t(w2, 101n), t(w1, 103n), t(w2, 103n)],
    });
    expect(two.length).toBe(1);
    const late = clusterByFunding([w1, w2], [], {
      maxHops: 2, excluded: new Set(), createBlock: 100n, earlyBuyBlocks: 30,
      trades: [t(w1, 101n), t(w2, 101n), t(w1, 200n), t(w2, 200n)],
    });
    expect(late.length).toBe(0);
  });

  test("same direct funder far apart in time is only a weak signal", () => {
    const f = addr("slow-funder");
    const w1 = addr("slow-1");
    const w2 = addr("slow-2");
    const edges: FundingEdge[] = [
      { from: f, to: w1, txHash: txh("s1"), blockNumber: 1n, timestamp: 1_000, value: 1n, hop: 1 },
      { from: f, to: w2, txHash: txh("s2"), blockNumber: 2n, timestamp: 1_000 + 3 * 86_400, value: 1n, hop: 1 },
    ];
    expect(clusterByFunding([w1, w2], edges, { maxHops: 2, excluded: new Set() }).length).toBe(0);
  });

  test("a distribution hub stops linking, unless it pays out like a farm", () => {
    const hub = addr("payout-hub");
    const ws = Array.from({ length: 60 }, (_, i) => addr(`hub-r-${i}`));
    // Varied, large payments: a payout service, not one operator.
    const varied: FundingEdge[] = ws.map((w, i) => ({
      from: hub, to: w, txHash: txh(`hv-${i}`), blockNumber: BigInt(i + 1), timestamp: 1_000 + i,
      value: BigInt(i + 1) * 10n ** 18n, hop: 1 as const,
    }));
    expect(clusterByFunding(ws, varied, { maxHops: 2, excluded: new Set() }).length).toBe(0);
    // Small, similar first payments to fresh wallets: a farm, still linked above the cap.
    const farm: FundingEdge[] = ws.map((w, i) => ({
      from: hub, to: w, txHash: txh(`hf-${i}`), blockNumber: BigInt(i + 1), timestamp: 1_000 + i,
      value: 10n ** 16n, hop: 1 as const,
    }));
    const c = clusterByFunding(ws, farm, { maxHops: 2, excluded: new Set() });
    expect(c.length).toBe(1);
    expect(c[0]!.members.length).toBe(60);
  });

  test("a registered wallet that funds another registered wallet links them directly", () => {
    const a = addr("a");
    const b = addr("b");
    const edges: FundingEdge[] = [{ from: a, to: b, txHash: txh("ab"), blockNumber: 1n, timestamp: 1, value: 1n, hop: 1 }];
    const c = clusterByFunding([a, b], edges, { maxHops: 2, excluded: new Set() });
    expect(c.length).toBe(1);
    expect(c[0]!.links[0]!.via).toBe(a);
    expect(c[0]!.links[0]!.txHashes).toEqual([txh("ab")]);
  });

  test("no shared funders gives a clean, empty result", () => {
    const c = clusterByFunding([addr("x"), addr("y")], [], { maxHops: 2, excluded: new Set() });
    expect(c).toEqual([]);
  });
});
