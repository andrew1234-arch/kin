/**
 * First live check of the transfer-history provider: asks for recent incoming native-ETH transfers to
 * WETH on Base (which receives deposits constantly) and prints what came back, raw counts and one parsed
 * row. Exits non-zero if nothing parses, so a wrong request/response shape fails loudly.
 *
 *   bun run scripts/probe-history.ts
 */
import { type Hex } from "viem";
import { historyFromEnv } from "../src/data/history";
import { Rpc } from "../src/data/rpc";
import { WETH_BASE } from "../src/replay/clanker";

const rpc = Rpc.fromEnv();
const chainId = Number(BigInt(await rpc.call<Hex>("eth_chainId", [])));
const latest = BigInt(await rpc.call<Hex>("eth_blockNumber", []));
console.log(`chain ${chainId}, latest block ${latest}`);
if (chainId !== 8453) throw new Error("BASE_RPC_URL is not Base mainnet");
const history = historyFromEnv(rpc);
const t0 = performance.now();
const rows = await history.incomingNative(WETH_BASE, latest - 300n, latest, 5);
console.log(`${history.name}: ${rows.length} transfers in ${Math.round(performance.now() - t0)} ms`);
if (rows.length === 0) {
  console.error("No transfers parsed. Check the provider settings and its response format.");
  process.exit(1);
}
for (const [k, v] of Object.entries(rows[0]!)) console.log(`  ${k}: ${typeof v === "bigint" ? v.toString() : v}`);

// Every row must have a well-formed hash, block and timestamp. Comparisons are written as !(x > 0) so NaN
// (what a renamed or missing field produces) fails too.
const bad: string[] = [];
rows.forEach((r, i) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(r.txHash)) bad.push(`row ${i}: txHash ${r.txHash}`);
  if (!(r.blockNumber > 0n)) bad.push(`row ${i}: blockNumber ${r.blockNumber}`);
  if (!(r.timestamp > 0)) bad.push(`row ${i}: timestamp ${r.timestamp}`);
});
// Providers are asked for non-zero transfers, so a value of 0 means the value field wasn't read. One such
// row can be a provider quirk (e.g. an internal transfer without a raw value): warn. All of them: fail.
const zeroValue = rows.filter((r) => !(r.value > 0n)).length;
if (zeroValue === rows.length) bad.push(`value is 0 or missing in all ${rows.length} rows`);
else if (zeroValue > 0) console.warn(`warning: value is 0 or missing in ${zeroValue} of ${rows.length} rows`);
if (bad.length > 0) {
  console.error(`Malformed rows from ${history.name}:\n  ${bad.join("\n  ")}`);
  process.exit(1);
}
console.log(`history provider OK (${rows.length} rows checked)`);
