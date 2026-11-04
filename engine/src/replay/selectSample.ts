/**
 * Chooses the replay sample by rule, from onchain events, so nobody hand-picks tokens:
 *
 *   all Clanker v4 TokenCreated events on Base in the block range covering RANGE_DAYS days that ends
 *   SETTLE_HOURS before the selection block, keeping launches paired with WETH (so early buys are paid in
 *   ETH and can be priced), then N tokens taken at evenly spaced positions in creation order.
 *
 *   bun run src/replay/selectSample.ts [N=50] [RANGE_DAYS=7] [SETTLE_HOURS=24] [--out replay/sample.json]
 *
 * The output records the rule, the exact block range, how many events matched, and for every token the
 * transaction and block that created it. It fails (and writes nothing) if the range holds no creation
 * events — the sign of a wrong factory address or event signature — or fewer WETH-paired launches than N.
 */
import { renameSync, writeFileSync } from "node:fs";
import { decodeEventLog, encodeEventTopics, getAddress, type Address, type Hex } from "viem";
import { envPositiveBigInt } from "../env";
import { hex, Rpc } from "../data/rpc";
import { measureBlockTime } from "../scan/earlyBuyers";
import { CLANKER_SOURCE, CLANKER_V4_FACTORY_BASE, TOKEN_CREATED, WETH_BASE } from "./clanker";
import { flagValue, type ReplaySample } from "./sample";

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

/** TokenCreated logs in [fromBlock, toBlock], requested in parallel chunks (the Rpc client limits concurrency), in chain order. */
export async function fetchCreations(
  rpc: Pick<Rpc, "call">,
  factory: Address,
  fromBlock: bigint,
  toBlock: bigint,
  chunk: bigint,
): Promise<Created[]> {
  if (chunk <= 0n) throw new Error("chunk size must be a positive number of blocks");
  if (toBlock < fromBlock) throw new Error(`empty block range ${fromBlock}-${toBlock}`);
  const [topic0] = encodeEventTopics({ abi: [TOKEN_CREATED], eventName: "TokenCreated" });
  const ranges: [bigint, bigint][] = [];
  for (let start = fromBlock; start <= toBlock; start += chunk) {
    ranges.push([start, start + chunk - 1n < toBlock ? start + chunk - 1n : toBlock]);
  }
  const pages = await Promise.all(
    ranges.map(([a, b]) =>
      rpc.call<Log[]>("eth_getLogs", [{ address: factory, topics: [topic0], fromBlock: hex(a), toBlock: hex(b) }]),
    ),
  );
  return pages.flat().map((l) => {
    const ev = decodeEventLog({ abi: [TOKEN_CREATED], data: l.data, topics: l.topics as [Hex, ...Hex[]] });
    return {
      token: getAddress(ev.args.tokenAddress),
      symbol: ev.args.tokenSymbol,
      name: ev.args.tokenName,
      pairedToken: getAddress(ev.args.pairedToken),
      block: BigInt(l.blockNumber),
      tx: l.transactionHash,
    };
  });
}

/** N items at evenly spaced positions (first and last included when N >= 2). Deterministic. */
export function evenlySpaced<T>(items: T[], n: number): T[] {
  if (!Number.isInteger(n) || n < 1) throw new Error(`sample size must be a positive integer, got ${n}`);
  if (items.length <= n) return [...items];
  if (n === 1) return [items[0]!];
  const idx = new Set<number>();
  for (let i = 0; i < n; i++) idx.add(Math.round((i * (items.length - 1)) / (n - 1)));
  return [...idx].sort((a, b) => a - b).map((i) => items[i]!);
}

export interface SelectOptions {
  n: number;
  rangeDays: number;
  settleHours: number;
  chunk: bigint;
  latest: bigint;
  blockTimeSec: number;
}

export function validateSelectOptions(o: Pick<SelectOptions, "n" | "rangeDays" | "settleHours">) {
  if (!Number.isInteger(o.n) || o.n < 1) throw new Error(`N must be a positive integer, got ${o.n}`);
  if (!Number.isFinite(o.rangeDays) || o.rangeDays <= 0) throw new Error(`RANGE_DAYS must be > 0, got ${o.rangeDays}`);
  if (!Number.isFinite(o.settleHours) || o.settleHours < 0) throw new Error(`SETTLE_HOURS must be >= 0, got ${o.settleHours}`);
}

