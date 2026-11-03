import { getAddress, type Address } from "viem";

/**
 * The exact text a wallet signs to register for a launch, and to dispute it. Plain text so it reads
 * clearly in any wallet. Verification goes through an RPC client (viem verifyMessage), which also
 * accepts smart-contract wallets (ERC-1271 / ERC-6492).
 */
export function registrationMessage(launchId: string, wallet: Address, chainId: number): string {
  return [
    "Kin launch registration",
    `Launch: ${launchId}`,
    `Wallet: ${getAddress(wallet)}`,
    `Chain: ${chainId}`,
    "Signing is free and does not send a transaction.",
  ].join("\n");
}

export function disputeMessage(launchId: string, wallet: Address, chainId: number, reason: string): string {
  return [
    "Kin allowlist dispute",
    `Launch: ${launchId}`,
    `Wallet: ${getAddress(wallet)}`,
    `Chain: ${chainId}`,
    `Reason: ${reason}`,
  ].join("\n");
}
