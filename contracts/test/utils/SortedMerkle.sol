// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal sorted-pair Merkle tree for tests. Proofs verify with OpenZeppelin MerkleProof.
///         The engine uses the OpenZeppelin merkle-tree package; EngineFixture.t.sol checks that format.
library SortedMerkle {
    function leaf(address wallet, bytes32 entityId, uint256 entityCap) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(wallet, entityId, entityCap))));
    }

    function hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function root(bytes32[] memory leaves) internal pure returns (bytes32) {
        require(leaves.length > 0, "empty");
        bytes32[] memory level = leaves;
        while (level.length > 1) level = _next(level);
        return level[0];
    }

    function proof(bytes32[] memory leaves, uint256 index) internal pure returns (bytes32[] memory out) {
        bytes32[] memory tmp = new bytes32[](64);
        uint256 n;
        bytes32[] memory level = leaves;
        while (level.length > 1) {
            uint256 sib = index ^ 1;
            if (sib < level.length) tmp[n++] = level[sib];
            level = _next(level);
            index /= 2;
        }
        out = new bytes32[](n);
        for (uint256 i; i < n; i++) {
            out[i] = tmp[i];
        }
    }

    function _next(bytes32[] memory level) private pure returns (bytes32[] memory up) {
        up = new bytes32[]((level.length + 1) / 2);
        for (uint256 i; i < level.length; i += 2) {
            up[i / 2] = i + 1 < level.length ? hashPair(level[i], level[i + 1]) : level[i];
        }
    }
}
