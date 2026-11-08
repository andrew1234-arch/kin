/** Where a chain id's data comes from, in words a visitor can trust. */
export function chainLabel(id: number): { name: string; kind: string; tone: "live" | "test" | "local" } {
  if (id === 8453) return { name: "Base mainnet", kind: "Mainnet", tone: "live" };
  if (id === 84532) return { name: "Base Sepolia", kind: "Testnet", tone: "test" };
  if (id === 31337) return { name: "Anvil", kind: "Local chain", tone: "local" };
  return { name: `Chain ${id}`, kind: "Test chain", tone: "test" };
}
