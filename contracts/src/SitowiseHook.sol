// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";

interface ISitowiseFactory {
    function fund() external payable;
}

/// @title SitowiseHook
/// @notice Uniswap v4 hook that takes a fixed share of the unspecified side of
///         a swap and forwards it to the Sitowise factory.
///
///         This is the mechanism the factory is eventually funded by. It is a
///         separate contract on purpose: the factory holds node balances and
///         knows nothing about swaps, so a bug here can never reach money that
///         is already credited to a node. The factory's `fund()` is payable and
///         adds to `freeBalance`, never to `outstanding`, which means value
///         arriving from this hook cannot silently change what anyone is owed.
///
///         A v4 pool fixes its hook at `initialize` and can never change it, so
///         this contract only earns anything on pools created to name it. Until
///         such a pool exists and carries volume, the hook takes nothing, and
///         node rewards are funded by Sitowise directly. The site says so.
///
///         Uniswap reads a hook's permissions from the low 14 bits of its own
///         address, so this must be deployed through CREATE2 to a mined salt.
///         Required flags: AFTER_SWAP (1 << 6) | AFTER_SWAP_RETURNS_DELTA
///         (1 << 2) == 0x44. `script/MineHook.s.sol` finds the salt and
///         `validateFlags()` refuses to let a wrong address run.
contract SitowiseHook is IHooks {
    using CurrencyLibrary for Currency;

    error NotPoolManager();
    error NotOwner();
    error NotImplemented();
    error BadFlags();
    error ShareTooHigh();
    error BadInput();
    error TransferFailed();
    error NotPendingOwner();

    /// afterSwap | afterSwapReturnDelta.
    uint160 internal constant REQUIRED_FLAGS = uint160((1 << 6) | (1 << 2));
    uint160 internal constant ALL_HOOK_MASK = uint160((1 << 14) - 1);

    /// Hard ceiling on the share, so no owner setting can turn this into a
    /// swap-eating contract. 5% of the unspecified side.
    uint16 public constant MAX_SHARE_BPS = 500;

    IPoolManager public immutable poolManager;
    /// Where the take is forwarded. Immutable: the destination of swap revenue
    /// is not something an owner key should be able to repoint.
    address public immutable factory;

    address public owner;
    address public pendingOwner;
    uint16 public shareBps = 25;

    event ShareChanged(uint16 shareBps);
    event Collected(Currency indexed currency, uint256 amount);
    event Forwarded(uint256 amount);
    event Swept(Currency indexed currency, address indexed to, uint256 amount);
    event OwnershipOfferStarted(address indexed pendingOwner);
    event OwnerChanged(address owner);

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IPoolManager poolManager_, address factory_) {
        if (address(poolManager_) == address(0) || factory_ == address(0)) revert BadInput();
        poolManager = poolManager_;
        factory = factory_;
        owner = msg.sender;
        emit OwnerChanged(msg.sender);
        validateFlags();
    }

    /// @notice Reverts unless this contract's own address carries exactly the
    ///         permission bits it implements. Called in the constructor, so a
    ///         hook deployed to a wrong address cannot exist at all.
    function validateFlags() public view {
        if (uint160(address(this)) & ALL_HOOK_MASK != REQUIRED_FLAGS) revert BadFlags();
    }

    // ------------------------------------------------------------------ swap --

    /// @inheritdoc IHooks
    /// @dev Takes `shareBps` of the unspecified side and returns it as the hook
    ///      delta, which makes the PoolManager charge the swapper for it. The
    ///      value is then pulled with `take` and forwarded if it is native ETH.
    function afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external onlyPoolManager returns (bytes4, int128) {
        uint16 bps = shareBps;
        if (bps == 0) return (IHooks.afterSwap.selector, int128(0));

        // Exact input means the specified side is what the trader put in, so
        // the unspecified side is the output; exact output is the mirror.
        bool exactIn = params.amountSpecified < 0;
        bool unspecifiedIsOne = exactIn ? params.zeroForOne : !params.zeroForOne;

        Currency currency = unspecifiedIsOne ? key.currency1 : key.currency0;
        int128 amount = unspecifiedIsOne ? delta.amount1() : delta.amount0();

        // On exact input the trader is owed the output (positive); on exact
        // output the trader owes the input (negative). Only the magnitude
        // matters for a share, and a zero-amount swap leaves nothing to take.
        uint256 magnitude = amount < 0 ? uint256(uint128(-amount)) : uint256(uint128(amount));
        if (magnitude == 0) return (IHooks.afterSwap.selector, int128(0));

        uint256 fee = (magnitude * bps) / 10_000;
        if (fee == 0) return (IHooks.afterSwap.selector, int128(0));

        poolManager.take(currency, address(this), fee);
        emit Collected(currency, fee);

        if (currency.isAddressZero()) _forward(fee);

        // casting to 'uint128' is safe because fee is at most MAX_SHARE_BPS/10000
        // of `magnitude`, which was itself read out of an int128, so it cannot
        // exceed type(int128).max.
        // forge-lint: disable-next-line(unsafe-typecast)
        return (IHooks.afterSwap.selector, int128(uint128(fee)));
    }

    /// Native ETH goes straight to the factory's free balance. A failure here
    /// would revert the swap that produced it, so the call is allowed to fail
    /// quietly and leave the ETH in this contract for `sweep` to move later.
    function _forward(uint256 amount) internal {
        (bool ok,) = factory.call{value: amount}(abi.encodeCall(ISitowiseFactory.fund, ()));
        if (ok) emit Forwarded(amount);
    }

    // ----------------------------------------------------------------- admin --

    function setShareBps(uint16 v) external onlyOwner {
        if (v > MAX_SHARE_BPS) revert ShareTooHigh();
        shareBps = v;
        emit ShareChanged(v);
    }

    /// Moves whatever this contract is holding. ERC-20 takes and any native ETH
    /// whose forward failed end up here; node balances never do, because they
    /// live in the factory and this contract cannot call anything that touches
    /// them.
    function sweep(Currency currency, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert BadInput();
        currency.transfer(to, amount);
        emit Swept(currency, to, amount);
    }

    /// Push whatever native ETH is sitting here into the factory.
    function forwardBalance() external {
        uint256 bal = address(this).balance;
        if (bal == 0) revert BadInput();
        ISitowiseFactory(factory).fund{value: bal}();
        emit Forwarded(bal);
    }

    function transferOwnership(address v) external onlyOwner {
        if (v == address(0)) revert BadInput();
        pendingOwner = v;
        emit OwnershipOfferStarted(v);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnerChanged(msg.sender);
    }

    receive() external payable {}

    // ------------------------------------------- unimplemented IHooks members --
    // The permission bits in this contract's address are not set for any of
    // these, so the PoolManager never calls them. They revert rather than
    // return a selector so a misconfigured deployment fails loudly.

    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        revert NotImplemented();
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert NotImplemented();
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert NotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert NotImplemented();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert NotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert NotImplemented();
    }

    function beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        external
        pure
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        revert NotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert NotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert NotImplemented();
    }
}