export async function selectSample(
  rpc: Pick<Rpc, "call">,
  opts: SelectOptions,
): Promise<ReplaySample & { selectionDetail: Record<string, unknown> }> {
  validateSelectOptions(opts);
  if (!(opts.blockTimeSec > 0)) throw new Error("could not measure block time");
  const settleBlocks = BigInt(Math.ceil((opts.settleHours * 3600) / opts.blockTimeSec));
  const rangeBlocks = BigInt(Math.ceil((opts.rangeDays * 86400) / opts.blockTimeSec));
  const toBlock = opts.latest - settleBlocks;
  const fromBlock = toBlock - rangeBlocks + 1n;
  if (fromBlock < 0n) throw new Error("range reaches before genesis");
  const all = await fetchCreations(rpc, CLANKER_V4_FACTORY_BASE, fromBlock, toBlock, opts.chunk);
  if (all.length === 0) {
    throw new Error(
      `no Clanker v4 TokenCreated events from ${CLANKER_V4_FACTORY_BASE} in blocks ${fromBlock}-${toBlock}: ` +
        "check the factory address and event signature against Clanker's current deployment before trusting any sample",
    );
  }
  const weth = all.filter((c) => c.pairedToken === getAddress(WETH_BASE));
  if (weth.length < opts.n) {
    throw new Error(
      `only ${weth.length} WETH-paired launches (of ${all.length}) in blocks ${fromBlock}-${toBlock}; ` +
        `widen RANGE_DAYS or lower N (asked for ${opts.n})`,
    );
  }
  const picked = evenlySpaced(weth, opts.n);
  return {
    chainId: 8453,
    selection:
      `Clanker v4 launches on Base: every TokenCreated event from the Clanker v4 factory in blocks ${fromBlock}–${toBlock} ` +
      `(${opts.rangeDays} days ending ${opts.settleHours} h before selection), keeping the ${weth.length} of ${all.length} ` +
      `paired with WETH, then ${picked.length} taken at evenly spaced positions in creation order.`,
    tokens: picked.map((c) => ({
      address: c.token,
      createdBlock: c.block.toString(),
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

/** Parse "[N] [DAYS] [SETTLE] [--out path]" strictly: unknown options and extra arguments are errors. */
export function parseArgs(argv: string[]) {
  let path: string | undefined;
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--out") path = flagValue(argv, i++, a);
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else pos.push(a);
  }
  if (pos.length > 3) throw new Error(`too many arguments: ${pos.slice(3).join(" ")} (use --out <path> for the output file)`);
  const num = (s: string | undefined, def: number, name: string) => {
    if (s === undefined) return def;
    if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`${name} must be a number, got "${s}"`);
    return Number(s);
  };
  const o = { n: num(pos[0], 50, "N"), rangeDays: num(pos[1], 7, "RANGE_DAYS"), settleHours: num(pos[2], 24, "SETTLE_HOURS") };
  validateSelectOptions(o);
  return { ...o, out: path };
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const rpc = Rpc.fromEnv();
  if (Number(BigInt(await rpc.call<Hex>("eth_chainId", []))) !== 8453) throw new Error("BASE_RPC_URL is not Base mainnet");
  const latest = BigInt(await rpc.call<Hex>("eth_blockNumber", []));
  const sample = await selectSample(rpc, {
    ...args,
    chunk: envPositiveBigInt("LOGS_CHUNK", 2000n),
    latest,
    blockTimeSec: await measureBlockTime(rpc, latest),
  });
  const json = JSON.stringify(sample, null, 2) + "\n";
  if (args.out) {
    // Write next to the target, then rename: a failed run never leaves a truncated sample behind.
    const tmp = `${args.out}.tmp-${process.pid}`;
    writeFileSync(tmp, json);
    renameSync(tmp, args.out);
    console.error(`wrote ${args.out}`);
  } else {
    process.stdout.write(json);
  }
  console.error(sample.selection);
}
