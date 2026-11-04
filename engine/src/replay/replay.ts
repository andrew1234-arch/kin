/**
 * Replay job: Kin Scan over a fixed sample of recent Base launches.
 *
 *   bun run src/replay/replay.ts <sample.json> [--reuse <earlier report.json>]... [--out <report.json>] [--publish]
 *
 * The sample file names how it was chosen and lists every token with where it came from. The report carries
 * the method, the sample, every raw scan, and aggregates computed only from those scans. `--publish` also
 * writes DATA_DIR/replay/latest.json, which the public /replay page serves; that file is only ever replaced
 * by a run that scanned at least one token.
 *
 * Exit codes: 0 report written; 1 no token could be scanned (report written, nothing published);
 * 2 configuration or usage error, 3 unexpected error (e.g. RPC down before scanning); nothing written for 2 and 3.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatEther } from "viem";
import { scanOptionsFromEnv } from "../config";
import { historyFromEnv } from "../data/history";
import { Rpc } from "../data/rpc";
import { dataDir } from "../paths";
import { sameMethod, type ScanOptions, type ScanResult } from "../scan/scan";
import { assertChain, ConfigError, flagValue, loadSample, prepareOutput, scanSampleToken } from "./sample";

export type { ReplaySample } from "./sample";
export { loadSample } from "./sample";

/** Scans from earlier reports (Gate A or replay) made on the same chain with exactly these parameters. */
export function reusableScans(
  paths: string[],
  opts: ScanOptions,
  historyProvider: string,
  chainId: number,
): Map<string, ScanResult> {
  const out = new Map<string, ScanResult>();
  for (const p of paths) {
    let report: { results?: { scan?: ScanResult }[]; scans?: ScanResult[] };
    try {
      report = JSON.parse(readFileSync(p, "utf8"));
    } catch (e) {
      throw new ConfigError(`--reuse ${p}: ${(e as Error).message}`);
    }
    const scans = [...(report.results ?? []).map((r) => r.scan), ...(report.scans ?? [])].filter(Boolean) as ScanResult[];
    for (const sc of scans) {
      if (sc.chainId === chainId && sameMethod(sc, opts, historyProvider)) out.set(sc.token.toLowerCase(), sc);
    }
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

export function parseCli(argv: string[]) {
  let out: string | undefined;
  let publish = false;
  const reuse: string[] = [];
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--out") out = flagValue(argv, i++, a);
    else if (a === "--reuse") reuse.push(flagValue(argv, i++, a));
    else if (a === "--publish") publish = true;
    else if (a.startsWith("--")) throw new ConfigError(`unknown option ${a}`);
    else pos.push(a);
  }
  if (pos.length !== 1) {
    throw new ConfigError("usage: replay.ts <sample.json> [--reuse <report.json>]... [--out <report.json>] [--publish]");
  }
  return { samplePath: pos[0]!, out, reuse, publish };
}

async function main(): Promise<number> {
  const cli = parseCli(process.argv.slice(2));
  const sample = loadSample(cli.samplePath);
  const opts = scanOptionsFromEnv();
  const probeRpc = Rpc.fromEnv();
  await assertChain(probeRpc, sample.chainId);
  const providerName = historyFromEnv(probeRpc).name;
  const reused = reusableScans(cli.reuse, opts, providerName, sample.chainId);
  const ranAt = new Date().toISOString();
  const dir = join(dataDir(), "replay");
  const file = cli.out ?? join(dir, `replay-${ranAt.replace(/[:.]/g, "-")}.json`);
  prepareOutput(file);
  if (cli.publish) prepareOutput(join(dir, "latest.json"));

  const scans: ScanResult[] = [];
  const failures: { token: string; error: string }[] = [];
  let reusedCount = 0;
  for (const t of sample.tokens) {
    const prior = reused.get(t.address.toLowerCase());
    if (prior) {
      scans.push(prior);
      reusedCount++;
      console.log(`${prior.token} ${prior.symbol ?? ""} reused (same chain and parameters)`);
      continue;
    }
    try {
      const s = await scanSampleToken(t, opts, true);
      scans.push(s);
      console.log(`${s.token} ${s.symbol ?? ""} buyers=${s.summary.earlyBuyers} entities=${s.summary.multiWalletEntities}`);
    } catch (e) {
      failures.push({ token: t.address, error: (e as Error).message });
      console.error(`${t.address} failed: ${(e as Error).message}`);
    }
  }
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
  writeFileSync(file, JSON.stringify(report, null, 2));
  const published = cli.publish && scans.length > 0;
  if (published) writeFileSync(join(dir, "latest.json"), JSON.stringify(report));
  console.log(
    `wrote ${file} (${scans.length} scanned, ${reusedCount} reused, ${failures.length} failed)` +
      (cli.publish ? (published ? "; published as latest.json" : "; NOT published: nothing was scanned") : ""),
  );
  return scans.length > 0 ? 0 : 1;
}

if (import.meta.main) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof ConfigError ? `configuration error: ${e.message}` : e);
      process.exit(e instanceof ConfigError ? 2 : 3);
    },
  );
}
