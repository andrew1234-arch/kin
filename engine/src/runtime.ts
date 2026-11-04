import { createPublicClient, http, type PublicClient } from "viem";
import { scanOptionsFromEnv } from "./config";
import { historyFromEnv } from "./data/history";
import { Rpc } from "./data/rpc";
import { LaunchService } from "./launch/service";
import { LaunchStore } from "./launch/store";
import { chainFor } from "./sandbox/relayer";
import { envNum, envRequired, envStr } from "./env";
import { dataDir } from "./paths";

/**
 * Wiring shared by the API server and the admin CLI.
 *   DATA_DIR             where launch state, sandbox runs and replay reports live (default engine/data/runtime)
 *   LAUNCH_RPC_URL       RPC of the chain launches run on (Base Sepolia)
 *   LAUNCH_CHAIN_ID      its chain id (checked against the RPC at startup by the server)
 *   LAUNCH_HISTORY_PROVIDER  transfer-history provider for that chain (alchemy | blockscout | rpc-scan)
 */
/**
 * History provider for the launch chain (Base Sepolia). Configured on its own: it never inherits the Base
 * mainnet scan settings (HISTORY_PROVIDER, BLOCKSCOUT_API_URL).
 */
export function launchHistory(rpc: Rpc) {
  const provider = envStr("LAUNCH_HISTORY_PROVIDER") ?? "alchemy";
  const url = provider === "blockscout" ? envRequired("LAUNCH_BLOCKSCOUT_API_URL") : undefined;
  return historyFromEnv(rpc, provider, url);
}

export function launchRuntime() {
  const rpcUrl = envStr("LAUNCH_RPC_URL");
  const chainId = envNum("LAUNCH_CHAIN_ID", 84532, { min: 1, integer: true });
  const scanOpts = scanOptionsFromEnv();
  const pub: PublicClient | null = rpcUrl
    ? (createPublicClient({ chain: chainFor(chainId, rpcUrl), transport: http(rpcUrl) }) as PublicClient)
    : null;
  const store = new LaunchStore(dataDir());
  const service = new LaunchService({
    store,
    verify: async (address, message, signature) => {
      if (!pub) throw new Error("LAUNCH_RPC_URL is not set");
      return pub.verifyMessage({ address, message, signature });
    },
    rpc: () => {
      if (!rpcUrl) throw new Error("LAUNCH_RPC_URL is not set");
      return new Rpc(rpcUrl);
    },
    history: launchHistory,
    excluded: scanOpts.excluded,
    exclusionsSource: scanOpts.exclusionsSource,
    fundingWindowHours: scanOpts.fundingWindowHours,
  });
  return { service, store, pub, chainId, rpcUrl };
}
