/**
 * GATE A — indexing cost and speed test.
 *
 * Runs the full Kin Scan pipeline (deploy block → early buyers → hop-1/hop-2 funding → clusters →
 * counterfactual) on each token and records wall time and request counts per method. Cost is
 * computed only if a pricing file is supplied (GATE_A_PRICING) and that file names its source.
 *
 *   bun run src/gates/gateA.ts 0xTokenA 0xTokenB 0xTokenC
 *
 * Env: see engine/.env.example.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scanOptionsFromEnv } from "../config";
import { historyFromEnv } from "../data/history";
import { Rpc } from "../data/rpc";
import { scanToken } from "../scan/scan";

const tokens = process.argv.slice(2);
if (tokens.length === 0) {
  console.error("usage: bun run src/gates/gateA.ts <token> [<token> ...]");
  process.exit(1);
}
const pricing = process.env.GATE_A_PRICING
  ? (JSON.parse(readFileSync(process.env.GATE_A_PRICING, "utf8")) as {
      source: string;
      perCallUsd: Record<string, number>;
    })
  : null;
const opts = scanOptionsFromEnv();

const results = [];
for (const token of tokens) {
  const rpc = Rpc.fromEnv();
  const scan = await scanToken(rpc, historyFromEnv(rpc), token, opts);
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
  results.push({
    token: scan.token,
    elapsedMs: scan.cost.elapsedMs,
    calls: scan.cost.calls,
    totalCalls: scan.cost.totalCalls,
    costUsd,
    scan,
  });
}

const ranAt = new Date().toISOString();
const dir = join(import.meta.dir, "../../out");
mkdirSync(dir, { recursive: true });
const file = join(dir, `gate-a-${ranAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify({ gate: "A", ranAt, pricingSource: pricing?.source ?? null, results }, null, 2));
console.log(`wrote ${file}`);
