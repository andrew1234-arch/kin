import type { Address, Hex } from "viem";

/**
 * "What Kin would have capped": replay the observed early buys, in chain order, through Kin's
 * entity caps. A buy lands if its entity's cumulative ETH spend stays within the cap, otherwise the
 * whole buy is rejected (as KinHook does). Buys paid in an ERC-20 have no known ETH value and are
 * reported as unknown, never guessed. This assumes the same buys would have been attempted.
 */
export interface KinCaps {
  /** Cap per linked entity and per aged, unlinked wallet (wei). */
  capWei: bigint;
  /** Total for all fresh, unlinked wallets together, split evenly between them (wei). */
  freshPoolCapWei: bigint;
}

/**
 * Each fresh wallet's share of the fresh pool: the pool split evenly, never more than the normal cap. Splitting
 * (instead of one first-come pool) means one actor with a few fresh wallets can't take the whole pool in the
 * window's first block; it gets only its wallets' shares. Shared with the allowlist builder.
 */
export function freshShareWei(capWei: bigint, freshPoolCapWei: bigint, freshWallets: number): bigint {
  if (freshWallets <= 0) return 0n;
  const share = freshPoolCapWei / BigInt(freshWallets);
  return share < capWei ? share : capWei;
}

export type SimTier = "linked" | "fresh" | "aged";

export interface SimBuy {
  wallet: Address;
  tx: Hex;
  block: bigint;
  logIndex: number;
  ethIn: bigint;
  tokens: bigint;
}

export interface EntityOutcome {
  key: string;
  tier: SimTier;
  capWei: bigint;
  attemptedWei: bigint;
  landedWei: bigint;
  blockedWei: bigint;
  landedBuys: number;
  blockedBuys: number;
  unknownBuys: number;
  blockedTokens: bigint;
  blockedTxs: Hex[];
}

export function simulateKin(
  buys: SimBuy[],
  entityOf: (wallet: Address) => { key: string; tier: SimTier; capWei?: bigint },
  caps: KinCaps,
) {
  const ordered = [...buys].sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
  const out = new Map<string, EntityOutcome>();
  for (const b of ordered) {
    const { key, tier, capWei } = entityOf(b.wallet);
    let o = out.get(key);
    if (!o) {
      o = {
        key,
        tier,
        capWei: capWei ?? (tier === "fresh" ? caps.freshPoolCapWei : caps.capWei),
        attemptedWei: 0n,
        landedWei: 0n,
        blockedWei: 0n,
        landedBuys: 0,
        blockedBuys: 0,
        unknownBuys: 0,
        blockedTokens: 0n,
        blockedTxs: [],
      };
      out.set(key, o);
    }
    if (b.ethIn === 0n) {
      o.unknownBuys++;
      continue;
    }
    o.attemptedWei += b.ethIn;
    if (o.landedWei + b.ethIn <= o.capWei) {
      o.landedWei += b.ethIn;
      o.landedBuys++;
    } else {
      o.blockedWei += b.ethIn;
      o.blockedBuys++;
      o.blockedTokens += b.tokens;
      o.blockedTxs.push(b.tx);
    }
  }
  const entities = [...out.values()];
  const sum = (f: (o: EntityOutcome) => bigint) => entities.reduce((s, o) => s + f(o), 0n);
  return {
    entities,
    totals: {
      attemptedWei: sum((o) => o.attemptedWei),
      landedWei: sum((o) => o.landedWei),
      blockedWei: sum((o) => o.blockedWei),
      blockedTokens: sum((o) => o.blockedTokens),
      blockedBuys: entities.reduce((s, o) => s + o.blockedBuys, 0),
      unknownBuys: entities.reduce((s, o) => s + o.unknownBuys, 0),
    },
  };
}
