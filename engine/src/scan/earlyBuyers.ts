import { getAddress, toEventSelector, type Address, type Hex } from "viem";
import { hex, Rpc } from "../data/rpc";

export const TRANSFER_TOPIC = toEventSelector("Transfer(address,address,uint256)");

export interface Buy {
  tx: Hex;
  block: bigint;
  logIndex: number;
  timestamp: number;
  /** Token base units received. */
  tokens: bigint;
  /** Native ETH sent with the transaction (tx.value). 0 when paid in an ERC-20 (then unknown). */
  ethIn: bigint;
}

export interface EarlyBuyer {
  wallet: Address;
  firstBuyBlock: bigint;
  firstBuyTx: Hex;
  firstBuyTimestamp: number;
  /** Token base units received in buy transactions within the scanned range. */
  received: bigint;
  buys: Buy[];
}

interface Log {
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  transactionHash: Hex;
  logIndex: Hex;
}

/**
 * First block at which `token` has code (binary search on eth_getCode; needs an archive node).
 * With a `hint` (e.g. the block of the launchpad's creation event) it costs two calls: code at the
 * hint and none just before it. A hint that fails that check falls back to the search.
 */
export async function findDeployBlock(rpc: Rpc, token: Address, latest: bigint, hint?: bigint): Promise<bigint> {
  let lo = 0n;
  let hi = latest;
  const hasCode = async (b: bigint) => (await rpc.call<Hex>("eth_getCode", [token, hex(b)])) !== "0x";
  if (hint !== undefined && hint > 0n && hint <= latest) {
    const [at, before] = await Promise.all([hasCode(hint), hasCode(hint - 1n)]);
    if (at && !before) return hint;
  }
  if (!(await hasCode(hi))) throw new Error(`${token} has no code at the latest block`);
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (await hasCode(mid)) hi = mid;
    else lo = mid + 1n;
  }
  return lo;
}

/**
 * Early buyers of a token: walk Transfer logs from deployment and treat a transfer as a buy when
 * the recipient is also the transaction sender (the wallet signed the swap and received the tokens).
 * This catches router-mediated swaps that deliver to msg.sender, which is the common case; it misses
 * buys delivered to a different recipient. Mints (from = 0x0) are ignored, and so is every other
 * transfer in a transaction that minted (the creation transaction: creator allocation, liquidity
 * seeding and any same-transaction "dev buy" are launch setup, not early buys).
 */
export async function findEarlyBuyers(
  rpc: Rpc,
  token: Address,
  fromBlock: bigint,
  opts: { maxBuyers: number; chunk: bigint; maxBlocks: bigint; latest: bigint },
): Promise<EarlyBuyer[]> {
  const buyers = new Map<string, EarlyBuyer>();
  const txInfo = new Map<string, { from: string; value: bigint }>();
  const valueCounted = new Set<string>();
  const mintTxs = new Set<string>();
  const blockTime = new Map<bigint, number>();
  const end = minBig(fromBlock + opts.maxBlocks, opts.latest);

  for (let start = fromBlock; start <= end && buyers.size < opts.maxBuyers; start += opts.chunk) {
    const stop = minBig(start + opts.chunk - 1n, end);
    const logs = await rpc.call<Log[]>("eth_getLogs", [
      { address: token, topics: [TRANSFER_TOPIC], fromBlock: hex(start), toBlock: hex(stop) },
    ]);
    for (const log of logs) {
      if (log.topics.length >= 3 && BigInt(topicAddr(log.topics[1]!)) === 0n) mintTxs.add(log.transactionHash);
    }
    for (const log of logs) {
      if (log.topics.length < 3) continue;
      const to = topicAddr(log.topics[2]!);
      const tx = log.transactionHash;
      if (mintTxs.has(tx)) continue;
      let info = txInfo.get(tx);
      if (!info) {
        const t = await rpc.call<{ from: string; value: Hex }>("eth_getTransactionByHash", [tx]);
        info = { from: t.from.toLowerCase(), value: BigInt(t.value) };
        txInfo.set(tx, info);
      }
      const sender = info.from;
      if (sender !== to.toLowerCase()) continue;
      const existing = buyers.get(sender);
      if (!existing && buyers.size >= opts.maxBuyers) continue;
      const amount = BigInt(log.data);
      const bn = BigInt(log.blockNumber);
      let ts = blockTime.get(bn);
      if (ts === undefined) {
        const b = await rpc.call<{ timestamp: Hex }>("eth_getBlockByNumber", [hex(bn), false]);
        ts = Number(BigInt(b.timestamp));
        blockTime.set(bn, ts);
      }
      // tx.value is counted once per transaction even if it emitted several transfers to the buyer.
      const ethIn = valueCounted.has(tx) ? 0n : info.value;
      valueCounted.add(tx);
      const buy: Buy = { tx, block: bn, logIndex: Number(BigInt(log.logIndex)), timestamp: ts, tokens: amount, ethIn };
      if (existing) {
        existing.received += amount;
        existing.buys.push(buy);
        continue;
      }
      buyers.set(sender, {
        wallet: getAddress(to),
        firstBuyBlock: bn,
        firstBuyTx: tx,
        firstBuyTimestamp: ts,
        received: amount,
        buys: [buy],
      });
    }
  }
  return [...buyers.values()].sort((a, b) => Number(a.firstBuyBlock - b.firstBuyBlock));
}

/** Average block time over the last `span` blocks, measured from the chain (not assumed). */
export async function measureBlockTime(rpc: Rpc, latest: bigint, maxSpan = 1000n): Promise<number> {
  const span = latest < maxSpan ? latest : maxSpan;
  if (span === 0n) return 0;
  const [a, b] = await Promise.all([
    rpc.call<{ timestamp: Hex }>("eth_getBlockByNumber", [hex(latest - span), false]),
    rpc.call<{ timestamp: Hex }>("eth_getBlockByNumber", [hex(latest), false]),
  ]);
  return Number(BigInt(b.timestamp) - BigInt(a.timestamp)) / Number(span);
}

const topicAddr = (t: Hex): Address => getAddress("0x" + t.slice(26));
const minBig = (a: bigint, b: bigint) => (a < b ? a : b);
