import { fallback, http, keccak256, type Hex, type Transport } from "viem";

/** Each chain's public RPC: the fallback when the configured endpoint (usually Alchemy) stalls or throttles. */
const PUBLIC_RPC: Record<number, string> = { 84532: "https://sepolia.base.org", 8453: "https://mainnet.base.org" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The engine's transport for one chain: the configured RPC first, the chain's public RPC if that fails, and
 * transaction sends that a timeout can't lose. A send that times out may still have reached the network, so before
 * failing, it checks whether the node knows the transaction (its hash is known in advance) and, if so, carries on.
 */
export function chainTransport(rpcUrl: string, chainId: number): Transport {
  const urls = [rpcUrl, PUBLIC_RPC[chainId]].filter((u, i, a): u is string => !!u && a.indexOf(u) === i);
  const one = (u: string) => http(u, { timeout: 25_000, retryCount: 2, retryDelay: 500 });
  const base = urls.length > 1 ? fallback(urls.map(one), { retryCount: 2 }) : one(urls[0]!);

  return (args) => {
    const t = base(args);
    const request = t.request;
    const send = (body: unknown, opts?: unknown) => request(body as never, opts as never) as Promise<unknown>;
    const wrapped = async (body: { method: string; params?: unknown }, opts?: unknown): Promise<unknown> => {
      if (body.method !== "eth_sendRawTransaction") return send(body, opts);
      const hash = keccak256((body.params as [Hex])[0]);
      try {
        return await send(body, opts);
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        if (/already known|known transaction|already imported/i.test(msg)) return hash;
        for (let i = 0; i < 4; i++) {
          await sleep(1500);
          const seen = await send({ method: "eth_getTransactionByHash", params: [hash] }).catch(() => null);
          if (seen) return hash;
        }
        throw e;
      }
    };
    return { ...t, request: wrapped as unknown as typeof request };
  };
}
