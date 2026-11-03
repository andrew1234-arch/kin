// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";

import {KinHook} from "./KinHook.sol";

/// @title KinVault
/// @notice Holds tokens bought during a Kin launch window. They become claimable at
///         windowEnd + lockDuration. Balances are not transferable, which makes renting an
///         allowlist slot to a bundler slow and costly (it does not make it impossible).
contract KinVault {
    using CurrencyLibrary for Currency;

    KinHook public immutable hook;
    address public immutable router;

    mapping(PoolId => Currency) public tokenOf;
    mapping(PoolId => mapping(address => uint256)) public owed;
    mapping(PoolId => uint256) public totalOwed;

    event Credited(PoolId indexed id, address indexed buyer, uint256 amount);
    event Claimed(PoolId indexed id, address indexed buyer, uint256 amount);

    error NotRouter();
    error TokenMismatch();
    error Locked(uint256 unlockTime);
    error NothingToClaim();

    constructor(KinHook _hook, address _router) {
        hook = _hook;
        router = _router;
    }

    /// @notice Called by KinRouter after it has delivered `amount` of `token` to this vault.
    function credit(PoolId id, Currency token, address buyer, uint256 amount) external {
        if (msg.sender != router) revert NotRouter();
        Currency known = tokenOf[id];
        if (known.isAddressZero()) {
            tokenOf[id] = token;
        } else if (Currency.unwrap(known) != Currency.unwrap(token)) {
            revert TokenMismatch();
        }
        owed[id][buyer] += amount;
        totalOwed[id] += amount;
        emit Credited(id, buyer, amount);
    }

    function claim(PoolId id) external returns (uint256) {
        return claimFor(id, msg.sender);
    }

    /// @notice Anyone may trigger a claim; tokens always go to the buyer.
    function claimFor(PoolId id, address buyer) public returns (uint256 amount) {
        uint256 unlockAt = hook.unlockTime(id);
        if (block.timestamp < unlockAt) revert Locked(unlockAt);
        amount = owed[id][buyer];
        if (amount == 0) revert NothingToClaim();
        owed[id][buyer] = 0;
        totalOwed[id] -= amount;
        tokenOf[id].transfer(buyer, amount);
        emit Claimed(id, buyer, amount);
    }
}
