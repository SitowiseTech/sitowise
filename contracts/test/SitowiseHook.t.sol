// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {SitowiseHook} from "../src/SitowiseHook.sol";
import {SitowiseFactory} from "../src/SitowiseFactory.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, toBalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {Currency} from "v4-core/src/types/Currency.sol";

/// @dev Stands in for the PoolManager. `take` is the only call the hook makes,
///      and it hands over real ETH so the forward path can be exercised.
contract ManagerStub {
    uint256 public takeCalls;
    Currency public lastCurrency;
    address public lastTo;
    uint256 public lastAmount;

    function take(Currency currency, address to, uint256 amount) external {
        takeCalls++;
        lastCurrency = currency;
        lastTo = to;
        lastAmount = amount;
        (bool ok,) = to.call{value: amount}("");
        require(ok, "stub take failed");
    }

    receive() external payable {}
}

contract SitowiseHookTest is Test {
    /// Mined with script/MineHook.s.sol: low 14 bits == 0x44.
    uint160 internal constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint160 internal constant REQUIRED_FLAGS = uint160((1 << 6) | (1 << 2));

    SitowiseHook internal hook;
    SitowiseFactory internal factory;
    ManagerStub internal manager;

    address internal stranger = address(0xDEAD);
    address internal relayer = address(0xB0B);
    address internal distributor = address(0xC0FFEE);

    /// An address whose low 14 bits are already 0x44, so the constructor's
    /// validateFlags passes without mining inside the test.
    address internal hookAddr = address(uint160(0x1000000000000000000000000000000000000044));

    function setUp() public {
        manager = new ManagerStub();
        factory = new SitowiseFactory(relayer, distributor);

        deployCodeTo("SitowiseHook.sol:SitowiseHook", abi.encode(address(manager), address(factory)), hookAddr);
        hook = SitowiseHook(payable(hookAddr));
        // deployCodeTo runs the constructor with this test as the sender, so
        // the hook's owner is address(this). Owner-only calls are therefore
        // made directly and `stranger` is used for the negative cases.
        vm.deal(address(manager), 100 ether);
    }

    // ------------------------------------------------------------- the address --

    function test_DeployedAddressCarriesExactlyTheImplementedFlags() public view {
        assertEq(uint160(address(hook)) & ALL_HOOK_MASK, REQUIRED_FLAGS);
        hook.validateFlags();
    }

    function test_DeployToWrongAddressReverts() public {
        // 0x45 sets a bit the contract does not implement.
        address wrong = address(uint160(0x2000000000000000000000000000000000000045));
        vm.expectRevert(SitowiseHook.BadFlags.selector);
        deployCodeTo("SitowiseHook.sol:SitowiseHook", abi.encode(address(manager), address(factory)), wrong);
    }

    // ------------------------------------------------------------------ access --

    function test_OnlyPoolManagerCanCallAfterSwap() public {
        vm.expectRevert(SitowiseHook.NotPoolManager.selector);
        hook.afterSwap(address(this), _key(), _exactIn(), toBalanceDelta(-1 ether, 1 ether), "");
    }

    function test_UnimplementedCallbacksRevert() public {
        vm.expectRevert(SitowiseHook.NotImplemented.selector);
        hook.beforeSwap(address(this), _key(), _exactIn(), "");
        vm.expectRevert(SitowiseHook.NotImplemented.selector);
        hook.beforeInitialize(address(this), _key(), 0);
    }

    // -------------------------------------------------------------- share math --

    /// Exact input: the unspecified side is the output, and the trader is owed
    /// it, so the delta is positive and the hook takes a share of that.
    function test_ExactInTakesShareOfOutput() public {
        uint256 out = 10 ether;
        (, int128 hookDelta) = _swap(_exactIn(), toBalanceDelta(-1 ether, int128(uint128(out))));
        uint256 expected = (out * 25) / 10_000;
        assertEq(uint256(uint128(hookDelta)), expected);
        assertEq(manager.lastAmount(), expected);
        assertEq(manager.takeCalls(), 1);
    }

    /// Exact output: the unspecified side is the input the trader owes, so the
    /// delta is negative and only the magnitude is charged against.
    function test_ExactOutTakesShareOfInputMagnitude() public {
        int128 owed = -8 ether;
        (, int128 hookDelta) = _swap(_exactOut(), toBalanceDelta(owed, 1 ether));
        uint256 expected = (8 ether * 25) / 10_000;
        assertEq(uint256(uint128(hookDelta)), expected);
    }

    function test_ZeroAmountTakesNothing() public {
        (, int128 hookDelta) = _swap(_exactIn(), toBalanceDelta(-1 ether, 0));
        assertEq(hookDelta, 0);
        assertEq(manager.takeCalls(), 0);
    }

    function test_ShareOfZeroDisablesTheHook() public {
        hook.setShareBps(0);
        (, int128 hookDelta) = _swap(_exactIn(), toBalanceDelta(-1 ether, 10 ether));
        assertEq(hookDelta, 0);
        assertEq(manager.takeCalls(), 0);
    }

    function testFuzz_ShareNeverExceedsTheCapOfTheUnspecifiedSide(uint128 amount, uint16 bps) public {
        amount = uint128(bound(amount, 0, uint128(type(int128).max)));
        bps = uint16(bound(bps, 0, hook.MAX_SHARE_BPS()));
        hook.setShareBps(bps);
        vm.deal(address(manager), uint256(amount) + 1 ether);

        (, int128 hookDelta) = _swap(_exactIn(), toBalanceDelta(-1, int128(amount)));
        assertLe(uint256(uint128(hookDelta)), (uint256(amount) * hook.MAX_SHARE_BPS()) / 10_000);
    }

    // -------------------------------------------------------------- the ceiling --

    function test_ShareCannotBeRaisedPastTheCeiling() public {
        // Read the ceiling BEFORE expectRevert. expectRevert applies to the very
        // next call, and `hook.MAX_SHARE_BPS()` inside the argument list is a
        // call of its own, so inlining it would arm the cheatcode against the
        // getter and the test would pass for the wrong reason.
        uint16 ceiling = hook.MAX_SHARE_BPS();
        vm.expectRevert(SitowiseHook.ShareTooHigh.selector);
        hook.setShareBps(ceiling + 1);

        hook.setShareBps(ceiling);
        assertEq(hook.shareBps(), ceiling);
    }

    function test_OnlyOwnerCanChangeShare() public {
        vm.prank(stranger);
        vm.expectRevert(SitowiseHook.NotOwner.selector);
        hook.setShareBps(10);
    }

    // ------------------------------------------------------------- the forward --

    /// Native ETH taken by the hook lands in the factory's FREE balance, never
    /// in `outstanding`. This is the property that keeps hook revenue from
    /// silently changing what node holders are owed.
    function test_NativeTakeLandsInFactoryFreeBalanceNotOutstanding() public {
        uint256 before = factory.freeBalance();
        _swap(_exactIn(), toBalanceDelta(-1 ether, 10 ether));
        uint256 expected = (10 ether * 25) / 10_000;

        assertEq(factory.freeBalance(), before + expected);
        assertEq(factory.outstanding(), 0);
        assertTrue(factory.isSolvent());
    }

    /// currency0 is native ETH in `_key()`, so an exact-output swap takes the
    /// input side and that is ETH too. Either way the money reaches the factory.
    function test_ForwardBalancePushesStrandedEthToFactory() public {
        vm.deal(address(hook), 3 ether);
        uint256 before = factory.freeBalance();
        hook.forwardBalance();
        assertEq(address(hook).balance, 0);
        assertEq(factory.freeBalance(), before + 3 ether);
    }

    // ------------------------------------------------------------------ helpers --

    function _key() internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(0)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
    }

    function _exactIn() internal pure returns (SwapParams memory) {
        return SwapParams({zeroForOne: true, amountSpecified: -1 ether, sqrtPriceLimitX96: 0});
    }

    function _exactOut() internal pure returns (SwapParams memory) {
        return SwapParams({zeroForOne: true, amountSpecified: 1 ether, sqrtPriceLimitX96: 0});
    }

    function _swap(SwapParams memory params, BalanceDelta delta) internal returns (bytes4, int128) {
        vm.prank(address(manager));
        return hook.afterSwap(address(this), _key(), params, delta, "");
    }
}
