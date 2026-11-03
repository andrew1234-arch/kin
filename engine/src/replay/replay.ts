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
import { formatEther } from "viem";
import { scanOptionsFromEnv } from "../config";
import { historyFromEnv } from "../data/history";
import { Rpc } from "../data/rpc";
import { dataDir } from "../runtime";
import { scanToken, type ScanResult } from "../scan/scan";

export interface ReplaySample {
  chainId: number;
  selection: string; // how the sample was chosen, in words
  tokens: { address: string; source: string }[];
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

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) throw new Error("usage: replay.ts <sample.json>");
  const sample = JSON.parse(readFileSync(path, "utf8")) as ReplaySample;
  if (!sample.selection || sample.tokens.length === 0) throw new Error("sample needs a selection method and tokens");
  const opts = scanOptionsFromEnv();
  const scans: ScanResult[] = [];
  const failures: { token: string; error: string }[] = [];
  for (const t of sample.tokens) {
    const rpc = Rpc.fromEnv();
    try {
      const s = await scanToken(rpc, historyFromEnv(rpc), t.address, opts);
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
    aggregates: aggregate(scans),
    failures,
    scans,
  };
  const dir = join(dataDir(), "replay");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `replay-${ranAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  writeFileSync(join(dir, "latest.json"), JSON.stringify(report));
  console.log(`wrote ${file}`);
}
