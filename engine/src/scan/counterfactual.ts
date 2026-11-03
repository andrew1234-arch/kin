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
  /** One shared cap for all fresh, unlinked wallets together (wei). */
  freshPoolCapWei: bigint;
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
  entityOf: (wallet: Address) => { key: string; tier: SimTier },
  caps: KinCaps,
) {
  const ordered = [...buys].sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
  const out = new Map<string, EntityOutcome>();
  for (const b of ordered) {
    const { key, tier } = entityOf(b.wallet);
    let o = out.get(key);
    if (!o) {
      o = {
        key,
        tier,
        capWei: tier === "fresh" ? caps.freshPoolCapWei : caps.capWei,
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
