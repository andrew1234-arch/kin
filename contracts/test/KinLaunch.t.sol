// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {KinHook} from "../src/KinHook.sol";
import {KinRouter} from "../src/KinRouter.sol";
import {KinVault} from "../src/KinVault.sol";
import {KinLaunchFactory} from "../src/KinLaunchFactory.sol";
import {KinToken} from "../src/KinToken.sol";
import {KinFixture} from "./utils/KinFixture.sol";
import {SortedMerkle} from "./utils/SortedMerkle.sol";

contract KinLaunchTest is KinFixture {
    using PoolIdLibrary for PoolKey;

    // ------------------------------------------------------------------ factory / config

    function test_FactoryLaunchIsConfigured() public view {
        KinHook.Launch memory l = hook.getLaunch(kinId);
        assertTrue(l.configured);
        assertEq(l.root, root);
        assertEq(l.evidenceHash, EVIDENCE);
        assertEq(l.windowStart, windowStart);
        assertEq(l.windowEnd, windowEnd);
        assertEq(l.lockDuration, LOCK);
        assertTrue(l.buyIsZeroForOne);
        assertEq(l.admin, address(this));
        assertEq(l.stats.linkedWallets, 20);
        assertEq(l.stats.freshWallets, 3);
        // Native ETH is currency0, the token is currency1, the hook is KinHook.
        assertEq(Currency.unwrap(kinKey.currency0), address(0));
        assertEq(Currency.unwrap(kinKey.currency1), kinToken);
        assertEq(address(kinKey.hooks), address(hook));
        // All supply went into the pool (creatorAllocation = 0), bar wei-level rounding dust returned to the creator.
        assertEq(IERC20(kinToken).totalSupply(), SUPPLY);
        assertLe(IERC20(kinToken).balanceOf(address(this)), SUPPLY / 1e18);
        assertEq(IERC20(kinToken).balanceOf(address(factory)), 0);
    }

    function test_HookAddressHasOnlySwapFlags() public view {
        uint160 flags = uint160(address(hook)) & uint160((1 << 14) - 1);
        assertEq(flags, uint160((1 << 7) | (1 << 6))); // Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
    }

    function test_FactoryEnforcesHookLimits() public {
        KinLaunchFactory.LaunchParams memory p = _params("Bad", "BAD", bytes32("review"));
        p.windowStart = uint64(block.timestamp) + MIN_REVIEW - 1; // no time to review the root
        p.windowEnd = p.windowStart + WINDOW;
        vm.expectRevert(KinHook.InvalidConfig.selector);
        factory.createLaunch(p, false);

        p = _params("Bad", "BAD", bytes32("short"));
        p.windowEnd = p.windowStart + MIN_WINDOW - 1; // cosmetic window
        vm.expectRevert(KinHook.InvalidConfig.selector);
        factory.createLaunch(p, false);

        p = _params("Bad", "BAD", bytes32("long"));
        p.windowEnd = p.windowStart + MAX_WINDOW + 1; // endless window
        vm.expectRevert(KinHook.InvalidConfig.selector);
        factory.createLaunch(p, false);

        p = _params("Bad", "BAD", bytes32("lock"));
        p.lockDuration = MAX_LOCK + 1;
        vm.expectRevert(KinHook.InvalidConfig.selector);
        factory.createLaunch(p, false);

        p = _params("Bad", "BAD", bytes32("creator"));
        p.creatorAllocation = SUPPLY * MAX_CREATOR_BPS / 10_000 + 1;
        vm.expectRevert(KinHook.InvalidConfig.selector);
        factory.createLaunch(p, false);
    }

    function test_CreatorAllocationIsOnTheReceipt() public {
        KinLaunchFactory.LaunchParams memory p = _params("Creator", "CRT", bytes32("creator-ok"));
        p.creatorAllocation = SUPPLY * MAX_CREATOR_BPS / 10_000;
        (PoolId id,) = factory.createLaunch(p, false);
        KinHook.Receipt memory r = hook.getReceipt(id);
        assertEq(r.totalSupply, SUPPLY);
        assertEq(r.creatorAllocation, p.creatorAllocation);
    }

    function test_PlainPoolsOnlyFromThePlainFactory() public {
        vm.expectRevert(KinLaunchFactory.BadParams.selector);
        factory.createLaunch(_params("Plain", "PLN", bytes32("p1")), true);
        vm.expectRevert(KinLaunchFactory.BadParams.selector);
        plainFactory.createLaunch(_params("Kin", "KIN", bytes32("p2")), false);
    }

    function test_PreInitialisedPoolAtTheSamePriceIsTolerated() public {
        KinLaunchFactory.LaunchParams memory p = _params("Pre", "PRE", bytes32("pre"));
        PoolKey memory key = _predictKey(p);
        manager.initialize(key, TickMath.getSqrtPriceAtTick(START_TICK)); // a griefer gets there first
        (PoolId id,) = factory.createLaunch(p, false);
        assertEq(PoolId.unwrap(id), PoolId.unwrap(key.toId()));
        assertTrue(hook.getLaunch(id).configured);
    }

    function test_PreInitialisedPoolAtAnotherPriceIsRefused() public {
        KinLaunchFactory.LaunchParams memory p = _params("Pre", "PRE", bytes32("pre2"));
        manager.initialize(_predictKey(p), TickMath.getSqrtPriceAtTick(START_TICK + SPACING));
        vm.expectRevert(KinLaunchFactory.PoolPreInitialized.selector);
        factory.createLaunch(p, false);
    }

    function test_CreatorCollectsFees() public {
        _openWindow();
        _buy(alice, 1 ether);
        vm.prank(stranger);
        vm.expectRevert(KinLaunchFactory.NotCreator.selector);
        factory.collectFees(kinKey);

        uint256 before = address(this).balance;
        (uint256 eth,) = factory.collectFees(kinKey);
        assertGt(eth, 0, "no ETH fees");
        assertApproxEqAbs(eth, 0.01 ether, 1, "1% of a 1 ETH buy"); // fee tier 10_000 = 1%
        assertEq(address(this).balance - before, eth);
    }

    function test_ConfigureOnlyByFactory() public {
        vm.expectRevert(KinHook.NotFactory.selector);
        hook.configureLaunch(kinKey, _cfg(root));
    }

    function test_SetFactoryOnlyOnce() public {
        vm.expectRevert(KinHook.FactoryAlreadySet.selector);
        hook.setFactory(address(1));
        vm.prank(stranger);
        vm.expectRevert(KinHook.NotOwner.selector);
        hook.setFactory(address(1));
    }

    function test_FactoryRejectsWindowInPast() public {
        KinLaunchFactory.LaunchParams memory p = _params("Late", "LATE", bytes32("late"));
        p.windowStart = uint64(block.timestamp - 1);
        vm.expectRevert(KinHook.InvalidConfig.selector);
        factory.createLaunch(p, false);
    }

    function test_UnconfiguredPoolWithKinHookCannotTrade() public {
        // Someone initialises their own pool with KinHook, bypassing the factory.
        PoolKey memory rogue = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(kinToken),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        manager.initialize(rogue, TickMath.getSqrtPriceAtTick(0));
        vm.deal(stranger, 1 ether);
        _expectHookRevert(abi.encodeWithSelector(KinHook.NotConfigured.selector));
        _buy(stranger, rogue, 0.1 ether, _noAllowance());
    }

    // ------------------------------------------------------------------ windowStart

    function test_AllSwapsRevertBeforeWindowStart() public {
        _expectHookRevert(abi.encodeWithSelector(KinHook.WindowNotOpen.selector, windowStart));
        _buy(alice, 0.1 ether);

        vm.deal(stranger, 1 ether);
        _expectHookRevert(abi.encodeWithSelector(KinHook.WindowNotOpen.selector, windowStart));
        vm.prank(stranger);
        swapRouter.swap{value: 0.1 ether}(
            kinKey,
            SwapParams({zeroForOne: true, amountSpecified: -0.1 ether, sqrtPriceLimitX96: MIN_PRICE_LIMIT}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );

        vm.warp(windowStart - 1);
        _expectHookRevert(abi.encodeWithSelector(KinHook.WindowNotOpen.selector, windowStart));
        _buy(alice, 0.1 ether);

        vm.warp(windowStart);
        assertTrue(hook.isWindowOpen(kinId));
        _buy(alice, 0.1 ether);
    }

    // ------------------------------------------------------------------ dispute period / root updates

    function test_RootUpdateDuringDisputePeriod() public {
        // A disputed wallet (stranger) is added as its own entity before the window.
        leaves.push(SortedMerkle.leaf(stranger, keccak256("entity:stranger"), CAP));
        wallets.push(stranger);
        entityOf.push(keccak256("entity:stranger"));
        capOf.push(CAP);
        bytes32 newRoot = SortedMerkle.root(leaves);
        KinHook.AllowlistStats memory s = _stats();
        s.allowlistedWallets = 26;
        s.entities = 5;

        hook.updateAllowlist(kinId, newRoot, keccak256("evidence-v2.json"), s);
        KinHook.Launch memory l = hook.getLaunch(kinId);
        assertEq(l.root, newRoot);
        assertEq(l.evidenceHash, keccak256("evidence-v2.json"));
        assertEq(l.stats.allowlistedWallets, 26);

        _openWindow();
        vm.deal(stranger, 1 ether);
        _buy(stranger, 0.1 ether);
        assertEq(hook.entitySpent(kinId, keccak256("entity:stranger")), 0.1 ether);
    }

    function test_LateRootUpdatePushesTheWindowBack() public {
        vm.warp(windowStart - 1); // one second before the window
        hook.updateAllowlist(kinId, keccak256("late-root"), keccak256("ev"), _stats());
        KinHook.Launch memory l = hook.getLaunch(kinId);
        assertEq(l.windowStart, block.timestamp + MIN_REVIEW, "a full review period follows the change");
        assertEq(l.windowEnd - l.windowStart, WINDOW, "window length kept");
    }

    function test_EntityCapIsPinnedByTheFirstBuy() public {
        // A second leaf for the bundle entity claims a bigger cap than the one already proven.
        leaves.push(SortedMerkle.leaf(stranger, BUNDLE, 5 ether));
        wallets.push(stranger);
        entityOf.push(BUNDLE);
        capOf.push(5 ether);
        hook.updateAllowlist(kinId, SortedMerkle.root(leaves), keccak256("evidence-v2.json"), _stats());
        windowStart = hook.getLaunch(kinId).windowStart;
        _openWindow();
        _buy(bundle[0], PER_WALLET);
        vm.deal(stranger, 10 ether);
        KinRouter.Allowance memory a = _allowance(stranger);
        vm.prank(stranger);
        _expectAfterSwapRevert(abi.encodeWithSelector(KinHook.EntityCapMismatch.selector, BUNDLE, CAP, 5 ether));
        router.swapExactIn{value: 2 ether}(kinKey, true, 2 ether, 0, a, block.timestamp);
    }

    function test_PartialFillChargesWhatWasPaid() public {
        bytes32 whale = keccak256("entity:whale");
        leaves.push(SortedMerkle.leaf(stranger, whale, 100_000 ether));
        wallets.push(stranger);
        entityOf.push(whale);
        capOf.push(100_000 ether);
        hook.updateAllowlist(kinId, SortedMerkle.root(leaves), keccak256("evidence-v2.json"), _stats());
        _openWindow();
        vm.deal(stranger, 50_000 ether);
        _buy(stranger, 50_000 ether); // far more than the whole curve costs
        uint256 paid = 50_000 ether - stranger.balance;
        assertLt(paid, 50_000 ether, "partial fill");
        assertEq(hook.entitySpent(kinId, whale), paid, "entity charged what it paid");
        assertEq(hook.getWindowStats(kinId).totalVolume, paid, "receipt volume is what was paid");
    }

    function test_RootUpdateBlockedAfterWindowStart() public {
        _openWindow();
        vm.expectRevert(KinHook.AllowlistFrozen.selector);
        hook.updateAllowlist(kinId, keccak256("new"), keccak256("ev"), _stats());

        _closeWindow();
        vm.expectRevert(KinHook.AllowlistFrozen.selector);
        hook.updateAllowlist(kinId, keccak256("new"), keccak256("ev"), _stats());
    }

    function test_RootUpdateOnlyByAdmin() public {
        vm.prank(stranger);
        vm.expectRevert(KinHook.NotAdmin.selector);
        hook.updateAllowlist(kinId, keccak256("new"), keccak256("ev"), _stats());
    }

    // ------------------------------------------------------------------ vault

    function test_VaultLockAndClaim() public {
        _openWindow();
        uint256 out = _buy(alice, 0.4 ether);
        assertEq(vault.owed(kinId, alice), out);
        assertEq(IERC20(kinToken).balanceOf(address(vault)), out);
        uint256 unlockAt = uint256(windowEnd) + LOCK;
        assertEq(hook.unlockTime(kinId), unlockAt);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(KinVault.Locked.selector, unlockAt));
        vault.claim(kinId);

        _closeWindow(); // window over, lock still running
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(KinVault.Locked.selector, unlockAt));
        vault.claim(kinId);

        vm.warp(unlockAt - 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(KinVault.Locked.selector, unlockAt));
        vault.claim(kinId);

        vm.warp(unlockAt);
        vm.prank(alice);
        assertEq(vault.claim(kinId), out);
        assertEq(IERC20(kinToken).balanceOf(alice), out);
        assertEq(vault.owed(kinId, alice), 0);
        assertEq(vault.totalOwed(kinId), 0);

        vm.prank(alice);
        vm.expectRevert(KinVault.NothingToClaim.selector);
        vault.claim(kinId);
    }

    function test_ClaimForAlwaysPaysTheBuyer() public {
        _openWindow();
        uint256 out = _buy(bob, 0.3 ether);
        vm.warp(uint256(windowEnd) + LOCK);
        vm.prank(stranger);
        vault.claimFor(kinId, bob);
        assertEq(IERC20(kinToken).balanceOf(bob), out);
        assertEq(IERC20(kinToken).balanceOf(stranger), 0);
    }

    function test_VaultCreditOnlyByRouter() public {
        vm.expectRevert(KinVault.NotRouter.selector);
        vault.credit(kinId, Currency.wrap(kinToken), alice, 1);
    }

    // ------------------------------------------------------------------ native ETH

    function test_NativeEthBuyChargesExactlyAmountIn() public {
        _openWindow();
        uint256 before = alice.balance;
        KinRouter.Allowance memory a = _allowance(alice);
        vm.prank(alice);
        // Overpay: the router refunds everything above amountIn.
        router.swapExactIn{value: 1 ether}(kinKey, true, 0.25 ether, 0, a, block.timestamp);
        assertEq(alice.balance, before - 0.25 ether);
        assertEq(address(router).balance, 0);
        assertEq(hook.entitySpent(kinId, ALICE), 0.25 ether);
    }

    function test_NativeEthUnderpaymentReverts() public {
        _openWindow();
        KinRouter.Allowance memory a = _allowance(alice);
        vm.prank(alice);
        vm.expectRevert(KinRouter.BadMsgValue.selector);
        router.swapExactIn{value: 0.1 ether - 1}(kinKey, true, 0.1 ether, 0, a, block.timestamp);
    }

    function test_SlippageProtection() public {
        _openWindow();
        KinRouter.Allowance memory a = _allowance(alice);
        vm.prank(alice);
        vm.expectRevert(); // TooLittleReceived, bubbled through PoolManager.unlock
        router.swapExactIn{value: 0.1 ether}(kinKey, true, 0.1 ether, type(uint256).max, a, block.timestamp);
    }

    function test_FreshWalletsShareOnePooledCap() public {
        _openWindow();
        _buy(fresh[0], 0.2 ether);
        _buy(fresh[1], 0.2 ether);
        _expectAfterSwapRevert(abi.encodeWithSelector(KinHook.EntityCapExceeded.selector, FRESH, FRESH_CAP, 0.6 ether));
        _buy(fresh[2], 0.2 ether);
        _buy(fresh[2], 0.1 ether);
        assertEq(hook.entitySpent(kinId, FRESH), FRESH_CAP);
    }

    function test_ExactOutputRejectedInWindow() public {
        _openWindow();
        KinRouter.Allowance memory a = _allowance(alice);
        bytes memory data = abi.encode(alice, a.entityId, a.entityCap, a.proof);
        vm.prank(address(manager));
        vm.expectRevert(KinHook.ExactInputOnly.selector);
        hook.beforeSwap(
            address(router),
            kinKey,
            SwapParams({zeroForOne: true, amountSpecified: 1 ether, sqrtPriceLimitX96: MIN_PRICE_LIMIT}),
            data
        );
    }

    // ------------------------------------------------------------------ Fairness Receipt

    function test_ReceiptIsFinalAtWindowEndWithoutATransaction() public {
        assertFalse(hook.getReceipt(kinId).finalized);
        _closeWindow();
        KinHook.Receipt memory r = hook.getReceipt(kinId);
        assertTrue(r.finalized);
        assertEq(r.finalizedAt, windowEnd);
    }

    function test_FinalizeRecordsReceipt() public {
        vm.expectRevert(KinHook.WindowNotEnded.selector);
        hook.finalize(kinId);

        _openWindow();
        for (uint256 i; i < BUNDLE_SIZE; i++) {
            _tryBuy(bundle[i], kinKey, PER_WALLET, _allowance(bundle[i])); // 10 land = 1 ETH
        }
        _buy(alice, 0.5 ether);
        _buy(bob, 0.25 ether);
        _buy(fresh[0], 0.25 ether);

        vm.expectRevert(KinHook.WindowNotEnded.selector);
        hook.finalize(kinId);

        _closeWindow();
        vm.prank(stranger); // anyone can finalize
        hook.finalize(kinId);

        KinHook.Receipt memory r = hook.getReceipt(kinId);
        assertTrue(r.finalized);
        assertEq(r.finalizedAt, windowEnd);
        assertEq(r.root, root);
        assertEq(r.evidenceHash, EVIDENCE);
        assertEq(r.window.totalVolume, 2 ether);
        assertEq(r.window.buyingEntities, 4);
        assertEq(r.window.buyerWallets, 13); // 10 bundle + alice + bob + fresh[0]
        assertEq(r.window.buys, 13);
        assertEq(r.window.largestEntity, BUNDLE);
        assertEq(r.window.largestEntitySpend, 1 ether);
        assertEq(r.largestEntityShareBps, 5_000);
        assertEq(r.allowlist.linkedWallets, 20);
        assertEq(r.allowlist.freshWallets, 3);

        vm.expectRevert(KinHook.AlreadyFinalized.selector);
        hook.finalize(kinId);

        // Trades after the window do not change the receipt.
        vm.deal(stranger, 1 ether);
        _buy(stranger, kinKey, 0.1 ether, _noAllowance());
        assertEq(hook.getReceipt(kinId).window.totalVolume, 2 ether);
    }

    function test_FinalizeWithNoBuys() public {
        _closeWindow();
        hook.finalize(kinId);
        KinHook.Receipt memory r = hook.getReceipt(kinId);
        assertEq(r.window.totalVolume, 0);
        assertEq(r.largestEntityShareBps, 0);
    }

    // ------------------------------------------------------------------ fuzz

    /// @notice However an entity's wallets split their buys, its cumulative spend never exceeds its cap,
    ///         and every successful buy is counted.
    function testFuzz_EntityNeverExceedsCap(uint256 seed, uint8 nBuys) public {
        nBuys = uint8(bound(nBuys, 1, 30));
        _openWindow();
        uint256 landedSum;
        for (uint256 i; i < nBuys; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            address w = bundle[r % BUNDLE_SIZE];
            uint256 amount = bound(r >> 8, 1e9, 0.4 ether);
            uint256 before = hook.entitySpent(kinId, BUNDLE);
            bool ok = _tryBuy(w, kinKey, amount, _allowance(w));
            if (ok) {
                landedSum += amount;
                assertLe(before + amount, CAP, "landed over cap");
            } else {
                assertGt(before + amount, CAP, "rejected within cap");
            }
            assertLe(hook.entitySpent(kinId, BUNDLE), CAP, "entity over cap");
        }
        assertEq(hook.entitySpent(kinId, BUNDLE), landedSum);
        assertEq(hook.getWindowStats(kinId).totalVolume, landedSum);
    }

    // ------------------------------------------------------------------ helpers

    function _cfg(bytes32 r) internal view returns (KinHook.LaunchConfig memory) {
        return KinHook.LaunchConfig({
            root: r,
            evidenceHash: EVIDENCE,
            windowStart: windowStart,
            windowEnd: windowEnd,
            lockDuration: LOCK,
            buyIsZeroForOne: true,
            admin: address(this),
            stats: _stats(),
            totalSupply: SUPPLY,
            creatorAllocation: 0
        });
    }

    function _predictKey(KinLaunchFactory.LaunchParams memory p) internal view returns (PoolKey memory key) {
        bytes32 salt = keccak256(abi.encode(address(this), p.salt, block.number));
        bytes memory init = abi.encodePacked(type(KinToken).creationCode, abi.encode(p.name, p.symbol, p.totalSupply, address(factory)));
        address token = vm.computeCreate2Address(salt, keccak256(init), address(factory));
        key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: FEE,
            tickSpacing: SPACING,
            hooks: IHooks(address(hook))
        });
    }
}
