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

/// @notice Deploys KinRouter, KinHook (CREATE2 address mined for BEFORE_SWAP only), KinVault and
///         KinLaunchFactory against the official Uniswap v4 PoolManager for the current chain.
///         On anvil (31337) it first deploys a fresh PoolManager and a PoolSwapTest router.
///         Writes deployments/<chainId>.json.
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

        KinRouter router = new KinRouter(IPoolManager(pm), deployer);
        bytes memory args = abi.encode(pm, address(router), deployer);
        (address predicted, bytes32 salt) = HookMiner.find(
            Addresses.CREATE2_DEPLOYER, uint160(Hooks.BEFORE_SWAP_FLAG), type(KinHook).creationCode, args
        );
        KinHook hook = new KinHook{salt: salt}(IPoolManager(pm), address(router), deployer);
        require(address(hook) == predicted, "hook address mismatch");

        KinVault vault = new KinVault(hook, address(router));
        router.wire(hook, vault);
        KinLaunchFactory factory = new KinLaunchFactory(IPoolManager(pm), hook);
        hook.setFactory(address(factory));
        vm.stopBroadcast();

        console2.log("chainId     ", block.chainid);
        console2.log("PoolManager ", pm);
        console2.log("KinRouter   ", address(router));
        console2.log("KinHook     ", address(hook));
        console2.log("KinVault    ", address(vault));
        console2.log("Factory     ", address(factory));
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
        string memory json = vm.serializeAddress(k, "factory", address(factory));
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), ".json"));
    }
}
