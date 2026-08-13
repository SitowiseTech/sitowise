// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {SitowiseFactory} from "../src/SitowiseFactory.sol";

/// @notice Drives the factory through random but always-valid sequences.
///         Every entrypoint is written so it can never revert (fail_on_revert
///         is true), yet it is deliberately NOT vacuous: `rescueFullBalance`
///         and `rescueAttempt` bound their amount by the WHOLE contract
///         balance, so the contract itself has to be the thing that says no.
contract Handler is Test {
    SitowiseFactory public immutable f;

    address public immutable relayer;
    address public immutable distributor;
    address public immutable admin;
    address public immutable treasury;
    address public immutable funder;

    address[5] public actors;
    uint256[] public ids;

    /// @dev `mintFor` now rejects the zero hash and any hash it has already
    ///      seen, so the handler must hand out a fresh ref every time or it
    ///      would revert and trip fail_on_revert.
    uint256 public refNonce;

    // ghost counters -- read by afterInvariant() to prove the handler did work
    uint256 public callsMint;
    uint256 public callsCredit;
    uint256 public callsWithdraw;
    uint256 public callsWithdrawAll;
    uint256 public callsFund;
    uint256 public rescueAttempts;
    uint256 public rescueOk;
    uint256 public rescueRejected;

    // ghost accounting, independent of the contract's own bookkeeping
    uint256 public ghostCredited;
    uint256 public ghostWithdrawn;
    uint256 public ghostFunded;
    uint256 public ghostRescued;

    constructor(SitowiseFactory f_, address relayer_, address distributor_, address admin_) {
        f = f_;
        relayer = relayer_;
        distributor = distributor_;
        admin = admin_;
        treasury = makeAddr("treasury");
        funder = makeAddr("funder");
        actors[0] = makeAddr("h_alice");
        actors[1] = makeAddr("h_bob");
        actors[2] = makeAddr("h_carol");
        actors[3] = makeAddr("h_dave");
        actors[4] = makeAddr("h_erin");
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    // ------------------------------------------------------------- actions --

    function mint(uint256 actorSeed) external {
        if (f.paused()) return;
        address to = _actor(actorSeed);
        if (f.nodeCountOf(to) >= f.maxPerWallet()) return;

        bytes32 ref = _nextRef();
        vm.prank(relayer);
        uint256 id = f.mintFor(to, ref);
        ids.push(id);
        callsMint++;
    }

    function credit(uint256 idSeed, uint256 amtSeed, uint256 sizeSeed) external {
        uint256 n = ids.length;
        if (n == 0) return;

        uint256 size = bound(sizeSeed, 1, 3);
        uint256[] memory batchIds = new uint256[](size);
        uint256[] memory amounts = new uint256[](size);
        uint256 sum;
        for (uint256 i; i < size; ++i) {
            // deliberately allows the SAME id more than once in a batch
            batchIds[i] = ids[uint256(keccak256(abi.encode(idSeed, i))) % n];
            uint256 amt = bound(uint256(keccak256(abi.encode(amtSeed, i))), 1, 10 ether);
            amounts[i] = amt;
            sum += amt;
        }

        vm.deal(distributor, sum);
        vm.prank(distributor);
        f.creditBatch{value: sum}(batchIds, amounts);

        ghostCredited += sum;
        callsCredit++;
    }

    /// @dev Starts at a random node and scans forward for one that actually has
    ///      a balance. Scanning (rather than giving up on an empty node) is what
    ///      keeps the campaign from going vacuous on an unlucky call ordering.
    function withdraw(uint256 idSeed, uint256 toSeed) external {
        uint256 n = ids.length;
        if (n == 0) return;

        uint256 start = idSeed % n;
        for (uint256 k; k < n; ++k) {
            uint256 id = ids[(start + k) % n];
            (address nodeOwner,, uint256 bal,,) = f.nodeInfo(id);
            if (bal == 0) continue;

            address to = _actor(toSeed);
            vm.prank(nodeOwner);
            f.withdraw(id, to);

            ghostWithdrawn += bal;
            callsWithdraw++;
            return;
        }
    }

    function withdrawAll(uint256 actorSeed, uint256 toSeed) external {
        uint256 start = actorSeed % actors.length;
        for (uint256 k; k < actors.length; ++k) {
            address who = actors[(start + k) % actors.length];
            uint256 total = f.balanceOfOwner(who);
            if (total == 0) continue;

            address to = _actor(toSeed);
            vm.prank(who);
            uint256 got = f.withdrawAll(to);

            ghostWithdrawn += got;
            callsWithdrawAll++;
            return;
        }
    }

    function fund(uint256 amtSeed) external {
        uint256 amt = bound(amtSeed, 1, 5 ether);
        vm.deal(funder, amt);
        vm.prank(funder);
        f.fund{value: amt}();
        ghostFunded += amt;
        callsFund++;
    }

    function fundRaw(uint256 amtSeed) external {
        uint256 amt = bound(amtSeed, 1, 5 ether);
        vm.deal(funder, amt);
        vm.prank(funder);
        (bool ok,) = address(f).call{value: amt}("");
        require(ok, "raw fund failed");
        ghostFunded += amt;
        callsFund++;
    }

    /// @notice Called once from setUp so the campaign never starts from a state
    ///         where no node exists at all.
    function seed() external {
        bytes32 ref = _nextRef();
        vm.prank(relayer);
        uint256 id = f.mintFor(actors[0], ref);
        ids.push(id);
        callsMint++;
    }

    /// @dev Built BEFORE any prank is set, and deliberately not a call that
    ///      could consume one.
    function _nextRef() internal returns (bytes32) {
        return keccak256(abi.encode("handler-payment", address(this), ++refNonce));
    }

    /// @notice Distributor credits a node and the owner immediately tries to
    ///         sweep the WHOLE contract balance. A perfectly ordinary sequence,
    ///         and one where the requested amount is guaranteed to exceed
    ///         freeBalance(), so the contract is forced to say no on every run.
    function creditThenRescueEverything(uint256 idSeed, uint256 amtSeed) external {
        uint256 n = ids.length;
        if (n == 0) return;

        uint256 id = ids[idSeed % n];
        uint256 amt = bound(amtSeed, 1, 10 ether);
        uint256[] memory batchIds = new uint256[](1);
        uint256[] memory amounts = new uint256[](1);
        batchIds[0] = id;
        amounts[0] = amt;

        vm.deal(distributor, amt);
        vm.prank(distributor);
        f.creditBatch{value: amt}(batchIds, amounts);
        ghostCredited += amt;
        callsCredit++;

        _tryRescue(address(f).balance);
    }

    /// @notice Ask for exactly the unattached remainder. Always legitimate.
    function rescueExactlyFree() external {
        _tryRescue(f.freeBalance());
    }

    /// @notice Ask for an arbitrary slice of the ENTIRE contract balance, which
    ///         may well be more than freeBalance(). The contract must refuse.
    function rescueAttempt(uint256 amtSeed) external {
        uint256 amount = bound(amtSeed, 0, address(f).balance);
        _tryRescue(amount);
    }

    /// @notice Always asks for every wei the contract holds. With any node
    ///         balance outstanding this MUST be rejected.
    function rescueFullBalance() external {
        _tryRescue(address(f).balance);
    }

    function _tryRescue(uint256 amount) internal {
        rescueAttempts++;
        vm.prank(admin);
        try f.rescue(treasury, amount) {
            rescueOk++;
            ghostRescued += amount;
        } catch {
            rescueRejected++;
        }
    }
}

contract SitowiseFactoryInvariantTest is Test {
    SitowiseFactory f;
    Handler handler;

    address relayer = makeAddr("inv_relayer");
    address distributor = makeAddr("inv_distributor");

    function setUp() public {
        f = new SitowiseFactory(relayer, distributor);
        handler = new Handler(f, relayer, distributor, address(this));

        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](10);
        selectors[0] = Handler.mint.selector;
        selectors[1] = Handler.credit.selector;
        selectors[2] = Handler.withdraw.selector;
        selectors[3] = Handler.withdrawAll.selector;
        selectors[4] = Handler.fund.selector;
        selectors[5] = Handler.fundRaw.selector;
        selectors[6] = Handler.rescueAttempt.selector;
        selectors[7] = Handler.rescueFullBalance.selector;
        selectors[8] = Handler.rescueExactlyFree.selector;
        selectors[9] = Handler.creditThenRescueEverything.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));

        handler.seed();
    }

    /// @notice THE guarantee: node money is always physically present.
    function invariant_ContractAlwaysCoversOutstanding() public view {
        assertGe(address(f).balance, f.outstanding(), "insolvent");
        assertTrue(f.isSolvent());
    }

    /// @notice `outstanding` really is the sum of every node balance.
    function invariant_OutstandingEqualsSumOfNodeBalances() public view {
        uint256 sum;
        uint256 n = f.totalNodes();
        for (uint256 id = 1; id <= n; ++id) {
            (,, uint256 bal,,) = f.nodeInfo(id);
            sum += bal;
        }
        assertEq(sum, f.outstanding(), "outstanding drifted from node balances");
    }

    function invariant_OutstandingEqualsDistributedMinusWithdrawn() public view {
        assertEq(f.totalDistributed() - f.totalWithdrawn(), f.outstanding(), "flow accounting");
    }

    function invariant_GhostAccountingMatches() public view {
        assertEq(f.totalDistributed(), handler.ghostCredited(), "credited");
        assertEq(f.totalWithdrawn(), handler.ghostWithdrawn(), "withdrawn");
        assertEq(
            address(f).balance,
            handler.ghostCredited() + handler.ghostFunded() - handler.ghostWithdrawn()
                - handler.ghostRescued(),
            "eth flow"
        );
    }

    function invariant_FreeBalanceIsTheRescuableRemainder() public view {
        assertEq(f.freeBalance(), address(f).balance - f.outstanding(), "freeBalance");
    }

    /// @dev Logging only. The non-vacuity ASSERTIONS live in
    ///      `SitowiseFactoryHandlerCoverageTest` below, so that a genuine
    ///      invariant break here is never masked by a coverage complaint about
    ///      the (deliberately tiny) shrunk counterexample sequence.
    function afterInvariant() public view {
        console2.log("mint            ", handler.callsMint());
        console2.log("credit          ", handler.callsCredit());
        console2.log("withdraw        ", handler.callsWithdraw());
        console2.log("withdrawAll     ", handler.callsWithdrawAll());
        console2.log("fund            ", handler.callsFund());
        console2.log("rescue attempts ", handler.rescueAttempts());
        console2.log("rescue accepted ", handler.rescueOk());
        console2.log("rescue rejected ", handler.rescueRejected());
    }
}

