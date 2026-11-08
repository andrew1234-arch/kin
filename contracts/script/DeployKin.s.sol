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
    struct Deployed {
        address deployer;
        address pm;
        address otherRouter;
        KinRouter router;
        KinHook hook;
        bytes32 salt;
        KinVault vault;
        KinLaunchFactory factory;
        KinLaunchFactory plainFactory;
        address permitSigner;
        KinHook.Limits limits;
    }

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        Deployed memory d;
        d.deployer = vm.addr(pk);
        d.pm = Addresses.poolManager(block.chainid);
        d.otherRouter = block.chainid == Addresses.BASE_SEPOLIA ? Addresses.BASE_SEPOLIA_POOL_SWAP_TEST : address(0);
        d.limits = _limits();
        // Signs buy permits for instant launches; defaults to the deployer (the engine operator's key).
        d.permitSigner = vm.envOr("KIN_PERMIT_SIGNER", d.deployer);

        vm.startBroadcast(pk);
        if (d.pm == address(0)) {
            require(block.chainid == Addresses.ANVIL, "no PoolManager address for this chain");
            d.pm = address(new PoolManager(d.deployer));
            d.otherRouter = address(new PoolSwapTest(IPoolManager(d.pm)));
        }
        d.router = new KinRouter(IPoolManager(d.pm), d.deployer);
        _deployHook(d);
        d.vault = new KinVault(d.hook, address(d.router));
        d.router.wire(d.hook, d.vault);
        d.factory = new KinLaunchFactory(IPoolManager(d.pm), d.hook);
        d.hook.setFactory(address(d.factory));
        d.plainFactory = new KinLaunchFactory(IPoolManager(d.pm), KinHook(address(0)));
        vm.stopBroadcast();

        console2.log("chainId     ", block.chainid);
        console2.log("PoolManager ", d.pm);
        console2.log("KinRouter   ", address(d.router));
        console2.log("KinHook     ", address(d.hook));
        console2.log("KinVault    ", address(d.vault));
        console2.log("Factory     ", address(d.factory));
        console2.log("PlainFactory", address(d.plainFactory));
        console2.log("OtherRouter ", d.otherRouter);
        console2.log("PermitSigner", d.permitSigner);
        _write(d);
    }

    function _deployHook(Deployed memory d) internal {
        bytes memory args = abi.encode(d.pm, address(d.router), d.deployer, d.limits, d.permitSigner);
        (address predicted, bytes32 salt) = HookMiner.find(
            Addresses.CREATE2_DEPLOYER,
            uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG),
            type(KinHook).creationCode,
            args
        );
        d.hook = new KinHook{salt: salt}(IPoolManager(d.pm), address(d.router), d.deployer, d.limits, d.permitSigner);
        require(address(d.hook) == predicted, "hook address mismatch");
        d.salt = salt;
    }

    function _write(Deployed memory d) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "deployer", d.deployer);
        vm.serializeAddress(k, "poolManager", d.pm);
        vm.serializeAddress(k, "otherRouter", d.otherRouter);
        vm.serializeAddress(k, "kinRouter", address(d.router));
        vm.serializeAddress(k, "kinHook", address(d.hook));
        vm.serializeBytes32(k, "kinHookSalt", d.salt);
        vm.serializeAddress(k, "kinVault", address(d.vault));
        vm.serializeAddress(k, "plainFactory", address(d.plainFactory));
        vm.serializeUint(k, "minReviewPeriod", d.limits.minReviewPeriod);
        vm.serializeUint(k, "minWindow", d.limits.minWindow);
        vm.serializeUint(k, "maxWindow", d.limits.maxWindow);
        vm.serializeUint(k, "maxLock", d.limits.maxLock);
        vm.serializeUint(k, "maxCreatorBps", d.limits.maxCreatorBps);
        vm.serializeAddress(k, "permitSigner", d.permitSigner);
        string memory json = vm.serializeAddress(k, "factory", address(d.factory));
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
