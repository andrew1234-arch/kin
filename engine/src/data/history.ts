import { getAddress, type Address, type Hex } from "viem";
import { hex, Rpc } from "./rpc";
import { TRANSFER_TOPIC } from "../scan/earlyBuyers";
import { ConfigError, envRequired, envStr } from "../env";

/**
 * Transfer-history access: "who sent native ETH (or a funding ERC-20 such as WETH) to this address, up to block X?".
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
  value: bigint; // wei, or token base units when `asset` is set
  internal: boolean;
  /** The ERC-20 contract, for token transfers; undefined for native ETH. */
  asset?: Address;
}

export type Order = "asc" | "desc";

export interface HistoryProvider {
  readonly name: string;
  /**
   * Incoming native-ETH transfers to `address` in [fromBlock, toBlock], at most `limit`: newest first ("desc",
   * the default) or oldest first ("asc", used to find a wallet's first funding).
   */
  incomingNative(address: Address, fromBlock: bigint, toBlock: bigint, limit: number, order?: Order): Promise<IncomingTransfer[]>;
  /** Incoming transfers of the given ERC-20 `tokens` to `address` in [fromBlock, toBlock], newest first. */
  incomingTokens(address: Address, tokens: Address[], fromBlock: bigint, toBlock: bigint, limit: number): Promise<IncomingTransfer[]>;
  calls(): Map<string, number>;
}

/** Alchemy `alchemy_getAssetTransfers`, sent to BASE_RPC_URL (an Alchemy Base endpoint). */
export class AlchemyHistory implements HistoryProvider {
  readonly name = "alchemy";
  constructor(private readonly rpc: Rpc) {}
  calls() {
    return this.rpc.calls;
  }
  incomingNative(address: Address, fromBlock: bigint, toBlock: bigint, limit: number, order: Order = "desc") {
    return this.transfers(address, fromBlock, toBlock, limit, order, ["external", "internal"]);
  }

  incomingTokens(address: Address, tokens: Address[], fromBlock: bigint, toBlock: bigint, limit: number) {
    if (tokens.length === 0) return Promise.resolve([]);
    return this.transfers(address, fromBlock, toBlock, limit, "desc", ["erc20"], tokens);
  }

  private async transfers(
    address: Address,
    fromBlock: bigint,
    toBlock: bigint,
    limit: number,
    order: Order,
    category: string[],
    contractAddresses?: Address[],
  ) {
    type T = {
      blockNum: string;
      hash: Hex;
      from: string;
      to: string;
      rawContract?: { value?: string | null; address?: string | null };
      category: string;
      metadata?: { blockTimestamp?: string };
    };
    const res = await this.rpc.call<{ transfers: T[] }>("alchemy_getAssetTransfers", [
      {
        fromBlock: hex(fromBlock),
        toBlock: hex(toBlock),
        toAddress: address,
        category,
        ...(contractAddresses ? { contractAddresses } : {}),
        order,
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
      ...(t.category === "erc20" && t.rawContract?.address ? { asset: getAddress(t.rawContract.address) } : {}),
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

  /**
   * Blockscout lists newest first. For "asc" this reads up to 5 pages per kind and keeps the oldest seen, so for
   * a wallet with more history than that the "first" funding found is later than the true one: the wallet can
   * look younger (fresh) than it is, never older. To be checked on the first live run.
   */
  async incomingNative(address: Address, fromBlock: bigint, toBlock: bigint, limit: number, order: Order = "desc") {
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
      for (let page = 0; page < 5 && (order === "asc" || out.length < limit * 2); page++) {
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
    const sorted = out.sort((a, b) => Number(b.blockNumber - a.blockNumber));
    return order === "asc" ? sorted.reverse().slice(0, limit) : sorted.slice(0, limit);
  }

  async incomingTokens(address: Address, tokens: Address[], fromBlock: bigint, toBlock: bigint, limit: number) {
    type Item = {
      transaction_hash?: Hex;
      tx_hash?: Hex;
      from: { hash: string };
      to: { hash: string } | null;
      total?: { value?: string };
      block_number?: number;
      timestamp: string;
      token?: { address?: string; address_hash?: string };
    };
    const out: IncomingTransfer[] = [];
    for (const token of tokens) {
      const body = await this.get<{ items: Item[] }>(`/addresses/${address}/token-transfers?type=ERC-20&filter=to&token=${token}`);
      for (const it of body.items) {
        const bn = BigInt(it.block_number ?? 0);
        const value = BigInt(it.total?.value ?? "0");
        if (bn > toBlock || bn < fromBlock || value === 0n) continue;
        if (!it.to || it.to.hash.toLowerCase() !== address.toLowerCase()) continue;
        out.push({
          from: getAddress(it.from.hash),
          to: getAddress(it.to.hash),
          txHash: (it.transaction_hash ?? it.tx_hash)!,
          blockNumber: bn,
          timestamp: Math.floor(Date.parse(it.timestamp) / 1000),
          value,
          internal: false,
          asset: getAddress(token),
        });
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
  async incomingNative(address: Address, fromBlock: bigint, toBlock: bigint, limit: number, order: Order = "desc") {
    type Tx = { hash: Hex; from: string; to: string | null; value: Hex };
    const out: IncomingTransfer[] = [];
    const lo = fromBlock < 0n ? 0n : fromBlock;
    const blocks = function* () {
      if (order === "asc") for (let b = lo; b <= toBlock; b++) yield b;
      else for (let b = toBlock; b >= lo; b--) yield b;
    };
    for (const b of blocks()) {
      if (out.length >= limit) break;
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
    return out.slice(0, limit);
  }

  async incomingTokens(address: Address, tokens: Address[], fromBlock: bigint, toBlock: bigint, limit: number) {
    if (tokens.length === 0) return [];
    type Log = { address: string; topics: Hex[]; data: Hex; transactionHash: Hex; blockNumber: Hex };
    const logs = await this.rpc.call<Log[]>("eth_getLogs", [
      {
        address: tokens,
        fromBlock: hex(fromBlock < 0n ? 0n : fromBlock),
        toBlock: hex(toBlock),
        topics: [TRANSFER_TOPIC, null, pad(address)],
      },
    ]);
    const out: IncomingTransfer[] = [];
    for (const l of logs.reverse().slice(0, limit)) {
      const value = BigInt(l.data);
      if (value === 0n) continue;
      const blk = await this.rpc.call<{ timestamp: Hex }>("eth_getBlockByNumber", [l.blockNumber, false]);
      out.push({
        from: getAddress(`0x${l.topics[1]!.slice(26)}`),
        to: getAddress(address),
        txHash: l.transactionHash,
        blockNumber: BigInt(l.blockNumber),
        timestamp: Number(BigInt(blk.timestamp)),
        value,
        internal: false,
        asset: getAddress(l.address),
      });
    }
    return out;
  }
}

const pad = (a: Address): Hex => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
