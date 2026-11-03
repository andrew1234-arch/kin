// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {KinHook} from "./KinHook.sol";
import {KinToken} from "./KinToken.sol";

/// @title KinLaunchFactory
/// @notice Deploys a fixed-supply token, creates a native-ETH/token v4 pool with KinHook, seeds
///         one-sided token liquidity, and configures the launch window on the hook.
///         With `plain = true` it creates the same token and pool without any hook; the attack
///         sandbox uses this as the uncapped comparison.
///
/// Price convention: currency0 is native ETH (address(0) always sorts first), currency1 is the token,
/// so a "buy" of the token is a zeroForOne swap. Ticks are in token-per-ETH terms. The token
/// liquidity sits in [tickLower, startTick) and the pool is initialised at startTick, so the position
/// holds only tokens until buyers push the price down into the range.
///
/// The LP position is owned by this factory and has no withdrawal path: launch liquidity is locked.
contract KinLaunchFactory is IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;

    struct LaunchParams {
        string name;
        string symbol;
        uint256 totalSupply;
        uint256 creatorAllocation; // sent to the creator, outside the window; disclosed in events
        uint24 fee;
        int24 tickSpacing;
        int24 startTick;
        int24 tickLower;
        bytes32 root;
        bytes32 evidenceHash;
        KinHook.AllowlistStats stats;
        uint64 windowStart;
        uint64 windowEnd;
        uint64 lockDuration;
        bytes32 salt;
    }

    IPoolManager public immutable poolManager;
    KinHook public immutable hook;

    PoolKey[] internal _launchKeys;
    mapping(PoolId => address) public creatorOf;

    event LaunchCreated(
        PoolId indexed id,
        address indexed token,
        address indexed creator,
        bool plain,
        PoolKey key,
        LaunchParams params,
        uint128 liquidity,
        uint256 tokensInPool
    );

    error NotPoolManager();
    error BadParams();

    constructor(IPoolManager _poolManager, KinHook _hook) {
        poolManager = _poolManager;
        hook = _hook;
    }

    function createLaunch(LaunchParams calldata p, bool plain) external returns (PoolId id, address token) {
        if (
            p.totalSupply == 0 || p.creatorAllocation >= p.totalSupply || p.tickSpacing <= 0
                || p.startTick % p.tickSpacing != 0 || p.tickLower % p.tickSpacing != 0 || p.tickLower >= p.startTick
                || p.tickLower < TickMath.minUsableTick(p.tickSpacing)
                || p.startTick > TickMath.maxUsableTick(p.tickSpacing)
        ) revert BadParams();

        token = address(
            new KinToken{salt: keccak256(abi.encode(msg.sender, p.salt))}(
                p.name, p.symbol, p.totalSupply, address(this)
            )
        );

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: p.fee,
            tickSpacing: p.tickSpacing,
            hooks: plain ? IHooks(address(0)) : IHooks(address(hook))
        });
        id = key.toId();

        uint160 sqrtStart = TickMath.getSqrtPriceAtTick(p.startTick);
        poolManager.initialize(key, sqrtStart);

        uint256 forPool = p.totalSupply - p.creatorAllocation;
        uint128 liquidity =
            LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(p.tickLower), sqrtStart, forPool);
        uint256 used = abi.decode(poolManager.unlock(abi.encode(key, p.tickLower, p.startTick, liquidity)), (uint256));

        // Creator allocation plus rounding dust left over from the liquidity maths.
        uint256 rest = p.totalSupply - used;
        if (rest > 0) IERC20(token).safeTransfer(msg.sender, rest);

        if (!plain) {
            hook.configureLaunch(
                key,
                KinHook.LaunchConfig({
                    root: p.root,
                    evidenceHash: p.evidenceHash,
                    windowStart: p.windowStart,
                    windowEnd: p.windowEnd,
                    lockDuration: p.lockDuration,
                    buyIsZeroForOne: true,
                    admin: msg.sender,
                    stats: p.stats
                })
            );
        }

        _launchKeys.push(key);
        creatorOf[id] = msg.sender;
        emit LaunchCreated(id, token, msg.sender, plain, key, p, liquidity, used);
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (PoolKey memory key, int24 tickLower, int24 tickUpper, uint128 liquidity) =
            abi.decode(raw, (PoolKey, int24, int24, uint128));

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: int256(uint256(liquidity)), salt: bytes32(0)
            }),
            ""
        );

        // One-sided: only token (currency1) is owed.
        uint256 owed = uint256(uint128(-delta.amount1()));
        poolManager.sync(key.currency1);
        IERC20(Currency.unwrap(key.currency1)).safeTransfer(address(poolManager), owed);
        poolManager.settle();
        return abi.encode(owed);
    }

    function launchCount() external view returns (uint256) {
        return _launchKeys.length;
    }

    function launchKey(uint256 i) external view returns (PoolKey memory) {
        return _launchKeys[i];
    }
}
