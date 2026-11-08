import { getAddress, isAddress, parseEther, type Address } from "viem";
import { loadExclusions } from "./data/exclusions";
import { ConfigError, envNum, envPositiveBigInt, envStr } from "./env";

/** An ETH amount from an override or the environment; a malformed amount is a configuration error. */
function ethSetting(key: string, override: string | undefined, def: string): bigint {
  const v = override ?? envStr(key) ?? def;
  if (!/^\d+(\.\d+)?$/.test(v)) throw new ConfigError(`${key}=${v} is not an ETH amount`);
  return parseEther(v);
}
import { DEFAULT_SCAN_OPTIONS, type ScanOptions } from "./scan/scan";
import { WETH_BASE } from "./replay/clanker";

/**
 * Comma-separated ERC-20 addresses whose transfers count as funding. Unset: `def` (Base mainnet WETH, from the
 * clanker-sdk source cited in replay/clanker.ts). Add others (e.g. USDC) from a cited source; "none" disables.
 */
export function fundingTokens(key: string, def: Address[]): Address[] {
  const v = envStr(key);
  if (v === undefined) return def;
  if (v.trim().toLowerCase() === "none") return [];
  return v.split(",").map((a) => a.trim()).filter(Boolean).map((a) => {
    if (!isAddress(a)) throw new ConfigError(`${key}: ${a} is not an address`);
    return getAddress(a);
  });
}

/**
 * Scan options from the environment. Caps are product parameters (not facts about Base) and are
 * printed with every result: KIN_CAP_ETH per entity, KIN_FRESH_POOL_CAP_ETH shared by fresh wallets.
 */
export function scanOptionsFromEnv(
  overrides: Partial<{ capEth: string; freshCapEth: string; earlyBuyers: number }> = {},
): ScanOptions {
  const ex = loadExclusions();
  const extra = (envStr("EXTRA_EXCLUSIONS") ?? "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  extra.forEach((a) => ex.set.add(a));
  return {
    earlyBuyers: overrides.earlyBuyers ?? envNum("EARLY_BUYERS", DEFAULT_SCAN_OPTIONS.earlyBuyers, { min: 1, integer: true }),
    fundingWindowHours: envNum("FUNDING_WINDOW_HOURS", DEFAULT_SCAN_OPTIONS.fundingWindowHours, { min: 0 }),
    logsChunk: envPositiveBigInt("LOGS_CHUNK", DEFAULT_SCAN_OPTIONS.logsChunk),
    maxScanBlocks: envPositiveBigInt("MAX_SCAN_BLOCKS", DEFAULT_SCAN_OPTIONS.maxScanBlocks),
    maxHops: DEFAULT_SCAN_OPTIONS.maxHops,
    freshMaxNonce: envNum("FRESH_MAX_NONCE", DEFAULT_SCAN_OPTIONS.freshMaxNonce, { min: 0, integer: true }),
    freshMaxAgeHours: envNum("FRESH_MAX_AGE_HOURS", DEFAULT_SCAN_OPTIONS.freshMaxAgeHours, { min: 0 }),
    fundingTokens: fundingTokens("FUNDING_TOKENS", [WETH_BASE]),
    caps: {
      capWei: ethSetting("KIN_CAP_ETH", overrides.capEth, "0.1"),
      freshPoolCapWei: ethSetting("KIN_FRESH_POOL_CAP_ETH", overrides.freshCapEth, "0.2"),
    },
    excluded: ex.set,
    exclusionsSource: { ...ex.list.source, count: ex.list.count, extra },
  };
}
