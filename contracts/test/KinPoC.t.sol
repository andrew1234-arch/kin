// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {console2} from "forge-std/console2.sol";

import {KinHook} from "../src/KinHook.sol";
import {KinRouter} from "../src/KinRouter.sol";
import {KinFixture} from "./utils/KinFixture.sol";
import {SortedMerkle} from "./utils/SortedMerkle.sol";

/// @notice The 8 behaviours of the verified proof of concept (brief, Appendix A), re-run against
///         the production contracts (BaseHook, native-ETH pool from the factory, vaulted window buys).
contract KinPoCTest is KinFixture {
    function test_HonestBuyerWithinCap() public {
        _openWindow();
        uint256 out = _buy(alice, 0.5 ether);
        assertGt(out, 0, "no tokens");
        assertEq(hook.entitySpent(kinId, ALICE), 0.5 ether);
        // Window buys are vaulted, not sent to the buyer.
        assertEq(vault.owed(kinId, alice), out);
        assertEq(IERC20(kinToken).balanceOf(alice), 0);
        // A second buy up to exactly the cap still lands.
        _buy(alice, 0.5 ether);
        assertEq(hook.entitySpent(kinId, ALICE), CAP);
    }

    function test_BundleOf20CollapsesIntoOneCap() public {
        // Plain comparison pool: same token parameters, no hook.
        (, address plainToken) = factory.createLaunch(_params("Plain Demo", "PLN", bytes32("plain")), true);
        PoolKey memory plainKey = factory.launchKey(1);
        assertEq(address(plainKey.hooks), address(0));
        assertEq(Currency.unwrap(plainKey.currency1), plainToken);

        _openWindow();
        uint256 kinLanded;
        uint256 plainLanded;
        for (uint256 i; i < BUNDLE_SIZE; i++) {
            KinRouter.Allowance memory a = _allowance(bundle[i]);
            if (_tryBuy(bundle[i], kinKey, PER_WALLET, a)) kinLanded++;
            if (_tryBuy(bundle[i], plainKey, PER_WALLET, _noAllowance())) plainLanded++;
        }
        console2.log("Kin pool landed", kinLanded, "of", BUNDLE_SIZE);
        console2.log("Plain pool landed", plainLanded, "of", BUNDLE_SIZE);
        assertEq(kinLanded, CAP / PER_WALLET, "kin landed");
        assertEq(plainLanded, BUNDLE_SIZE, "plain landed");
        assertEq(hook.entitySpent(kinId, BUNDLE), CAP);

        // The 11th bundle buy fails specifically with EntityCapExceeded.
        _expectHookRevert(abi.encodeWithSelector(KinHook.EntityCapExceeded.selector, BUNDLE, CAP, CAP + PER_WALLET));
        _buy(bundle[10], PER_WALLET);
    }

    function test_IndependentBuyersUnaffectedByBundle() public {
        _openWindow();
        for (uint256 i; i < BUNDLE_SIZE; i++) {
            _tryBuy(bundle[i], kinKey, PER_WALLET, _allowance(bundle[i]));
        }
        assertEq(hook.entitySpent(kinId, BUNDLE), CAP);
        _buy(alice, CAP);
        _buy(bob, CAP);
        assertEq(hook.entitySpent(kinId, ALICE), CAP);
        assertEq(hook.entitySpent(kinId, BOB), CAP);
    }

    function test_NotOnAllowlistReverts() public {
        _openWindow();
        vm.deal(stranger, 1 ether);
        KinRouter.Allowance memory fake =
            KinRouter.Allowance({entityId: keccak256("entity:stranger"), entityCap: CAP, proof: new bytes32[](0)});
        _expectHookRevert(abi.encodeWithSelector(KinHook.NotOnAllowlist.selector));
        _buy(stranger, kinKey, 0.1 ether, fake);
    }

    function test_BundlerCannotBorrowAnotherEntity() public {
        _openWindow();
        // Bundle wallet presents Alice's entity, cap and proof: the leaf binds the wallet, so it fails.
        KinRouter.Allowance memory borrowed = _allowance(alice);
        _expectHookRevert(abi.encodeWithSelector(KinHook.NotOnAllowlist.selector));
        _buy(bundle[0], kinKey, 0.1 ether, borrowed);
    }

    function test_CannotSpoofBuyerThroughOtherRouter() public {
        _openWindow();
        // Another router forwards hook data that claims to be Alice.
        KinRouter.Allowance memory a = _allowance(alice);
        bytes memory spoofed = abi.encode(alice, a.entityId, a.entityCap, a.proof);
        vm.deal(stranger, 1 ether);
        _expectHookRevert(abi.encodeWithSelector(KinHook.UntrustedRouter.selector));
        vm.prank(stranger);
        swapRouter.swap{value: 0.1 ether}(
            kinKey,
            SwapParams({zeroForOne: true, amountSpecified: -0.1 ether, sqrtPriceLimitX96: MIN_PRICE_LIMIT}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            spoofed
        );
    }

    function test_SellsBlockedDuringWindow() public {
        _openWindow();
        deal(kinToken, alice, 1_000_000 ether);
        vm.prank(alice);
        IERC20(kinToken).approve(address(router), type(uint256).max);
        KinRouter.Allowance memory a = _allowance(alice);
        _expectHookRevert(abi.encodeWithSelector(KinHook.SellsLockedDuringWindow.selector));
        vm.prank(alice);
        router.swapExactIn(kinKey, false, 1_000 ether, 0, a, block.timestamp);
    }

    function test_OpenTradingAfterWindow() public {
        _closeWindow();
        // Any router, any wallet, both directions.
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        swapRouter.swap{value: 0.2 ether}(
            kinKey,
            SwapParams({zeroForOne: true, amountSpecified: -0.2 ether, sqrtPriceLimitX96: MIN_PRICE_LIMIT}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        uint256 bought = IERC20(kinToken).balanceOf(stranger);
        assertGt(bought, 0);

        vm.startPrank(stranger);
        IERC20(kinToken).approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(
            kinKey,
            SwapParams({zeroForOne: false, amountSpecified: -int256(bought / 2), sqrtPriceLimitX96: MAX_PRICE_LIMIT}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
        assertEq(IERC20(kinToken).balanceOf(stranger), bought - bought / 2);

        // KinRouter after the window delivers directly, not to the vault.
        uint256 out = _buy(stranger, kinKey, 0.1 ether, _noAllowance());
        assertEq(IERC20(kinToken).balanceOf(stranger), bought - bought / 2 + out);
        assertEq(vault.owed(kinId, stranger), 0);
    }
}
