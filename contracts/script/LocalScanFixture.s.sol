// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

import {KinHook} from "../src/KinHook.sol";
import {KinRouter} from "../src/KinRouter.sol";
import {KinLaunchFactory} from "../src/KinLaunchFactory.sol";

/// @notice Local (anvil) fixture for the engine's scan pipeline: a plain launch where one funder funds
///         3 fresh wallets that each buy, and 2 independently funded wallets that also buy.
///         Expected scan result: one 3-wallet entity, two singletons. Never run against a live network.
contract LocalScanFixture is Script {
    using stdJson for string;

    function run() external {
        require(block.chainid == 31337, "local only");
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        string memory dep = vm.readFile("deployments/31337.json");
        KinLaunchFactory factory = KinLaunchFactory(dep.readAddress(".factory"));
        KinRouter router = KinRouter(payable(dep.readAddress(".kinRouter")));

        KinLaunchFactory.LaunchParams memory p;
        p.name = "Scan Fixture";
        p.symbol = "SCAN";
        p.totalSupply = 1_000_000_000 ether;
        p.fee = 10_000;
        p.tickSpacing = 200;
        p.startTick = 184_200;
        p.tickLower = 69_000;
        p.salt = keccak256(abi.encode("scan-fixture", block.timestamp));
        vm.broadcast(deployerPk);
        (, address token) = factory.createLaunch(p, true);
        PoolKey memory key = factory.launchKey(factory.launchCount() - 1);
        require(Currency.unwrap(key.currency1) == token, "key mismatch");

        uint256 funderPk = uint256(keccak256("kin-local:bundle-funder"));
        vm.broadcast(deployerPk);
        payable(vm.addr(funderPk)).transfer(1 ether);

        string memory k = "fixture";
        string[5] memory labels = ["linked-0", "linked-1", "linked-2", "solo-0", "solo-1"];
        for (uint256 i; i < 5; i++) {
            uint256 pk = uint256(keccak256(abi.encode("kin-local:", labels[i])));
            address w = vm.addr(pk);
            // linked-*: funded by the shared funder; solo-*: funded directly by the deployer.
            vm.broadcast(i < 3 ? funderPk : deployerPk);
            payable(w).transfer(0.05 ether);
            KinRouter.Allowance memory none;
            vm.broadcast(pk);
            router.swapExactIn{value: 0.01 ether}(key, true, 0.01 ether, 0, none, block.timestamp + 3600);
            vm.serializeAddress(k, labels[i], w);
        }
        vm.serializeAddress(k, "funder", vm.addr(funderPk));
        string memory json = vm.serializeAddress(k, "token", token);
        vm.writeJson(json, "deployments/31337-scan-fixture.json");
        console2.log("scan fixture token", token);
    }
}
