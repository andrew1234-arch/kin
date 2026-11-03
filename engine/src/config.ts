import { parseEther } from "viem";
import { loadExclusions } from "./data/exclusions";
import { DEFAULT_SCAN_OPTIONS, type ScanOptions } from "./scan/scan";

const env = (k: string) => process.env[k];

/**
 * Scan options from the environment. Caps are product parameters (not facts about Base) and are
 * printed with every result: KIN_CAP_ETH per entity, KIN_FRESH_POOL_CAP_ETH shared by fresh wallets.
 */
export function scanOptionsFromEnv(
  overrides: Partial<{ capEth: string; freshCapEth: string; earlyBuyers: number }> = {},
): ScanOptions {
  const ex = loadExclusions();
  const extra = (env("EXTRA_EXCLUSIONS") ?? "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  extra.forEach((a) => ex.set.add(a));
  return {
    earlyBuyers: overrides.earlyBuyers ?? Number(env("EARLY_BUYERS") ?? DEFAULT_SCAN_OPTIONS.earlyBuyers),
    fundingWindowHours: Number(env("FUNDING_WINDOW_HOURS") ?? DEFAULT_SCAN_OPTIONS.fundingWindowHours),
    logsChunk: BigInt(env("LOGS_CHUNK") ?? DEFAULT_SCAN_OPTIONS.logsChunk),
    maxScanBlocks: BigInt(env("MAX_SCAN_BLOCKS") ?? DEFAULT_SCAN_OPTIONS.maxScanBlocks),
    maxHops: DEFAULT_SCAN_OPTIONS.maxHops,
    freshMaxNonce: Number(env("FRESH_MAX_NONCE") ?? DEFAULT_SCAN_OPTIONS.freshMaxNonce),
    caps: {
      capWei: parseEther(overrides.capEth ?? env("KIN_CAP_ETH") ?? "0.1"),
      freshPoolCapWei: parseEther(overrides.freshCapEth ?? env("KIN_FRESH_POOL_CAP_ETH") ?? "0.2"),
    },
    excluded: ex.set,
    exclusionsSource: { ...ex.list.source, count: ex.list.count, extra },
  };
}
