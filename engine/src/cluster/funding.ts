import { getAddress, type Address } from "viem";
import type { HistoryProvider } from "../data/history";
import type { FundingEdge } from "../types";

/**
 * Collect native-ETH funding edges for a set of wallets: hop 1 (who funded each wallet in the window
 * before `beforeBlock`) and hop 2 (who funded those funders before they funded). Excluded addresses
 * and the wallets themselves are not expanded to hop 2. Used by Kin Scan and by the allowlist builder.
 */
export async function traceFunding(
  history: HistoryProvider,
  targets: { wallet: Address; beforeBlock: bigint }[],
  opts: { windowBlocks: bigint; excluded: Set<string>; maxHops: 1 | 2; perAddressLimit?: number },
): Promise<{ edges: FundingEdge[]; lastFundedAt: Map<string, number> }> {
  const limit = opts.perAddressLimit ?? 10;
  const floor0 = (b: bigint) => (b < 0n ? 0n : b);
  const edges: FundingEdge[] = [];
  const lastFundedAt = new Map<string, number>();

  const hop1 = await Promise.all(
    targets.map((t) => history.incomingNative(t.wallet, floor0(t.beforeBlock - opts.windowBlocks), t.beforeBlock, limit)),
  );
  const targetSet = new Set(targets.map((t) => t.wallet.toLowerCase()));
  const funderFirst = new Map<string, bigint>();
  hop1.forEach((list, i) => {
    const w = targets[i]!.wallet.toLowerCase();
    for (const t of list) {
      edges.push({ ...t, hop: 1 });
      const prev = lastFundedAt.get(w);
      if (prev === undefined || t.timestamp > prev) lastFundedAt.set(w, t.timestamp);
      const f = t.from.toLowerCase();
      if (opts.excluded.has(f) || targetSet.has(f)) continue;
      const first = funderFirst.get(f);
      if (first === undefined || t.blockNumber < first) funderFirst.set(f, t.blockNumber);
    }
  });

  if (opts.maxHops === 2) {
    const hop2 = await Promise.all(
      [...funderFirst].map(([f, bn]) =>
        history.incomingNative(getAddress(f), floor0(bn - opts.windowBlocks), bn, limit),
      ),
    );
    hop2.forEach((list) => list.forEach((t) => edges.push({ ...t, hop: 2 })));
  }
  return { edges, lastFundedAt };
}
