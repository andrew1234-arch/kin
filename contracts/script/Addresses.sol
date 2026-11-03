// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice External addresses used by the deploy scripts. Nothing here is from memory.
///
/// Uniswap v4 deployments. Source: the official Uniswap docs repository,
///   https://github.com/Uniswap/docs/blob/1c7597d73be0e9a3a4e44aa75b8fb212b40ea136/content/protocols/v4/deployments.mdx
///   (rendered at docs.uniswap.org/contracts/v4/deployments), sections "Base: 8453" and "Base Sepolia: 84532".
///
/// CREATE2 deployer used by `forge script` for `new X{salt: s}()`. Source: the same repository,
///   content/protocols/v4/guides/hooks/hook-deployment.mdx ("In `forge script`, this should be
///   `0x4e59b44847b379578588920cA78FbF26c0B4956C` (CREATE2 Deployer Proxy)").
library Addresses {
    uint256 internal constant BASE = 8453;
    uint256 internal constant BASE_SEPOLIA = 84532;
    uint256 internal constant ANVIL = 31337;

    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    // Base (8453)
    address internal constant BASE_POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address internal constant BASE_STATE_VIEW = 0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71;

    // Base Sepolia (84532)
    address internal constant BASE_SEPOLIA_POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    address internal constant BASE_SEPOLIA_STATE_VIEW = 0x571291b572ed32ce6751a2Cb2486EbEe8DEfB9B4;
    /// v4-core's PoolSwapTest router, deployed by Uniswap on Base Sepolia. Gate B uses it as the
    /// "any other router" that must be rejected during the window.
    address internal constant BASE_SEPOLIA_POOL_SWAP_TEST = 0x8B5bcC363ddE2614281aD875bad385E0A785D3B9;

    function poolManager(uint256 chainId) internal pure returns (address) {
        if (chainId == BASE) return BASE_POOL_MANAGER;
        if (chainId == BASE_SEPOLIA) return BASE_SEPOLIA_POOL_MANAGER;
        return address(0); // anvil: the deploy script deploys a fresh PoolManager
    }
}
