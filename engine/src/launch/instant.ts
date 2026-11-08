import { getAddress, keccak256, parseSignature, signatureToCompactSignature, toBytes, toHex, type Address, type Hex, type LocalAccount } from "viem";
import { canonicalJson } from "../allowlist/canonical";
import type { FundingEdge } from "../types";

/**
 * Instant launches: no registration and no allowlist. When a wallet asks to buy, the engine traces its funding
 * (the same trace the allowlist builder and Kin Scan use), assigns it to an entity, and signs a short-lived
 * KinPermit that KinHook checks in the swap. Assignments are append-only and public, so every limit the engine
 * handed out can be audited against the chain (WindowBuy events carry the entity each buy was charged to).
 */

export type InstantTier = "linked" | "aged" | "fresh";

export interface PermitLink {
  from: Address;
  to: Address;
  txHash: Hex;
  hop: 1 | 2;
  asset?: string;
}

export interface PermitAssignment {
  wallet: Address;
  entityId: Hex;
  tier: InstantTier;
  cap: string; // wei
  at: number;
  nonce: number;
  firstFundedAt?: number;
  /** Funding edges into the wallet (hop 1) and into its funders (hop 2), exchanges left out. */
  links: PermitLink[];
  /** The earlier wallet or funder this wallet was linked through, when it joined an existing entity. */
  via?: Address;
}

export interface InstantTiers {
  capWei: bigint;
  freshPoolCapWei: bigint;
  freshMaxNonce: number;
  freshMaxAgeHours: number;
}

export interface Candidate {
  wallet: Address;
  nonce: number;
  firstFundedAt?: number;
  edges: FundingEdge[];
}

export const instantFreshPoolId = (slug: string): Hex => keccak256(toBytes(`kin:instant:${slug}:fresh-pool`));
export const instantSoloId = (slug: string, w: Address): Hex => keccak256(toBytes(`kin:instant:${slug}:${w.toLowerCase()}`));

/** Funding edges that matter for this wallet: into it (hop 1) and into its funders (hop 2), exchanges excluded. */
export function relevantLinks(wallet: Address, edges: FundingEdge[], excluded: Set<string>): PermitLink[] {
  const w = wallet.toLowerCase();
  const hop1 = edges.filter((e) => e.hop === 1 && e.to.toLowerCase() === w && !excluded.has(e.from.toLowerCase()) && e.from.toLowerCase() !== w);
  const funders = new Set(hop1.map((e) => e.from.toLowerCase()));
  const hop2 = edges.filter(
    (e) => e.hop === 2 && funders.has(e.to.toLowerCase()) && !excluded.has(e.from.toLowerCase()) && e.from.toLowerCase() !== w,
  );
  return [...hop1, ...hop2].map((e) => ({
    from: getAddress(e.from),
    to: getAddress(e.to),
    txHash: e.txHash,
    hop: e.hop as 1 | 2,
    ...(e.asset ? { asset: e.asset } : {}),
  }));
}

/**
 * Assign one wallet, given every earlier assignment (in issue order). Rules, in order:
 *   1. Linked: the wallet, or any funder of it within 2 hops, already belongs to an entity (as a buyer or as a
 *      funder of a buyer). It joins the earliest such entity and gets that entity's cap: a cap is pinned onchain
 *      by an entity's first buy, so it can never change.
 *   2. Fresh: no meaningful history (nonce, or first funded too recently). One shared fresh pool for the launch.
 *   3. Aged and unlinked: its own entity and the normal cap. Its funders are remembered, so a later wallet with
 *      the same funder joins it.
 * Entities can't be merged after the fact: two entities that have both bought keep their own totals.
 */
export function assignInstant(slug: string, prior: PermitAssignment[], c: Candidate, t: InstantTiers, now: number, excluded: Set<string>) {
  const index = new Map<string, PermitAssignment>();
  const remember = (addr: string, a: PermitAssignment) => {
    const k = addr.toLowerCase();
    if (!index.has(k)) index.set(k, a);
  };
  for (const a of prior) {
    remember(a.wallet, a);
    for (const l of a.links) remember(l.from, a);
  }

  const links = relevantLinks(c.wallet, c.edges, excluded);
  const keys = [c.wallet, ...links.map((l) => l.from)];
  for (const k of keys) {
    const hit = index.get(k.toLowerCase());
    if (hit) {
      return {
        entityId: hit.entityId,
        tier: (hit.tier === "fresh" ? "fresh" : "linked") as InstantTier,
        cap: hit.cap,
        links,
        via: getAddress(k),
      };
    }
  }

  const maxAge = t.freshMaxAgeHours * 3600;
  const young = maxAge > 0 && c.firstFundedAt !== undefined && now - c.firstFundedAt < maxAge;
  if (c.nonce <= t.freshMaxNonce || young) {
    return { entityId: instantFreshPoolId(slug), tier: "fresh" as InstantTier, cap: t.freshPoolCapWei.toString(), links };
  }
  return { entityId: instantSoloId(slug, c.wallet), tier: "aged" as InstantTier, cap: t.capWei.toString(), links };
}

/** The rules an instant launch runs by, published byte for byte; its keccak256 is committed onchain at deploy. */
export function instantPolicy(input: {
  slug: string;
  chainId: number;
  tiers: { capWei: string; freshPoolCapWei: string; freshMaxNonce: number; freshMaxAgeHours?: number };
  permitSigner: Address;
  method: Record<string, unknown>;
}) {
  const json = canonicalJson({
    schema: "kin-instant-policy/1",
    launch: { slug: input.slug, chainId: input.chainId },
    tiers: input.tiers,
    permitSigner: input.permitSigner,
    rules: [
      "No registration. A wallet's funding is traced when it asks to buy.",
      "A wallet linked by funding (2 hops, exchanges excluded) to an earlier buyer or its funders joins that entity and its cap.",
      "A fresh wallet (no history, or first funded within freshMaxAgeHours) joins the launch's shared fresh pool.",
      "Any other wallet is its own entity with the normal cap.",
      "Every assignment is public at /launches/<slug>/permits; each window buy's entity is in KinHook's WindowBuy event.",
    ],
    method: input.method,
  });
  return { json, hash: keccak256(toBytes(json)) };
}

export const PERMIT_TYPES = {
  KinPermit: [
    { name: "poolId", type: "bytes32" },
    { name: "buyer", type: "address" },
    { name: "entityId", type: "bytes32" },
    { name: "entityCap", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

/** Sign a KinPermit; returns the router `proof` for instant launches: [deadline, r, yParityAndS]. */
export async function signPermit(
  signer: LocalAccount,
  p: { chainId: number; hook: Address; poolId: Hex; buyer: Address; entityId: Hex; entityCap: bigint; deadline: number },
): Promise<Hex[]> {
  const sig = await signer.signTypedData({
    domain: { name: "KinHook", version: "1", chainId: p.chainId, verifyingContract: p.hook },
    types: PERMIT_TYPES,
    primaryType: "KinPermit",
    message: { poolId: p.poolId, buyer: p.buyer, entityId: p.entityId, entityCap: p.entityCap, deadline: BigInt(p.deadline) },
  });
  const compact = signatureToCompactSignature(parseSignature(sig));
  return [toHex(BigInt(p.deadline), { size: 32 }), compact.r, compact.yParityAndS];
}
