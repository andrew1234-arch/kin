/**
 * Shared by Gate A and the replay: the sample file format, strict CLI helpers, output-path checks, the chain
 * check, and the per-token scan. Deliberately free of the launch/sandbox runtime.
 */
import { accessSync, constants, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { isAddress, type Hex } from "viem";
import { historyFromEnv } from "../data/history";
import { Rpc } from "../data/rpc";
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

/** Configuration or usage problem: the run should stop without producing a report (exit code 2). */
export class ConfigError extends Error {}

/** Read and validate a sample file; refuses an empty or unexplained sample. */
export function loadSample(path: string): ReplaySample {
  let sample: ReplaySample;
  try {
    sample = JSON.parse(readFileSync(path, "utf8")) as ReplaySample;
  } catch (e) {
    throw new ConfigError(`${path}: ${(e as Error).message}`);
  }
  if (!Number.isInteger(sample.chainId) || sample.chainId <= 0) throw new ConfigError(`${path}: missing chainId`);
  if (!sample.selection || /NOT YET CHOSEN/.test(sample.selection)) throw new ConfigError(`${path}: the sample has no selection method`);
  if (!Array.isArray(sample.tokens) || sample.tokens.length === 0) throw new ConfigError(`${path}: the sample has no tokens`);
  for (const t of sample.tokens) {
    if (!isAddress(t.address)) throw new ConfigError(`${path}: bad token address ${t.address}`);
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

/** Create the output's directory and check it is writable now, before hours of scanning. */
export function prepareOutput(path: string) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  accessSync(dir, constants.W_OK);
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
