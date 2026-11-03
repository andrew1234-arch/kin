import { parseAbiItem, type Address } from "viem";

/**
 * Clanker v4 on Base, as published by Clanker in its official SDK repository:
 *   https://github.com/clanker-devco/clanker-sdk @ cb6783369a8bf7fb6983409b96cab6a2f738b4ca
 *   - factory address: src/utils/clankers.ts, entry `clanker_v4` (chainId base.id)
 *   - TokenCreated event: src/abi/v4/Clanker.ts
 *   - WETH on Base: src/constants.ts, WETH_ADDRESSES[base.id]
 */
export const CLANKER_SOURCE = {
  repo: "https://github.com/clanker-devco/clanker-sdk",
  commit: "cb6783369a8bf7fb6983409b96cab6a2f738b4ca",
  files: ["src/utils/clankers.ts (clanker_v4)", "src/abi/v4/Clanker.ts (TokenCreated)", "src/constants.ts (WETH_ADDRESSES)"],
};

export const CLANKER_V4_FACTORY_BASE: Address = "0xE85A59c628F7d27878ACeB4bf3b35733630083a9";
export const WETH_BASE: Address = "0x4200000000000000000000000000000000000006";

export const TOKEN_CREATED = parseAbiItem(
  "event TokenCreated(address msgSender, address indexed tokenAddress, address indexed tokenAdmin, string tokenImage, string tokenName, string tokenSymbol, string tokenMetadata, string tokenContext, int24 startingTick, address poolHook, bytes32 poolId, address pairedToken, address locker, address mevModule, uint256 extensionsSupply, address[] extensions)",
);
