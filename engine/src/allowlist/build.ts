import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { getAddress, keccak256, toBytes, type Address, type Hex } from "viem";
import { sortAddrs } from "../cluster/cluster";
import type { Cluster, Entity, Tier, WalletProfile } from "../types";
import { canonicalJson } from "./canonical";
import { freshShareWei } from "../scan/counterfactual";

/**
 * Allowlist builder: registrations + clusters → tiers → leaves → Merkle root + proofs + evidence.
 *
 * Leaf encoding is OpenZeppelin StandardMerkleTree over (address wallet, bytes32 entityId, uint256 entityCap):
 *   keccak256(bytes.concat(keccak256(abi.encode(wallet, entityId, entityCap))))
 * which is exactly what KinHook verifies (sorted-pair proofs, OZ MerkleProof).
 */
export const LEAF_ENCODING = ["address", "bytes32", "uint256"] as const;

export interface TierConfig {
  /** Cap for a linked entity or an aged, unlinked wallet (wei). */
  capWei: bigint;
  /** Total for every fresh wallet together, split evenly: each gets min(capWei, pool / fresh wallets) (wei). */
  freshPoolCapWei: bigint;
  /** Cap for a Base Verify verified wallet on its own (wei). Never lifts a linked entity's shared cap. */
  verifiedCapWei: bigint;
  /** A wallet with nonce <= this at the snapshot is "fresh" (no meaningful history). */
  freshMaxNonce: number;
  /**
   * ...as is a wallet first funded less than this many hours before the snapshot (0 = off), so one cheap
   * self-transaction doesn't turn a new wallet into an aged one.
   */
  freshMaxAgeHours?: number;
}

export interface LaunchRef {
  chainId: number;
  /** Free-form id until the pool exists (e.g. the factory salt or a slug). */
  launchId: string;
  snapshotBlock: string;
  /** Unix seconds of the snapshot block; wallet age (freshMaxAgeHours) is measured from it. */
  snapshotTimestamp?: number;
}

export interface BuildInput {
  launch: LaunchRef;
  tiers: TierConfig;
  wallets: WalletProfile[];
  clusters: Cluster[];
  method: Record<string, unknown>; // clustering parameters + exclusion list source, recorded verbatim
}

export interface AllowlistEntry {
  wallet: Address;
  entityId: Hex;
  tier: Tier;
  cap: string; // wei, decimal string
  proof: Hex[];
}

export interface AllowlistStats {
  allowlistedWallets: number;
  entities: number;
  linkedWallets: number;
  freshWallets: number;
}

export interface BuildOutput {
  root: Hex;
  entries: AllowlistEntry[];
  stats: AllowlistStats;
  /** The evidence file, exactly as published. Its keccak256 is `evidenceHash`, committed onchain. */
  evidenceJson: string;
  evidenceHash: Hex;
}

export const freshEntityId = (w: Address): Hex => keccak256(toBytes("kin:fresh:" + w.toLowerCase()));
export const linkedEntityId = (members: Address[]): Hex =>
  keccak256(toBytes("kin:linked:" + sortAddrs(members).map((m) => m.toLowerCase()).join(",")));
export const soloEntityId = (w: Address): Hex => keccak256(toBytes("kin:solo:" + w.toLowerCase()));
export const verifiedEntityId = (w: Address): Hex => keccak256(toBytes("kin:verified:" + w.toLowerCase()));