/// @notice Same handler, same target set, but the only invariant is a handler
///         tautology that cannot depend on the contract. Its `afterInvariant`
///         is therefore free to assert that the campaign was NOT vacuous:
///         nodes were minted and credited, ETH was withdrawn, and rescues were
///         both accepted (free funds) and refused (over-large).
contract SitowiseFactoryHandlerCoverageTest is Test {
    SitowiseFactory f;
    Handler handler;

    address relayer = makeAddr("cov_relayer");
    address distributor = makeAddr("cov_distributor");

    function setUp() public {
        f = new SitowiseFactory(relayer, distributor);
        handler = new Handler(f, relayer, distributor, address(this));

        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](10);
        selectors[0] = Handler.mint.selector;
        selectors[1] = Handler.credit.selector;
        selectors[2] = Handler.withdraw.selector;
        selectors[3] = Handler.withdrawAll.selector;
        selectors[4] = Handler.fund.selector;
        selectors[5] = Handler.fundRaw.selector;
        selectors[6] = Handler.rescueAttempt.selector;
        selectors[7] = Handler.rescueFullBalance.selector;
        selectors[8] = Handler.rescueExactlyFree.selector;
        selectors[9] = Handler.creditThenRescueEverything.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));

        handler.seed();
    }

    /// @dev Handler-internal tautology: never fails, so it never shrinks the
    ///      sequence and never hides the coverage assertions below.
    function invariant_HandlerBookkeepingIsConsistent() public view {
        assertEq(handler.rescueOk() + handler.rescueRejected(), handler.rescueAttempts());
    }

    function afterInvariant() public view {
        assertGt(handler.callsMint(), 0, "vacuous: nothing minted");
        assertGt(handler.callsCredit(), 0, "vacuous: nothing credited");
        assertGt(handler.callsWithdraw() + handler.callsWithdrawAll(), 0, "vacuous: nothing withdrawn");
        assertGt(handler.rescueAttempts(), 0, "vacuous: no rescue attempted");
        assertGt(handler.rescueRejected(), 0, "vacuous: no over-large rescue was ever refused");
        assertGt(handler.rescueOk(), 0, "vacuous: no legitimate rescue ever went through");
    }
}

