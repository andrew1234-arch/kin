import { describe, expect, test } from "bun:test";
import { simulateKin, type SimBuy } from "../src/scan/counterfactual";
import { addr, txh } from "./scenario";

const ETH = 10n ** 18n;
const buy = (w: string, i: number, eth: bigint): SimBuy => ({
  wallet: addr(w),
  tx: txh(`${w}-${i}`),
  block: BigInt(100 + i),
  logIndex: 0,
  ethIn: eth,
  tokens: eth * 1000n,
});

describe("simulateKin", () => {
  test("a 20-wallet entity is held to one cap; buys past it are blocked in chain order", () => {
    const buys = Array.from({ length: 20 }, (_, i) => buy(`b${i}`, i, ETH / 10n));
    const r = simulateKin(buys, () => ({ key: "E1", tier: "linked" }), { capWei: ETH, freshPoolCapWei: ETH / 2n });
    const e = r.entities[0]!;
    expect(e.landedBuys).toBe(10);
    expect(e.blockedBuys).toBe(10);
    expect(e.landedWei).toBe(ETH);
    expect(e.blockedTxs[0]).toBe(txh("b10-10"));
  });

  test("fresh wallets share the pooled cap; aged wallets keep their own", () => {
    const buys = [buy("f0", 0, ETH / 4n), buy("f1", 1, ETH / 4n), buy("f2", 2, ETH / 4n), buy("aged", 3, ETH)];
    const r = simulateKin(
      buys,
      (w) => (w === addr("aged") ? { key: "W", tier: "aged" } : { key: "FRESH", tier: "fresh" }),
      { capWei: ETH, freshPoolCapWei: ETH / 2n },
    );
    const fresh = r.entities.find((e) => e.key === "FRESH")!;
    expect(fresh.landedBuys).toBe(2);
    expect(fresh.blockedBuys).toBe(1);
    expect(r.entities.find((e) => e.key === "W")!.blockedBuys).toBe(0);
    expect(r.totals.blockedWei).toBe(ETH / 4n);
  });

  test("buys with no known ETH value are reported as unknown, not guessed", () => {
    const r = simulateKin([buy("x", 0, 0n)], () => ({ key: "W", tier: "aged" }), { capWei: ETH, freshPoolCapWei: ETH });
    expect(r.totals.unknownBuys).toBe(1);
    expect(r.totals.attemptedWei).toBe(0n);
  });
});
