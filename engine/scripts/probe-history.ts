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
const r = rows[0]!;
for (const [k, v] of Object.entries(r)) console.log(`  ${k}: ${typeof v === "bigint" ? v.toString() : v}`);
if (!r.txHash.startsWith("0x") || r.blockNumber <= 0n || r.timestamp <= 0) {
  console.error("Parsed row is incomplete (hash, block or timestamp missing).");
  process.exit(1);
}
console.log("history provider OK");