/// @notice Deterministic proof that the handler is not vacuous: it can ask for
///         more than freeBalance() and the contract is what refuses. This is
///         also the mutation canary -- if `rescue`'s bound is changed from
///         freeBalance() to address(this).balance, `rescueRejected` becomes 0
///         here and the solvency invariant above starts failing.
contract HandlerNonVacuityTest is Test {
    SitowiseFactory f;
    Handler handler;

    address relayer = makeAddr("nv_relayer");
    address distributor = makeAddr("nv_distributor");

    function setUp() public {
        f = new SitowiseFactory(relayer, distributor);
        handler = new Handler(f, relayer, distributor, address(this));
    }

    function test_HandlerCanAttemptAnOverLargeRescueAndIsRefused() public {
        handler.mint(0);
        handler.credit(0, 12345, 0);

        uint256 outstanding = f.outstanding();
        assertGt(outstanding, 0, "setup: something must be outstanding");
        assertEq(f.freeBalance(), 0, "setup: nothing is free");

        // The handler asks for the whole balance, which is strictly more than
        // freeBalance(). The call is ATTEMPTED and the contract rejects it.
        handler.rescueFullBalance();

        assertEq(handler.rescueAttempts(), 1, "attempt was made");
        assertEq(handler.rescueOk(), 0, "must not have succeeded");
        assertEq(handler.rescueRejected(), 1, "contract refused it");
        assertEq(address(f).balance, outstanding, "no wei left the contract");
        assertTrue(f.isSolvent());
    }

    function test_HandlerRescueSucceedsOnlyForTheFreePart() public {
        handler.mint(0);
        handler.credit(0, 999, 0);
        uint256 outstanding = f.outstanding();

        handler.fund(3 ether); // bounded to <= 5 ether, so this lands as-is
        uint256 free = f.freeBalance();
        assertGt(free, 0);

        handler.rescueFullBalance();
        assertEq(handler.rescueRejected(), 1, "whole balance still refused");

        handler.rescueAttempt(free); // bound(free, 0, balance) == free
        assertEq(handler.rescueOk(), 1, "exactly-free rescue allowed");
        assertEq(address(f).balance, outstanding);
        assertTrue(f.isSolvent());
    }

    function test_HandlerSequenceKeepsInvariantTrue() public {
        for (uint256 i; i < 12; ++i) {
            handler.mint(i);
            handler.credit(i, i * 7 + 1, i);
            handler.fund(i * 1e17 + 1);
            handler.rescueAttempt(i * 1e18);
            handler.withdraw(i, i + 1);
            handler.withdrawAll(i + 2, i);
            handler.rescueFullBalance();
            assertGe(address(f).balance, f.outstanding(), "insolvent at step");
        }
        assertGt(handler.rescueRejected(), 0, "over-large rescues were refused");
        assertGt(handler.callsWithdraw() + handler.callsWithdrawAll(), 0, "withdrawals happened");
    }
}
