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
    const c = clusterByFunding([w1, w2], edges, { maxHops: 2, excluded: new Set() });
    expect(c.length).toBe(1);
    expect(c[0]!.links[0]!.via).toBe(root);
    expect(c[0]!.links[0]!.hops).toEqual([2, 2]);
    expect(c[0]!.links[0]!.txHashes.length).toBe(4);
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
