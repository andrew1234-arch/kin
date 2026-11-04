/**
 * GATE A — indexing cost and speed test.
 *
 * Runs the full Kin Scan pipeline (deploy block → early buyers → hop-1/hop-2 funding → clusters →
 * counterfactual) on each token and records wall time and request counts per method. Cost is
 * computed only if a pricing file is supplied (GATE_A_PRICING) and that file names its source.
 * A token that fails is recorded with its error and the others still run.
 *
 *   bun run src/gates/gateA.ts <token> [<token> ...] [--out report.json]
 *   bun run src/gates/gateA.ts --sample replay/sample.json --count 3 [--out report.json]
 *
 * Exit code: 0 if at least one token was scanned, 1 if none were.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isAddress } from "viem";
import { scanOptionsFromEnv } from "../config";
import { historyFromEnv } from "../data/history";
import { Rpc } from "../data/rpc";
import { envStr } from "../env";
import { loadSample } from "../replay/replay";
import { scanToken } from "../scan/scan";

function parseCli(argv: string[]) {
  let out: string | undefined;
  let samplePath: string | undefined;
  let count = 3;
  const tokens: { address: string; createdBlock?: string }[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--out") out = argv[++i];
    else if (a === "--sample") samplePath = argv[++i];
    else if (a === "--count") count = Number(argv[++i]);
    else if (isAddress(a)) tokens.push({ address: a });
    else throw new Error(`not a token address or option: ${a}`);
  }
  if (!Number.isInteger(count) || count < 1) throw new Error("--count must be a positive integer");
  if (samplePath) tokens.push(...loadSample(samplePath).tokens.slice(0, count));
  if (tokens.length === 0) {
    throw new Error("usage: gateA.ts <token>... | --sample <sample.json> [--count 3]  [--out report.json]");
  }
  return { out, tokens };
}

const cli = parseCli(process.argv.slice(2));
const pricingPath = envStr("GATE_A_PRICING");
const pricing = pricingPath
  ? (JSON.parse(readFileSync(pricingPath, "utf8")) as { source: string; perCallUsd: Record<string, number> })
  : null;
if (pricing && !pricing.source) throw new Error("GATE_A_PRICING file must name its source");
const opts = scanOptionsFromEnv();

const results = [];
const failures: { token: string; error: string }[] = [];
for (const t of cli.tokens) {
  const rpc = Rpc.fromEnv();
  try {
    const hint = t.createdBlock ? { deployBlock: BigInt(t.createdBlock) } : {};
    const scan = await scanToken(rpc, historyFromEnv(rpc), t.address, opts, hint);
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

const ranAt = new Date().toISOString();
const file = cli.out ?? join(import.meta.dir, "../../out", `gate-a-${ranAt.replace(/[:.]/g, "-")}.json`);
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify({ gate: "A", ranAt, pricingSource: pricing?.source ?? null, results, failures }, null, 2));
console.log(`wrote ${file} (${results.length} scanned, ${failures.length} failed)`);
if (results.length === 0) process.exit(1);
