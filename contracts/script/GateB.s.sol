// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {stdJson} from "forge-std/StdJson.sol";

import {KinHook} from "../src/KinHook.sol";
import {KinRouter} from "../src/KinRouter.sol";
import {KinVault} from "../src/KinVault.sol";
import {KinLaunchFactory} from "../src/KinLaunchFactory.sol";

/// @notice Gate B, step 1: create a Kin launch whose window opens GATE_B_DELAY_SECONDS from now.
///         Allowlist: the buyer (own entity, small cap) plus one dummy leaf so the proof is non-trivial.
///
///   forge script script/GateB.s.sol:GateBCreateLaunch --rpc-url base_sepolia --broadcast
contract GateBCreateLaunch is Script {
    using stdJson for string;
    using PoolIdLibrary for PoolKey;

    struct Gate {
        address buyer;
        bytes32 entity;
        uint256 cap;
        bytes32 dummyLeaf;
    }

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        string memory dep = vm.readFile(string.concat("deployments/", vm.toString(block.chainid), ".json"));
        KinLaunchFactory factory = KinLaunchFactory(dep.readAddress(".factory"));

        Gate memory g;
        g.buyer = vm.addr(pk);
        g.cap = vm.envOr("GATE_B_CAP_WEI", uint256(0.001 ether));
        g.entity = keccak256(abi.encode("gate-b", g.buyer));
        g.dummyLeaf = _leaf(address(0xdEaD), keccak256("gate-b:dummy"), g.cap);
        KinLaunchFactory.LaunchParams memory p = _params(g);

        vm.startBroadcast(pk);
        (PoolId id, address token) = factory.createLaunch(p, false);
        vm.stopBroadcast();

        uint256 index = factory.launchCount() - 1;
        console2.log("launch index", index);
        console2.log("token", token);
        console2.log("window opens at", p.windowStart);
        _write(g, index, id, token, p);
    }

    function _params(Gate memory g) internal view returns (KinLaunchFactory.LaunchParams memory p) {
        bytes32 leafBuyer = _leaf(g.buyer, g.entity, g.cap);
        uint64 delay = uint64(vm.envOr("GATE_B_DELAY_SECONDS", uint256(90)));
        p.name = "Kin Gate B";
        p.symbol = "KGB";
        p.totalSupply = 1_000_000_000 ether;
        p.fee = 10_000;
        p.tickSpacing = 200;
        p.startTick = 184_200;
        p.tickLower = 69_000;
        p.root = leafBuyer < g.dummyLeaf
            ? keccak256(abi.encodePacked(leafBuyer, g.dummyLeaf))
            : keccak256(abi.encodePacked(g.dummyLeaf, leafBuyer));
        p.evidenceHash = keccak256("gate-b: no evidence file (synthetic two-leaf allowlist)");
        p.stats = KinHook.AllowlistStats({allowlistedWallets: 2, entities: 2, linkedWallets: 0, freshWallets: 0});
        p.windowStart = uint64(block.timestamp) + delay;
        p.windowEnd = p.windowStart + 1 hours;
        p.lockDuration = 120;
        p.salt = keccak256(abi.encode("gate-b", block.timestamp));
    }

    function _write(Gate memory g, uint256 index, PoolId id, address token, KinLaunchFactory.LaunchParams memory p)
        internal
    {
        string memory k = "gateb";
        vm.serializeUint(k, "launchIndex", index);
        vm.serializeAddress(k, "token", token);
        vm.serializeBytes32(k, "poolId", PoolId.unwrap(id));
        vm.serializeAddress(k, "buyer", g.buyer);
        vm.serializeBytes32(k, "entityId", g.entity);
        vm.serializeUint(k, "entityCap", g.cap);
        vm.serializeBytes32(k, "proof0", g.dummyLeaf);
        vm.serializeUint(k, "windowStart", p.windowStart);
        string memory json = vm.serializeUint(k, "windowEnd", p.windowEnd);
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), "-gateb.json"));
    }

    function _leaf(address w, bytes32 e, uint256 c) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(w, e, c))));
    }
}

