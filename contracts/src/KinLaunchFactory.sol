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
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {KinHook} from "./KinHook.sol";
import {KinToken} from "./KinToken.sol";

/// @title KinLaunchFactory
/// @notice Deploys a fixed-supply token, creates a native-ETH/token v4 pool with KinHook, seeds
///         one-sided token liquidity, and configures the launch window on the hook.
///         A factory deployed with `hook = address(0)` is a sandbox-only PLAIN factory: it creates the
///         same token and pool without any hook (the attack sandbox's uncapped comparison). The Kin
///         factory cannot create plain pools, so its LaunchCreated events are always protected launches.
///
/// Price convention: currency0 is native ETH (address(0) always sorts first), currency1 is the token,
/// so a "buy" of the token is a zeroForOne swap. Ticks are in token-per-ETH terms. The token
/// liquidity sits in [tickLower, startTick) and the pool is initialised at startTick, so the position
/// holds only tokens until buyers push the price down into the range.
///
/// The LP position is owned by this factory and has no withdrawal path: launch liquidity is locked.
/// Its swap fees are not: the launch's creator can collect them with `collectFees`.
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

    struct Position {
        int24 tickLower;
        int24 tickUpper;
    }

    uint8 internal constant ACTION_SEED = 0;
    uint8 internal constant ACTION_COLLECT = 1;

    PoolKey[] internal _launchKeys;
    mapping(PoolId => address) public creatorOf;
    mapping(PoolId => Position) public positionOf;

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

    event FeesCollected(PoolId indexed id, address indexed creator, uint256 amount0, uint256 amount1);

    error NotPoolManager();
    error BadParams();
    error NotCreator();
    error PoolPreInitialized();

    constructor(IPoolManager _poolManager, KinHook _hook) {
        poolManager = _poolManager;
        hook = _hook;
    }

    function createLaunch(LaunchParams calldata p, bool plain) external returns (PoolId id, address token) {
        if (
            plain != (address(hook) == address(0)) || p.totalSupply == 0 || p.creatorAllocation >= p.totalSupply || p.tickSpacing <= 0
                || p.startTick % p.tickSpacing != 0 || p.tickLower % p.tickSpacing != 0 || p.tickLower >= p.startTick
                || p.tickLower < TickMath.minUsableTick(p.tickSpacing)
                || p.startTick > TickMath.maxUsableTick(p.tickSpacing)
        ) revert BadParams();

        // The block number in the salt makes the token address (and so the PoolKey) unknowable before the
        // block that creates it, so nobody can initialise the pool first from an earlier block.
        token = address(
            new KinToken{salt: keccak256(abi.encode(msg.sender, p.salt, block.number))}(
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
        // A pool someone initialised first at the same price is harmless (it holds no liquidity); any other
        // price is refused.
        try poolManager.initialize(key, sqrtStart) {}
        catch {
            (uint160 current,,,) = StateLibrary.getSlot0(poolManager, id);
            if (current != sqrtStart) revert PoolPreInitialized();
        }

        uint256 forPool = p.totalSupply - p.creatorAllocation;
        uint128 liquidity =
            LiquidityAmounts.getLiquidityForAmount1(TickMath.getSqrtPriceAtTick(p.tickLower), sqrtStart, forPool);
        uint256 used = abi.decode(
            poolManager.unlock(abi.encode(ACTION_SEED, abi.encode(key, p.tickLower, p.startTick, liquidity))), (uint256)
        );
        positionOf[id] = Position({tickLower: p.tickLower, tickUpper: p.startTick});

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
                    stats: p.stats,
                    totalSupply: p.totalSupply,
                    creatorAllocation: p.creatorAllocation
                })
            );
        }

        _launchKeys.push(key);
        creatorOf[id] = msg.sender;
        emit LaunchCreated(id, token, msg.sender, plain, key, p, liquidity, used);
    }

    /// @notice Send the launch position's accrued swap fees (ETH and token) to the launch's creator.
    function collectFees(PoolKey calldata key) external returns (uint256 amount0, uint256 amount1) {
        PoolId id = key.toId();
        address creator = creatorOf[id];
        if (msg.sender != creator) revert NotCreator();
        Position memory pos = positionOf[id];
        (amount0, amount1) = abi.decode(
            poolManager.unlock(abi.encode(ACTION_COLLECT, abi.encode(key, pos.tickLower, pos.tickUpper, creator))),
            (uint256, uint256)
        );
        emit FeesCollected(id, creator, amount0, amount1);
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (uint8 action, bytes memory data) = abi.decode(raw, (uint8, bytes));
        if (action == ACTION_COLLECT) return _collect(data);

        (PoolKey memory key, int24 tickLower, int24 tickUpper, uint128 liquidity) =
            abi.decode(data, (PoolKey, int24, int24, uint128));

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

    /// @dev A zero-liquidity modifyLiquidity "pokes" the position: the caller delta is exactly its fees.
    function _collect(bytes memory data) internal returns (bytes memory) {
        (PoolKey memory key, int24 tickLower, int24 tickUpper, address to) =
            abi.decode(data, (PoolKey, int24, int24, address));
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: 0, salt: bytes32(0)}), ""
        );
        uint256 a0 = uint256(uint128(delta.amount0()));
        uint256 a1 = uint256(uint128(delta.amount1()));
        if (a0 > 0) poolManager.take(key.currency0, to, a0);
        if (a1 > 0) poolManager.take(key.currency1, to, a1);
        return abi.encode(a0, a1);
    }

    function launchCount() external view returns (uint256) {
        return _launchKeys.length;
    }

    function launchKey(uint256 i) external view returns (PoolKey memory) {
        return _launchKeys[i];
    }
}
