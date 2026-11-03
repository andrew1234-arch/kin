import { join } from "node:path";
import { createPublicClient, http, type PublicClient } from "viem";
import { scanOptionsFromEnv } from "./config";
import { historyFromEnv } from "./data/history";
import { Rpc } from "./data/rpc";
import { LaunchService } from "./launch/service";
import { LaunchStore } from "./launch/store";
import { chainFor } from "./sandbox/relayer";

/**
 * Wiring shared by the API server and the admin CLI.
 *   DATA_DIR             where launch state, sandbox runs and replay reports live (default engine/data/runtime)
 *   LAUNCH_RPC_URL       RPC of the chain launches run on (Base Sepolia)
 *   LAUNCH_CHAIN_ID      its chain id (checked against the RPC at startup by the server)
 *   LAUNCH_HISTORY_PROVIDER  transfer-history provider for that chain (alchemy | blockscout | rpc-scan)
 */
export function dataDir() {
  return process.env.DATA_DIR ?? join(import.meta.dir, "../data/runtime");
}

export function launchRuntime() {
  const rpcUrl = process.env.LAUNCH_RPC_URL;
  const chainId = Number(process.env.LAUNCH_CHAIN_ID ?? 84532);
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
    history: (rpc) => {
      const prev = process.env.HISTORY_PROVIDER;
      process.env.HISTORY_PROVIDER = process.env.LAUNCH_HISTORY_PROVIDER ?? prev;
      try {
        return historyFromEnv(rpc);
      } finally {
        process.env.HISTORY_PROVIDER = prev;
      }
    },
    excluded: scanOpts.excluded,
    exclusionsSource: scanOpts.exclusionsSource,
    fundingWindowHours: scanOpts.fundingWindowHours,
  });
  return { service, store, pub, chainId, rpcUrl };
}
