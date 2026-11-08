// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/test/shared/HookMiner.sol";

import {KinHook} from "../src/KinHook.sol";
import {KinRouter} from "../src/KinRouter.sol";
import {KinLaunchFactory} from "../src/KinLaunchFactory.sol";
import {KinFixture} from "./utils/KinFixture.sol";

/// @notice Instant launches: no allowlist, no registration. The engine signs a buy permit when the wallet buys.
contract KinInstantTest is KinFixture {
    using PoolIdLibrary for PoolKey;

    PoolKey instKey;
    PoolId instId;
    bytes32 constant A = keccak256("instant:entity-a");
    bytes32 constant B = keccak256("instant:entity-b");

    function setUp() public override {
        super.setUp();
        KinLaunchFactory.LaunchParams memory p = _params("Instant", "INST", bytes32("instant"));
        p.root = bytes32(0);
        p.evidenceHash = keccak256("policy.json");
        p.stats = KinHook.AllowlistStats(0, 0, 0, 0);
        (instId,) = factory.createLaunch(p, false);
        instKey = factory.launchKey(factory.launchCount() - 1);
    }

    // ------------------------------------------------------------------ permits

    function _digest(PoolId id, address buyer, bytes32 entity, uint256 cap, uint64 deadline) internal view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("KinHook"),
                keccak256("1"),
                block.chainid,
                address(hook)
            )
        );
        bytes32 structHash = keccak256(abi.encode(hook.PERMIT_TYPEHASH(), PoolId.unwrap(id), buyer, entity, cap, deadline));
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _permit(uint256 key, PoolId id, address buyer, bytes32 entity, uint256 cap, uint64 deadline)
        internal
        view
        returns (KinRouter.Allowance memory a)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, _digest(id, buyer, entity, cap, deadline));
        bytes32 vs = bytes32(uint256(s) | (uint256(v - 27) << 255));
        bytes32[] memory proof = new bytes32[](3);
        proof[0] = bytes32(uint256(deadline));
        proof[1] = r;
        proof[2] = vs;
        a = KinRouter.Allowance({entityId: entity, entityCap: cap, proof: proof});
    }

    function _permit(address buyer, bytes32 entity, uint256 cap) internal view returns (KinRouter.Allowance memory) {
        return _permit(permitSignerKey, instId, buyer, entity, cap, uint64(block.timestamp + 10 minutes));
    }

    // ------------------------------------------------------------------ tests

    function test_InstantLaunchHasNoRoot() public view {
        KinHook.Launch memory l = hook.getLaunch(instId);
        assertEq(l.root, bytes32(0));
        assertEq(hook.permitSigner(), permitSigner);
    }

    function test_PermitBuyLands() public {
        _openWindow();
        uint256 out = _buy(alice, instKey, PER_WALLET, _permit(alice, A, CAP));
        assertGt(out, 0);
        assertEq(hook.entitySpent(instId, A), PER_WALLET);
        assertEq(hook.buyerSpent(instId, alice), PER_WALLET);
    }

    function test_PermitsForOneEntityShareOneCap() public {
        _openWindow();
        _buy(alice, instKey, 0.6 ether, _permit(alice, A, CAP));
        // bob was traced to the same funder: same entity, same cap; together they can't pass it.
        KinRouter.Allowance memory p = _permit(bob, A, CAP);
        _expectAfterSwapRevert(abi.encodeWithSelector(KinHook.EntityCapExceeded.selector, A, CAP, 1.1 ether));
        _buy(bob, instKey, 0.5 ether, p);
        _buy(bob, instKey, 0.4 ether, p);
        assertEq(hook.entitySpent(instId, A), 1 ether);
    }

    function test_PermitCapIsPinnedByFirstBuy() public {
        _openWindow();
        _buy(alice, instKey, PER_WALLET, _permit(alice, A, CAP));
        KinRouter.Allowance memory bigger = _permit(bob, A, 2 * CAP);
        _expectAfterSwapRevert(abi.encodeWithSelector(KinHook.EntityCapMismatch.selector, A, CAP, 2 * CAP));
        _buy(bob, instKey, PER_WALLET, bigger);
    }

    function test_ExpiredPermitReverts() public {
        _openWindow();
        uint64 deadline = uint64(block.timestamp + 1 minutes);
        KinRouter.Allowance memory p = _permit(permitSignerKey, instId, alice, A, CAP, deadline);
        vm.warp(deadline + 1);
        _expectAfterSwapRevert(abi.encodeWithSelector(KinHook.PermitExpired.selector, deadline));
        _buy(alice, instKey, PER_WALLET, p);
    }

    function test_PermitFromAnotherSignerReverts() public {
        _openWindow();
        KinRouter.Allowance memory p = _permit(0xBAD, instId, alice, A, CAP, uint64(block.timestamp + 10 minutes));
        _expectAfterSwapRevert(abi.encodeWithSelector(KinHook.BadPermit.selector));
        _buy(alice, instKey, PER_WALLET, p);
    }

    function test_PermitCannotBeUsedByAnotherWallet() public {
        _openWindow();
        KinRouter.Allowance memory alicePermit = _permit(alice, A, CAP);
        _expectAfterSwapRevert(abi.encodeWithSelector(KinHook.BadPermit.selector));
        _buy(bob, instKey, PER_WALLET, alicePermit);
    }

    function test_TamperedPermitReverts() public {
        _openWindow();
        KinRouter.Allowance memory p = _permit(alice, A, CAP);
        p.entityId = B; // move the buy to a fresh entity
        _expectAfterSwapRevert(abi.encodeWithSelector(KinHook.BadPermit.selector));
        _buy(alice, instKey, PER_WALLET, p);
        p = _permit(alice, A, CAP);
        p.entityCap = 10 * CAP; // raise the cap
        _expectAfterSwapRevert(abi.encodeWithSelector(KinHook.BadPermit.selector));
        _buy(alice, instKey, PER_WALLET, p);
    }

    function test_PermitForAnotherPoolReverts() public {
        _openWindow();
        KinRouter.Allowance memory p = _permit(permitSignerKey, kinId, alice, A, CAP, uint64(block.timestamp + 10 minutes));
        _expectAfterSwapRevert(abi.encodeWithSelector(KinHook.BadPermit.selector));
        _buy(alice, instKey, PER_WALLET, p);
    }

    function test_MalformedPermitReverts() public {
        _openWindow();
        _expectAfterSwapRevert(abi.encodeWithSelector(KinHook.BadPermit.selector));
        _buy(alice, instKey, PER_WALLET, _noAllowance());
    }

    function test_InstantWindowStillGated() public {
        // Before the window every swap reverts; permits change who may buy, not when.
        KinRouter.Allowance memory p = _permit(alice, A, CAP);
        _expectHookRevert(abi.encodeWithSelector(KinHook.WindowNotOpen.selector, windowStart));
        _buy(alice, instKey, PER_WALLET, p);
    }

    function test_HookWithoutSignerRejectsInstantLaunch() public {
        bytes memory args = abi.encode(address(manager), address(router), address(this), _limits(), address(0));
        (, bytes32 salt) = HookMiner.find(
            address(this), uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG), type(KinHook).creationCode, args
        );
        KinHook noSigner = new KinHook{salt: salt}(manager, address(router), address(this), _limits(), address(0));
        KinLaunchFactory f = new KinLaunchFactory(manager, noSigner);
        noSigner.setFactory(address(f));
        KinLaunchFactory.LaunchParams memory p = _params("NoSigner", "NOS", bytes32("nosigner"));
        p.root = bytes32(0);
        vm.expectRevert(KinHook.InvalidConfig.selector);
        f.createLaunch(p, false);
    }
}
