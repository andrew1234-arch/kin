import { describe, expect, test } from "bun:test";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { encodeAbiParameters, keccak256, toBytes, concat, type Hex } from "viem";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assignEntities, buildAllowlist, freshEntityId, LEAF_ENCODING, type TierConfig } from "../src/allowlist/build";
import { clusterByFunding } from "../src/cluster/cluster";
import { sandboxScenario } from "./scenario";

const ETH = 10n ** 18n;
const tiers: TierConfig = { capWei: ETH, freshPoolCapWei: ETH / 2n, verifiedCapWei: 3n * ETH, freshMaxNonce: 0 };

function build() {
  const s = sandboxScenario();
  const clusters = clusterByFunding(s.wallets.map((w) => w.wallet), s.edges, {
    maxHops: 2,
    excluded: new Set([s.exchange.toLowerCase()]),
  });
  const out = buildAllowlist({
    launch: { chainId: 84532, launchId: "engine-fixture", snapshotBlock: "0" },
    tiers,
    wallets: s.wallets,
    clusters,
    method: { heuristic: "shared-funder", maxHops: 2, exclusions: "test fixture: one synthetic exchange address" },
  });
  return { s, out };
}

describe("buildAllowlist", () => {
  test("tiers: bundle -> one linked entity, aged -> own entity, fresh -> an even share of the fresh pool each", () => {
    const { s, out } = build();
    expect(out.stats).toEqual({ allowlistedWallets: 25, entities: 6, linkedWallets: 20, freshWallets: 3 });

    const bundleIds = new Set(out.entries.filter((e) => s.bundle.includes(e.wallet)).map((e) => e.entityId));
    expect(bundleIds.size).toBe(1);
    expect(out.entries.find((e) => e.wallet === s.bundle[0])!.cap).toBe(ETH.toString());

    const freshEntries = out.entries.filter((e) => s.fresh.includes(e.wallet));
    expect(new Set(freshEntries.map((e) => e.entityId))).toEqual(new Set(s.fresh.map((w) => freshEntityId(w))));
    // 0.5 ETH pool / 3 fresh wallets: one actor with a fresh wallet can't take the whole pool first.
    for (const e of freshEntries) expect(e.cap).toBe((ETH / 2n / 3n).toString());

    const alice = out.entries.find((e) => e.wallet === s.alice)!;
    const bob = out.entries.find((e) => e.wallet === s.bob)!;
    expect(alice.tier).toBe("aged");
    expect(alice.entityId).not.toBe(bob.entityId);
  });

  test("leaf format matches KinHook: keccak256(bytes.concat(keccak256(abi.encode(wallet, entityId, cap))))", () => {
    const { out } = build();
    for (const e of out.entries) {
      const inner = keccak256(
        encodeAbiParameters(
          [{ type: "address" }, { type: "bytes32" }, { type: "uint256" }],
          [e.wallet, e.entityId, BigInt(e.cap)],
        ),
      );
      const leaf = keccak256(concat([inner]));
      // Manual sorted-pair verification, mirroring OpenZeppelin MerkleProof.
      let h: Hex = leaf;
      for (const p of e.proof) h = BigInt(h) < BigInt(p) ? keccak256(concat([h, p])) : keccak256(concat([p, h]));
      expect(h).toBe(out.root);
      expect(StandardMerkleTree.verify(out.root, [...LEAF_ENCODING], [e.wallet, e.entityId, e.cap], e.proof)).toBe(true);
    }
  });

  test("evidence is deterministic and its hash commits to the exact bytes", () => {
    const a = build().out;
    const b = build().out;
    expect(a.evidenceJson).toBe(b.evidenceJson);
    expect(a.evidenceHash).toBe(keccak256(toBytes(a.evidenceJson)));
    const ev = JSON.parse(a.evidenceJson);
    expect(ev.merkleRoot).toBe(a.root);
    const linked = ev.entities.find((e: { tier: string }) => e.tier === "linked");
    expect(linked.links.length).toBe(19);
    for (const l of linked.links) expect(l.txHashes.length).toBeGreaterThan(0);
  });

  test("writes the cross-check fixture consumed by contracts/test/EngineFixture.t.sol", () => {
    const { s, out } = build();
    const dir = join(import.meta.dir, "../../contracts/test/fixtures");
    mkdirSync(dir, { recursive: true });
    const fixture = {
      root: out.root,
      evidenceHash: out.evidenceHash,
      stats: out.stats,
      bundle: s.bundle,
      entries: out.entries.map((e) => ({ wallet: e.wallet, entityId: e.entityId, cap: e.cap, proof: e.proof })),
    };
    writeFileSync(join(dir, "engine-allowlist.json"), JSON.stringify(fixture, null, 2) + "\n");
    expect(fixture.entries.length).toBe(25);
  });
});

describe("fresh by age", () => {
  test("a wallet first funded recently is fresh even after a self-transaction (nonce > 0)", () => {
    const t: TierConfig = { ...tiers, freshMaxAgeHours: 168 };
    const now = 1_700_000_000;
    const young = "0x00000000000000000000000000000000000000a1" as const;
    const old = "0x00000000000000000000000000000000000000a2" as const;
    const { entities } = assignEntities(
      [
        { wallet: young, nonce: 1, firstFundedAt: now - 3600 },
        { wallet: old, nonce: 1, firstFundedAt: now - 30 * 86400 },
      ],
      [],
      t,
      now,
    );
    const tierOf = (w: string) => entities.find((e) => e.members.some((m) => m.toLowerCase() === w))!.tier;
    expect(tierOf(young)).toBe("fresh");
    expect(tierOf(old)).toBe("aged");
  });
});
