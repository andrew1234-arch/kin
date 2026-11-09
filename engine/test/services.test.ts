import { afterAll, expect, test } from "bun:test";
import { getAddress, type Address, type Hex } from "viem";
import { clusterByFunding } from "../src/cluster/cluster";
import { traceFunding } from "../src/cluster/funding";
import type { HistoryProvider, IncomingTransfer } from "../src/data/history";
import { Rpc } from "../src/data/rpc";

const a = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`) as Address;
const HOT = a(0xaaa1); // an exchange hot wallet: 10,000 transactions sent
const PERSON = a(0xbbb1); // an ordinary wallet: 3 transactions sent
const [W1, W2, W3, W4] = [a(1), a(2), a(3), a(4)];

// Chain state served over JSON-RPC: no contracts, and each address's transaction count.
const nonces: Record<string, number> = { [HOT.toLowerCase()]: 10_000, [PERSON.toLowerCase()]: 3 };
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const { method, params } = (await req.json()) as { method: string; params: [string] };
    const result = method === "eth_getCode" ? "0x" : `0x${(nonces[params[0].toLowerCase()] ?? 0).toString(16)}`;
    return Response.json({ jsonrpc: "2.0", id: 1, result });
  },
});
afterAll(() => server.stop(true));

const transfer = (from: Address, to: Address, i: number): IncomingTransfer => ({
  from,
  to,
  txHash: `0x${i.toString(16).padStart(64, "0")}` as Hex,
  blockNumber: 100n + BigInt(i),
  timestamp: 1_000 + i * 60,
  value: 10n ** 16n,
  internal: false,
});
const funding: IncomingTransfer[] = [transfer(HOT, W1, 1), transfer(HOT, W2, 2), transfer(PERSON, W3, 3), transfer(PERSON, W4, 4)];
const history: HistoryProvider = {
  name: "fake",
  calls: () => new Map(),
  incomingNative: async (to) => funding.filter((t) => t.to === to),
  incomingTokens: async () => [],
};

test("wallets funded by an exchange hot wallet are not linked; wallets funded by one person are", async () => {
  const rpc = new Rpc(`http://127.0.0.1:${server.port}`);
  const wallets = [W1, W2, W3, W4];
  const { edges } = await traceFunding(
    history,
    wallets.map((wallet) => ({ wallet, beforeBlock: 1_000n })),
    { windowBlocks: 1_000n, excluded: new Set(), maxHops: 2, rpc },
  );
  expect(edges.some((e) => e.from === HOT)).toBe(false);
  const clusters = clusterByFunding(wallets, edges, { maxHops: 2, excluded: new Set() });
  expect(clusters.map((c) => c.members.map((m) => m.toLowerCase()).sort())).toEqual([[W3.toLowerCase(), W4.toLowerCase()]]);
});
