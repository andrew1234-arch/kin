import { readFileSync } from "node:fs";
import { getAddress, parseEther, type Hex } from "viem";
import type { SandboxConfig } from "./relayer";
import { envNum, envRequired, envStr } from "../env";

/**
 * Sandbox settings from the environment:
 *   SANDBOX_RPC_URL, SANDBOX_RELAYER_KEY, SANDBOX_DEPLOYMENT (path to contracts/deployments/<chainId>.json),
 *   SANDBOX_EXPLORER_URL (block explorer base URL for links; optional),
 *   SANDBOX_BUNDLE_SIZE (20), SANDBOX_PER_WALLET_ETH (0.0001), SANDBOX_CAP_BUYS (10),
 *   SANDBOX_WINDOW_DELAY_SEC (8), SANDBOX_WINDOW_SEC (600), SANDBOX_LOCK_SEC (300).
 */
export function sandboxConfigFromEnv(): SandboxConfig {
  const need = (k: string) => envRequired(k);
  const dep = JSON.parse(readFileSync(need("SANDBOX_DEPLOYMENT"), "utf8"));
  return {
    rpcUrl: need("SANDBOX_RPC_URL"),
    chainId: Number(dep.chainId),
    relayerKey: need("SANDBOX_RELAYER_KEY") as Hex,
    deployment: {
      kinRouter: getAddress(dep.kinRouter),
      kinHook: getAddress(dep.kinHook),
      kinVault: getAddress(dep.kinVault),
      factory: getAddress(dep.factory),
    },
    bundleSize: envNum("SANDBOX_BUNDLE_SIZE", 20, { min: 1, integer: true }),
    perWalletWei: parseEther(envStr("SANDBOX_PER_WALLET_ETH") ?? "0.0001"),
    capBuys: envNum("SANDBOX_CAP_BUYS", 10, { min: 1, integer: true }),
    windowDelaySec: envNum("SANDBOX_WINDOW_DELAY_SEC", 8, { min: 0, integer: true }),
    windowLengthSec: envNum("SANDBOX_WINDOW_SEC", 600, { min: 1, integer: true }),
    lockSec: envNum("SANDBOX_LOCK_SEC", 300, { min: 0, integer: true }),
    explorerUrl: envStr("SANDBOX_EXPLORER_URL") ?? null,
  };
}
