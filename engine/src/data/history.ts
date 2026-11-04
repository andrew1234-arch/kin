import { getAddress, type Address, type Hex } from "viem";
import { hex, Rpc } from "./rpc";
import { ConfigError, envRequired, envStr } from "../env";

/**
 * Transfer-history access: "who sent native ETH to this address, up to block X?".
 * Plain JSON-RPC cannot answer that (incoming value transfers are not indexed), so a
 * transfer-history API is required. Which provider, and its cost, is what Gate A measures.
 *
 * STATUS: written without network access (the build container blocks Base RPC and indexers).
 * Request/response shapes follow each provider's public API as the author understands it and
 * must be checked on the first live Gate A run.
 */
export interface IncomingTransfer {
  from: Address;
  to: Address;
  txHash: Hex;
  blockNumber: bigint;
  timestamp: number;
  value: bigint; // wei
  internal: boolean;
}

export interface HistoryProvider {
  readonly name: string;
  /** Incoming native-ETH transfers to `address` in [fromBlock, toBlock], newest first, at most `limit`. */
  incomingNative(address: Address, fromBlock: bigint, toBlock: bigint, limit: number): Promise<IncomingTransfer[]>;
  calls(): Map<string, number>;
}

/** Alchemy `alchemy_getAssetTransfers`, sent to BASE_RPC_URL (an Alchemy Base endpoint). */
export class AlchemyHistory implements HistoryProvider {
  readonly name = "alchemy";
  constructor(private readonly rpc: Rpc) {}
  calls() {
    return this.rpc.calls;
  }
  async incomingNative(address: Address, fromBlock: bigint, toBlock: bigint, limit: number) {
    type T = {
      blockNum: string;
      hash: Hex;
      from: string;
      to: string;
      rawContract?: { value?: string | null };
      category: string;
      metadata?: { blockTimestamp?: string };
    };
    const res = await this.rpc.call<{ transfers: T[] }>("alchemy_getAssetTransfers", [
      {
        fromBlock: hex(fromBlock),
        toBlock: hex(toBlock),
        toAddress: address,
        category: ["external", "internal"],
        order: "desc",
        withMetadata: true,
        excludeZeroValue: true,
        maxCount: hex(limit),
      },
    ]);
    return res.transfers.map((t) => ({
      from: getAddress(t.from),
      to: getAddress(t.to),
      txHash: t.hash,
      blockNumber: BigInt(t.blockNum),
      timestamp: t.metadata?.blockTimestamp ? Math.floor(Date.parse(t.metadata.blockTimestamp) / 1000) : 0,
      value: t.rawContract?.value ? BigInt(t.rawContract.value) : 0n,
      internal: t.category === "internal",
    }));
  }
}

/** Blockscout REST API v2 at BLOCKSCOUT_API_URL (e.g. the Base instance's https://<host>/api/v2). */
export class BlockscoutHistory implements HistoryProvider {
  readonly name = "blockscout";
  private readonly counts = new Map<string, number>();
  constructor(private readonly baseUrl: string) {}
  calls() {
    return this.counts;
  }

  private async get<T>(path: string): Promise<T> {
    const key = path.split("?")[0]!.replace(/0x[0-9a-fA-F]{40}/, ":address");
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(this.baseUrl.replace(/\/$/, "") + path);
      if (res.ok) return (await res.json()) as T;
      if (attempt >= 4 || (res.status !== 429 && res.status < 500)) throw new Error(`blockscout ${res.status} ${path}`);
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }

  async incomingNative(address: Address, fromBlock: bigint, toBlock: bigint, limit: number) {
    type Item = {
      hash?: Hex;
      transaction_hash?: Hex;
      from: { hash: string };
      to: { hash: string } | null;
      value: string;
      block_number?: number;
      block?: number;
      timestamp: string;
    };
    const out: IncomingTransfer[] = [];
    for (const [kind, internal] of [["transactions", false], ["internal-transactions", true]] as const) {
      let next = "";
      for (let page = 0; page < 5 && out.length < limit * 2; page++) {
        const body = await this.get<{ items: Item[]; next_page_params: Record<string, string> | null }>(
          `/addresses/${address}/${kind}?filter=to${next}`,
        );
        let older = false;
        for (const it of body.items) {
          const bn = BigInt(it.block_number ?? it.block ?? 0);
          if (bn > toBlock) continue;
          if (bn < fromBlock) {
            older = true;
            break;
          }
          if (!it.to || it.to.hash.toLowerCase() !== address.toLowerCase() || BigInt(it.value) === 0n) continue;
          out.push({
            from: getAddress(it.from.hash),
            to: getAddress(it.to.hash),
            txHash: (it.hash ?? it.transaction_hash)!,
            blockNumber: bn,
            timestamp: Math.floor(Date.parse(it.timestamp) / 1000),
            value: BigInt(it.value),
            internal,
          });
        }
        if (older || !body.next_page_params) break;
        next = "&" + new URLSearchParams(body.next_page_params).toString();
      }
    }
    return out.sort((a, b) => Number(b.blockNumber - a.blockNumber)).slice(0, limit);
  }
}

/**
 * The transfer-history provider for `rpc`'s chain. Callers for a chain other than Base mainnet must pass
 * that chain's own Blockscout URL: BLOCKSCOUT_API_URL is the Base mainnet instance.
 */
export function historyFromEnv(rpc: Rpc, provider?: string, blockscoutUrl?: string): HistoryProvider {
  const p = provider ?? envStr("HISTORY_PROVIDER") ?? "alchemy";
  if (p === "alchemy") return new AlchemyHistory(rpc);
  if (p === "rpc-scan") return new RpcScanHistory(rpc);
  if (p === "blockscout") {
    return new BlockscoutHistory(blockscoutUrl ?? envRequired("BLOCKSCOUT_API_URL"));
  }
  throw new ConfigError(`unknown history provider "${p}" (alchemy | blockscout | rpc-scan)`);
}

/**
 * Dev-only provider: scans every block in range with eth_getBlockByNumber(full txs) for top-level
 * native transfers. Fine for a local anvil chain with a few hundred blocks; far too slow for Base.
 * Does not see internal (contract-to-wallet) transfers.
 */
export class RpcScanHistory implements HistoryProvider {
  readonly name = "rpc-scan";
  constructor(private readonly rpc: Rpc) {}
  calls() {
    return this.rpc.calls;
  }
  async incomingNative(address: Address, fromBlock: bigint, toBlock: bigint, limit: number) {
    type Tx = { hash: Hex; from: string; to: string | null; value: Hex };
    const out: IncomingTransfer[] = [];
    for (let b = toBlock; b >= (fromBlock < 0n ? 0n : fromBlock) && out.length < limit; b--) {
      const blk = await this.rpc.call<{ timestamp: Hex; transactions: Tx[] }>("eth_getBlockByNumber", [hex(b), true]);
      for (const t of blk.transactions) {
        if (!t.to || t.to.toLowerCase() !== address.toLowerCase() || BigInt(t.value) === 0n) continue;
        out.push({
          from: getAddress(t.from),
          to: getAddress(t.to),
          txHash: t.hash,
          blockNumber: b,
          timestamp: Number(BigInt(blk.timestamp)),
          value: BigInt(t.value),
          internal: false,
        });
      }
    }
    return out;
  }
}
