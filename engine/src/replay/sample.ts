/**
 * Shared by Gate A and the replay: the sample file format, strict CLI helpers, output-path checks, the chain
 * check, and the per-token scan. Deliberately free of the launch/sandbox runtime.
 */
import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { isAddress, type Hex } from "viem";
import { historyFromEnv } from "../data/history";
import { Rpc } from "../data/rpc";
import { ConfigError } from "../env";
import { scanToken, type ScanOptions, type ScanResult } from "../scan/scan";

export interface SampleToken {
  address: string;
  source: string;
  /** The launch's creation block, when known. */
  createdBlock?: string;
}

export interface ReplaySample {
  chainId: number;
  selection: string; // how the sample was chosen, in words
  tokens: SampleToken[];
}

export { ConfigError };

/**
 * Exit codes shared by gateA.ts and replay.ts. "Nothing scanned" is 10, not 1, because 1 is what Bun uses
 * for any uncaught crash and a caller must be able to tell the two apart.
 */
export const EXIT = { ok: 0, config: 2, unexpected: 3, nothingScanned: 10 } as const;

/** Run a CLI's main(): its return value is the exit code; ConfigError → 2, anything else → 3. */
export function runCli(main: () => Promise<number>) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof ConfigError ? `configuration error: ${e.message}` : e);
      process.exit(e instanceof ConfigError ? EXIT.config : EXIT.unexpected);
    },
  );
}

/** Read and validate a sample file; refuses an empty or unexplained sample. */
export function loadSample(path: string): ReplaySample {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new ConfigError(`${path}: ${(e as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(`${path}: a sample must be a JSON object with chainId, selection and tokens`);
  }
  const sample = parsed as ReplaySample;
  if (!Number.isInteger(sample.chainId) || sample.chainId <= 0) throw new ConfigError(`${path}: chainId must be a positive integer`);
  if (!sample.selection || /NOT YET CHOSEN/.test(sample.selection)) throw new ConfigError(`${path}: the sample has no selection method`);
  if (!Array.isArray(sample.tokens) || sample.tokens.length === 0) throw new ConfigError(`${path}: the sample has no tokens`);
  const seen = new Set<string>();
  for (const t of sample.tokens) {
    if (typeof t !== "object" || t === null || !isAddress(t.address)) throw new ConfigError(`${path}: bad token entry ${JSON.stringify(t)}`);
    const key = t.address.toLowerCase();
    if (seen.has(key)) throw new ConfigError(`${path}: token ${t.address} is listed twice; it would be counted twice`);
    seen.add(key);
    if (t.createdBlock !== undefined && !/^\d+$/.test(t.createdBlock)) throw new ConfigError(`${path}: bad createdBlock for ${t.address}`);
  }
  return sample;
}

/** The value after a flag; refuses a missing value or another flag in its place. */
export function flagValue(argv: string[], i: number, flag: string): string {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) throw new ConfigError(`${flag} needs a value`);
  return v;
}

/**
 * Check, before hours of scanning, that `path` can be written: its directory is created and writable, and
 * the path itself is not a directory or a read-only file.
 */
export function prepareOutput(path: string) {
  const dir = dirname(path);
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    if (existsSync(path)) {
      if (statSync(path).isDirectory()) throw new Error("it is a directory");
      accessSync(path, constants.W_OK);
    }
  } catch (e) {
    throw new ConfigError(`cannot write ${path}: ${(e as Error).message}`);
  }
}

/** The RPC must serve the chain the sample was drawn from. */
export async function assertChain(rpc: Rpc, expected: number) {
  const got = Number(BigInt(await rpc.call<Hex>("eth_chainId", [])));
  if (got !== expected) throw new ConfigError(`the RPC serves chain ${got}, the sample is for chain ${expected}`);
}

/**
 * Scan one sample token. `useHint` passes the known creation block, so the deploy block costs two calls
 * instead of a binary search. Gate A does NOT use it: it must measure what an unhinted /scan really costs.
 */
export function scanSampleToken(t: SampleToken, opts: ScanOptions, useHint: boolean): Promise<ScanResult> {
  const rpc = Rpc.fromEnv();
  const hints = useHint && t.createdBlock ? { deployBlock: BigInt(t.createdBlock) } : {};
  return scanToken(rpc, historyFromEnv(rpc), t.address, opts, hints);
}
