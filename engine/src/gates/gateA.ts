/**
 * GATE A — indexing cost and speed test.
 *
 * For each token: find its deploy block, collect the first N buyers, trace each buyer's native-ETH
 * funding (hop 1) and its funders' funding (hop 2) in a window before the buy, cluster, and record
 * wall time and request counts per method. Cost is computed only if a pricing file is supplied
 * (GATE_A_PRICING), and that file must name its source. Nothing is estimated from memory.
 *
 *   bun run src/gates/gateA.ts 0xTokenA 0xTokenB 0xTokenC
 *
 * Env: BASE_RPC_URL (archive), HISTORY_PROVIDER (alchemy|blockscout|rpc-scan[local only]), BLOCKSCOUT_API_URL,
 *      EXTRA_EXCLUSIONS (comma-separated),
 *      EARLY_BUYERS (50), FUNDING_WINDOW_HOURS (72), LOGS_CHUNK (2000), MAX_SCAN_BLOCKS (43200),
 *      GATE_A_PRICING (path to {"source": "...", "perCallUsd": {"method": usd}}).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress, type Address } from "viem";
import { clusterByFunding } from "../cluster/cluster";
import { loadExclusions } from "../data/exclusions";
import { historyFromEnv } from "../data/history";
import { Rpc } from "../data/rpc";
import { findDeployBlock, findEarlyBuyers, measureBlockTime } from "../scan/earlyBuyers";
import type { FundingEdge } from "../types";

const env = (k: string, d: string) => process.env[k] ?? d;

async function gateA(tokens: Address[]) {
  const exclusions = loadExclusions();
  // EXTRA_EXCLUSIONS: comma-separated addresses to treat like exchanges (recorded in the output).
  const extra = (process.env.EXTRA_EXCLUSIONS ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);
  extra.forEach((a) => exclusions.set.add(a));
  const pricing = process.env.GATE_A_PRICING
    ? (JSON.parse(readFileSync(process.env.GATE_A_PRICING, "utf8")) as { source: string; perCallUsd: Record<string, number> })
    : null;
  const params = {
    earlyBuyers: Number(env("EARLY_BUYERS", "50")),
    fundingWindowHours: Number(env("FUNDING_WINDOW_HOURS", "72")),
    logsChunk: BigInt(env("LOGS_CHUNK", "2000")),
    maxScanBlocks: BigInt(env("MAX_SCAN_BLOCKS", "43200")),
    maxHops: 2 as const,
    historyProvider: env("HISTORY_PROVIDER", "alchemy"),
    exclusions: { ...exclusions.list.source, count: exclusions.list.count, extra },
  };

  const results = [];
  for (const token of tokens) {
    const rpc = Rpc.fromEnv();
    const history = historyFromEnv(rpc);
    const t0 = performance.now();
    const latest = BigInt(await rpc.call<string>("eth_blockNumber", []));
    const blockTime = await measureBlockTime(rpc, latest);
    // A chain with no measurable block time (e.g. a fresh local anvil) gets a whole-chain window.
    const windowBlocks =
      blockTime > 0 ? BigInt(Math.ceil((params.fundingWindowHours * 3600) / blockTime)) : latest;
    const floor0 = (b: bigint) => (b < 0n ? 0n : b);

    const deployBlock = await findDeployBlock(rpc, token, latest);
    const tDeploy = performance.now();
    const buyers = await findEarlyBuyers(rpc, token, deployBlock, {
      maxBuyers: params.earlyBuyers,
      chunk: params.logsChunk,
      maxBlocks: params.maxScanBlocks,
      latest,
    });
    const tBuyers = performance.now();

    // Hop 1: who funded each buyer before its first buy.
    const edges: FundingEdge[] = [];
    const hop1 = await Promise.all(
      buyers.map((b) => history.incomingNative(b.wallet, floor0(b.firstBuyBlock - windowBlocks), b.firstBuyBlock, 10)),
    );
    const buyerSet = new Set(buyers.map((b) => b.wallet.toLowerCase()));
    const funderFirst = new Map<string, bigint>(); // funder -> earliest block it funded a buyer
    hop1.forEach((list) => {
      for (const t of list) {
        edges.push({ ...t, hop: 1 });
        const f = t.from.toLowerCase();
        if (exclusions.set.has(f) || buyerSet.has(f)) continue;
        const prev = funderFirst.get(f);
        if (prev === undefined || t.blockNumber < prev) funderFirst.set(f, t.blockNumber);
      }
    });
    // Hop 2: who funded those funders.
    const hop2 = await Promise.all(
      [...funderFirst].map(([f, bn]) => history.incomingNative(getAddress(f), floor0(bn - windowBlocks), bn, 10)),
    );
    hop2.forEach((list) => list.forEach((t) => edges.push({ ...t, hop: 2 })));
    const tFunding = performance.now();

    const clusters = clusterByFunding(
      buyers.map((b) => b.wallet),
      edges,
      { maxHops: params.maxHops, excluded: exclusions.set },
    );
    const received = new Map(buyers.map((b) => [b.wallet.toLowerCase(), b.received]));
    const totalEarly = buyers.reduce((s, b) => s + b.received, 0n);
    const clustered = clusters.reduce(
      (s, c) => s + c.members.reduce((x, m) => x + (received.get(m.toLowerCase()) ?? 0n), 0n),
      0n,
    );

    const calls = Object.fromEntries([...rpc.calls, ...(history.name === "alchemy" ? [] : history.calls())]);
    const totalCalls = Object.values(calls).reduce((a, b) => a + b, 0);
    let costUsd: number | null = null;
    if (pricing) {
      costUsd = 0;
      for (const [m, n] of Object.entries(calls)) costUsd += n * (pricing.perCallUsd[m] ?? 0);
    }

    const r = {
      token,
      latestBlock: latest.toString(),
      measuredBlockTimeSec: blockTime,
      deployBlock: deployBlock.toString(),
      earlyBuyers: buyers.length,
      fundingEdges: edges.length,
      clusters: clusters.length,
      walletsInMultiWalletEntities: clusters.reduce((s, c) => s + c.members.length, 0),
      multiWalletEntityShareOfEarlyBuysBps: totalEarly > 0n ? Number((clustered * 10_000n) / totalEarly) : null,
      timingMs: {
        deployBlock: Math.round(tDeploy - t0),
        earlyBuyers: Math.round(tBuyers - tDeploy),
        funding: Math.round(tFunding - tBuyers),
        total: Math.round(performance.now() - t0),
      },
      calls,
      totalCalls,
      costUsd,
      clusterDetail: clusters,
    };
    console.log(
      `${token}  buyers=${r.earlyBuyers} clusters=${r.clusters} linked=${r.walletsInMultiWalletEntities} ` +
        `time=${(r.timingMs.total / 1000).toFixed(1)}s calls=${totalCalls}` +
        (costUsd === null ? " cost=(no pricing file)" : ` cost=$${costUsd.toFixed(4)}`),
    );
    results.push(r);
  }

  const out = {
    gate: "A",
    ranAt: new Date().toISOString(),
    params,
    pricingSource: pricing?.source ?? null,
    results,
  };
  const dir = join(import.meta.dir, "../../out");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `gate-a-${out.ranAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  console.log(`wrote ${file}`);
}

const tokens = process.argv.slice(2).map((t) => getAddress(t));
if (tokens.length === 0) {
  console.error("usage: bun run src/gates/gateA.ts <token> [<token> ...]");
  process.exit(1);
}
await gateA(tokens);
