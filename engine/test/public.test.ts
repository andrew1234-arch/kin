import { afterEach, describe, expect, test } from "bun:test";
import { createPublicLaunch } from "../src/launch/public";

// Validation runs before any chain or store access, so a bare runtime is enough here.
const rt = {} as Parameters<typeof createPublicLaunch>[0];
const KEYS = ["PUBLIC_LAUNCHES", "LAUNCH_ADMIN_KEY", "LAUNCH_DEPLOYMENT", "LAUNCH_RPC_URL"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const enable = () => {
  process.env.PUBLIC_LAUNCHES = "1";
  process.env.LAUNCH_ADMIN_KEY = `0x${"11".repeat(32)}`;
  process.env.LAUNCH_DEPLOYMENT = "/nonexistent.json";
  process.env.LAUNCH_RPC_URL = "http://127.0.0.1:1";
};

describe("public launches", () => {
  afterEach(() => {
    for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
  });

  test("are off unless PUBLIC_LAUNCHES=1", async () => {
    delete process.env.PUBLIC_LAUNCHES;
    await expect(createPublicLaunch(rt, { name: "Night Shift", symbol: "SHIFT", capEth: "0.001" }, "ip")).rejects.toThrow(/turned off/);
  });

  test("reject a bad name, symbol or limit before touching the chain", async () => {
    enable();
    const ok = { name: "Night Shift", symbol: "SHIFT", capEth: "0.001", windowMin: 60, lockMin: 10 };
    await expect(createPublicLaunch(rt, { ...ok, name: "x" }, "ip")).rejects.toThrow(/Name/);
    await expect(createPublicLaunch(rt, { ...ok, symbol: "TOO-LONG-SYMBOL" }, "ip")).rejects.toThrow(/Symbol/);
    await expect(createPublicLaunch(rt, { ...ok, capEth: "abc" }, "ip")).rejects.toThrow(/Limit per buyer/);
    await expect(createPublicLaunch(rt, { ...ok, capEth: "5" }, "ip")).rejects.toThrow(/between/);
    await expect(createPublicLaunch(rt, { ...ok, capEth: "0.00001" }, "ip")).rejects.toThrow(/between/);
  });
});