/// @notice Gate B, step 2 (after the window opens):
///   (a) simulate a buy through another router (v4-core PoolSwapTest) carrying hook data that claims to
///       be the allowlisted buyer, and require that it reverts with KinHook.UntrustedRouter;
///   (b) broadcast one real buy through KinRouter and check it was capped-accounted and vaulted.
///
///   forge script script/GateB.s.sol:GateBSwap --rpc-url base_sepolia --broadcast
contract GateBSwap is Script {
    using stdJson for string;
    using PoolIdLibrary for PoolKey;

    struct Ctx {
        KinRouter router;
        KinHook hook;
        KinVault vault;
        address other;
        PoolKey key;
        PoolId id;
        address buyer;
        KinRouter.Allowance a;
        uint256 amount;
    }

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        Ctx memory c = _load();
        require(c.buyer == vm.addr(pk), "buyer must be the broadcaster");
        require(c.hook.isWindowOpen(c.id), "window is not open yet; wait and re-run");
        _checkOtherRouterRejected(c);
        _buyThroughKinRouter(c, pk);
    }

    function _load() internal view returns (Ctx memory c) {
        string memory dep = vm.readFile(string.concat("deployments/", vm.toString(block.chainid), ".json"));
        string memory gb = vm.readFile(string.concat("deployments/", vm.toString(block.chainid), "-gateb.json"));
        c.router = KinRouter(payable(dep.readAddress(".kinRouter")));
        c.hook = KinHook(dep.readAddress(".kinHook"));
        c.vault = KinVault(dep.readAddress(".kinVault"));
        c.other = dep.readAddress(".otherRouter");
        c.key = KinLaunchFactory(dep.readAddress(".factory")).launchKey(gb.readUint(".launchIndex"));
        c.id = c.key.toId();
        require(PoolId.unwrap(c.id) == gb.readBytes32(".poolId"), "pool id mismatch");
        c.buyer = gb.readAddress(".buyer");
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = gb.readBytes32(".proof0");
        c.a = KinRouter.Allowance({
            entityId: gb.readBytes32(".entityId"), entityCap: gb.readUint(".entityCap"), proof: proof
        });
        c.amount = c.a.entityCap / 2;
    }

    /// (a) Another router forwarding hook data that claims to be the buyer. Simulated only, never broadcast.
    function _checkOtherRouterRejected(Ctx memory c) internal {
        if (c.other == address(0)) {
            console2.log("no other router configured for this chain; skipped the rejection check");
            return;
        }
        bytes memory spoof = abi.encode(c.buyer, c.a.entityId, c.a.entityCap, c.a.proof);
        vm.prank(c.buyer); // the real buyer calling through the wrong router
        try PoolSwapTest(c.other).swap{value: c.amount}(
            c.key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(c.amount), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            spoof
        ) {
            revert("GATE B FAIL: swap through another router was accepted");
        } catch (bytes memory reason) {
            require(_innerSelector(reason) == KinHook.UntrustedRouter.selector, "GATE B FAIL: unexpected revert");
            console2.log("other router rejected with KinHook.UntrustedRouter: OK");
        }
    }

    /// (b) One real buy through KinRouter: must be entity-accounted and vaulted.
    function _buyThroughKinRouter(Ctx memory c, uint256 pk) internal {
        uint256 spentBefore = c.hook.entitySpent(c.id, c.a.entityId);
        uint256 owedBefore = c.vault.owed(c.id, c.buyer);
        vm.startBroadcast(pk);
        uint256 out = c.router.swapExactIn{value: c.amount}(c.key, true, c.amount, 0, c.a, block.timestamp + 600);
        vm.stopBroadcast();
        require(c.hook.entitySpent(c.id, c.a.entityId) == spentBefore + c.amount, "GATE B FAIL: spend not recorded");
        require(c.vault.owed(c.id, c.buyer) == owedBefore + out, "GATE B FAIL: tokens not vaulted");
        console2.log("KinRouter buy landed: wei in", c.amount);
        console2.log("KinRouter buy: tokens vaulted", out);
    }

    function _innerSelector(bytes memory reason) internal pure returns (bytes4) {
        if (reason.length < 4 || bytes4(reason) != CustomRevert.WrappedError.selector) return bytes4(0);
        bytes memory body = new bytes(reason.length - 4);
        for (uint256 i; i < body.length; i++) {
            body[i] = reason[i + 4];
        }
        (,, bytes memory innerReason,) = abi.decode(body, (address, bytes4, bytes, bytes));
        return innerReason.length >= 4 ? bytes4(innerReason) : bytes4(0);
    }
}
