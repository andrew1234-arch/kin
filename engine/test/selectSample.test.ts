import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, toEventSelector, type Hex } from "viem";
import { CLANKER_V4_FACTORY_BASE, TOKEN_CREATED, WETH_BASE } from "../src/replay/clanker";
import vendored from "../src/replay/clanker-token-created.abi.json";
import { evenlySpaced, fetchCreations, parseArgs, selectSample } from "../src/replay/selectSample";
import { addr, txh } from "./scenario";

/** A TokenCreated log as the chain would return it. */
function creationLog(i: number, block: bigint, paired: `0x${string}`) {
  const topics = encodeEventTopics({
    abi: [TOKEN_CREATED],
    eventName: "TokenCreated",
    args: { tokenAddress: addr(`tok-${i}`), tokenAdmin: addr(`admin-${i}`) },
  });
  const data = encodeAbiParameters(
    TOKEN_CREATED.inputs.filter((x) => !("indexed" in x && x.indexed)),
    [addr("sender"), "img", `Token ${i}`, `T${i}`, "{}", "{}", -230400, addr("hook"), txh(`pool-${i}`), paired, addr("locker"), addr("mev"), 0n, []],
  );
  return { address: CLANKER_V4_FACTORY_BASE, topics, data, blockNumber: `0x${block.toString(16)}`, transactionHash: txh(`create-${i}`) };
}

function stubRpc(logs: ReturnType<typeof creationLog>[]) {
  const requests: { fromBlock: string; toBlock: string }[] = [];
  return {
    requests,
    async call<T>(method: string, params: unknown[]): Promise<T> {
      expect(method).toBe("eth_getLogs");
      const q = params[0] as { fromBlock: string; toBlock: string };
      requests.push(q);
      // Answer out of order on purpose: parallel chunks must still come back in chain order.
      await Bun.sleep(Number(BigInt(q.fromBlock) % 7n));
      return logs.filter((l) => BigInt(l.blockNumber) >= BigInt(q.fromBlock) && BigInt(l.blockNumber) <= BigInt(q.toBlock)) as T;
    },
  };
}

const latest = 1_000_000n;
const toBlock = latest - 1800n; // settle 1 h at 2 s blocks
const fromBlock = toBlock - 43_200n + 1n; // 1 day
const base = { rangeDays: 1, settleHours: 1, chunk: 5_000n, latest, blockTimeSec: 2 };

describe("Clanker TokenCreated definition", () => {
  test("matches the definition extracted mechanically from Clanker's SDK, field by field", () => {
    const official = vendored.abi[0]!;
    expect(official.name).toBe("TokenCreated");
    const ours: [string, string, boolean][] = TOKEN_CREATED.inputs.map((x) => [x.name, x.type, "indexed" in x && x.indexed === true]);
    const theirs: [string, string, boolean][] = official.inputs.map((x) => [x.name, x.type, x.indexed]);
    expect(ours).toEqual(theirs);
    expect(ours.length).toBe(16);
    expect(toEventSelector(TOKEN_CREATED)).toBe(toEventSelector(official as never));
  });

  test("topic0 is pinned, so any edit to the signature shows up here", () => {
    expect(toEventSelector(TOKEN_CREATED)).toBe("0x9299d1d1a88d8e1abdc591ae7a167a6bc63a8f17d695804e9091ee33aa89fb67");
  });
});

describe("selectSample", () => {
  test("evenly spaced picks are deterministic, include both ends, and reject a bad N", () => {
    const xs = Array.from({ length: 101 }, (_, i) => i);
    expect(evenlySpaced(xs, 5)).toEqual([0, 25, 50, 75, 100]);
    expect(evenlySpaced(xs.slice(0, 3), 5)).toEqual([0, 1, 2]);
    expect(evenlySpaced(xs, 1)).toEqual([0]);
    for (const bad of [0, -1, 2.5, Number.NaN]) expect(() => evenlySpaced(xs, bad)).toThrow();
  });

  test("CLI arguments are validated", () => {
    expect(parseArgs(["10", "3", "12", "--out", "x.json"])).toEqual({ n: 10, rangeDays: 3, settleHours: 12, out: "x.json" });
    expect(parseArgs([])).toEqual({ n: 50, rangeDays: 7, settleHours: 24, out: undefined });
    for (const bad of [["abc"], ["-1"], ["2.5"], ["0"], ["5", "0"], ["5", "7", "-1"], ["--out"]]) expect(() => parseArgs(bad)).toThrow();
  });

  test("a zero or negative chunk size is refused instead of looping", async () => {
    await expect(fetchCreations(stubRpc([]), CLANKER_V4_FACTORY_BASE, 1n, 10n, 0n)).rejects.toThrow("positive");
    await expect(fetchCreations(stubRpc([]), CLANKER_V4_FACTORY_BASE, 1n, 10n, -5n)).rejects.toThrow("positive");
  });

  test("reads the settled range in parallel chunks, keeps WETH pairs in chain order, samples evenly", async () => {
    const logs = Array.from({ length: 30 }, (_, i) =>
      creationLog(i, fromBlock + BigInt(i) * 1000n, i % 3 === 2 ? addr("usdc-like") : WETH_BASE),
    );
    const rpc = stubRpc(logs);
    const s = await selectSample(rpc, { ...base, n: 5 });
    const starts = rpc.requests.map((r) => BigInt(r.fromBlock)).sort((a, b) => (a < b ? -1 : 1));
    expect(starts[0]).toBe(fromBlock);
    expect(rpc.requests.map((r) => BigInt(r.toBlock)).reduce((a, b) => (a > b ? a : b))).toBe(toBlock);
    expect(s.selectionDetail.eventsInRange).toBe(30);
    expect(s.selectionDetail.wethPaired).toBe(20);
    expect(s.tokens.length).toBe(5);
    expect(s.tokens[0]!.address).toBe(addr("tok-0"));
    expect(s.tokens[0]!.createdBlock).toBe(fromBlock.toString());
    expect(s.tokens[0]!.source).toContain(txh("create-0"));
    expect(s.tokens.at(-1)!.address).toBe(addr("tok-28"));
    expect(s.selection).toContain("20 of 30");
  });

  test("no creation events at all fails loudly (wrong factory or signature)", async () => {
    await expect(selectSample(stubRpc([]), { ...base, n: 5 })).rejects.toThrow("no Clanker v4 TokenCreated events");
  });

  test("fewer WETH-paired launches than N fails instead of writing a short sample", async () => {
    const logs = Array.from({ length: 6 }, (_, i) => creationLog(i, fromBlock + BigInt(i) * 10n, i < 3 ? WETH_BASE : addr("other")));
    await expect(selectSample(stubRpc(logs), { ...base, n: 5 })).rejects.toThrow("only 3 WETH-paired launches");
  });
});
