import { getAddress, keccak256, toBytes, type Address, type Hex } from "viem";
import type { FundingEdge, WalletProfile } from "../src/types";

/** Deterministic test address from a label (not a real wallet). */
export const addr = (label: string): Address => getAddress("0x" + keccak256(toBytes("kin-test:" + label)).slice(26));
export const txh = (label: string): Hex => keccak256(toBytes("kin-test-tx:" + label));

/**
 * The sandbox scenario: one funder funds 20 fresh wallets (a bundle); two aged independent buyers;
 * three fresh unlinked wallets; one exchange hot wallet that funds an aged buyer and a fresh wallet
 * (must NOT link them).
 */
export function sandboxScenario() {
  const funder = addr("bundle-funder");
  const exchange = addr("exchange-hot-wallet");
  const bundle = Array.from({ length: 20 }, (_, i) => addr(`bundle-${i}`));
  const alice = addr("alice");
  const bob = addr("bob");
  const fresh = Array.from({ length: 3 }, (_, i) => addr(`fresh-${i}`));

  const edges: FundingEdge[] = [
    ...bundle.map((w, i) => ({
      from: funder,
      to: w,
      txHash: txh(`fund-bundle-${i}`),
      blockNumber: 100n + BigInt(i),
      timestamp: 1_700_000_000 + i * 2,
      value: 10n ** 17n,
      hop: 1 as const,
    })),
    { from: exchange, to: alice, txHash: txh("cex-alice"), blockNumber: 10n, timestamp: 1_690_000_000, value: 10n ** 18n, hop: 1 },
    { from: exchange, to: fresh[0]!, txHash: txh("cex-fresh0"), blockNumber: 11n, timestamp: 1_690_000_100, value: 10n ** 17n, hop: 1 },
  ];
  const wallets: WalletProfile[] = [
    ...bundle.map((w) => ({ wallet: w, nonce: 0 })),
    { wallet: alice, nonce: 250 },
    { wallet: bob, nonce: 40 },
    ...fresh.map((w) => ({ wallet: w, nonce: 0 })),
  ];
  return { funder, exchange, bundle, alice, bob, fresh, edges, wallets };
}
