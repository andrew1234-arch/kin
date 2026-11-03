import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, toEventSelector, type Hex } from "viem";
import { CLANKER_V4_FACTORY_BASE, TOKEN_CREATED, WETH_BASE } from "../src/replay/clanker";
import { evenlySpaced, selectSample } from "../src/replay/selectSample";
import { addr, txh } from "./scenario";

/** A TokenCreated log exactly as the chain would return it. */
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

describe("selectSample", () => {
  test("the event signature matches Clanker's published ABI layout", () => {
    expect(toEventSelector(TOKEN_CREATED)).toBe(
      toEventSelector(
        "TokenCreated(address,address,address,string,string,string,string,string,int24,address,bytes32,address,address,address,uint256,address[])",
      ),
    );
  });

  test("evenly spaced picks are deterministic and include both ends", () => {
    const xs = Array.from({ length: 101 }, (_, i) => i);
    expect(evenlySpaced(xs, 5)).toEqual([0, 25, 50, 75, 100]);
    expect(evenlySpaced(xs.slice(0, 3), 5)).toEqual([0, 1, 2]);
  });

  test("reads creations in the settled range, keeps WETH pairs, samples evenly", async () => {
    // 2 s blocks; latest 1,000,000; settle 1 h = 1,800 blocks; range 1 day = 43,200 blocks.
    const latest = 1_000_000n;
    const toBlock = latest - 1800n;
    const fromBlock = toBlock - 43_200n + 1n;
    const logs = Array.from({ length: 30 }, (_, i) =>
      creationLog(i, fromBlock + BigInt(i) * 1000n, i % 3 === 2 ? addr("usdc-like") : WETH_BASE),
    );
    const requests: { fromBlock: string; toBlock: string }[] = [];
    const rpc = {
      async call<T>(method: string, params: unknown[]): Promise<T> {
        expect(method).toBe("eth_getLogs");
        const q = params[0] as { address: string; topics: Hex[]; fromBlock: string; toBlock: string };
        requests.push(q);
        const lo = BigInt(q.fromBlock);
        const hi = BigInt(q.toBlock);
        return logs.filter((l) => BigInt(l.blockNumber) >= lo && BigInt(l.blockNumber) <= hi) as T;
      },
    };
    const s = await selectSample(rpc, { n: 5, rangeDays: 1, settleHours: 1, chunk: 10_000n, latest, blockTimeSec: 2 });
    expect(BigInt(requests[0]!.fromBlock)).toBe(fromBlock);
    expect(BigInt(requests.at(-1)!.toBlock)).toBe(toBlock);
    expect(s.selectionDetail.eventsInRange).toBe(30);
    expect(s.selectionDetail.wethPaired).toBe(20);
    expect(s.tokens.length).toBe(5);
    expect(s.tokens[0]!.address).toBe(addr("tok-0"));
    expect(s.tokens[0]!.source).toContain(txh("create-0"));
    expect(s.tokens.at(-1)!.address).toBe(addr("tok-28")); // last WETH-paired creation
    expect(s.selection).toContain("20 of 30");
  });
});
