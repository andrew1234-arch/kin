import { decodeFunctionResult, encodeFunctionData, erc20Abi, getAddress, type Address, type Hex } from "viem";
import { clusterByFunding } from "../cluster/cluster";
import { traceFunding } from "../cluster/funding";
import type { HistoryProvider } from "../data/history";
import { hex, Rpc } from "../data/rpc";
import type { Link } from "../types";
import { simulateKin, type KinCaps, type SimTier } from "./counterfactual";
import { findDeployBlock, findEarlyBuyers, measureBlockTime, type EarlyBuyer } from "./earlyBuyers";

export interface ScanOptions {
  earlyBuyers: number;
  fundingWindowHours: number;
  logsChunk: bigint;
  maxScanBlocks: bigint;
  maxHops: 1 | 2;
  /** A wallet whose nonce before its first buy is <= this counts as fresh. */
  freshMaxNonce: number;
  caps: KinCaps;
  excluded: Set<string>;
  exclusionsSource: Record<string, unknown>;
}

export const DEFAULT_SCAN_OPTIONS = {
  earlyBuyers: 50,
  fundingWindowHours: 72,
  logsChunk: 2000n,
  maxScanBlocks: 43_200n,
  maxHops: 2 as const,
  freshMaxNonce: 0,
};

/** JSON-safe scan result (wei and token amounts are decimal strings). */
export interface ScanResult {
  schema: "kin-scan/1";
  chainId: number;
  token: Address;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
  deployBlock: string;
  latestBlock: string;
  scannedAt: string;
  method: Record<string, unknown>;
  buyers: {
    wallet: Address;
    firstBuyBlock: string;
    firstBuyTx: Hex;
    firstBuyTimestamp: number;
    nonceBeforeFirstBuy: number;
    tier: SimTier;
    entity: string;
    tokens: string;
    ethSpentWei: string;
    buys: number;
  }[];
  entities: {
    id: string;
    tier: SimTier;
    members: Address[];
    funders: Address[];
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
      blockedTxs: Hex[];
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
  cost: { elapsedMs: number; calls: Record<string, number>; totalCalls: number };
}

export async function scanToken(
  rpc: Rpc,
  history: HistoryProvider,
  tokenIn: string,
  opts: ScanOptions,
): Promise<ScanResult> {
  const token = getAddress(tokenIn);
  const t0 = performance.now();
  const [chainIdHex, latestHex] = await Promise.all([
    rpc.call<Hex>("eth_chainId", []),
    rpc.call<Hex>("eth_blockNumber", []),
  ]);
  const latest = BigInt(latestHex);
  const meta = await tokenMeta(rpc, token);
  const blockTime = await measureBlockTime(rpc, latest);
  const windowBlocks = blockTime > 0 ? BigInt(Math.ceil((opts.fundingWindowHours * 3600) / blockTime)) : latest;
  const floor0 = (b: bigint) => (b < 0n ? 0n : b);

  const deployBlock = await findDeployBlock(rpc, token, latest);
  const buyers = await findEarlyBuyers(rpc, token, deployBlock, {
    maxBuyers: opts.earlyBuyers,
    chunk: opts.logsChunk,
    maxBlocks: opts.maxScanBlocks,
    latest,
  });

  // Freshness: the wallet's nonce just before its first buy.
  const nonces = await Promise.all(
    buyers.map((b) =>
      rpc.call<Hex>("eth_getTransactionCount", [b.wallet, hex(floor0(b.firstBuyBlock - 1n))]).then((n) => Number(BigInt(n))),
    ),
  );

  // Funding: hop 1 (who funded each buyer before its first buy), hop 2 (who funded those funders).
  const { edges, lastFundedAt: fundedAt } = await traceFunding(
    history,
    buyers.map((b) => ({ wallet: b.wallet, beforeBlock: b.firstBuyBlock })),
    { windowBlocks, excluded: opts.excluded, maxHops: opts.maxHops },
  );

  const clusters = clusterByFunding(
    buyers.map((b) => b.wallet),
    edges,
    { maxHops: opts.maxHops, excluded: opts.excluded },
  );

  // Entity assignment, mirroring the allowlist tiers: linked > fresh pool > aged.
  const entityOf = new Map<string, { key: string; tier: SimTier }>();
  clusters.forEach((c, i) => c.members.forEach((m) => entityOf.set(m.toLowerCase(), { key: `E${i + 1}`, tier: "linked" })));
  buyers.forEach((b, i) => {
    const k = b.wallet.toLowerCase();
    if (entityOf.has(k)) return;
    entityOf.set(k, nonces[i]! <= opts.freshMaxNonce ? { key: "FRESH", tier: "fresh" } : { key: `W:${k}`, tier: "aged" });
  });
  const sim = simulateKin(
    buyers.flatMap((b) => b.buys.map((x) => ({ wallet: b.wallet, tx: x.tx, block: x.block, logIndex: x.logIndex, ethIn: x.ethIn, tokens: x.tokens }))),
    (w) => entityOf.get(w.toLowerCase())!,
    opts.caps,
  );
  const outcome = new Map(sim.entities.map((o) => [o.key, o]));

  const totalEarly = buyers.reduce((s, b) => s + b.received, 0n);
  const supply = meta.totalSupply;
  const bps = (x: bigint, of: bigint | null) => (of && of > 0n ? Number((x * 10_000n) / of) : null);
  const byWallet = new Map(buyers.map((b) => [b.wallet.toLowerCase(), b]));

  const entities: ScanResult["entities"] = clusters.map((c, i) => {
    const key = `E${i + 1}`;
    const members = c.members.map((m) => byWallet.get(m.toLowerCase())!).filter(Boolean) as EarlyBuyer[];
    const tokens = members.reduce((s, b) => s + b.received, 0n);
    const blocks = new Map<string, number>();
    members.forEach((b) => blocks.set(b.firstBuyBlock.toString(), (blocks.get(b.firstBuyBlock.toString()) ?? 0) + 1));
    const sameBlockBuyers = [...blocks.values()].filter((n) => n > 1).reduce((s, n) => s + n, 0);
    const gaps = members
      .map((b) => {
        const f = fundedAt.get(b.wallet.toLowerCase());
        return f === undefined ? null : b.firstBuyTimestamp - f;
      })
      .filter((x): x is number => x !== null)
      .sort((a, b) => a - b);
    const o = outcome.get(key);
    return {
      id: key,
      tier: "linked" as const,
      members: c.members,
      funders: [...new Set(c.links.map((l) => l.via))],
      links: c.links,
      tokens: tokens.toString(),
      shareOfEarlyBps: bps(tokens, totalEarly) ?? 0,
      shareOfSupplyBps: bps(tokens, supply),
      sameBlockBuyers,
      medianFundToBuySeconds: gaps.length ? gaps[Math.floor(gaps.length / 2)]! : null,
      kin: outcomeJson(o, opts.caps.capWei),
    };
  });

  const linkedTokens = entities.reduce((s, e) => s + BigInt(e.tokens), 0n);
  return {
    schema: "kin-scan/1",
    chainId: Number(BigInt(chainIdHex)),
    token,
    ...meta,
    totalSupply: meta.totalSupply?.toString() ?? null,
    deployBlock: deployBlock.toString(),
    latestBlock: latest.toString(),
    scannedAt: new Date().toISOString(),
    method: {
      earlyBuyerRule: "Transfer to the transaction sender, excluding the token's creation transaction(s)",
      earlyBuyers: opts.earlyBuyers,
      fundingWindowHours: opts.fundingWindowHours,
      measuredBlockTimeSec: blockTime,
      maxHops: opts.maxHops,
      linkRule: "shared native-ETH funder within maxHops before the first buy; excluded addresses never link",
      freshRule: `nonce before first buy <= ${opts.freshMaxNonce}`,
      caps: { capWei: opts.caps.capWei.toString(), freshPoolCapWei: opts.caps.freshPoolCapWei.toString() },
      counterfactualRule: "replay buys in chain order; a buy lands if its entity's cumulative ETH stays within the cap",
      exclusions: opts.exclusionsSource,
      historyProvider: history.name,
    },
    buyers: buyers.map((b, i) => {
      const e = entityOf.get(b.wallet.toLowerCase())!;
      return {
        wallet: b.wallet,
        firstBuyBlock: b.firstBuyBlock.toString(),
        firstBuyTx: b.firstBuyTx,
        firstBuyTimestamp: b.firstBuyTimestamp,
        nonceBeforeFirstBuy: nonces[i]!,
        tier: e.tier,
        entity: e.key,
        tokens: b.received.toString(),
        ethSpentWei: b.buys.reduce((s, x) => s + x.ethIn, 0n).toString(),
        buys: b.buys.length,
      };
    }),
    entities,
    summary: {
      earlyBuyers: buyers.length,
      multiWalletEntities: entities.length,
      walletsInMultiWalletEntities: entities.reduce((s, e) => s + e.members.length, 0),
      multiWalletShareOfEarlyBps: bps(linkedTokens, totalEarly),
      multiWalletShareOfSupplyBps: bps(linkedTokens, supply),
      freshWallets: [...entityOf.values()].filter((e) => e.tier === "fresh").length,
      kin: {
        attemptedWei: sim.totals.attemptedWei.toString(),
        landedWei: sim.totals.landedWei.toString(),
        blockedWei: sim.totals.blockedWei.toString(),
        blockedBuys: sim.totals.blockedBuys,
        unknownBuys: sim.totals.unknownBuys,
      },
    },
    cost: {
      elapsedMs: Math.round(performance.now() - t0),
      calls: Object.fromEntries([...rpc.calls, ...(history.calls() === rpc.calls ? [] : history.calls())]),
      totalCalls: rpc.totalCalls() + (history.calls() === rpc.calls ? 0 : [...history.calls().values()].reduce((a, b) => a + b, 0)),
    },
  };
}

function outcomeJson(o: ReturnType<typeof simulateKin>["entities"][number] | undefined, capWei: bigint) {
  return {
    capWei: (o?.capWei ?? capWei).toString(),
    attemptedWei: (o?.attemptedWei ?? 0n).toString(),
    landedWei: (o?.landedWei ?? 0n).toString(),
    blockedWei: (o?.blockedWei ?? 0n).toString(),
    landedBuys: o?.landedBuys ?? 0,
    blockedBuys: o?.blockedBuys ?? 0,
    unknownBuys: o?.unknownBuys ?? 0,
    blockedTxs: o?.blockedTxs ?? [],
  };
}

async function tokenMeta(rpc: Rpc, token: Address) {
  const read = async <T>(fn: "name" | "symbol" | "decimals" | "totalSupply"): Promise<T | null> => {
    try {
      const data = await rpc.call<Hex>("eth_call", [{ to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: fn }) }, "latest"]);
      return decodeFunctionResult({ abi: erc20Abi, functionName: fn, data }) as T;
    } catch {
      return null;
    }
  };
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    read<string>("name"),
    read<string>("symbol"),
    read<number>("decimals"),
    read<bigint>("totalSupply"),
  ]);
  return { name, symbol, decimals, totalSupply };
}
