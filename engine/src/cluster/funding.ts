import { getAddress, type Address, type Hex } from "viem";
import type { HistoryProvider, IncomingTransfer } from "../data/history";
import type { Rpc } from "../data/rpc";
import type { FundingEdge } from "../types";

export interface TraceOptions {
  /** Lookback before each wallet's `beforeBlock`; covering the whole history (beforeBlock) is the default. */
  windowBlocks: bigint;
  excluded: Set<string>;
  maxHops: 1 | 2;
  perAddressLimit?: number;
  /**
   * ERC-20s that count as funding (e.g. WETH, a stablecoin). Token transfers only count when the sender is not a
   * contract: pools and routers send tokens to every swapper and would link unrelated wallets.
   */
  fundingTokens?: Address[];
  /** Needed for `fundingTokens` and service detection: tells contracts from wallets (eth_getCode). */
  rpc?: Rpc;
  /**
   * Funders with at least this many sent transactions are public services (exchange hot wallets, public faucets),
   * and so are contracts: like the excluded list, their payments link no one. Needs `rpc`; 0 turns it off.
   */
  serviceNonce?: number;
}

export const DEFAULT_SERVICE_NONCE = 10_000;

/**
 * Collect funding edges for a set of wallets: hop 1 (who funded each wallet before `beforeBlock`, native ETH and
 * the configured funding tokens) and hop 2 (who funded those funders before they funded). Excluded addresses and
 * the wallets themselves are not expanded to hop 2. Also returns each wallet's first funding seen (oldest
 * incoming transfer), which the tiering step uses as the wallet's age. Used by Kin Scan and the allowlist builder.
 */
export async function traceFunding(
  history: HistoryProvider,
  targets: { wallet: Address; beforeBlock: bigint }[],
  opts: TraceOptions,
): Promise<{ edges: FundingEdge[]; lastFundedAt: Map<string, number>; firstFundedAt: Map<string, number> }> {
  const limit = opts.perAddressLimit ?? 10;
  const floor0 = (b: bigint) => (b < 0n ? 0n : b);
  const tokens = opts.fundingTokens ?? [];
  const isWallet = walletCheck(opts.rpc);
  const isService = serviceCheck(opts.rpc, opts.serviceNonce ?? DEFAULT_SERVICE_NONCE);
  let edges: FundingEdge[] = [];
  const lastFundedAt = new Map<string, number>();
  const firstFundedAt = new Map<string, number>();

  // Incoming funding for one address: the newest transfers, plus the oldest (so padding a wallet with later
  // dust can't push its real first funder out of view).
  const incoming = async (a: Address, from: bigint, to: bigint, withOldest: boolean): Promise<IncomingTransfer[]> => {
    const [newest, oldest, toks] = await Promise.all([
      history.incomingNative(a, from, to, limit, "desc"),
      withOldest ? history.incomingNative(a, from, to, limit, "asc") : Promise.resolve([]),
      tokens.length ? history.incomingTokens(a, tokens, from, to, limit) : Promise.resolve([]),
    ]);
    const tokenEdges: IncomingTransfer[] = [];
    for (const t of toks) if (await isWallet(t.from)) tokenEdges.push(t);
    const seen = new Set<string>();
    return [...newest, ...oldest, ...tokenEdges].filter((t) => {
      if (t.from.toLowerCase() === t.to.toLowerCase()) return false; // a transfer to yourself funds nothing
      const k = `${t.txHash}:${t.from}:${t.asset ?? ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  const hop1 = await Promise.all(
    targets.map((t) => incoming(t.wallet, floor0(t.beforeBlock - opts.windowBlocks), t.beforeBlock, true)),
  );
  const targetSet = new Set(targets.map((t) => t.wallet.toLowerCase()));
  const funderFirst = new Map<string, bigint>();
  hop1.forEach((list, i) => {
    const w = targets[i]!.wallet.toLowerCase();
    for (const t of list) {
      edges.push({ ...t, hop: 1 });
      const last = lastFundedAt.get(w);
      if (last === undefined || t.timestamp > last) lastFundedAt.set(w, t.timestamp);
      const first = firstFundedAt.get(w);
      if (first === undefined || t.timestamp < first) firstFundedAt.set(w, t.timestamp);
      const f = t.from.toLowerCase();
      if (opts.excluded.has(f) || targetSet.has(f)) continue;
      const fb = funderFirst.get(f);
      if (fb === undefined || t.blockNumber < fb) funderFirst.set(f, t.blockNumber);
    }
  });

  // Funders that are services, not people: their payments link no one, and they aren't expanded to hop 2.
  const services = new Set<string>();
  await Promise.all([...funderFirst.keys()].map(async (f) => (await isService(f)) && services.add(f)));
  for (const f of services) funderFirst.delete(f);

  if (opts.maxHops === 2) {
    const hop2 = await Promise.all(
      [...funderFirst].map(([f, bn]) => incoming(getAddress(f), floor0(bn - opts.windowBlocks), bn, false)),
    );
    // Only a source that paid two or more funders can link anyone, so only those need checking.
    const paid = new Map<string, Set<string>>();
    hop2.forEach((list) =>
      list.forEach((t) => {
        const k = t.from.toLowerCase();
        paid.set(k, (paid.get(k) ?? new Set()).add(t.to.toLowerCase()));
      }),
    );
    await Promise.all([...paid].filter(([, to]) => to.size > 1).map(async ([k]) => (await isService(k)) && services.add(k)));
    hop2.forEach((list) => list.forEach((t) => edges.push({ ...t, hop: 2 })));
  }
  if (services.size) edges = edges.filter((e) => !services.has(e.from.toLowerCase()));
  return { edges, lastFundedAt, firstFundedAt };
}

/** A contract (not a 7702-delegated EOA), or a wallet that has sent at least `minNonce` transactions. */
function serviceCheck(rpc: Rpc | undefined, minNonce: number) {
  const cache = new Map<string, Promise<boolean>>();
  return (a: string): Promise<boolean> => {
    if (!rpc || minNonce <= 0) return Promise.resolve(false);
    const k = a.toLowerCase();
    let p = cache.get(k);
    if (!p) {
      p = (async () => {
        const code = await rpc.call<Hex>("eth_getCode", [k, "latest"]);
        if (code !== "0x" && !code.startsWith("0xef0100")) return true;
        return BigInt(await rpc.call<Hex>("eth_getTransactionCount", [k, "latest"])) >= BigInt(minNonce);
      })();
      cache.set(k, p);
    }
    return p;
  };
}

/** EOAs (including EIP-7702 delegated EOAs, code 0xef0100…) are wallets; any other code is a contract. */
function walletCheck(rpc: Rpc | undefined) {
  const cache = new Map<string, Promise<boolean>>();
  return (a: Address): Promise<boolean> => {
    if (!rpc) return Promise.resolve(false); // without a way to check, token edges are not trusted
    const k = a.toLowerCase();
    let p = cache.get(k);
    if (!p) {
      p = rpc.call<Hex>("eth_getCode", [a, "latest"]).then((code) => code === "0x" || code.startsWith("0xef0100"));
      cache.set(k, p);
    }
    return p;
  };
}
