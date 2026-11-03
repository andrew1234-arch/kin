import { readFileSync } from "node:fs";
import { getAddress, parseEther, type Hex } from "viem";
import type { SandboxConfig } from "./relayer";

/**
 * Sandbox settings from the environment:
 *   SANDBOX_RPC_URL, SANDBOX_RELAYER_KEY, SANDBOX_DEPLOYMENT (path to contracts/deployments/<chainId>.json),
 *   SANDBOX_EXPLORER_URL (block explorer base URL for links; optional),
 *   SANDBOX_BUNDLE_SIZE (20), SANDBOX_PER_WALLET_ETH (0.0001), SANDBOX_CAP_BUYS (10),
 *   SANDBOX_WINDOW_DELAY_SEC (8), SANDBOX_WINDOW_SEC (600), SANDBOX_LOCK_SEC (300).
 */
export function sandboxConfigFromEnv(): SandboxConfig {
  const need = (k: string) => {
    const v = process.env[k];
    if (!v) throw new Error(`${k} is not set`);
    return v;
  };
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
    bundleSize: Number(process.env.SANDBOX_BUNDLE_SIZE ?? 20),
    perWalletWei: parseEther(process.env.SANDBOX_PER_WALLET_ETH ?? "0.0001"),
    capBuys: Number(process.env.SANDBOX_CAP_BUYS ?? 10),
    windowDelaySec: Number(process.env.SANDBOX_WINDOW_DELAY_SEC ?? 8),
    windowLengthSec: Number(process.env.SANDBOX_WINDOW_SEC ?? 600),
    lockSec: Number(process.env.SANDBOX_LOCK_SEC ?? 300),
    explorerUrl: process.env.SANDBOX_EXPLORER_URL || null,
  };
}
