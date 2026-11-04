import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Rpc } from "../src/data/rpc";
import { parseCli as gateACli } from "../src/gates/gateA";
import { parseCli as replayCli } from "../src/replay/replay";
import { ConfigError } from "../src/replay/sample";
import { parseArgs as selectArgs } from "../src/replay/selectSample";
import { launchHistory } from "../src/runtime";

const engineDir = join(import.meta.dir, "..");

/** Run the real shell helper (scripts/run-env.sh) and return the variables it exported. */
function loadEnv(files: string[], env: Record<string, string> = {}, keys: string[]) {
  const script = `set -euo pipefail; . scripts/run-env.sh; load_env "$@"; ${keys.map((k) => `printf '%s=[%s]\\n' ${k} "\${${k}-<unset>}"`).join("; ")}`;
  const base: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/" };
  const r = Bun.spawnSync(["bash", "-c", script, "bash", ...files], { cwd: engineDir, env: { ...base, ...env } });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

describe(".env loading for the run scripts", () => {
  const dir = mkdtempSync(join(tmpdir(), "kin-env-"));
  const f = (name: string, body: string) => {
    const p = join(dir, name);
    writeFileSync(p, body);
    return p;
  };

  test("a quoted value with an inline comment loses its quotes and comment", () => {
    const p = f("q.env", 'BASE_RPC_URL="https://rpc.example" # archive node\nAMP=https://x/y?k=1&n=2\n');
    const r = loadEnv([p], {}, ["BASE_RPC_URL", "AMP"]);
    expect(r.out).toContain("BASE_RPC_URL=[https://rpc.example]");
    expect(r.out).toContain("AMP=[https://x/y?k=1&n=2]");
  });

  test("a blank line never hides a value set later, in the same file or a later file", () => {
    const a = f("a.env", "BASE_RPC_URL=\nDATA_DIR=\nDATA_DIR=/data\n");
    const b = f("b.env", "BASE_RPC_URL=https://from-b\n");
    const r = loadEnv([a, b], {}, ["BASE_RPC_URL", "DATA_DIR"]);
    expect(r.out).toContain("BASE_RPC_URL=[https://from-b]");
    expect(r.out).toContain("DATA_DIR=[/data]");
  });

  test("the caller's environment wins over the files", () => {
    const p = f("c.env", "HISTORY_PROVIDER=alchemy\n");
    expect(loadEnv([p], { HISTORY_PROVIDER: "blockscout" }, ["HISTORY_PROVIDER"]).out).toContain("HISTORY_PROVIDER=[blockscout]");
  });

  test("a loader failure stops the script instead of continuing unconfigured", () => {
    const r = loadEnv([dir /* a directory: unreadable as a file */], {}, ["X"]);
    expect(r.code).not.toBe(0);
    expect(r.out).not.toContain("X=");
    expect(r.err).toContain("load_env");
  });
});

describe("strict command lines", () => {
  test("gate A refuses a flag with no value instead of silently ignoring it", () => {
    expect(() => gateACli(["0x4200000000000000000000000000000000000006", "--out"])).toThrow(ConfigError);
    expect(() => gateACli(["--sample"])).toThrow(ConfigError);
    expect(() => gateACli(["--count", "abc", "0x4200000000000000000000000000000000000006"])).toThrow(ConfigError);
    expect(gateACli(["0x4200000000000000000000000000000000000006", "--out", "r.json"]).out).toBe("r.json");
  });

  test("replay refuses missing values, unknown options and extra arguments", () => {
    expect(() => replayCli(["s.json", "--out"])).toThrow(ConfigError);
    expect(() => replayCli(["s.json", "--reuse", "--publish"])).toThrow(ConfigError);
    expect(() => replayCli(["s.json", "extra.json"])).toThrow(ConfigError);
    expect(() => replayCli(["s.json", "--frobnicate"])).toThrow(ConfigError);
    expect(replayCli(["s.json", "--publish", "--out", "o.json"])).toEqual({ samplePath: "s.json", out: "o.json", reuse: [], publish: true });
  });

  test("the sample selector refuses a fourth positional argument (a forgotten --out)", () => {
    expect(() => selectArgs(["50", "7", "24", "replay/sample.json"])).toThrow("too many arguments");
    expect(() => selectArgs(["50", "--out", "--x"])).toThrow();
  });
});

describe("launch-chain history provider", () => {
  const KEYS = ["LAUNCH_HISTORY_PROVIDER", "LAUNCH_BLOCKSCOUT_API_URL", "BLOCKSCOUT_API_URL", "HISTORY_PROVIDER"];
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  afterEach(() => KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]))));

  test("blockscout on the launch chain needs its own URL and never falls back to mainnet's", () => {
    process.env.LAUNCH_HISTORY_PROVIDER = "blockscout";
    process.env.BLOCKSCOUT_API_URL = "https://mainnet-blockscout.example/api/v2";
    delete process.env.LAUNCH_BLOCKSCOUT_API_URL;
    expect(() => launchHistory(new Rpc("http://127.0.0.1:1"))).toThrow("LAUNCH_BLOCKSCOUT_API_URL");
    process.env.LAUNCH_BLOCKSCOUT_API_URL = "https://sepolia-blockscout.example/api/v2";
    expect(launchHistory(new Rpc("http://127.0.0.1:1")).name).toBe("blockscout");
  });
});
