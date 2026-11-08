// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/test/shared/HookMiner.sol";

import {KinHook} from "../src/KinHook.sol";
import {KinRouter} from "../src/KinRouter.sol";
import {KinVault} from "../src/KinVault.sol";
import {KinLaunchFactory} from "../src/KinLaunchFactory.sol";
import {Addresses} from "./Addresses.sol";

/// @notice Deploys KinRouter, KinHook (CREATE2 address mined for BEFORE_SWAP + AFTER_SWAP), KinVault,
///         KinLaunchFactory and a separate plain (hookless) factory for the sandbox comparison, against the
///         official Uniswap v4 PoolManager for the current chain. On anvil (31337) it first deploys a fresh
///         PoolManager and a PoolSwapTest router. Writes deployments/<chainId>[-<KIN_DEPLOYMENT_NAME>].json.
///
/// Hook limits (product parameters, recorded in the deployment file):
///   KIN_MIN_REVIEW_SECONDS (1800; 0 on anvil)  KIN_MIN_WINDOW_SECONDS (300; 1 on anvil)
///   KIN_MAX_WINDOW_SECONDS (86400)  KIN_MAX_LOCK_SECONDS (604800)  KIN_MAX_CREATOR_BPS (1000)
/// The attack sandbox needs a window that opens within seconds, so it runs on its own deployment:
///   KIN_DEPLOYMENT_NAME=sandbox KIN_MIN_REVIEW_SECONDS=0 KIN_MIN_WINDOW_SECONDS=60 forge script ...
///
///   forge script script/DeployKin.s.sol --rpc-url base_sepolia --broadcast
contract DeployKin is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address pm = Addresses.poolManager(block.chainid);
        address otherRouter =
            block.chainid == Addresses.BASE_SEPOLIA ? Addresses.BASE_SEPOLIA_POOL_SWAP_TEST : address(0);

        vm.startBroadcast(pk);
        if (pm == address(0)) {
            require(block.chainid == Addresses.ANVIL, "no PoolManager address for this chain");
            pm = address(new PoolManager(deployer));
            otherRouter = address(new PoolSwapTest(IPoolManager(pm)));
        }

        KinHook.Limits memory limits = _limits();
        KinRouter router = new KinRouter(IPoolManager(pm), deployer);
        bytes memory args = abi.encode(pm, address(router), deployer, limits);
        (address predicted, bytes32 salt) = HookMiner.find(
            Addresses.CREATE2_DEPLOYER,
            uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG),
            type(KinHook).creationCode,
            args
        );
        KinHook hook = new KinHook{salt: salt}(IPoolManager(pm), address(router), deployer, limits);
        require(address(hook) == predicted, "hook address mismatch");

        KinVault vault = new KinVault(hook, address(router));
        router.wire(hook, vault);
        KinLaunchFactory factory = new KinLaunchFactory(IPoolManager(pm), hook);
        hook.setFactory(address(factory));
        KinLaunchFactory plainFactory = new KinLaunchFactory(IPoolManager(pm), KinHook(address(0)));
        vm.stopBroadcast();

        console2.log("chainId     ", block.chainid);
        console2.log("PoolManager ", pm);
        console2.log("KinRouter   ", address(router));
        console2.log("KinHook     ", address(hook));
        console2.log("KinVault    ", address(vault));
        console2.log("Factory     ", address(factory));
        console2.log("PlainFactory", address(plainFactory));
        console2.log("OtherRouter ", otherRouter);

        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "deployer", deployer);
        vm.serializeAddress(k, "poolManager", pm);
        vm.serializeAddress(k, "otherRouter", otherRouter);
        vm.serializeAddress(k, "kinRouter", address(router));
        vm.serializeAddress(k, "kinHook", address(hook));
        vm.serializeBytes32(k, "kinHookSalt", salt);
        vm.serializeAddress(k, "kinVault", address(vault));
        vm.serializeAddress(k, "plainFactory", address(plainFactory));
        vm.serializeUint(k, "minReviewPeriod", limits.minReviewPeriod);
        vm.serializeUint(k, "minWindow", limits.minWindow);
        vm.serializeUint(k, "maxWindow", limits.maxWindow);
        vm.serializeUint(k, "maxLock", limits.maxLock);
        vm.serializeUint(k, "maxCreatorBps", limits.maxCreatorBps);
        string memory json = vm.serializeAddress(k, "factory", address(factory));
        string memory name = vm.envOr("KIN_DEPLOYMENT_NAME", string(""));
        string memory suffix = bytes(name).length == 0 ? "" : string.concat("-", name);
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), suffix, ".json"));
    }

    function _limits() internal view returns (KinHook.Limits memory l) {
        bool local = block.chainid == Addresses.ANVIL;
        l.minReviewPeriod = uint64(vm.envOr("KIN_MIN_REVIEW_SECONDS", local ? uint256(0) : 1800));
        l.minWindow = uint64(vm.envOr("KIN_MIN_WINDOW_SECONDS", local ? uint256(1) : 300));
        l.maxWindow = uint64(vm.envOr("KIN_MAX_WINDOW_SECONDS", uint256(86_400)));
        l.maxLock = uint64(vm.envOr("KIN_MAX_LOCK_SECONDS", uint256(604_800)));
        l.maxCreatorBps = uint16(vm.envOr("KIN_MAX_CREATOR_BPS", uint256(1000)));
    }
}
