import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEther } from "viem";
import { envNum, envPositiveBigInt, envStr } from "../src/env";
import { loadSample, reusableScans } from "../src/replay/replay";
import { methodParams, sameMethod, type ScanOptions, type ScanResult } from "../src/scan/scan";

const KEYS = ["KIN_T_STR", "KIN_T_NUM", "KIN_T_BIG"];
afterEach(() => KEYS.forEach((k) => delete process.env[k]));

describe("env helpers", () => {
  test("blank values count as unset", () => {
    process.env.KIN_T_STR = "   ";
    expect(envStr("KIN_T_STR")).toBeUndefined();
    process.env.KIN_T_NUM = "";
    expect(envNum("KIN_T_NUM", 8)).toBe(8);
    process.env.KIN_T_BIG = "";
    expect(envPositiveBigInt("KIN_T_BIG", 2000n)).toBe(2000n);
  });

  test("malformed numbers fail loudly instead of becoming NaN or 0", () => {
    process.env.KIN_T_NUM = "abc";
    expect(() => envNum("KIN_T_NUM", 8)).toThrow();
    process.env.KIN_T_NUM = "2.5";
    expect(() => envNum("KIN_T_NUM", 8, { integer: true })).toThrow();
    process.env.KIN_T_BIG = "0";
    expect(() => envPositiveBigInt("KIN_T_BIG", 1n)).toThrow();
    process.env.KIN_T_BIG = "-5";
    expect(() => envPositiveBigInt("KIN_T_BIG", 1n)).toThrow();
  });
});

const opts: ScanOptions = {
  earlyBuyers: 50,
  fundingWindowHours: 72,
  logsChunk: 2000n,
  maxScanBlocks: 43_200n,
  maxHops: 2,
  freshMaxNonce: 0,
  freshMaxAgeHours: 168,
  fundingTokens: [],
  caps: { capWei: parseEther("0.1"), freshPoolCapWei: parseEther("0.2") },
  excluded: new Set(),
  exclusionsSource: { repo: "x", commit: "y", count: 1, extra: [] },
};
const fakeScan = (token: string, method: Record<string, unknown>, chainId = 8453) =>
  ({ token, chainId, method: { ...method, measuredBlockTimeSec: 2 } }) as unknown as ScanResult;

describe("replay reuse", () => {
  test("a scan is reused only when every parameter matches", () => {
    const same = fakeScan("0xA", methodParams(opts, "alchemy"));
    expect(sameMethod(same, opts, "alchemy")).toBe(true);
    expect(sameMethod(same, opts, "blockscout")).toBe(false);
    expect(sameMethod(same, { ...opts, caps: { ...opts.caps, capWei: parseEther("0.2") } }, "alchemy")).toBe(false);
    expect(sameMethod(same, { ...opts, earlyBuyers: 40 }, "alchemy")).toBe(false);
  });

  test("reusableScans reads Gate A and replay reports and keeps only matching scans", () => {
    const dir = mkdtempSync(join(tmpdir(), "kin-reuse-"));
    const gate = join(dir, "gate.json");
    writeFileSync(
      gate,
      JSON.stringify({
        results: [
          { scan: fakeScan("0xAAA", methodParams(opts, "alchemy")) },
          { scan: fakeScan("0xBBB", methodParams({ ...opts, earlyBuyers: 10 }, "alchemy")) },
          { scan: fakeScan("0xCCC", methodParams(opts, "alchemy"), 84532) }, // same parameters, other chain
        ],
      }),
    );
    const m = reusableScans([gate], opts, "alchemy", 8453);
    expect([...m.keys()]).toEqual(["0xaaa"]);
  });

  test("loadSample refuses the unfilled template and empty samples", () => {
    const dir = mkdtempSync(join(tmpdir(), "kin-sample-"));
    const p = join(dir, "s.json");
    writeFileSync(p, JSON.stringify({ chainId: 8453, selection: "NOT YET CHOSEN. Fill in…", tokens: [] }));
    expect(() => loadSample(p)).toThrow("no selection method");
    writeFileSync(p, JSON.stringify({ chainId: 8453, selection: "rule", tokens: [] }));
    expect(() => loadSample(p)).toThrow("no tokens");
    writeFileSync(p, JSON.stringify({ chainId: 8453, selection: "rule", tokens: [{ address: "0x1234", source: "s" }] }));
    expect(() => loadSample(p)).toThrow("bad token entry");
  });
});
