// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Production hook base: OpenZeppelin uniswap-hooks BaseHook (BaseHook was removed from
// v4-periphery in commit 5da22e60 "remove hooks and move to hook repo").
import {BaseHook} from "@openzeppelin/uniswap-hooks/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title KinHook
/// @notice Entity-capped launch windows for Uniswap v4 pools.
///
/// Lifecycle of a pool configured by the KinLaunchFactory:
///   1. Registration / dispute period (block.timestamp < windowStart): every swap reverts.
///      The launch admin may replace the allowlist root (e.g. after a dispute).
///   2. Window (windowStart <= block.timestamp < windowEnd): only the trusted KinRouter may swap,
///      only in the buy direction, exact-input only, and every wallet in the same entity draws from
///      ONE shared cap. The root is frozen.
///   3. Open trading (block.timestamp >= windowEnd): any router, any direction.
///
/// In a v4 hook, `sender` is the router that called PoolManager, not the end user. That is why the
/// hook trusts exactly one router (KinRouter), which writes its own msg.sender into the hook data.
///
/// Allowlist leaf (must match engine/src/allowlist exactly):
///   keccak256(bytes.concat(keccak256(abi.encode(wallet, entityId, entityCap))))
/// Proofs use sorted-pair hashing (OpenZeppelin MerkleProof / StandardMerkleTree compatible).
///
/// Claims discipline: this makes bundling expensive and visible. It does not stop it.
contract KinHook is BaseHook {
    using PoolIdLibrary for PoolKey;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @notice Allowlist-derived numbers produced by the engine. They are committed together with
    ///         the evidence hash, so anyone can recompute them from the published evidence file.
    struct AllowlistStats {
        uint32 allowlistedWallets; // leaves in the tree
        uint32 entities; // distinct entityIds in the tree
        uint32 linkedWallets; // wallets that sit in a multi-wallet (linked) entity
        uint32 freshWallets; // wallets that share the pooled "fresh" entity cap
    }

    struct LaunchConfig {
        bytes32 root;
        bytes32 evidenceHash;
        uint64 windowStart;
        uint64 windowEnd;
        uint64 lockDuration; // vault lock after windowEnd
        bool buyIsZeroForOne;
        address admin; // may update the root before windowStart
        AllowlistStats stats;
    }

    struct Launch {
        bytes32 root;
        bytes32 evidenceHash;
        uint64 windowStart;
        uint64 windowEnd;
        uint64 lockDuration;
        bool buyIsZeroForOne;
        bool configured;
        address admin;
        AllowlistStats stats;
    }

    /// @notice Values computed onchain from window buys.
    struct WindowStats {
        uint256 totalVolume; // sum of exact-input amounts (quote currency) bought in the window
        uint256 largestEntitySpend;
        bytes32 largestEntity;
        uint32 buyerWallets; // distinct wallets that bought
        uint32 buyingEntities; // distinct entities that bought
        uint32 buys;
    }

    /// @notice The Fairness Receipt for one launch.
    struct Receipt {
        bool finalized;
        uint64 finalizedAt;
        bytes32 root;
        bytes32 evidenceHash;
        WindowStats window;
        uint256 largestEntityShareBps; // largestEntitySpend * 10_000 / totalVolume
        AllowlistStats allowlist;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    address public immutable kinRouter;
    address public immutable owner;
    address public factory;

    mapping(PoolId => Launch) internal _launches;
    mapping(PoolId => WindowStats) internal _windowStats;
    mapping(PoolId => uint64) public finalizedAt;
    mapping(PoolId => mapping(bytes32 => uint256)) public entitySpent;
    mapping(PoolId => mapping(address => uint256)) public buyerSpent;

    // ---------------------------------------------------------------------
    // Events / errors
    // ---------------------------------------------------------------------

    event FactorySet(address factory);
    event LaunchConfigured(
        PoolId indexed id,
        address indexed admin,
        bytes32 root,
        bytes32 evidenceHash,
        uint64 windowStart,
        uint64 windowEnd,
        uint64 lockDuration,
        bool buyIsZeroForOne,
        AllowlistStats stats
    );
    event AllowlistUpdated(PoolId indexed id, bytes32 root, bytes32 evidenceHash, AllowlistStats stats);
    event WindowBuy(
        PoolId indexed id, bytes32 indexed entity, address indexed buyer, uint256 amountIn, uint256 entitySpent
    );
    event ReceiptFinalized(
        PoolId indexed id,
        bytes32 root,
        bytes32 evidenceHash,
        uint256 totalVolume,
        uint32 buyingEntities,
        uint32 buyerWallets,
        uint256 largestEntityShareBps,
        uint32 linkedWallets,
        uint32 freshWallets
    );

    error NotOwner();
    error NotFactory();
    error NotAdmin();
    error FactoryAlreadySet();
    error AlreadyConfigured();
    error NotConfigured();
    error InvalidConfig();
    error WindowNotOpen(uint64 windowStart);
    error AllowlistFrozen();
    error UntrustedRouter();
    error SellsLockedDuringWindow();
    error ExactInputOnly();
    error NotOnAllowlist();
    error EntityCapExceeded(bytes32 entity, uint256 cap, uint256 attempted);
    error WindowNotEnded();
    error AlreadyFinalized();

    constructor(IPoolManager _manager, address _kinRouter, address _owner) BaseHook(_manager) {
        kinRouter = _kinRouter;
        owner = _owner;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.beforeSwap = true;
    }

    // ---------------------------------------------------------------------
    // Wiring
    // ---------------------------------------------------------------------

    /// @notice One-shot: the factory and the hook reference each other, so the factory is set after deploy.
    function setFactory(address _factory) external {
        if (msg.sender != owner) revert NotOwner();
        if (factory != address(0)) revert FactoryAlreadySet();
        factory = _factory;
        emit FactorySet(_factory);
    }

    // ---------------------------------------------------------------------
    // Launch configuration
    // ---------------------------------------------------------------------

    function configureLaunch(PoolKey calldata key, LaunchConfig calldata cfg) external onlyValidPools(key.hooks) {
        if (msg.sender != factory) revert NotFactory();
        PoolId id = key.toId();
        Launch storage l = _launches[id];
        if (l.configured) revert AlreadyConfigured();
        if (
            cfg.root == bytes32(0) || cfg.windowStart < block.timestamp || cfg.windowEnd <= cfg.windowStart
                || cfg.admin == address(0)
        ) revert InvalidConfig();

        l.root = cfg.root;
        l.evidenceHash = cfg.evidenceHash;
        l.windowStart = cfg.windowStart;
        l.windowEnd = cfg.windowEnd;
        l.lockDuration = cfg.lockDuration;
        l.buyIsZeroForOne = cfg.buyIsZeroForOne;
        l.configured = true;
        l.admin = cfg.admin;
        l.stats = cfg.stats;

        emit LaunchConfigured(
            id,
            cfg.admin,
            cfg.root,
            cfg.evidenceHash,
            cfg.windowStart,
            cfg.windowEnd,
            cfg.lockDuration,
            cfg.buyIsZeroForOne,
            cfg.stats
        );
    }

    /// @notice Replace the allowlist during the dispute period. Frozen from windowStart onwards.
    function updateAllowlist(PoolId id, bytes32 root, bytes32 evidenceHash, AllowlistStats calldata stats) external {
        Launch storage l = _launches[id];
        if (!l.configured) revert NotConfigured();
        if (msg.sender != l.admin) revert NotAdmin();
        if (block.timestamp >= l.windowStart) revert AllowlistFrozen();
        if (root == bytes32(0)) revert InvalidConfig();
        l.root = root;
        l.evidenceHash = evidenceHash;
        l.stats = stats;
        emit AllowlistUpdated(id, root, evidenceHash, stats);
    }

    // ---------------------------------------------------------------------
    // Swap gate
    // ---------------------------------------------------------------------

    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        Launch storage l = _launches[id];
        if (!l.configured) revert NotConfigured();
        if (block.timestamp < l.windowStart) revert WindowNotOpen(l.windowStart);
        if (block.timestamp < l.windowEnd) _windowBuy(id, l, sender, params, hookData);
        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function _windowBuy(
        PoolId id,
        Launch storage l,
        address sender,
        SwapParams calldata params,
        bytes calldata hookData
    ) internal {
        if (sender != kinRouter) revert UntrustedRouter();
        if (params.zeroForOne != l.buyIsZeroForOne) revert SellsLockedDuringWindow();
        if (params.amountSpecified >= 0) revert ExactInputOnly();

        (address buyer, bytes32 entityId, uint256 entityCap) = _verifyLeaf(l.root, hookData);
        uint256 amountIn = uint256(-params.amountSpecified);

        uint256 prevEntity = entitySpent[id][entityId];
        uint256 spent = prevEntity + amountIn;
        if (spent > entityCap) revert EntityCapExceeded(entityId, entityCap, spent);
        entitySpent[id][entityId] = spent;

        _recordStats(id, buyer, entityId, amountIn, prevEntity == 0, spent);
        emit WindowBuy(id, entityId, buyer, amountIn, spent);
    }

    function _verifyLeaf(bytes32 root, bytes calldata hookData)
        internal
        pure
        returns (address buyer, bytes32 entityId, uint256 entityCap)
    {
        bytes32[] memory proof;
        (buyer, entityId, entityCap, proof) = abi.decode(hookData, (address, bytes32, uint256, bytes32[]));
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(buyer, entityId, entityCap))));
        if (!MerkleProof.verify(proof, root, leaf)) revert NotOnAllowlist();
    }

    function _recordStats(
        PoolId id,
        address buyer,
        bytes32 entityId,
        uint256 amountIn,
        bool firstEntityBuy,
        uint256 entityTotal
    ) internal {
        WindowStats storage s = _windowStats[id];
        if (firstEntityBuy) s.buyingEntities++;
        if (buyerSpent[id][buyer] == 0) s.buyerWallets++;
        buyerSpent[id][buyer] += amountIn;
        s.totalVolume += amountIn;
        s.buys++;
        if (entityTotal > s.largestEntitySpend) {
            s.largestEntitySpend = entityTotal;
            s.largestEntity = entityId;
        }
    }

    // ---------------------------------------------------------------------
    // Fairness Receipt
    // ---------------------------------------------------------------------

    /// @notice Anyone can freeze the receipt once the window has ended.
    function finalize(PoolId id) external {
        Launch storage l = _launches[id];
        if (!l.configured) revert NotConfigured();
        if (block.timestamp < l.windowEnd) revert WindowNotEnded();
        if (finalizedAt[id] != 0) revert AlreadyFinalized();
        finalizedAt[id] = uint64(block.timestamp);

        Receipt memory r = getReceipt(id);
        emit ReceiptFinalized(
            id,
            r.root,
            r.evidenceHash,
            r.window.totalVolume,
            r.window.buyingEntities,
            r.window.buyerWallets,
            r.largestEntityShareBps,
            r.allowlist.linkedWallets,
            r.allowlist.freshWallets
        );
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getLaunch(PoolId id) external view returns (Launch memory) {
        return _launches[id];
    }

    function getWindowStats(PoolId id) external view returns (WindowStats memory) {
        return _windowStats[id];
    }

    function isWindowOpen(PoolId id) external view returns (bool) {
        Launch storage l = _launches[id];
        return l.configured && block.timestamp >= l.windowStart && block.timestamp < l.windowEnd;
    }

    function unlockTime(PoolId id) external view returns (uint256) {
        Launch storage l = _launches[id];
        return uint256(l.windowEnd) + uint256(l.lockDuration);
    }

    function getReceipt(PoolId id) public view returns (Receipt memory r) {
        Launch storage l = _launches[id];
        r.finalized = finalizedAt[id] != 0;
        r.finalizedAt = finalizedAt[id];
        r.root = l.root;
        r.evidenceHash = l.evidenceHash;
        r.window = _windowStats[id];
        r.allowlist = l.stats;
        if (r.window.totalVolume > 0) {
            r.largestEntityShareBps = (r.window.largestEntitySpend * 10_000) / r.window.totalVolume;
        }
    }
}
