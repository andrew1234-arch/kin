// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {stdJson} from "forge-std/StdJson.sol";

import {KinHook} from "../src/KinHook.sol";
import {KinRouter} from "../src/KinRouter.sol";
import {KinLaunchFactory} from "../src/KinLaunchFactory.sol";
import {KinFixture} from "./utils/KinFixture.sol";
import {SortedMerkle} from "./utils/SortedMerkle.sol";

/// @notice Cross-check: the allowlist produced by the TypeScript engine (engine/test/allowlist.test.ts
///         writes test/fixtures/engine-allowlist.json) is accepted by KinHook byte for byte.
contract EngineFixtureTest is KinFixture {
    using stdJson for string;

    string json;
    uint256 n;

    function setUp() public override {
        super.setUp();
        json = vm.readFile("test/fixtures/engine-allowlist.json");
        n = json.readUint(".stats.allowlistedWallets");
    }

    function _entry(uint256 i) internal view returns (address w, bytes32 e, uint256 c, bytes32[] memory p) {
        string memory b = string.concat(".entries[", vm.toString(i), "]");
        w = json.readAddress(string.concat(b, ".wallet"));
        e = json.readBytes32(string.concat(b, ".entityId"));
        c = vm.parseUint(json.readString(string.concat(b, ".cap")));
        p = json.readBytes32Array(string.concat(b, ".proof"));
    }

    function test_EngineProofsVerifyWithOpenZeppelinMerkleProof() public view {
        bytes32 r = json.readBytes32(".root");
        assertEq(n, 25);
        for (uint256 i; i < n; i++) {
            (address w, bytes32 e, uint256 c, bytes32[] memory p) = _entry(i);
            assertTrue(MerkleProof.verify(p, r, SortedMerkle.leaf(w, e, c)), "engine proof rejected");
        }
    }

    function test_EngineAllowlistEnforcedByHook() public {
        // A launch whose root and evidence hash come straight from the engine.
        KinLaunchFactory.LaunchParams memory p = _params("Engine", "ENG", bytes32("engine"));
        p.root = json.readBytes32(".root");
        p.evidenceHash = json.readBytes32(".evidenceHash");
        (PoolId id,) = factory.createLaunch(p, false);
        PoolKey memory key = factory.launchKey(1);

        address[] memory bundleWallets = json.readAddressArray(".bundle");
        _openWindow();
        uint256 landed;
        for (uint256 i; i < bundleWallets.length; i++) {
            KinRouter.Allowance memory a = _engineAllowance(bundleWallets[i]);
            vm.deal(bundleWallets[i], 1 ether);
            if (_tryBuy(bundleWallets[i], key, PER_WALLET, a)) landed++;
        }
        // Engine linked the 20-wallet bundle into one entity with a 1 ETH cap: 10 x 0.1 ETH land.
        assertEq(landed, 10);
        assertEq(hook.getWindowStats(id).buyingEntities, 1);
    }

    function _engineAllowance(address w) internal view returns (KinRouter.Allowance memory a) {
        for (uint256 i; i < n; i++) {
            (address ew, bytes32 e, uint256 c, bytes32[] memory p) = _entry(i);
            if (ew == w) return KinRouter.Allowance({entityId: e, entityCap: c, proof: p});
        }
        revert("wallet not in engine allowlist");
    }
}
