// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {KinLaunchFactory} from "../src/KinLaunchFactory.sol";

/// @notice Reads the shared launch economics from launch-params.json (the same file the engine reads).
library LaunchParamsFile {
    using stdJson for string;

    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function apply_(KinLaunchFactory.LaunchParams memory p) internal view {
        string memory j = vm.readFile("launch-params.json");
        p.totalSupply = vm.parseUint(j.readString(".totalSupply"));
        p.creatorAllocation = vm.parseUint(j.readString(".creatorAllocation"));
        p.fee = uint24(j.readUint(".fee"));
        p.tickSpacing = int24(j.readInt(".tickSpacing"));
        p.startTick = int24(j.readInt(".startTick"));
        p.tickLower = int24(j.readInt(".tickLower"));
    }
}
