// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {HookMiner} from "@uniswap/v4-periphery/test/shared/HookMiner.sol";

import {KinHook} from "../../src/KinHook.sol";
import {KinRouter} from "../../src/KinRouter.sol";
import {KinVault} from "../../src/KinVault.sol";
import {KinLaunchFactory} from "../../src/KinLaunchFactory.sol";
import {SortedMerkle} from "./SortedMerkle.sol";

/// @notice Shared setup: real v4-core PoolManager, mined KinHook address, KinRouter, KinVault, factory,
///         and one Kin launch (native ETH / token) with four entities:
///           BUNDLE: 20 wallets funded by one funder -> one entity, one 1 ETH cap
///           ALICE, BOB: independent aged wallets, 1 ETH cap each
///           FRESH: 3 fresh wallets sharing one pooled 0.5 ETH cap
abstract contract KinFixture is Deployers {
    using PoolIdLibrary for PoolKey;

    bytes32 constant BUNDLE = keccak256("entity:bundle");
    bytes32 constant ALICE = keccak256("entity:alice");
    bytes32 constant BOB = keccak256("entity:bob");
    bytes32 constant FRESH = keccak256("entity:fresh-pool");

    uint256 constant CAP = 1 ether;
    uint256 constant FRESH_CAP = 0.5 ether;
    uint256 constant PER_WALLET = 0.1 ether;
    uint256 constant BUNDLE_SIZE = 20;

    // Price: ~1e8 tokens per ETH at start (tick 184200), liquidity down to ~1e3 tokens per ETH.
    int24 constant START_TICK = 184_200;
    int24 constant TICK_LOWER = 69_000;
    int24 constant SPACING = 200;
    uint24 constant FEE = 10_000;
    uint256 constant SUPPLY = 1_000_000_000 ether;

    uint64 constant DISPUTE_PERIOD = 1 hours;
    uint64 constant WINDOW = 30 minutes;
    uint64 constant LOCK = 1 days;
    uint64 constant MIN_REVIEW = 30 minutes;
    uint64 constant MIN_WINDOW = 5 minutes;
    uint64 constant MAX_WINDOW = 1 days;
    uint64 constant MAX_LOCK = 7 days;
    uint16 constant MAX_CREATOR_BPS = 1000;

    KinHook hook;
    KinRouter router;
    KinVault vault;
    KinLaunchFactory factory;
    KinLaunchFactory plainFactory;

    PoolKey kinKey;
    PoolId kinId;
    address kinToken;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address stranger = makeAddr("stranger");
    address funder = makeAddr("bundle-funder");
    uint256 permitSignerKey = 0xA11CE;
    address permitSigner = vm.addr(0xA11CE);
    address[] bundle;
    address[] fresh;

    // Allowlist
    address[] wallets;
    bytes32[] entityOf;
    uint256[] capOf;
    bytes32[] leaves;
    bytes32 root;
    bytes32 constant EVIDENCE = keccak256("evidence-v1.json");

    uint64 windowStart;
    uint64 windowEnd;

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        deployFreshManagerAndRouters();

        router = new KinRouter(manager, address(this));
        bytes memory args = abi.encode(address(manager), address(router), address(this), _limits(), permitSigner);
        (address predicted, bytes32 salt) = HookMiner.find(
            address(this), uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG), type(KinHook).creationCode, args
        );
        hook = new KinHook{salt: salt}(manager, address(router), address(this), _limits(), permitSigner);
        require(address(hook) == predicted, "hook address mismatch");

        vault = new KinVault(hook, address(router));
        router.wire(hook, vault);
        factory = new KinLaunchFactory(manager, hook);
        hook.setFactory(address(factory));
        plainFactory = new KinLaunchFactory(manager, KinHook(address(0)));

        _buildAllowlist();

        windowStart = uint64(block.timestamp) + DISPUTE_PERIOD;
        windowEnd = windowStart + WINDOW;
        (kinId, kinToken) = factory.createLaunch(_params("Kin Demo", "KIND", bytes32("kin")), false);
        kinKey = factory.launchKey(0);
    }

    // ------------------------------------------------------------------ allowlist

    function _buildAllowlist() internal {
        for (uint256 i; i < BUNDLE_SIZE; i++) {
            address w = makeAddr(string.concat("bundle-", vm.toString(i)));
            bundle.push(w);
            _addLeaf(w, BUNDLE, CAP);
        }
        _addLeaf(alice, ALICE, CAP);
        _addLeaf(bob, BOB, CAP);
        for (uint256 i; i < 3; i++) {
            address w = makeAddr(string.concat("fresh-", vm.toString(i)));
            fresh.push(w);
            _addLeaf(w, FRESH, FRESH_CAP);
        }
        root = SortedMerkle.root(leaves);
    }

    function _addLeaf(address w, bytes32 entity, uint256 cap) internal {
        wallets.push(w);
        entityOf.push(entity);
        capOf.push(cap);
        leaves.push(SortedMerkle.leaf(w, entity, cap));
        vm.deal(w, 10 ether);
    }

    function _limits() internal pure returns (KinHook.Limits memory) {
        return KinHook.Limits({
            minReviewPeriod: MIN_REVIEW,
            minWindow: MIN_WINDOW,
            maxWindow: MAX_WINDOW,
            maxLock: MAX_LOCK,
            maxCreatorBps: MAX_CREATOR_BPS
        });
    }

    function _stats() internal pure returns (KinHook.AllowlistStats memory) {
        return KinHook.AllowlistStats({allowlistedWallets: 25, entities: 4, linkedWallets: 20, freshWallets: 3});
    }

    function _params(string memory name, string memory symbol, bytes32 salt)
        internal
        view
        returns (KinLaunchFactory.LaunchParams memory p)
    {
        p.name = name;
        p.symbol = symbol;
        p.totalSupply = SUPPLY;
        p.creatorAllocation = 0;
        p.fee = FEE;
        p.tickSpacing = SPACING;
        p.startTick = START_TICK;
        p.tickLower = TICK_LOWER;
        p.root = root;
        p.evidenceHash = EVIDENCE;
        p.stats = _stats();
        p.windowStart = windowStart;
        p.windowEnd = windowEnd;
        p.lockDuration = LOCK;
        p.salt = salt;
    }

    function _indexOf(address w) internal view returns (uint256) {
        for (uint256 i; i < wallets.length; i++) {
            if (wallets[i] == w) return i;
        }
        revert("not in allowlist");
    }

    function _allowance(address w) internal view returns (KinRouter.Allowance memory a) {
        uint256 i = _indexOf(w);
        a = KinRouter.Allowance({entityId: entityOf[i], entityCap: capOf[i], proof: SortedMerkle.proof(leaves, i)});
    }

    function _noAllowance() internal pure returns (KinRouter.Allowance memory a) {}

    // ------------------------------------------------------------------ actions

    function _buy(address who, PoolKey memory key, uint256 amount, KinRouter.Allowance memory a)
        internal
        returns (uint256)
    {
        vm.prank(who);
        return router.swapExactIn{value: amount}(key, true, amount, 0, a, block.timestamp);
    }

    function _buy(address who, uint256 amount) internal returns (uint256) {
        return _buy(who, kinKey, amount, _allowance(who));
    }

    function _tryBuy(address who, PoolKey memory key, uint256 amount, KinRouter.Allowance memory a)
        internal
        returns (bool ok)
    {
        vm.prank(who);
        try router.swapExactIn{value: amount}(key, true, amount, 0, a, block.timestamp) returns (uint256) {
            ok = true;
        } catch {}
    }

    function _openWindow() internal {
        vm.warp(windowStart);
    }

    function _closeWindow() internal {
        vm.warp(windowEnd);
    }

    function _expectHookRevert(bytes memory reason) internal {
        _expectHookRevert(IHooks.beforeSwap.selector, reason);
    }

    /// @dev Allowlist and cap checks run in afterSwap (they charge what the swap actually paid).
    function _expectAfterSwapRevert(bytes memory reason) internal {
        _expectHookRevert(IHooks.afterSwap.selector, reason);
    }

    function _expectHookRevert(bytes4 callback, bytes memory reason) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                callback,
                reason,
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
    }
}
