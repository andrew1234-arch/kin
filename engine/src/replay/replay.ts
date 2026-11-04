/**
 * Replay job: Kin Scan over a fixed sample of recent Base launches.
 *
 *   bun run src/replay/replay.ts replay/sample.json
 *
 * The sample file names how it was chosen and lists every token with where it came from. The output
 * (DATA_DIR/replay/replay-<time>.json, and latest.json) carries the method, the sample, every raw scan,
 * and aggregates computed only from those scans. Every headline number traces back to this file.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatEther, isAddress } from "viem";
import { scanOptionsFromEnv } from "../config";
import { historyFromEnv } from "../data/history";
import { Rpc } from "../data/rpc";
import { dataDir } from "../runtime";
import { sameMethod, scanToken, type ScanOptions, type ScanResult } from "../scan/scan";

export interface ReplaySample {
  chainId: number;
  selection: string; // how the sample was chosen, in words
  /** createdBlock (when known) lets each scan skip the deploy-block search. */
  tokens: { address: string; source: string; createdBlock?: string }[];
}

/** Read and validate a sample file; refuses an empty or unexplained sample. */
export function loadSample(path: string): ReplaySample {
  const sample = JSON.parse(readFileSync(path, "utf8")) as ReplaySample;
  if (!sample.selection || /NOT YET CHOSEN/.test(sample.selection)) throw new Error(`${path}: the sample has no selection method`);
  if (!Array.isArray(sample.tokens) || sample.tokens.length === 0) throw new Error(`${path}: the sample has no tokens`);
  for (const t of sample.tokens) {
    if (!isAddress(t.address)) throw new Error(`${path}: bad token address ${t.address}`);
    if (t.createdBlock !== undefined && !/^\d+$/.test(t.createdBlock)) throw new Error(`${path}: bad createdBlock for ${t.address}`);
  }
  return sample;
}

/** Scans from an earlier report (Gate A or replay) that were made with the same parameters. */
export function reusableScans(paths: string[], opts: ScanOptions, historyProvider: string): Map<string, ScanResult> {
  const out = new Map<string, ScanResult>();
  for (const p of paths) {
    const report = JSON.parse(readFileSync(p, "utf8")) as { results?: { scan?: ScanResult }[]; scans?: ScanResult[] };
    const scans = [...(report.results ?? []).map((r) => r.scan), ...(report.scans ?? [])].filter(Boolean) as ScanResult[];
    for (const sc of scans) if (sameMethod(sc, opts, historyProvider)) out.set(sc.token.toLowerCase(), sc);
  }
  return out;
}

export function aggregate(scans: ScanResult[]) {
  const withClusters = scans.filter((s) => s.summary.multiWalletEntities > 0);
  const shares = scans
    .map((s) => s.summary.multiWalletShareOfEarlyBps)
    .filter((x): x is number => x !== null)
    .sort((a, b) => a - b);
  const sumWei = (f: (s: ScanResult) => string) => scans.reduce((t, s) => t + BigInt(f(s)), 0n);
  const attempted = sumWei((s) => s.summary.kin.attemptedWei);
  const blocked = sumWei((s) => s.summary.kin.blockedWei);
  return {
    launchesScanned: scans.length,
    launchesWithMultiWalletEntity: withClusters.length,
    launchesWithMultiWalletEntityPct: scans.length ? Math.round((withClusters.length / scans.length) * 1000) / 10 : null,
    earlyBuyersTotal: scans.reduce((t, s) => t + s.summary.earlyBuyers, 0),
    walletsInMultiWalletEntitiesTotal: scans.reduce((t, s) => t + s.summary.walletsInMultiWalletEntities, 0),
    medianMultiWalletShareOfEarlyBps: shares.length ? shares[Math.floor(shares.length / 2)]! : null,
    kinCounterfactual: {
      attemptedEth: formatEther(attempted),
      blockedEth: formatEther(blocked),
      blockedPct: attempted > 0n ? Number((blocked * 1000n) / attempted) / 10 : null,
      unknownBuys: scans.reduce((t, s) => t + s.summary.kin.unknownBuys, 0),
    },
    examples: [...withClusters]
      .sort((a, b) => (b.summary.multiWalletShareOfEarlyBps ?? 0) - (a.summary.multiWalletShareOfEarlyBps ?? 0))
      .slice(0, 3)
      .map((s) => ({
        token: s.token,
        symbol: s.symbol,
        multiWalletShareOfEarlyBps: s.summary.multiWalletShareOfEarlyBps,
        largestEntityWallets: Math.max(...s.entities.map((e) => e.members.length)),
      })),
  };
}

/** "<sample.json> [--reuse report.json ...] [--out report.json]" */
function parseCli(argv: string[]) {
  let out: string | undefined;
  const reuse: string[] = [];
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out = argv[++i];
    else if (argv[i] === "--reuse") reuse.push(argv[++i]!);
    else pos.push(argv[i]!);
  }
  if (!pos[0] || (argv.includes("--out") && !out) || reuse.some((r) => !r)) {
    throw new Error("usage: replay.ts <sample.json> [--reuse <earlier report.json>]... [--out <report.json>]");
  }
  return { samplePath: pos[0], out, reuse };
}

if (import.meta.main) {
  const cli = parseCli(process.argv.slice(2));
  const sample = loadSample(cli.samplePath);
  const opts = scanOptionsFromEnv();
  const providerName = historyFromEnv(Rpc.fromEnv()).name;
  const reused = reusableScans(cli.reuse, opts, providerName);
  const scans: ScanResult[] = [];
  const failures: { token: string; error: string }[] = [];
  let reusedCount = 0;
  for (const t of sample.tokens) {
    const prior = reused.get(t.address.toLowerCase());
    if (prior) {
      scans.push(prior);
      reusedCount++;
      console.log(`${prior.token} ${prior.symbol ?? ""} reused (same parameters)`);
      continue;
    }
    const rpc = Rpc.fromEnv();
    try {
      const hint = t.createdBlock ? { deployBlock: BigInt(t.createdBlock) } : {};
      const s = await scanToken(rpc, historyFromEnv(rpc), t.address, opts, hint);
      scans.push(s);
      console.log(`${s.token} ${s.symbol ?? ""} buyers=${s.summary.earlyBuyers} entities=${s.summary.multiWalletEntities}`);
    } catch (e) {
      failures.push({ token: t.address, error: (e as Error).message });
      console.error(`${t.address} failed: ${(e as Error).message}`);
    }
  }
  const ranAt = new Date().toISOString();
  const report = {
    schema: "kin-replay/1",
    ranAt,
    sample,
    method: scans[0]?.method ?? null,
    reusedScans: reusedCount,
    aggregates: aggregate(scans),
    failures,
    scans,
  };
  const dir = join(dataDir(), "replay");
  mkdirSync(dir, { recursive: true });
  const file = cli.out ?? join(dir, `replay-${ranAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  writeFileSync(join(dir, "latest.json"), JSON.stringify(report));
  console.log(`wrote ${file} (${scans.length} scanned, ${reusedCount} reused, ${failures.length} failed)`);
  if (scans.length === 0) process.exit(1);
}
