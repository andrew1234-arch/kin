// Shapes returned by the Kin engine API (engine/src). Kept in sync by hand.
export interface Link {
  a: string;
  b: string;
  /** Evidence type from the weighted cluster engine (Nuno port). A pair merges at weight 1.0. */
  reason: "direct_funding" | "same_direct_funder" | "common_funding_source" | "same_block_early_buy";
  weight: number;
  /** Shared funder or ancestor (funding reasons only). */
  via?: string;
  hops: [number, number];
  /** Block of a same-block early buy. */
  block?: string;
  txHashes: string[];
}

export interface ScanResult {
  schema: "kin-scan/1";
  chainId: number;
  token: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
  deployBlock: string;
  latestBlock: string;
  scannedAt: string;
  method: Record<string, unknown> & {
    earlyBuyers: number;
    fundingWindowHours: number;
    maxHops: number;
    caps: { capWei: string; freshPoolCapWei: string };
  };
  buyers: {
    wallet: string;
    firstBuyBlock: string;
    firstBuyTx: string;
    firstBuyTimestamp: number;
    nonceBeforeFirstBuy: number;
    tier: "linked" | "fresh" | "aged";
    entity: string;
    tokens: string;
    ethSpentWei: string;
    buys: number;
  }[];
  entities: {
    id: string;
    tier: "linked";
    members: string[];
    funders: string[];
    links: Link[];
    tokens: string;
    shareOfEarlyBps: number;
    shareOfSupplyBps: number | null;
    sameBlockBuyers: number;
    medianFundToBuySeconds: number | null;
    kin: {
      capWei: string;
      attemptedWei: string;
      landedWei: string;
      blockedWei: string;
      landedBuys: number;
      blockedBuys: number;
      unknownBuys: number;
      blockedTxs: string[];
    };
  }[];
  summary: {
    earlyBuyers: number;
    multiWalletEntities: number;
    walletsInMultiWalletEntities: number;
    multiWalletShareOfEarlyBps: number | null;
    multiWalletShareOfSupplyBps: number | null;
    freshWallets: number;
    kin: { attemptedWei: string; landedWei: string; blockedWei: string; blockedBuys: number; unknownBuys: number };
  };
  cost: { elapsedMs: number; totalCalls: number };
}

export type SandboxEvent =
  | { type: "step"; step: string; detail: string; txs?: string[] }
  | { type: "attempt"; pool: "kin" | "plain"; index: number; wallet: string; tx: string; status: "pending" | "landed" | "rejected" }
  | { type: "result"; result: SandboxResult }
  | { type: "error"; message: string };

export interface SandboxResult {
  chainId: number;
  explorerUrl: string | null;
  bundleSize: number;
  perWalletWei: string;
  entityCapWei: string;
  expectedKinMax: number;
  kin: { landed: number; rejected: number; poolId: string; token: string; launchTx: string; rejectReason: string | null };
  plain: { landed: number; rejected: number; poolId: string; token: string; launchTx: string };
  funder: string;
  fundingTxs: string[];
  root: string;
  evidenceHash: string;
  entitySpentWei: string;
  vaultedTokens: string;
  elapsedMs: number;
}

export interface SandboxRun {
  id: string;
  status: "running" | "done" | "failed";
  startedAt: number;
  events: SandboxEvent[];
  result: SandboxResult | null;
  error: string | null;
}

export interface AllowlistStats {
  allowlistedWallets: number;
  entities: number;
  linkedWallets: number;
  freshWallets: number;
}

export interface LaunchView {
  slug: string;
  chainId: number;
  name: string;
  symbol: string;
  createdAt: number;
  registrationClosesAt: number;
  tiers: { capWei: string; freshPoolCapWei: string; verifiedCapWei: string; freshMaxNonce: number };
  window: { delayAfterBuildSec: number; lengthSec: number; lockSec: number };
  registrations: number;
  verifiedWallets?: number;
  /** Whether the engine has Base Verify enabled (the verified-human tier). */
  baseVerify?: boolean;
  disputes: { id: string; wallet: string; reason: string; at: number; status: string; resolution: string | null }[];
  allowlist: null | { version: number; root: string; evidenceHash: string; stats: AllowlistStats; builtAt: number; snapshotBlock: string };
  onchain: null | {
    poolId: `0x${string}`;
    key: { currency0: `0x${string}`; currency1: `0x${string}`; fee: number; tickSpacing: number; hooks: `0x${string}` };
    token: string;
    launchTx: string;
    windowStart: number;
    windowEnd: number;
    lockDuration: number;
    rootVersion: number;
  };
}

export interface AllowlistEntry {
  wallet: string;
  entityId: string;
  tier: "linked" | "fresh" | "aged" | "verified";
  cap: string;
  proof: string[];
}

export interface WalletStatus {
  wallet: string;
  registered: boolean;
  registeredAt: number | null;
  verified?: boolean;
  entry: AllowlistEntry | null;
  entityMembers: number | null;
  disputes: { id: string; reason: string; status: string; resolution: string | null }[];
}

export type Phase = "registration" | "building" | "dispute" | "window" | "locked" | "claimable";

export function phaseOf(l: LaunchView, now: number): Phase {
  if (!l.onchain) return now < l.registrationClosesAt && !l.allowlist ? "registration" : "building";
  if (now < l.onchain.windowStart) return "dispute";
  if (now < l.onchain.windowEnd) return "window";
  if (now < l.onchain.windowEnd + l.onchain.lockDuration) return "locked";
  return "claimable";
}
