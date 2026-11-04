/**
 * GATE A — indexing cost and speed test.
 *
 * Runs the full Kin Scan pipeline (deploy block → early buyers → hop-1/hop-2 funding → clusters →
 * counterfactual) on each token and records wall time and request counts per method. It never uses a
 * deploy-block hint, so the numbers are what a user's /scan/:token really costs. Cost is computed only if
 * a pricing file is supplied (GATE_A_PRICING) and that file names its source. A token that fails is
 * recorded with its error and the others still run.
 *
 *   bun run src/gates/gateA.ts <token>... [--out report.json]
 *   bun run src/gates/gateA.ts --sample replay/sample.json [--count 3] [--out report.json]
 *
 * Exit codes: 0 at least one token scanned; 1 none scanned (report written); 2 configuration or usage
 * error; 3 unexpected error (nothing written for 2 and 3).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isAddress } from "viem";
import { scanOptionsFromEnv } from "../config";
import { Rpc } from "../data/rpc";
import { envStr } from "../env";
import { assertChain, ConfigError, flagValue, loadSample, prepareOutput, scanSampleToken, type SampleToken } from "../replay/sample";

export function parseCli(argv: string[]) {
  let out: string | undefined;
  let samplePath: string | undefined;
  let count = 3;
  const tokens: SampleToken[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--out") out = flagValue(argv, i++, a);
    else if (a === "--sample") samplePath = flagValue(argv, i++, a);
    else if (a === "--count") {
      const v = flagValue(argv, i++, a);
      if (!/^\d+$/.test(v) || Number(v) < 1) throw new ConfigError("--count must be a positive integer");
      count = Number(v);
    } else if (isAddress(a)) tokens.push({ address: a, source: "command line" });
    else throw new ConfigError(`not a token address or option: ${a}`);
  }
  let chainId: number | null = null;
  if (samplePath) {
    const sample = loadSample(samplePath);
    chainId = sample.chainId;
    tokens.push(...sample.tokens.slice(0, count));
  }
  if (tokens.length === 0) {
    throw new ConfigError("usage: gateA.ts <token>... | --sample <sample.json> [--count 3]  [--out report.json]");
  }
  return { out, tokens, chainId };
}

function loadPricing() {
  const path = envStr("GATE_A_PRICING");
  if (!path) return null;
  let pricing: { source?: string; perCallUsd?: Record<string, number> };
  try {
    pricing = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new ConfigError(`GATE_A_PRICING ${path}: ${(e as Error).message}`);
  }
  if (!pricing.source || !pricing.perCallUsd) throw new ConfigError("GATE_A_PRICING must have `source` and `perCallUsd`");
  return pricing as { source: string; perCallUsd: Record<string, number> };
}

async function main(): Promise<number> {
  const cli = parseCli(process.argv.slice(2));
  const pricing = loadPricing();
  const opts = scanOptionsFromEnv();
  if (cli.chainId !== null) await assertChain(Rpc.fromEnv(), cli.chainId);
  const ranAt = new Date().toISOString();
  const file = cli.out ?? join(import.meta.dir, "../../out", `gate-a-${ranAt.replace(/[:.]/g, "-")}.json`);
  prepareOutput(file);

  const results = [];
  const failures: { token: string; error: string }[] = [];
  for (const t of cli.tokens) {
    try {
      const scan = await scanSampleToken(t, opts, false);
      let costUsd: number | null = null;
      if (pricing) {
        costUsd = 0;
        for (const [m, n] of Object.entries(scan.cost.calls)) costUsd += n * (pricing.perCallUsd[m] ?? 0);
      }
      console.log(
        `${scan.token} ${scan.symbol ?? ""}  buyers=${scan.summary.earlyBuyers} entities=${scan.summary.multiWalletEntities} ` +
          `linked=${scan.summary.walletsInMultiWalletEntities} time=${(scan.cost.elapsedMs / 1000).toFixed(1)}s ` +
          `calls=${scan.cost.totalCalls}` +
          (costUsd === null ? " cost=(no pricing file)" : ` cost=$${costUsd.toFixed(4)}`),
      );
      results.push({ token: scan.token, elapsedMs: scan.cost.elapsedMs, calls: scan.cost.calls, totalCalls: scan.cost.totalCalls, costUsd, scan });
    } catch (e) {
      failures.push({ token: t.address, error: (e as Error).message });
      console.error(`${t.address} FAILED: ${(e as Error).message}`);
    }
  }
  writeFileSync(file, JSON.stringify({ gate: "A", ranAt, pricingSource: pricing?.source ?? null, results, failures }, null, 2));
  console.log(`wrote ${file} (${results.length} scanned, ${failures.length} failed)`);
  return results.length > 0 ? 0 : 1;
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
