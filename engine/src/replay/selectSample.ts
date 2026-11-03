/**
 * Chooses the replay sample by rule, from onchain events, so nobody hand-picks tokens:
 *
 *   all Clanker v4 TokenCreated events on Base in the block range covering RANGE_DAYS days that ends
 *   SETTLE_HOURS before the selection block, keeping launches paired with WETH (so early buys are paid in
 *   ETH and can be priced), then N tokens taken at evenly spaced positions in creation order.
 *
 *   bun run src/replay/selectSample.ts [N=50] [RANGE_DAYS=7] [SETTLE_HOURS=24] > replay/sample.json
 *
 * The output records the rule, the exact block range, how many events matched, and for every token the
 * transaction that created it.
 */
import { decodeEventLog, encodeEventTopics, getAddress, type Address, type Hex } from "viem";
import { hex, Rpc } from "../data/rpc";
import { measureBlockTime } from "../scan/earlyBuyers";
import { CLANKER_SOURCE, CLANKER_V4_FACTORY_BASE, TOKEN_CREATED, WETH_BASE } from "./clanker";
import type { ReplaySample } from "./replay";

interface Log {
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  transactionHash: Hex;
}

export interface Created {
  token: Address;
  symbol: string;
  name: string;
  pairedToken: Address;
  block: bigint;
  tx: Hex;
}

export async function fetchCreations(
  rpc: Pick<Rpc, "call">,
  factory: Address,
  fromBlock: bigint,
  toBlock: bigint,
  chunk: bigint,
): Promise<Created[]> {
  const [topic0] = encodeEventTopics({ abi: [TOKEN_CREATED], eventName: "TokenCreated" });
  const out: Created[] = [];
  for (let start = fromBlock; start <= toBlock; start += chunk) {
    const stop = start + chunk - 1n < toBlock ? start + chunk - 1n : toBlock;
    const logs = await rpc.call<Log[]>("eth_getLogs", [
      { address: factory, topics: [topic0], fromBlock: hex(start), toBlock: hex(stop) },
    ]);
    for (const l of logs) {
      const ev = decodeEventLog({ abi: [TOKEN_CREATED], data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      out.push({
        token: getAddress(ev.args.tokenAddress),
        symbol: ev.args.tokenSymbol,
        name: ev.args.tokenName,
        pairedToken: getAddress(ev.args.pairedToken),
        block: BigInt(l.blockNumber),
        tx: l.transactionHash,
      });
    }
  }
  return out;
}

/** N items at evenly spaced positions (first and last included when N >= 2). Deterministic. */
export function evenlySpaced<T>(items: T[], n: number): T[] {
  if (items.length <= n) return [...items];
  if (n <= 1) return items.slice(0, n);
  const idx = new Set<number>();
  for (let i = 0; i < n; i++) idx.add(Math.round((i * (items.length - 1)) / (n - 1)));
  return [...idx].sort((a, b) => a - b).map((i) => items[i]!);
}

export async function selectSample(
  rpc: Pick<Rpc, "call">,
  opts: { n: number; rangeDays: number; settleHours: number; chunk: bigint; latest: bigint; blockTimeSec: number },
): Promise<ReplaySample & { selectionDetail: Record<string, unknown> }> {
  if (opts.blockTimeSec <= 0) throw new Error("could not measure block time");
  const settleBlocks = BigInt(Math.ceil((opts.settleHours * 3600) / opts.blockTimeSec));
  const rangeBlocks = BigInt(Math.ceil((opts.rangeDays * 86400) / opts.blockTimeSec));
  const toBlock = opts.latest - settleBlocks;
  const fromBlock = toBlock - rangeBlocks + 1n;
  const all = await fetchCreations(rpc, CLANKER_V4_FACTORY_BASE, fromBlock, toBlock, opts.chunk);
  const weth = all.filter((c) => c.pairedToken === getAddress(WETH_BASE));
  const picked = evenlySpaced(weth, opts.n);
  return {
    chainId: 8453,
    selection:
      `Clanker v4 launches on Base: every TokenCreated event from the Clanker v4 factory in blocks ${fromBlock}–${toBlock} ` +
      `(${opts.rangeDays} days ending ${opts.settleHours} h before selection), keeping the ${weth.length} of ${all.length} ` +
      `paired with WETH, then ${picked.length} taken at evenly spaced positions in creation order.`,
    tokens: picked.map((c) => ({
      address: c.token,
      source: `Clanker v4 TokenCreated, block ${c.block}, tx ${c.tx} ($${c.symbol})`,
    })),
    selectionDetail: {
      factory: CLANKER_V4_FACTORY_BASE,
      factorySource: CLANKER_SOURCE,
      selectionBlock: opts.latest.toString(),
      measuredBlockTimeSec: opts.blockTimeSec,
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      eventsInRange: all.length,
      wethPaired: weth.length,
      requested: opts.n,
      selected: picked.length,
    },
  };
}

if (import.meta.main) {
  const [n = "50", days = "7", settle = "24"] = process.argv.slice(2);
  const rpc = Rpc.fromEnv();
  const latest = BigInt(await rpc.call<Hex>("eth_blockNumber", []));
  if (Number(BigInt(await rpc.call<Hex>("eth_chainId", []))) !== 8453) throw new Error("BASE_RPC_URL is not Base mainnet");
  const sample = await selectSample(rpc, {
    n: Number(n),
    rangeDays: Number(days),
    settleHours: Number(settle),
    chunk: BigInt(process.env.LOGS_CHUNK ?? 2000),
    latest,
    blockTimeSec: await measureBlockTime(rpc as Rpc, latest),
  });
  console.log(JSON.stringify(sample, null, 2));
  console.error(sample.selection);
}
