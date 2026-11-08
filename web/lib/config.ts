import { defineChain, getAddress, type Address } from "viem";

/**
 * Runtime configuration. Nothing here is hardcoded: endpoints, chain and contract addresses come
 * from NEXT_PUBLIC_* variables set at deploy time (see web/.env.example).
 */
export const API_URL = (process.env.NEXT_PUBLIC_KIN_API ?? "").replace(/\/$/, "");
/**
 * Static copy of each deployed launch (engine `admin.ts publish`: DATA_DIR/publish/<slug>.json, hosted anywhere
 * static such as IPFS or a bucket). The launch page falls back to it for the launch record and proofs when the
 * engine API is unreachable, so the window doesn't depend on one server staying up.
 */
export const LAUNCH_MIRROR = (process.env.NEXT_PUBLIC_LAUNCH_MIRROR ?? "").replace(/\/$/, "");
/** Slippage tolerance for window buys, in basis points of the quoted output. */
export const SLIPPAGE_BPS = Number(process.env.NEXT_PUBLIC_SLIPPAGE_BPS || 300);

export const LAUNCH_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 84532);
export const LAUNCH_RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "";
/** Block explorer for the launch chain (Base Sepolia), e.g. its base URL without a trailing slash. */
export const LAUNCH_EXPLORER = (process.env.NEXT_PUBLIC_EXPLORER_URL ?? "").replace(/\/$/, "");
/** Block explorer for Base mainnet, used by Kin Scan links. */
export const SCAN_EXPLORER = (process.env.NEXT_PUBLIC_SCAN_EXPLORER_URL ?? "").replace(/\/$/, "");

export interface Deployment {
  kinRouter: Address;
  kinHook: Address;
  kinVault: Address;
  factory: Address;
}

function parseDeployment(): Deployment | null {
  const raw = process.env.NEXT_PUBLIC_DEPLOYMENT_JSON;
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    return {
      kinRouter: getAddress(d.kinRouter),
      kinHook: getAddress(d.kinHook),
      kinVault: getAddress(d.kinVault),
      factory: getAddress(d.factory),
    };
  } catch {
    return null;
  }
}
export const DEPLOYMENT = parseDeployment();

export const launchChain = defineChain({
  id: LAUNCH_CHAIN_ID,
  name: LAUNCH_CHAIN_ID === 84532 ? "Base Sepolia" : LAUNCH_CHAIN_ID === 31337 ? "Local" : `Chain ${LAUNCH_CHAIN_ID}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: LAUNCH_RPC_URL ? [LAUNCH_RPC_URL] : [] } },
  testnet: LAUNCH_CHAIN_ID !== 8453,
});

export const txUrl = (explorer: string, hash: string) => (explorer ? `${explorer}/tx/${hash}` : null);
export const addrUrl = (explorer: string, a: string) => (explorer ? `${explorer}/address/${a}` : null);
