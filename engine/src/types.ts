import type { Address, Hex } from "viem";

/** A wallet → funder edge: `from` sent value to `to` in `txHash`. */
export interface FundingEdge {
  from: Address;
  to: Address;
  txHash: Hex;
  blockNumber: bigint;
  timestamp: number; // unix seconds
  /** Value in wei for native ETH, or token base units when `asset` is set. */
  value: bigint;
  /** undefined = native ETH; otherwise the ERC-20 contract. */
  asset?: Address;
  /** 1 = funder of a registered/early wallet; 2 = funder of a hop-1 funder. */
  hop: 1 | 2;
}

/** Per-wallet facts the tiering step needs. */
export interface WalletProfile {
  wallet: Address;
  /** Outgoing transaction count (nonce) at the snapshot block. */
  nonce: number;
  /** Unix seconds of the first funding seen, if known. */
  firstFundedAt?: number;
  /** Base Verify (onchain variant, Base Sepolia only) — set by the verify step. */
  verified?: boolean;
}

export type Tier = "linked" | "fresh" | "aged" | "verified";

/** One link between two wallets, with the transactions that prove it. */
export interface Link {
  a: Address;
  b: Address;
  reason: "shared-funder";
  /** The shared funder address. */
  via: Address;
  /** Hops from each wallet to the shared funder. */
  hops: [number, number];
  /** Every transaction on both paths (a ← … ← via → … → b). */
  txHashes: Hex[];
}

export interface Entity {
  entityId: Hex;
  tier: Tier;
  members: Address[];
  links: Link[];
}

export interface Cluster {
  members: Address[];
  links: Link[];
}