/** Assign every registered wallet to exactly one entity. */
export function assignEntities(wallets: WalletProfile[], clusters: Cluster[], cfg: TierConfig, snapshotTimestamp?: number) {
  const byWallet = new Map(wallets.map((w) => [w.wallet.toLowerCase(), w]));
  const entities: Entity[] = [];
  const capOf = new Map<Hex, bigint>();
  const inCluster = new Set<string>();

  // 1. Linked: one entity, one shared cap. Verification never lifts it: one verified (or borrowed) account must
  //    not raise a whole bundle's cap.
  for (const c of clusters) {
    const members = sortAddrs(c.members.filter((m) => byWallet.has(m.toLowerCase())));
    if (members.length < 2) continue;
    members.forEach((m) => inCluster.add(m.toLowerCase()));
    const id = linkedEntityId(members);
    entities.push({ entityId: id, tier: "linked", members, links: c.links });
    capOf.set(id, cfg.capWei);
  }

  // 2. Singletons: verified > fresh (new by nonce or by age) > aged. Fresh wallets split the fresh pool.
  const maxAge = (cfg.freshMaxAgeHours ?? 0) * 3600;
  const young = (w: WalletProfile) =>
    maxAge > 0 && snapshotTimestamp !== undefined && w.firstFundedAt !== undefined && snapshotTimestamp - w.firstFundedAt < maxAge;
  const fresh: Address[] = [];
  for (const w of [...wallets].sort((a, b) => a.wallet.toLowerCase().localeCompare(b.wallet.toLowerCase()))) {
    if (inCluster.has(w.wallet.toLowerCase())) continue;
    const addr = getAddress(w.wallet);
    if (w.verified) {
      const id = verifiedEntityId(addr);
      entities.push({ entityId: id, tier: "verified", members: [addr], links: [] });
      capOf.set(id, cfg.verifiedCapWei);
    } else if (w.nonce <= cfg.freshMaxNonce || young(w)) {
      fresh.push(addr);
    } else {
      const id = soloEntityId(addr);
      entities.push({ entityId: id, tier: "aged", members: [addr], links: [] });
      capOf.set(id, cfg.capWei);
    }
  }
  const share = freshShareWei(cfg.capWei, cfg.freshPoolCapWei, fresh.length);
  for (const addr of fresh) {
    const id = freshEntityId(addr);
    entities.push({ entityId: id, tier: "fresh", members: [addr], links: [] });
    capOf.set(id, share);
  }
  return { entities, capOf };
}

export function buildAllowlist(input: BuildInput): BuildOutput {
  const { entities, capOf } = assignEntities(input.wallets, input.clusters, input.tiers, input.launch.snapshotTimestamp);

  const rows: { wallet: Address; entityId: Hex; tier: Tier; cap: bigint }[] = [];
  for (const e of entities) {
    for (const m of e.members) rows.push({ wallet: m, entityId: e.entityId, tier: e.tier, cap: capOf.get(e.entityId)! });
  }
  rows.sort((a, b) => a.wallet.toLowerCase().localeCompare(b.wallet.toLowerCase()));
  if (rows.length === 0) throw new Error("no registered wallets");

  const tree = StandardMerkleTree.of(
    rows.map((r) => [r.wallet, r.entityId, r.cap.toString()]),
    [...LEAF_ENCODING],
  );
  const root = tree.root as Hex;
  const entries: AllowlistEntry[] = rows.map((r, i) => ({
    wallet: r.wallet,
    entityId: r.entityId,
    tier: r.tier,
    cap: r.cap.toString(),
    proof: tree.getProof(i) as Hex[],
  }));

  const stats: AllowlistStats = {
    allowlistedWallets: rows.length,
    entities: entities.length,
    linkedWallets: entities.filter((e) => e.tier === "linked").reduce((n, e) => n + e.members.length, 0),
    freshWallets: entities.filter((e) => e.tier === "fresh").reduce((n, e) => n + e.members.length, 0),
  };

  const evidence = {
    schema: "kin-evidence/1",
    launch: input.launch,
    leafEncoding: "keccak256(bytes.concat(keccak256(abi.encode(address wallet, bytes32 entityId, uint256 entityCap))))",
    merkleRoot: root,
    tiers: {
      capWei: input.tiers.capWei.toString(),
      freshPoolCapWei: input.tiers.freshPoolCapWei.toString(),
      verifiedCapWei: input.tiers.verifiedCapWei.toString(),
      freshMaxNonce: input.tiers.freshMaxNonce,
      freshMaxAgeHours: input.tiers.freshMaxAgeHours ?? 0,
    },
    method: input.method,
    stats,
    entities: entities.map((e) => ({
      entityId: e.entityId,
      tier: e.tier,
      capWei: capOf.get(e.entityId)!.toString(),
      members: e.members,
      links: e.links,
    })),
    wallets: [...input.wallets]
      .sort((a, b) => a.wallet.toLowerCase().localeCompare(b.wallet.toLowerCase()))
      .map((w) => ({
        wallet: getAddress(w.wallet),
        nonce: w.nonce,
        firstFundedAt: w.firstFundedAt ?? null,
        verified: !!w.verified,
      })),
  };
  const evidenceJson = canonicalJson(evidence);
  return { root, entries, stats, evidenceJson, evidenceHash: keccak256(toBytes(evidenceJson)) };
}
