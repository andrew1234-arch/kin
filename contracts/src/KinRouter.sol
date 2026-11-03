// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {KinHook} from "./KinHook.sol";
import {KinVault} from "./KinVault.sol";

/// @title KinRouter
/// @notice The only router KinHook trusts during a launch window. It writes its own msg.sender into
///         the hook data, so a buyer cannot claim to be someone else. Window buys are delivered to
///         KinVault on the buyer's behalf; outside a window it behaves as a plain exact-input router.
///         Native ETH (Currency address(0)) and ERC-20 quote currencies are both supported.
contract KinRouter is IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using SafeERC20 for IERC20;

    struct Allowance {
        bytes32 entityId;
        uint256 entityCap;
        bytes32[] proof;
    }

    struct CallbackData {
        address payer;
        address recipient;
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
        uint256 minAmountOut;
        bytes hookData;
    }

    IPoolManager public immutable poolManager;
    address public immutable deployer;
    KinHook public hook;
    KinVault public vault;

    event Swapped(
        PoolId indexed id, address indexed buyer, bool zeroForOne, uint256 amountIn, uint256 amountOut, bool vaulted
    );

    error NotDeployer();
    error AlreadyWired();
    error NotPoolManager();
    error Expired();
    error BadMsgValue();
    error TooLittleReceived(uint256 amountOut, uint256 minAmountOut);
    error AmountTooLarge();
    error RefundFailed();

    constructor(IPoolManager _poolManager, address _deployer) {
        poolManager = _poolManager;
        deployer = _deployer;
    }

    /// @notice One-shot wiring (the hook address is mined after the router exists).
    function wire(KinHook _hook, KinVault _vault) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (address(hook) != address(0)) revert AlreadyWired();
        hook = _hook;
        vault = _vault;
    }

    /// @notice Exact-input swap. On a Kin pool during its window this is a capped, vaulted buy.
    /// @param allowance The caller's allowlist leaf and proof. Ignored outside a Kin window.
    function swapExactIn(
        PoolKey calldata key,
        bool zeroForOne,
        uint256 amountIn,
        uint256 minAmountOut,
        Allowance calldata allowance,
        uint256 deadline
    ) external payable returns (uint256 amountOut) {
        if (block.timestamp > deadline) revert Expired();
        if (amountIn == 0 || amountIn > uint256(type(int256).max)) revert AmountTooLarge();

        Currency input = zeroForOne ? key.currency0 : key.currency1;
        if (input.isAddressZero()) {
            if (msg.value < amountIn) revert BadMsgValue();
        } else if (msg.value != 0) {
            revert BadMsgValue();
        }

        PoolId id = key.toId();
        bool kinPool = address(key.hooks) == address(hook) && address(hook) != address(0);
        bool vaulted = kinPool && hook.isWindowOpen(id);

        uint256 paid;
        (paid, amountOut) = _unlockAndSwap(key, zeroForOne, amountIn, minAmountOut, allowance, kinPool, vaulted);

        if (vaulted) {
            vault.credit(id, zeroForOne ? key.currency1 : key.currency0, msg.sender, amountOut);
        }

        // Refund unused native ETH (overpayment, or a partial fill at the price limit).
        if (input.isAddressZero() && msg.value > paid) {
            (bool ok,) = msg.sender.call{value: msg.value - paid}("");
            if (!ok) revert RefundFailed();
        }

        emit Swapped(id, msg.sender, zeroForOne, paid, amountOut, vaulted);
    }

    function _unlockAndSwap(
        PoolKey calldata key,
        bool zeroForOne,
        uint256 amountIn,
        uint256 minAmountOut,
        Allowance calldata allowance,
        bool kinPool,
        bool vaulted
    ) internal returns (uint256 paid, uint256 amountOut) {
        CallbackData memory d;
        d.payer = msg.sender;
        d.recipient = vaulted ? address(vault) : msg.sender;
        d.key = key;
        d.zeroForOne = zeroForOne;
        d.amountIn = amountIn;
        d.minAmountOut = minAmountOut;
        if (kinPool) d.hookData = abi.encode(msg.sender, allowance.entityId, allowance.entityCap, allowance.proof);
        (paid, amountOut) = abi.decode(poolManager.unlock(abi.encode(d)), (uint256, uint256));
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        CallbackData memory d = abi.decode(raw, (CallbackData));

        BalanceDelta delta = poolManager.swap(
            d.key,
            SwapParams({
                zeroForOne: d.zeroForOne,
                amountSpecified: -int256(d.amountIn),
                sqrtPriceLimitX96: d.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            d.hookData
        );

        (Currency input, Currency output) =
            d.zeroForOne ? (d.key.currency0, d.key.currency1) : (d.key.currency1, d.key.currency0);
        int128 inDelta = d.zeroForOne ? delta.amount0() : delta.amount1();
        int128 outDelta = d.zeroForOne ? delta.amount1() : delta.amount0();
        uint256 paid = uint256(uint128(-inDelta));
        uint256 out = uint256(uint128(outDelta));
        if (out < d.minAmountOut) revert TooLittleReceived(out, d.minAmountOut);

        // Settle the input.
        if (input.isAddressZero()) {
            poolManager.settle{value: paid}();
        } else {
            poolManager.sync(input);
            IERC20(Currency.unwrap(input)).safeTransferFrom(d.payer, address(poolManager), paid);
            poolManager.settle();
        }
        // Deliver the output (to KinVault during a window).
        poolManager.take(output, d.recipient, out);

        return abi.encode(paid, out);
    }

    receive() external payable {
        if (msg.sender != address(poolManager)) revert BadMsgValue();
    }
}
