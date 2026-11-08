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
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title KinHook
/// @notice Entity-capped launch windows for Uniswap v4 pools.
///
/// Lifecycle of a pool configured by the KinLaunchFactory:
///   1. Registration / dispute period (block.timestamp < windowStart): every swap reverts.
///      The launch admin may replace the allowlist root (e.g. after a dispute); every replacement
///      pushes the window back so at least `minReviewPeriod` remains to inspect the new root.
///   2. Window (windowStart <= block.timestamp < windowEnd): only the trusted KinRouter may swap,
///      only in the buy direction, exact-input only, and every wallet in the same entity draws from
///      ONE shared cap, counted in what the swap actually paid (afterSwap). The root is frozen.
///   3. Open trading (block.timestamp >= windowEnd): any router, any direction. The receipt is final.
///
/// Window length, lock length, the minimum review period and the creator's share of supply are
/// bounded by deploy-time limits (`limits`), so no launch can make the window cosmetic or endless.
///
/// In a v4 hook, `sender` is the router that called PoolManager, not the end user. That is why the
/// hook trusts exactly one router (KinRouter), which writes its own msg.sender into the hook data.
///
/// Allowlist leaf (must match engine/src/allowlist exactly):
///   keccak256(bytes.concat(keccak256(abi.encode(wallet, entityId, entityCap))))
/// Proofs use sorted-pair hashing (OpenZeppelin MerkleProof / StandardMerkleTree compatible).
///
/// Instant launches (root == 0) have no allowlist and no registration. The Kin engine traces a buyer's funding
/// when they buy and signs a short-lived EIP-712 KinPermit(poolId, buyer, entityId, entityCap, deadline) with
/// `permitSigner`. The router's `proof` field then carries the permit as [deadline, r, vs] (EIP-2098 compact
/// signature). Every other rule (one running total per entity, cap pinned by the entity's first buy) is the same.
///
/// Claims discipline: this makes bundling expensive and visible. It does not stop it.
contract KinHook is BaseHook, EIP712 {
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

    /// @notice Deploy-time bounds every launch on this hook must respect.
    struct Limits {
        uint64 minReviewPeriod; // min time between the last root change (or configuration) and windowStart
        uint64 minWindow;
        uint64 maxWindow;
        uint64 maxLock;
        uint16 maxCreatorBps; // creatorAllocation <= totalSupply * maxCreatorBps / 10_000
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
        uint256 totalSupply;
        uint256 creatorAllocation; // tokens the creator received outside the window
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
        uint256 totalSupply;
        uint256 creatorAllocation;
    }

    /// @notice One entity's window spend and the cap its first buy proved (packed in one slot).
    struct EntityState {
        uint128 spent;
        uint128 cap;
    }

    /// @notice Values computed onchain from window buys.
    struct WindowStats {
        uint256 totalVolume; // sum of amounts actually paid (quote currency) in the window
        uint256 largestEntitySpend;
        bytes32 largestEntity;
        uint32 buyerWallets; // distinct wallets that bought
        uint32 buyingEntities; // distinct entities that bought
        uint32 buys;
    }

    /// @notice The Fairness Receipt for one launch.
    /// `finalized` is true once the window has ended: nothing in the receipt can change after that.
    struct Receipt {
        bool finalized;
        uint64 finalizedAt; // windowEnd, once finalized
        bytes32 root;
        bytes32 evidenceHash;
        WindowStats window;
        uint256 largestEntityShareBps; // largestEntitySpend * 10_000 / totalVolume
        AllowlistStats allowlist;
        uint256 totalSupply;
        uint256 creatorAllocation; // outside every cap; shown so a "fair" window can't hide a large creator share
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    address public immutable kinRouter;
    address public immutable owner;
    uint64 public immutable minReviewPeriod;
    uint64 public immutable minWindow;
    uint64 public immutable maxWindow;
    uint64 public immutable maxLock;
    uint16 public immutable maxCreatorBps;
    address public factory;
    /// @notice Signs buy permits for instant launches (root == 0). Zero disables instant launches on this hook.
    address public immutable permitSigner;

    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("KinPermit(bytes32 poolId,address buyer,bytes32 entityId,uint256 entityCap,uint64 deadline)");

    mapping(PoolId => Launch) internal _launches;
    mapping(PoolId => WindowStats) internal _windowStats;
    mapping(PoolId => bool) public receiptEmitted;
    mapping(PoolId => mapping(bytes32 => EntityState)) internal _entities;
    mapping(PoolId => mapping(address => uint256)) public buyerSpent;

    // ---------------------------------------------------------------------
    // Events / errors
    // ---------------------------------------------------------------------

    event FactorySet(address factory);
    event LaunchConfigured(PoolId indexed id, address indexed admin, LaunchConfig cfg);
    event AllowlistUpdated(
        PoolId indexed id, bytes32 root, bytes32 evidenceHash, AllowlistStats stats, uint64 windowStart, uint64 windowEnd
    );
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
    error EntityCapMismatch(bytes32 entity, uint256 provenCap, uint256 leafCap);
    error WindowNotEnded();
    error AlreadyFinalized();
    error PermitExpired(uint64 deadline);
    error BadPermit();

    constructor(IPoolManager _manager, address _kinRouter, address _owner, Limits memory _limits, address _permitSigner)
        BaseHook(_manager)
        EIP712("KinHook", "1")
    {
        if (_limits.minWindow == 0 || _limits.minWindow > _limits.maxWindow || _limits.maxCreatorBps > 10_000) {
            revert InvalidConfig();
        }
        kinRouter = _kinRouter;
        owner = _owner;
        minReviewPeriod = _limits.minReviewPeriod;
        minWindow = _limits.minWindow;
        maxWindow = _limits.maxWindow;
        maxLock = _limits.maxLock;
        maxCreatorBps = _limits.maxCreatorBps;
        permitSigner = _permitSigner;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.beforeSwap = true;
        p.afterSwap = true;
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
        _checkConfig(cfg);

        l.root = cfg.root;
        l.evidenceHash = cfg.evidenceHash;
        l.windowStart = cfg.windowStart;
        l.windowEnd = cfg.windowEnd;
        l.lockDuration = cfg.lockDuration;
        l.buyIsZeroForOne = cfg.buyIsZeroForOne;
        l.configured = true;
        l.admin = cfg.admin;
        l.stats = cfg.stats;
        l.totalSupply = cfg.totalSupply;
        l.creatorAllocation = cfg.creatorAllocation;

        emit LaunchConfigured(id, cfg.admin, cfg);
    }

    function _checkConfig(LaunchConfig calldata cfg) internal view {
        if (
            (cfg.root == bytes32(0) && permitSigner == address(0)) || cfg.admin == address(0) || cfg.totalSupply == 0
                || cfg.windowStart < block.timestamp + minReviewPeriod || cfg.windowEnd < cfg.windowStart + minWindow
                || cfg.windowEnd > cfg.windowStart + maxWindow || cfg.lockDuration > maxLock
                || cfg.creatorAllocation * 10_000 > cfg.totalSupply * maxCreatorBps
        ) revert InvalidConfig();
    }

    /// @notice Replace the allowlist during the dispute period. Frozen from windowStart onwards.
    ///         If less than `minReviewPeriod` remains before the window, the window (start and end) moves
    ///         back so that a full review period follows every root change.
    function updateAllowlist(PoolId id, bytes32 root, bytes32 evidenceHash, AllowlistStats calldata stats) external {
        Launch storage l = _launches[id];
        if (!l.configured) revert NotConfigured();
        if (msg.sender != l.admin) revert NotAdmin();
        if (block.timestamp >= l.windowStart) revert AllowlistFrozen();
        if (root == bytes32(0)) revert InvalidConfig();
        l.root = root;
        l.evidenceHash = evidenceHash;
        l.stats = stats;
        uint64 earliest = uint64(block.timestamp) + minReviewPeriod;
        if (l.windowStart < earliest) {
            uint64 shift = earliest - l.windowStart;
            l.windowStart = earliest;
            l.windowEnd += shift;
        }
        emit AllowlistUpdated(id, root, evidenceHash, stats, l.windowStart, l.windowEnd);
    }

    // ---------------------------------------------------------------------
    // Swap gate
    // ---------------------------------------------------------------------

    /// @dev Gate: closed before the window; during it, KinRouter-only exact-input buys.
    function _beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        Launch storage l = _launches[key.toId()];
        if (!l.configured) revert NotConfigured();
        if (block.timestamp < l.windowStart) revert WindowNotOpen(l.windowStart);
        if (block.timestamp < l.windowEnd) {
            if (sender != kinRouter) revert UntrustedRouter();
            if (params.zeroForOne != l.buyIsZeroForOne) revert SellsLockedDuringWindow();
            if (params.amountSpecified >= 0) revert ExactInputOnly();
        }
        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @dev Accounting: during the window, charge the entity what the swap actually paid (a partial fill
    ///      at the end of the curve pays less than it asked for). Reverting here reverts the swap.
    function _afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata hookData)
        internal
        override
        returns (bytes4, int128)
    {
        PoolId id = key.toId();
        Launch storage l = _launches[id];
        if (block.timestamp < l.windowEnd) {
            int128 inDelta = params.zeroForOne ? delta.amount0() : delta.amount1();
            _windowBuy(id, l.root, uint256(uint128(-inDelta)), hookData);
        }
        return (this.afterSwap.selector, 0);
    }

    function _windowBuy(PoolId id, bytes32 root, uint256 paid, bytes calldata hookData) internal {
        (address buyer, bytes32 entityId, uint256 entityCap) =
            root == bytes32(0) ? _verifyPermit(id, hookData) : _verifyLeaf(root, hookData);

        // The first buy of an entity pins its cap; every later leaf for that entity must prove the same cap.
        EntityState storage e = _entities[id][entityId];
        uint256 prevEntity = e.spent;
        if (prevEntity == 0 && e.cap == 0) {
            if (entityCap > type(uint128).max) revert InvalidConfig();
            e.cap = uint128(entityCap);
        } else if (e.cap != entityCap) {
            revert EntityCapMismatch(entityId, e.cap, entityCap);
        }
        uint256 spent = prevEntity + paid;
        if (spent > entityCap) revert EntityCapExceeded(entityId, entityCap, spent);
        e.spent = uint128(spent);

        _recordStats(id, buyer, entityId, paid, prevEntity == 0, spent);
        emit WindowBuy(id, entityId, buyer, paid, spent);
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

    /// @dev Instant launches: `proof` is [deadline, r, vs], a KinPermit signed by `permitSigner` for this pool and
    ///      exactly this buyer (the router writes its own msg.sender as the buyer, so a permit can't be reused by
    ///      another wallet).
    function _verifyPermit(PoolId id, bytes calldata hookData)
        internal
        view
        returns (address buyer, bytes32 entityId, uint256 entityCap)
    {
        bytes32[] memory p;
        (buyer, entityId, entityCap, p) = abi.decode(hookData, (address, bytes32, uint256, bytes32[]));
        if (p.length != 3) revert BadPermit();
        uint64 deadline = uint64(uint256(p[0]));
        if (block.timestamp > deadline) revert PermitExpired(deadline);
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(PERMIT_TYPEHASH, PoolId.unwrap(id), buyer, entityId, entityCap, deadline))
        );
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, p[1], p[2]);
        if (err != ECDSA.RecoverError.NoError || signer != permitSigner || signer == address(0)) revert BadPermit();
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

    /// @notice Optional: emits the final receipt as an event once the window has ended (anyone may call).
    ///         The receipt is final at windowEnd whether or not this is called.
    function finalize(PoolId id) external {
        Launch storage l = _launches[id];
        if (!l.configured) revert NotConfigured();
        if (block.timestamp < l.windowEnd) revert WindowNotEnded();
        if (receiptEmitted[id]) revert AlreadyFinalized();
        receiptEmitted[id] = true;

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

    /// @notice What an entity has spent in the window (quote currency actually paid).
    function entitySpent(PoolId id, bytes32 entityId) external view returns (uint256) {
        return _entities[id][entityId].spent;
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
        r.finalized = l.configured && block.timestamp >= l.windowEnd;
        r.finalizedAt = r.finalized ? l.windowEnd : 0;
        r.root = l.root;
        r.evidenceHash = l.evidenceHash;
        r.window = _windowStats[id];
        r.allowlist = l.stats;
        r.totalSupply = l.totalSupply;
        r.creatorAllocation = l.creatorAllocation;
        if (r.window.totalVolume > 0) {
            r.largestEntityShareBps = (r.window.largestEntitySpend * 10_000) / r.window.totalVolume;
        }
    }
}
