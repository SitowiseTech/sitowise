// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SitowiseFactory} from "../src/SitowiseFactory.sol";
import {
    RejectsETH,
    NoReceive,
    ReentrantWithdrawer,
    ReentrantWithdrawAll,
    CrossReenter,
    ReentrantRescuer
} from "./Helpers.sol";

contract SitowiseFactoryTest is Test {
    SitowiseFactory f;

    address owner = address(this);
    address relayer = makeAddr("relayer");
    address distributor = makeAddr("distributor");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    event NodeMinted(uint256 indexed id, address indexed owner, bytes32 paymentRef, uint64 createdAt);
    event Credited(uint256 indexed id, uint256 amount, uint256 newBalance);
    event Withdrawn(uint256 indexed id, address indexed to, uint256 amount);
    event RelayerChanged(address relayer);
    event DistributorChanged(address distributor);
    event PausedChanged(bool paused);
    event MaxPerWalletChanged(uint256 max);
    event OwnerChanged(address owner);
    event OwnershipOfferStarted(address indexed pendingOwner);
    event Funded(address indexed from, uint256 amount);
    event Rescued(address indexed to, uint256 amount);

    receive() external payable {}

    function setUp() public {
        f = new SitowiseFactory(relayer, distributor);
        vm.deal(distributor, 10_000 ether);
        vm.warp(1_700_000_000);
    }

    // ------------------------------------------------------------- helpers --

    uint256 private _refNonce;

    /// @dev A fresh, non-zero payment ref. `mintFor` rejects the zero hash and
    ///      any hash it has already recorded, so every successful mint needs one.
    function _ref() internal returns (bytes32) {
        return keccak256(abi.encode("payment", address(this), ++_refNonce));
    }

    function _mint(address to) internal returns (uint256 id) {
        // NB: build the ref BEFORE the prank. Anything in the argument list that
        // makes a call would consume the prank (this bit me once already).
        bytes32 ref = _ref();
        vm.prank(relayer);
        id = f.mintFor(to, ref);
    }

    function _credit(uint256 id, uint256 amount) internal {
        uint256[] memory ids = new uint256[](1);
        uint256[] memory amounts = new uint256[](1);
        ids[0] = id;
        amounts[0] = amount;
        vm.prank(distributor);
        f.creditBatch{value: amount}(ids, amounts);
    }

    function _arr(uint256 a) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = a;
    }

    function _arr(uint256 a, uint256 b) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        r[0] = a;
        r[1] = b;
    }

    function _arr(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory r) {
        r = new uint256[](3);
        r[0] = a;
        r[1] = b;
        r[2] = c;
    }

    function _bal(uint256 id) internal view returns (uint256 b) {
        (,, b,,) = f.nodeInfo(id);
    }

    function _received(uint256 id) internal view returns (uint256 v) {
        (,,, v,) = f.nodeInfo(id);
    }

    function _withdrawnBy(uint256 id) internal view returns (uint256 v) {
        (,,,, v) = f.nodeInfo(id);
    }

    // =========================================================== constructor ==

    function test_Constructor_SetsRoles() public view {
        assertEq(f.owner(), owner, "owner");
        assertEq(f.relayer(), relayer, "relayer");
        assertEq(f.distributor(), distributor, "distributor");
        assertEq(f.maxPerWallet(), 25, "maxPerWallet");
        assertEq(f.MAX_PER_WALLET_CEILING(), 100, "ceiling");
        assertEq(f.pendingOwner(), address(0), "no pending owner");
        assertEq(f.totalNodes(), 0);
        assertEq(f.outstanding(), 0);
        assertFalse(f.paused());
        assertTrue(f.isSolvent());
    }

    function test_Constructor_RevertsOnZeroRelayer() public {
        vm.expectRevert(SitowiseFactory.BadInput.selector);
        new SitowiseFactory(address(0), distributor);
    }

    function test_Constructor_RevertsOnZeroDistributor() public {
        vm.expectRevert(SitowiseFactory.BadInput.selector);
        new SitowiseFactory(relayer, address(0));
    }

    // ================================================================ mintFor ==

    function test_MintFor_OnlyRelayer() public {
        bytes32 ref = _ref();

        vm.expectRevert(SitowiseFactory.NotRelayer.selector);
        f.mintFor(alice, ref); // owner is not the relayer

        vm.prank(alice);
        vm.expectRevert(SitowiseFactory.NotRelayer.selector);
        f.mintFor(alice, ref);

        vm.prank(distributor);
        vm.expectRevert(SitowiseFactory.NotRelayer.selector);
        f.mintFor(alice, ref);

        assertFalse(f.paymentRefUsed(ref), "a rejected mint must not burn the ref");
    }

    function test_MintFor_IdsIncrementFromOne() public {
        assertEq(_mint(alice), 1);
        assertEq(_mint(bob), 2);
        assertEq(_mint(alice), 3);
        assertEq(f.totalNodes(), 3);

        uint256[] memory a = f.nodesOf(alice);
        assertEq(a.length, 2);
        assertEq(a[0], 1);
        assertEq(a[1], 3);
        assertEq(f.nodesOf(bob)[0], 2);
    }

    function test_MintFor_NodeZeroIsNeverAssigned() public {
        _mint(alice);
        (address o,,,,) = f.nodeInfo(0);
        assertEq(o, address(0), "id 0 must stay empty");
    }

    function test_MintFor_StoresFieldsAndEmits() public {
        vm.expectEmit(true, true, false, true, address(f));
        emit NodeMinted(1, alice, bytes32(uint256(0xdead)), uint64(block.timestamp));
        vm.prank(relayer);
        uint256 id = f.mintFor(alice, bytes32(uint256(0xdead)));

        (address o, uint64 createdAt, uint256 bal, uint256 rec, uint256 wd) = f.nodeInfo(id);
        assertEq(o, alice);
        assertEq(createdAt, uint64(block.timestamp));
        assertEq(bal, 0);
        assertEq(rec, 0);
        assertEq(wd, 0);
    }

    function test_MintFor_RevertsOnZeroAddress() public {
        bytes32 ref = _ref();
        vm.prank(relayer);
        vm.expectRevert(SitowiseFactory.BadInput.selector);
        f.mintFor(address(0), ref);
        assertFalse(f.paymentRefUsed(ref));
    }

    function test_MintFor_WalletLimit25() public {
        for (uint256 i; i < 25; ++i) {
            _mint(alice);
        }
        assertEq(f.nodeCountOf(alice), 25);

        bytes32 ref = _ref();
        vm.prank(relayer);
        vm.expectRevert(SitowiseFactory.WalletLimit.selector);
        f.mintFor(alice, ref);

        // limit is per wallet, not global
        assertEq(_mint(bob), 26);
    }

    function test_MintFor_LimitFollowsMaxPerWallet() public {
        f.setMaxPerWallet(2);
        _mint(alice);
        _mint(alice);
        bytes32 ref = _ref();
        vm.prank(relayer);
        vm.expectRevert(SitowiseFactory.WalletLimit.selector);
        f.mintFor(alice, ref);

        f.setMaxPerWallet(3);
        _mint(alice);
        assertEq(f.nodeCountOf(alice), 3);
    }

    function test_MintFor_BlockedWhilePaused() public {
        f.setPaused(true);
        bytes32 ref = _ref();
        vm.prank(relayer);
        vm.expectRevert(SitowiseFactory.IsPaused.selector);
        f.mintFor(alice, ref);
        assertFalse(f.paymentRefUsed(ref), "a paused mint must not burn the ref");

        f.setPaused(false);
        assertEq(_mint(alice), 1);
    }

    function testFuzz_MintFor_AnyNonZeroRecipient(address to, bytes32 ref) public {
        vm.assume(to != address(0));
        vm.assume(ref != bytes32(0));
        vm.prank(relayer);
        uint256 id = f.mintFor(to, ref);
        (address o,,,,) = f.nodeInfo(id);
        assertEq(o, to);
        assertEq(f.nodeCountOf(to), 1);
        assertTrue(f.paymentRefUsed(ref));

        // the very same payment can never back a second node
        vm.prank(relayer);
        vm.expectRevert(SitowiseFactory.RefAlreadyUsed.selector);
        f.mintFor(to, ref);
    }

    // =========================================================== paymentRef ==

    function test_Ref_ZeroRefReverts() public {
        vm.prank(relayer);
        vm.expectRevert(SitowiseFactory.BadInput.selector);
        f.mintFor(alice, bytes32(0));
        assertEq(f.totalNodes(), 0);
        assertFalse(f.paymentRefUsed(bytes32(0)));
    }

    function test_Ref_RepeatRefReverts() public {
        bytes32 ref = _ref();

        vm.prank(relayer);
        uint256 id = f.mintFor(alice, ref);
        assertEq(id, 1);

        vm.prank(relayer);
        vm.expectRevert(SitowiseFactory.RefAlreadyUsed.selector);
        f.mintFor(alice, ref);

        assertEq(f.totalNodes(), 1, "no second node");
        assertEq(f.nodeCountOf(alice), 1);
    }

    function test_Ref_RepeatRefBlockedForADifferentBuyer() public {
        bytes32 ref = _ref();
        vm.prank(relayer);
        f.mintFor(alice, ref);

        // the registry is global: one payment, one node, whoever the buyer is
        vm.prank(relayer);
        vm.expectRevert(SitowiseFactory.RefAlreadyUsed.selector);
        f.mintFor(bob, ref);
        assertEq(f.nodeCountOf(bob), 0);
    }

    function test_Ref_RepeatRefBlockedAcrossRelayerChange() public {
        bytes32 ref = _ref();
        vm.prank(relayer);
        f.mintFor(alice, ref);

        f.setRelayer(carol);
        vm.prank(carol);
        vm.expectRevert(SitowiseFactory.RefAlreadyUsed.selector);
        f.mintFor(alice, ref);
    }

    function test_Ref_PaymentRefUsedReadsCorrectly() public {
        bytes32 used = _ref();
        bytes32 unused = _ref();

        assertFalse(f.paymentRefUsed(used));
        assertFalse(f.paymentRefUsed(unused));

        vm.prank(relayer);
        f.mintFor(alice, used);

        assertTrue(f.paymentRefUsed(used));
        assertFalse(f.paymentRefUsed(unused), "unrelated hashes stay free");
        assertFalse(f.paymentRefUsed(bytes32(0)));
    }

    function test_Ref_StaysUsedAfterTheNodeIsDrained() public {
        bytes32 ref = _ref();
        vm.prank(relayer);
        uint256 id = f.mintFor(alice, ref);
        _credit(id, 1 ether);

        vm.prank(alice);
        f.withdraw(id, alice);
        assertEq(_bal(id), 0);

        assertTrue(f.paymentRefUsed(ref), "draining a node does not free its ref");
        vm.prank(relayer);
        vm.expectRevert(SitowiseFactory.RefAlreadyUsed.selector);
        f.mintFor(alice, ref);

        // ...and not after a full sweep either
        uint256 id2 = _mint(alice);
        _credit(id2, 1 ether);
        vm.prank(alice);
        f.withdrawAll(alice);
        vm.prank(relayer);
        vm.expectRevert(SitowiseFactory.RefAlreadyUsed.selector);
        f.mintFor(alice, ref);
    }

    function test_Ref_NotConsumedByAFailedWalletLimitMint() public {
        f.setMaxPerWallet(1);
        _mint(alice);

        bytes32 ref = _ref();
        vm.prank(relayer);
        vm.expectRevert(SitowiseFactory.WalletLimit.selector);
        f.mintFor(alice, ref);
        assertFalse(f.paymentRefUsed(ref), "a rejected mint must not burn the payment");

        // the buyer's real payment can still be honoured once the cap is raised
        f.setMaxPerWallet(2);
        vm.prank(relayer);
        assertEq(f.mintFor(alice, ref), 2);
        assertTrue(f.paymentRefUsed(ref));
    }

    function test_Ref_EveryMintedNodeHasADistinctRef() public {
        bytes32 r1 = _ref();
        bytes32 r2 = _ref();
        bytes32 r3 = _ref();

        vm.startPrank(relayer);
        f.mintFor(alice, r1);
        f.mintFor(alice, r2);
        f.mintFor(bob, r3);
        vm.stopPrank();

        assertEq(f.totalNodes(), 3);
        assertTrue(f.paymentRefUsed(r1));
        assertTrue(f.paymentRefUsed(r2));
        assertTrue(f.paymentRefUsed(r3));
    }

    function testFuzz_Ref_SecondUseAlwaysReverts(bytes32 ref, address a, address b) public {
        vm.assume(ref != bytes32(0));
        vm.assume(a != address(0) && b != address(0));

        vm.prank(relayer);
        f.mintFor(a, ref);
        assertTrue(f.paymentRefUsed(ref));

        vm.prank(relayer);
        vm.expectRevert(SitowiseFactory.RefAlreadyUsed.selector);
        f.mintFor(b, ref);
    }

    // ============================================================ creditBatch ==

    function test_CreditBatch_OnlyDistributor() public {
        uint256 id = _mint(alice);
        vm.deal(alice, 1 ether);

        vm.expectRevert(SitowiseFactory.NotDistributor.selector);
        f.creditBatch{value: 1 ether}(_arr(id), _arr(1 ether));

        vm.prank(alice);
        vm.expectRevert(SitowiseFactory.NotDistributor.selector);
        f.creditBatch{value: 1 ether}(_arr(id), _arr(1 ether));

        vm.prank(relayer);
        vm.expectRevert(SitowiseFactory.NotDistributor.selector);
        f.creditBatch(_arr(id), _arr(1 ether));
    }

    function test_CreditBatch_HappyPath() public {
        uint256 a = _mint(alice);
        uint256 b = _mint(bob);

        vm.expectEmit(true, false, false, true, address(f));
        emit Credited(a, 1 ether, 1 ether);
        vm.expectEmit(true, false, false, true, address(f));
        emit Credited(b, 2 ether, 2 ether);

        vm.prank(distributor);
        f.creditBatch{value: 3 ether}(_arr(a, b), _arr(1 ether, 2 ether));

        assertEq(_bal(a), 1 ether);
        assertEq(_bal(b), 2 ether);
        assertEq(_received(a), 1 ether);
        assertEq(_received(b), 2 ether);
        assertEq(f.outstanding(), 3 ether);
        assertEq(f.totalDistributed(), 3 ether);
        assertEq(address(f).balance, 3 ether);
        assertEq(f.freeBalance(), 0);
        assertTrue(f.isSolvent());
    }

    function test_CreditBatch_AccumulatesAcrossCalls() public {
        uint256 id = _mint(alice);
        _credit(id, 1 ether);
        _credit(id, 0.5 ether);
        assertEq(_bal(id), 1.5 ether);
        assertEq(_received(id), 1.5 ether);
        assertEq(f.outstanding(), 1.5 ether);
        assertEq(f.totalDistributed(), 1.5 ether);
    }

    function test_CreditBatch_ValueTooLow() public {
        uint256 id = _mint(alice);
        vm.prank(distributor);
        vm.expectRevert(SitowiseFactory.ValueMismatch.selector);
        f.creditBatch{value: 1 ether - 1}(_arr(id), _arr(1 ether));
    }

    function test_CreditBatch_ValueTooHigh() public {
        uint256 id = _mint(alice);
        vm.prank(distributor);
        vm.expectRevert(SitowiseFactory.ValueMismatch.selector);
        f.creditBatch{value: 1 ether + 1}(_arr(id), _arr(1 ether));
    }

    function test_CreditBatch_ZeroValueWithAmounts() public {
        uint256 id = _mint(alice);
        vm.prank(distributor);
        vm.expectRevert(SitowiseFactory.ValueMismatch.selector);
        f.creditBatch{value: 0}(_arr(id), _arr(1 ether));
    }

    function test_CreditBatch_NonExistentNodeReverts() public {
        _mint(alice);
        vm.prank(distributor);
        vm.expectRevert(SitowiseFactory.BadInput.selector);
        f.creditBatch{value: 1 ether}(_arr(999), _arr(1 ether));

        // and nothing was banked
        assertEq(address(f).balance, 0);
        assertEq(f.outstanding(), 0);
    }

    function test_CreditBatch_NonExistentNodeInSecondSlotRevertsWholeBatch() public {
        uint256 id = _mint(alice);
        vm.prank(distributor);
        vm.expectRevert(SitowiseFactory.BadInput.selector);
        f.creditBatch{value: 3 ether}(_arr(id, 42), _arr(1 ether, 2 ether));

        assertEq(_bal(id), 0, "first credit must be rolled back");
        assertEq(f.outstanding(), 0);
        assertEq(address(f).balance, 0);
    }

    function test_CreditBatch_ZeroAmountReverts() public {
        uint256 id = _mint(alice);
        vm.prank(distributor);
        vm.expectRevert(SitowiseFactory.BadInput.selector);
        f.creditBatch{value: 0}(_arr(id), _arr(0));

        uint256 id2 = _mint(bob);
        vm.prank(distributor);
        vm.expectRevert(SitowiseFactory.BadInput.selector);
        f.creditBatch{value: 1 ether}(_arr(id, id2), _arr(1 ether, 0));
    }

    function test_CreditBatch_EmptyBatchReverts() public {
        uint256[] memory empty = new uint256[](0);
        vm.prank(distributor);
        vm.expectRevert(SitowiseFactory.BadInput.selector);
        f.creditBatch{value: 0}(empty, empty);

        // even with value attached
        vm.prank(distributor);
        vm.expectRevert(SitowiseFactory.BadInput.selector);
        f.creditBatch{value: 1 ether}(empty, empty);
    }

    function test_CreditBatch_LengthMismatchReverts() public {
        uint256 a = _mint(alice);
        uint256 b = _mint(bob);

        vm.prank(distributor);
        vm.expectRevert(SitowiseFactory.BadInput.selector);
        f.creditBatch{value: 1 ether}(_arr(a, b), _arr(1 ether));

        vm.prank(distributor);
        vm.expectRevert(SitowiseFactory.BadInput.selector);
        f.creditBatch{value: 3 ether}(_arr(a), _arr(1 ether, 2 ether));
    }

    /// @dev The bug fixed versus the spec draft: uint128 narrowing used to be a
    ///      silent truncation, which would have credited less than the ETH sent.
    function test_CreditBatch_AmountAboveUint128Reverts() public {
        uint256 id = _mint(alice);
        uint256 tooBig = uint256(type(uint128).max) + 1;
        vm.deal(distributor, tooBig + 1 ether);

        vm.prank(distributor);
        vm.expectRevert(SitowiseFactory.AmountTooLarge.selector);
        f.creditBatch{value: tooBig}(_arr(id), _arr(tooBig));

        assertEq(_bal(id), 0);
        assertEq(f.outstanding(), 0);
    }

    function test_CreditBatch_AmountExactlyUint128MaxAccepted() public {
        uint256 id = _mint(alice);
        uint256 max = uint256(type(uint128).max);
        vm.deal(distributor, max);

        vm.prank(distributor);
        f.creditBatch{value: max}(_arr(id), _arr(max));

        assertEq(_bal(id), max, "must not truncate");
        assertEq(_received(id), max);
        assertEq(f.outstanding(), max);
        assertEq(address(f).balance, max);
        assertTrue(f.isSolvent());
    }

    function test_CreditBatch_TruncationWouldHaveBrokenOutstanding() public {
        // Documents WHY the guard matters: 2**128 truncates to 0 in a bare cast.
        uint256 tooBig = uint256(type(uint128).max) + 1;
        assertEq(uint256(uint128(tooBig)), 0, "bare cast silently truncates");
    }

    function test_CreditBatch_AmountAboveUint128InSecondSlotReverts() public {
        uint256 a = _mint(alice);
        uint256 b = _mint(bob);
        uint256 tooBig = uint256(type(uint128).max) + 1;
        vm.deal(distributor, tooBig + 10 ether);

        vm.prank(distributor);
        vm.expectRevert(SitowiseFactory.AmountTooLarge.selector);
        f.creditBatch{value: tooBig + 1 ether}(_arr(a, b), _arr(1 ether, tooBig));
        assertEq(_bal(a), 0);
    }

    function test_CreditBatch_SameIdTwiceAccumulates() public {
        uint256 id = _mint(alice);

        vm.expectEmit(true, false, false, true, address(f));
        emit Credited(id, 1 ether, 1 ether);
        vm.expectEmit(true, false, false, true, address(f));
        emit Credited(id, 2 ether, 3 ether);

        vm.prank(distributor);
        f.creditBatch{value: 3 ether}(_arr(id, id), _arr(1 ether, 2 ether));

        assertEq(_bal(id), 3 ether);
        assertEq(_received(id), 3 ether);
        assertEq(f.outstanding(), 3 ether, "outstanding must equal ETH received");
        assertEq(address(f).balance, 3 ether);
        assertEq(f.freeBalance(), 0);
        assertEq(f.balanceOfOwner(alice), 3 ether);
    }

    function test_CreditBatch_SameIdThreeTimes() public {
        uint256 id = _mint(alice);
        vm.prank(distributor);
        f.creditBatch{value: 6 ether}(_arr(id, id, id), _arr(1 ether, 2 ether, 3 ether));
        assertEq(_bal(id), 6 ether);
        assertEq(f.outstanding(), address(f).balance);
    }

    function test_CreditBatch_WorksWhilePaused() public {
        uint256 id = _mint(alice);
        f.setPaused(true);
        _credit(id, 1 ether);
        assertEq(_bal(id), 1 ether);
    }

    function testFuzz_CreditBatch_ValueMustEqualSum(uint96 a, uint96 b, uint96 value) public {
        vm.assume(a > 0 && b > 0);
        uint256 sum = uint256(a) + uint256(b);
        vm.assume(uint256(value) != sum);

        uint256 x = _mint(alice);
        uint256 y = _mint(bob);
        vm.deal(distributor, sum + uint256(value) + 1 ether);

        vm.prank(distributor);
        vm.expectRevert(SitowiseFactory.ValueMismatch.selector);
        f.creditBatch{value: value}(_arr(x, y), _arr(a, b));
    }

    function testFuzz_CreditBatch_GrowsBalanceAndOutstanding(uint96 amount) public {
        vm.assume(amount > 0);
        uint256 id = _mint(alice);
        vm.deal(distributor, amount);
        vm.prank(distributor);
        f.creditBatch{value: amount}(_arr(id), _arr(amount));
        assertEq(_bal(id), amount);
        assertEq(f.outstanding(), amount);
        assertEq(address(f).balance, amount);
    }

    // =============================================================== withdraw ==

    function test_Withdraw_OnlyNodeOwner() public {
        uint256 id = _mint(alice);
        _credit(id, 1 ether);

        vm.prank(bob);
        vm.expectRevert(SitowiseFactory.NotNodeOwner.selector);
        f.withdraw(id, bob);

        // contract owner / relayer / distributor have no special power here
        vm.expectRevert(SitowiseFactory.NotNodeOwner.selector);
        f.withdraw(id, owner);

        vm.prank(relayer);
        vm.expectRevert(SitowiseFactory.NotNodeOwner.selector);
        f.withdraw(id, relayer);

        vm.prank(distributor);
        vm.expectRevert(SitowiseFactory.NotNodeOwner.selector);
        f.withdraw(id, distributor);
    }

    function test_Withdraw_NonExistentNodeReverts() public {
        vm.prank(alice);
        vm.expectRevert(SitowiseFactory.NotNodeOwner.selector);
        f.withdraw(777, alice);
    }

    function test_Withdraw_EmptyBalanceReverts() public {
        uint256 id = _mint(alice);
        vm.prank(alice);
        vm.expectRevert(SitowiseFactory.NothingToWithdraw.selector);
        f.withdraw(id, alice);
    }

    function test_Withdraw_ToZeroAddressReverts() public {
        uint256 id = _mint(alice);
        _credit(id, 1 ether);
        vm.prank(alice);
        vm.expectRevert(SitowiseFactory.BadInput.selector);
        f.withdraw(id, address(0));
    }

    function test_Withdraw_HappyPath() public {
        uint256 id = _mint(alice);
        _credit(id, 2 ether);

        vm.expectEmit(true, true, false, true, address(f));
        emit Withdrawn(id, alice, 2 ether);

        vm.prank(alice);
        f.withdraw(id, alice);

        assertEq(alice.balance, 2 ether);
        assertEq(_bal(id), 0, "balance zeroed");
        assertEq(_received(id), 2 ether, "totalReceived is lifetime, not reset");
        assertEq(_withdrawnBy(id), 2 ether);
        assertEq(f.outstanding(), 0, "outstanding drops");
        assertEq(f.totalWithdrawn(), 2 ether);
        assertEq(address(f).balance, 0);
    }

    function test_Withdraw_ToDifferentAddress() public {
        uint256 id = _mint(alice);
        _credit(id, 3 ether);

        vm.prank(alice);
        f.withdraw(id, carol);

        assertEq(carol.balance, 3 ether, "payout goes to the chosen address");
        assertEq(alice.balance, 0);
        assertEq(_bal(id), 0);
        assertEq(f.outstanding(), 0);
    }

    function test_Withdraw_OnlyTouchesTheOneNode() public {
        uint256 a = _mint(alice);
        uint256 b = _mint(alice);
        _credit(a, 1 ether);
        _credit(b, 2 ether);

        vm.prank(alice);
        f.withdraw(a, alice);

        assertEq(_bal(a), 0);
        assertEq(_bal(b), 2 ether);
        assertEq(f.outstanding(), 2 ether);
        assertEq(f.balanceOfOwner(alice), 2 ether);
        assertEq(address(f).balance, 2 ether);
    }

    function test_Withdraw_SecondWithdrawReverts() public {
        uint256 id = _mint(alice);
        _credit(id, 1 ether);
        vm.prank(alice);
        f.withdraw(id, alice);
        vm.prank(alice);
        vm.expectRevert(SitowiseFactory.NothingToWithdraw.selector);
        f.withdraw(id, alice);
        assertEq(alice.balance, 1 ether);
    }

    function test_Withdraw_NotBlockedWhilePaused() public {
        uint256 id = _mint(alice);
        _credit(id, 1 ether);
        f.setPaused(true);

        vm.prank(alice);
        f.withdraw(id, alice);
        assertEq(alice.balance, 1 ether, "pause must never trap holder money");
    }

    function test_Withdraw_RejectingReceiverRevertsAndKeepsBalance() public {
        RejectsETH bad = new RejectsETH();
        uint256 id = _mint(alice);
        _credit(id, 1 ether);

        vm.prank(alice);
        vm.expectRevert(SitowiseFactory.TransferFailed.selector);
        f.withdraw(id, address(bad));

        assertEq(_bal(id), 1 ether, "balance intact");
        assertEq(f.outstanding(), 1 ether, "outstanding intact");
        assertEq(f.totalWithdrawn(), 0);
        assertEq(_withdrawnBy(id), 0);
        assertEq(address(f).balance, 1 ether);

        // ...and the holder can still pull it somewhere that works
        vm.prank(alice);
        f.withdraw(id, alice);
        assertEq(alice.balance, 1 ether);
    }

    function test_Withdraw_ReceiverWithoutReceiveFunctionReverts() public {
        NoReceive bad = new NoReceive();
        uint256 id = _mint(alice);
        _credit(id, 1 ether);
        vm.prank(alice);
        vm.expectRevert(SitowiseFactory.TransferFailed.selector);
        f.withdraw(id, address(bad));
        assertEq(_bal(id), 1 ether);
    }

    function testFuzz_Withdraw_RoundTrip(uint96 amount, address to) public {
        vm.assume(amount > 0);
        vm.assume(to != address(0) && to != address(f));
        assumePayable(to);
        vm.assume(to.code.length == 0);

        uint256 id = _mint(alice);
        vm.deal(distributor, amount);
        vm.prank(distributor);
        f.creditBatch{value: amount}(_arr(id), _arr(amount));

        // captured AFTER funding: `to` may itself be the distributor
        uint256 before = to.balance;

        vm.prank(alice);
        f.withdraw(id, to);

        assertEq(to.balance, before + amount);
        assertEq(f.outstanding(), 0);
        assertEq(address(f).balance, 0);
    }

    // ============================================================ withdrawAll ==

    function test_WithdrawAll_MixedBalances() public {
        uint256 a = _mint(alice);
        uint256 b = _mint(alice); // stays at zero
        uint256 c = _mint(alice);
        uint256 d = _mint(bob); // someone else's

        _credit(a, 1 ether);
        _credit(c, 2.5 ether);
        _credit(d, 4 ether);

        assertEq(f.balanceOfOwner(alice), 3.5 ether);

        vm.prank(alice);
        uint256 got = f.withdrawAll(alice);

        assertEq(got, 3.5 ether, "total is correct");
        assertEq(alice.balance, 3.5 ether);
        assertEq(_bal(a), 0);
        assertEq(_bal(b), 0);
        assertEq(_bal(c), 0);
        assertEq(_bal(d), 4 ether, "other wallets untouched");
        assertEq(f.outstanding(), 4 ether);
        assertEq(address(f).balance, 4 ether);
        assertEq(f.totalWithdrawn(), 3.5 ether);
        assertEq(_withdrawnBy(a), 1 ether);
        assertEq(_withdrawnBy(b), 0);
        assertEq(_withdrawnBy(c), 2.5 ether);
        assertEq(f.balanceOfOwner(alice), 0);
    }

    function test_WithdrawAll_EmitsPerNode() public {
        uint256 a = _mint(alice);
        _mint(alice); // zero balance, must not emit
        uint256 c = _mint(alice);
        _credit(a, 1 ether);
        _credit(c, 2 ether);

        vm.expectEmit(true, true, false, true, address(f));
        emit Withdrawn(a, carol, 1 ether);
        vm.expectEmit(true, true, false, true, address(f));
        emit Withdrawn(c, carol, 2 ether);

        vm.prank(alice);
        f.withdrawAll(carol);
        assertEq(carol.balance, 3 ether);
    }

    function test_WithdrawAll_AllZeroReverts() public {
        _mint(alice);
        _mint(alice);
        vm.prank(alice);
        vm.expectRevert(SitowiseFactory.NothingToWithdraw.selector);
        f.withdrawAll(alice);
    }

    function test_WithdrawAll_NoNodesReverts() public {
        vm.prank(carol);
        vm.expectRevert(SitowiseFactory.NothingToWithdraw.selector);
        f.withdrawAll(carol);
    }

    function test_WithdrawAll_ToZeroReverts() public {
        uint256 id = _mint(alice);
        _credit(id, 1 ether);
        vm.prank(alice);
        vm.expectRevert(SitowiseFactory.BadInput.selector);
        f.withdrawAll(address(0));
    }

    function test_WithdrawAll_RejectingReceiverRevertsAndKeepsBalances() public {
        RejectsETH bad = new RejectsETH();
        uint256 a = _mint(alice);
        uint256 b = _mint(alice);
        _credit(a, 1 ether);
        _credit(b, 2 ether);

        vm.prank(alice);
        vm.expectRevert(SitowiseFactory.TransferFailed.selector);
        f.withdrawAll(address(bad));

        assertEq(_bal(a), 1 ether);
        assertEq(_bal(b), 2 ether);
        assertEq(f.outstanding(), 3 ether);
        assertEq(address(f).balance, 3 ether);
    }

    function test_WithdrawAll_AtMaxWalletSize() public {
        uint256 total;
        for (uint256 i; i < 25; ++i) {
            uint256 id = _mint(alice);
            uint256 amt = (i + 1) * 0.1 ether;
            _credit(id, amt);
            total += amt;
        }
        vm.prank(alice);
        uint256 got = f.withdrawAll(alice);
        assertEq(got, total);
        assertEq(f.outstanding(), 0);
        assertEq(f.balanceOfOwner(alice), 0);
    }

    function test_WithdrawAll_NotBlockedWhilePaused() public {
        uint256 id = _mint(alice);
        _credit(id, 1 ether);
        f.setPaused(true);
        vm.prank(alice);
        assertEq(f.withdrawAll(alice), 1 ether);
    }

    // ============================================================ reentrancy ==

    function test_Reentrancy_WithdrawPaysOnce() public {
        ReentrantWithdrawer att = new ReentrantWithdrawer(f);
        uint256 id = _mint(address(att));
        att.setId(id);
        _credit(id, 5 ether);
        _credit(_mint(bob), 3 ether); // bystander money in the contract

        att.go();

        assertGt(att.reenterCount(), 0, "re-entry was actually attempted");
        assertEq(att.reenterSucceeded(), 0, "re-entry must never succeed");
        assertEq(address(att).balance, 5 ether, "paid exactly once");
        assertEq(_bal(id), 0);
        assertEq(f.outstanding(), 3 ether, "outstanding still correct");
        assertEq(address(f).balance, 3 ether);
        assertTrue(f.isSolvent());
    }

    function test_Reentrancy_WithdrawUncaughtBubblesUpAndPaysNothing() public {
        ReentrantWithdrawer att = new ReentrantWithdrawer(f);
        uint256 id = _mint(address(att));
        att.setId(id);
        att.setSwallow(false);
        _credit(id, 5 ether);

        vm.expectRevert(SitowiseFactory.TransferFailed.selector);
        att.go();

        assertEq(address(att).balance, 0);
        assertEq(_bal(id), 5 ether, "balance intact after failed withdraw");
        assertEq(f.outstanding(), 5 ether);
    }

    function test_Reentrancy_WithdrawAllPaysOnce() public {
        ReentrantWithdrawAll att = new ReentrantWithdrawAll(f);
        uint256 a = _mint(address(att));
        uint256 b = _mint(address(att));
        _credit(a, 1 ether);
        _credit(b, 2 ether);
        _credit(_mint(bob), 7 ether);

        uint256 got = att.go();

        assertGt(att.reenterCount(), 0, "re-entry was actually attempted");
        assertEq(att.reenterSucceeded(), 0, "re-entry must never succeed");
        assertEq(got, 3 ether);
        assertEq(address(att).balance, 3 ether, "paid exactly once");
        assertEq(_bal(a), 0);
        assertEq(_bal(b), 0);
        assertEq(f.outstanding(), 7 ether, "outstanding still correct");
        assertEq(address(f).balance, 7 ether);
        assertTrue(f.isSolvent());
    }

    function test_Reentrancy_CrossFunctionWithdrawThenWithdrawAll() public {
        CrossReenter att = new CrossReenter(f);
        uint256 a = _mint(address(att));
        uint256 b = _mint(address(att));
        att.setId(a);
        _credit(a, 1 ether);
        _credit(b, 2 ether);

        att.go();

        assertGt(att.reenterCount(), 0);
        assertEq(att.reenterSucceeded(), 0, "cross-function re-entry blocked");
        assertEq(address(att).balance, 1 ether);
        assertEq(_bal(b), 2 ether, "node b untouched by the re-entry");
        assertEq(f.outstanding(), 2 ether);
        assertEq(address(f).balance, 2 ether);
    }

    function test_Reentrancy_RescueBlocked() public {
        ReentrantRescuer att = new ReentrantRescuer(f);
        f.transferOwnership(address(att));
        att.claimOwnership(); // ownership is two-step now
        assertEq(f.owner(), address(att));
        vm.deal(address(this), 5 ether);
        f.fund{value: 5 ether}();

        att.go(2 ether);

        assertGt(att.reenterCount(), 0);
        assertEq(att.reenterSucceeded(), 0, "rescue re-entry blocked");
        assertEq(address(att).balance, 2 ether);
        assertEq(address(f).balance, 3 ether);
    }

    // ================================================================= rescue ==

    function test_Rescue_OnlyOwner() public {
        vm.deal(address(this), 1 ether);
        f.fund{value: 1 ether}();
        vm.prank(alice);
        vm.expectRevert(SitowiseFactory.NotOwner.selector);
        f.rescue(alice, 1 ether);
    }

    function test_Rescue_ToZeroReverts() public {
        vm.deal(address(this), 1 ether);
        f.fund{value: 1 ether}();
        vm.expectRevert(SitowiseFactory.BadInput.selector);
        f.rescue(address(0), 1 ether);
    }

    function test_Rescue_CannotExceedFreeBalance() public {
        uint256 id = _mint(alice);
        _credit(id, 5 ether);
        vm.deal(address(this), 2 ether);
        f.fund{value: 2 ether}();

        assertEq(address(f).balance, 7 ether);
        assertEq(f.freeBalance(), 2 ether);

        vm.expectRevert(SitowiseFactory.ExceedsFree.selector);
        f.rescue(carol, 2 ether + 1);

        vm.expectRevert(SitowiseFactory.ExceedsFree.selector);
        f.rescue(carol, 7 ether);

        // exactly free is fine
        vm.expectEmit(true, false, false, true, address(f));
        emit Rescued(carol, 2 ether);
        f.rescue(carol, 2 ether);

        assertEq(carol.balance, 2 ether);
        assertEq(address(f).balance, 5 ether);
        assertEq(f.freeBalance(), 0);
        assertEq(f.outstanding(), 5 ether);
        assertTrue(f.isSolvent());
    }

    function test_Rescue_AfterCreditsFreeBalanceIsZero() public {
        uint256 id = _mint(alice);
        _credit(id, 3 ether);
        assertEq(f.freeBalance(), 0, "credited ETH is never free");

        vm.expectRevert(SitowiseFactory.ExceedsFree.selector);
        f.rescue(carol, 1);

        // and after the holder withdraws, still nothing free
        vm.prank(alice);
        f.withdraw(id, alice);
        assertEq(f.freeBalance(), 0);
        assertEq(address(f).balance, 0);
    }

    function test_Rescue_ZeroAmountIsANoop() public {
        f.rescue(carol, 0);
        assertEq(carol.balance, 0);
    }

    function test_Rescue_RejectingReceiverReverts() public {
        RejectsETH bad = new RejectsETH();
        vm.deal(address(this), 1 ether);
        f.fund{value: 1 ether}();
        vm.expectRevert(SitowiseFactory.TransferFailed.selector);
        f.rescue(address(bad), 1 ether);
        assertEq(address(f).balance, 1 ether);
    }

    function testFuzz_Rescue_NeverTouchesOutstanding(uint96 credit, uint96 free, uint256 amount) public {
        vm.assume(credit > 0);
        uint256 id = _mint(alice);
        vm.deal(distributor, credit);
        vm.prank(distributor);
        f.creditBatch{value: credit}(_arr(id), _arr(credit));

        vm.deal(address(this), free);
        f.fund{value: free}();

        amount = bound(amount, 0, address(f).balance);
        if (amount > f.freeBalance()) {
            vm.expectRevert(SitowiseFactory.ExceedsFree.selector);
            f.rescue(carol, amount);
        } else {
            f.rescue(carol, amount);
        }
        assertGe(address(f).balance, f.outstanding());
        assertEq(_bal(id), credit, "node balance untouched");
    }

    // ============================================================ fund/receive ==

    function test_Fund_RaisesFreeBalanceAndEmits() public {
        vm.deal(address(this), 3 ether);
        vm.expectEmit(true, false, false, true, address(f));
        emit Funded(address(this), 3 ether);
        f.fund{value: 3 ether}();

        assertEq(address(f).balance, 3 ether);
        assertEq(f.freeBalance(), 3 ether);
        assertEq(f.outstanding(), 0);
    }

    function test_PlainTransfer_RaisesFreeBalanceAndEmits() public {
        vm.deal(alice, 4 ether);
        vm.expectEmit(true, false, false, true, address(f));
        emit Funded(alice, 4 ether);
        vm.prank(alice);
        (bool ok,) = address(f).call{value: 4 ether}("");
        assertTrue(ok);

        assertEq(address(f).balance, 4 ether);
        assertEq(f.freeBalance(), 4 ether);
    }

    function test_Fund_AnyoneMayFund() public {
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        f.fund{value: 1 ether}();
        assertEq(f.freeBalance(), 1 ether);
    }

    function test_Fund_DoesNotBackNodeBalances() public {
        uint256 id = _mint(alice);
        vm.deal(address(this), 5 ether);
        f.fund{value: 5 ether}();
        vm.prank(alice);
        vm.expectRevert(SitowiseFactory.NothingToWithdraw.selector);
        f.withdraw(id, alice);
    }

    function test_UnknownCalldataReverts() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(f).call{value: 1 ether}(hex"12345678");
        assertFalse(ok, "no fallback: unknown selector must revert");
    }

    // ================================================================== admin ==

    function test_Admin_OnlyOwnerForEverySetter() public {
        vm.startPrank(alice);
        vm.expectRevert(SitowiseFactory.NotOwner.selector);
        f.setRelayer(alice);
        vm.expectRevert(SitowiseFactory.NotOwner.selector);
        f.setDistributor(alice);
        vm.expectRevert(SitowiseFactory.NotOwner.selector);
        f.setMaxPerWallet(5);
        vm.expectRevert(SitowiseFactory.NotOwner.selector);
        f.setPaused(true);
        vm.expectRevert(SitowiseFactory.NotOwner.selector);
        f.transferOwnership(alice);
        vm.expectRevert(SitowiseFactory.NotOwner.selector);
        f.rescue(alice, 0);
        // acceptOwnership is not owner-gated, it is pendingOwner-gated
        vm.expectRevert(SitowiseFactory.NotPendingOwner.selector);
        f.acceptOwnership();
        vm.stopPrank();

        // relayer and distributor are not admins either
        vm.prank(relayer);
        vm.expectRevert(SitowiseFactory.NotOwner.selector);
        f.setPaused(true);
        vm.prank(distributor);
        vm.expectRevert(SitowiseFactory.NotOwner.selector);
        f.setRelayer(distributor);
    }

    function test_Admin_SetRelayerChangesWhoMayMint() public {
        vm.expectEmit(false, false, false, true, address(f));
        emit RelayerChanged(carol);
        f.setRelayer(carol);
        assertEq(f.relayer(), carol);

        bytes32 oldRef = _ref();
        vm.prank(relayer);
        vm.expectRevert(SitowiseFactory.NotRelayer.selector);
        f.mintFor(alice, oldRef);

        bytes32 newRef = _ref();
        vm.prank(carol);
        assertEq(f.mintFor(alice, newRef), 1);
    }

    function test_Admin_SetDistributorChangesWhoMayCredit() public {
        uint256 id = _mint(alice);
        vm.expectEmit(false, false, false, true, address(f));
        emit DistributorChanged(carol);
        f.setDistributor(carol);
        assertEq(f.distributor(), carol);

        vm.prank(distributor);
        vm.expectRevert(SitowiseFactory.NotDistributor.selector);
        f.creditBatch{value: 0}(_arr(id), _arr(1 ether));

        vm.deal(carol, 1 ether);
        vm.prank(carol);
        f.creditBatch{value: 1 ether}(_arr(id), _arr(1 ether));
        assertEq(_bal(id), 1 ether);
    }

    function test_Admin_SetRelayerZeroReverts() public {
        vm.expectRevert(SitowiseFactory.BadInput.selector);
        f.setRelayer(address(0));
    }

    function test_Admin_SetDistributorZeroReverts() public {
        vm.expectRevert(SitowiseFactory.BadInput.selector);
        f.setDistributor(address(0));
    }

    function test_Admin_SetMaxPerWalletZeroReverts() public {
        vm.expectRevert(SitowiseFactory.BadInput.selector);
        f.setMaxPerWallet(0);
        assertEq(f.maxPerWallet(), 25, "unchanged");
    }

    function test_Admin_SetMaxPerWalletEmits() public {
        vm.expectEmit(false, false, false, true, address(f));
        emit MaxPerWalletChanged(100);
        f.setMaxPerWallet(100);
        assertEq(f.maxPerWallet(), 100);
    }

    function test_Admin_SetMaxPerWalletCeiling() public {
        assertEq(f.MAX_PER_WALLET_CEILING(), 100);

        f.setMaxPerWallet(100); // exactly the ceiling is fine
        assertEq(f.maxPerWallet(), 100);

        vm.expectRevert(SitowiseFactory.BadInput.selector);
        f.setMaxPerWallet(101);
        assertEq(f.maxPerWallet(), 100, "unchanged");

        vm.expectRevert(SitowiseFactory.BadInput.selector);
        f.setMaxPerWallet(type(uint256).max);
        assertEq(f.maxPerWallet(), 100);
    }

    function testFuzz_Admin_SetMaxPerWalletBounds(uint256 v) public {
        if (v == 0 || v > f.MAX_PER_WALLET_CEILING()) {
            vm.expectRevert(SitowiseFactory.BadInput.selector);
            f.setMaxPerWallet(v);
            assertEq(f.maxPerWallet(), 25);
        } else {
            f.setMaxPerWallet(v);
            assertEq(f.maxPerWallet(), v);
        }
    }

    /// @dev The reason the ceiling exists: a full sweep at the largest legal
    ///      wallet must still fit comfortably inside a block.
    function test_Admin_WithdrawAllAtCeilingFitsInABlock() public {
        f.setMaxPerWallet(f.MAX_PER_WALLET_CEILING());
        uint256 total;
        for (uint256 i; i < 100; ++i) {
            uint256 id = _mint(alice);
            _credit(id, 0.01 ether);
            total += 0.01 ether;
        }
        assertEq(f.nodeCountOf(alice), 100);

        vm.prank(alice);
        uint256 gasBefore = gasleft();
        uint256 got = f.withdrawAll(alice);
        uint256 gasUsed = gasBefore - gasleft();

        assertEq(got, total);
        assertLt(gasUsed, 15_000_000, "sweep must fit in a block");
        assertEq(f.outstanding(), 0);
    }

    function test_Admin_SetPausedEmitsBothWays() public {
        vm.expectEmit(false, false, false, true, address(f));
        emit PausedChanged(true);
        f.setPaused(true);
        assertTrue(f.paused());

        vm.expectEmit(false, false, false, true, address(f));
        emit PausedChanged(false);
        f.setPaused(false);
        assertFalse(f.paused());
    }

    function test_Admin_TransferOwnershipIsTwoStep() public {
        vm.expectEmit(true, false, false, true, address(f));
        emit OwnershipOfferStarted(carol);
        f.transferOwnership(carol);

        assertEq(f.owner(), owner, "ownership must NOT move on the offer");
        assertEq(f.pendingOwner(), carol);

        vm.expectEmit(false, false, false, true, address(f));
        emit OwnerChanged(carol);
        vm.prank(carol);
        f.acceptOwnership();

        assertEq(f.owner(), carol);
        assertEq(f.pendingOwner(), address(0), "pending cleared on accept");

        vm.expectRevert(SitowiseFactory.NotOwner.selector);
        f.setPaused(true);

        vm.prank(carol);
        f.setPaused(true);
        assertTrue(f.paused());
    }

    function test_Admin_OldOwnerKeepsEveryRightUntilAccepted() public {
        vm.deal(address(this), 1 ether);
        f.fund{value: 1 ether}();
        f.transferOwnership(carol);

        // the offer changes nothing about who may administer the contract
        f.setPaused(true);
        f.setPaused(false);
        f.setRelayer(bob);
        f.setDistributor(bob);
        f.setMaxPerWallet(7);
        f.rescue(owner, 1 ether);
        assertEq(f.owner(), owner);

        // ...and the owner-elect may do none of it yet
        vm.startPrank(carol);
        vm.expectRevert(SitowiseFactory.NotOwner.selector);
        f.setPaused(true);
        vm.expectRevert(SitowiseFactory.NotOwner.selector);
        f.setRelayer(carol);
        vm.expectRevert(SitowiseFactory.NotOwner.selector);
        f.setMaxPerWallet(9);
        vm.expectRevert(SitowiseFactory.NotOwner.selector);
        f.rescue(carol, 0);
        vm.expectRevert(SitowiseFactory.NotOwner.selector);
        f.transferOwnership(carol);
        vm.stopPrank();
    }

    function test_Admin_OnlyPendingOwnerMayAccept() public {
        f.transferOwnership(carol);

        vm.prank(bob);
        vm.expectRevert(SitowiseFactory.NotPendingOwner.selector);
        f.acceptOwnership();

        // not even the sitting owner can accept on the elect's behalf
        vm.expectRevert(SitowiseFactory.NotPendingOwner.selector);
        f.acceptOwnership();

        vm.prank(relayer);
        vm.expectRevert(SitowiseFactory.NotPendingOwner.selector);
        f.acceptOwnership();

        assertEq(f.owner(), owner);
        assertEq(f.pendingOwner(), carol);
    }

    function test_Admin_AcceptWithNoOfferReverts() public {
        vm.prank(carol);
        vm.expectRevert(SitowiseFactory.NotPendingOwner.selector);
        f.acceptOwnership();
        assertEq(f.owner(), owner);
    }

    function test_Admin_AcceptTwiceReverts() public {
        f.transferOwnership(carol);
        vm.prank(carol);
        f.acceptOwnership();

        vm.prank(carol);
        vm.expectRevert(SitowiseFactory.NotPendingOwner.selector);
        f.acceptOwnership();
        assertEq(f.owner(), carol);
    }

    function test_Admin_OfferCanBeRedirectedBeforeAccept() public {
        f.transferOwnership(carol);
        f.transferOwnership(bob);
        assertEq(f.pendingOwner(), bob);

        vm.prank(carol);
        vm.expectRevert(SitowiseFactory.NotPendingOwner.selector);
        f.acceptOwnership();

        vm.prank(bob);
        f.acceptOwnership();
        assertEq(f.owner(), bob);
    }

    /// @dev The whole point of the two-step: a typo cannot brick the admin surface.
    function test_Admin_TypoOfferIsRecoverable() public {
        address typo = address(uint160(0xdeadbeef));
        f.transferOwnership(typo);
        assertEq(f.owner(), owner, "still in control");

        f.transferOwnership(carol);
        vm.prank(carol);
        f.acceptOwnership();
        assertEq(f.owner(), carol);
    }

    function test_Admin_TransferOwnershipZeroReverts() public {
        f.transferOwnership(carol);
        vm.expectRevert(SitowiseFactory.BadInput.selector);
        f.transferOwnership(address(0));
        assertEq(f.owner(), owner);
        assertEq(f.pendingOwner(), carol, "existing offer untouched");
    }

    function test_Admin_PauseBlocksMintButNeverWithdraw() public {
        uint256 a = _mint(alice);
        uint256 b = _mint(alice);
        _credit(a, 1 ether);
        _credit(b, 2 ether);

        f.setPaused(true);

        bytes32 ref = _ref();
        vm.prank(relayer);
        vm.expectRevert(SitowiseFactory.IsPaused.selector);
        f.mintFor(bob, ref);

        vm.prank(alice);
        f.withdraw(a, alice);
        vm.prank(alice);
        f.withdrawAll(alice);
        assertEq(alice.balance, 3 ether);
        assertEq(f.outstanding(), 0);
    }

    // ================================================================== views ==

    function test_Views_EmptyState() public view {
        assertEq(f.nodesOf(alice).length, 0);
        assertEq(f.nodeCountOf(alice), 0);
        assertEq(f.balanceOfOwner(alice), 0);
        assertEq(f.freeBalance(), 0);
        assertTrue(f.isSolvent());
        (address o, uint64 t, uint256 b, uint256 r, uint256 w) = f.nodeInfo(1);
        assertEq(o, address(0));
        assertEq(t, 0);
        assertEq(b, 0);
        assertEq(r, 0);
        assertEq(w, 0);
    }

    function test_Views_FullPicture() public {
        uint256 a = _mint(alice);
        uint256 b = _mint(alice);
        uint256 c = _mint(bob);
        _credit(a, 1 ether);
        _credit(b, 2 ether);
        _credit(c, 4 ether);
        vm.deal(address(this), 1 ether);
        f.fund{value: 1 ether}();

        vm.prank(alice);
        f.withdraw(a, alice);

        (address o, uint64 t, uint256 bal, uint256 rec, uint256 wd) = f.nodeInfo(a);
        assertEq(o, alice);
        assertEq(t, uint64(block.timestamp));
        assertEq(bal, 0);
        assertEq(rec, 1 ether);
        assertEq(wd, 1 ether);

        assertEq(f.nodeCountOf(alice), 2);
        assertEq(f.nodeCountOf(bob), 1);
        uint256[] memory ids = f.nodesOf(alice);
        assertEq(ids[0], a);
        assertEq(ids[1], b);

        assertEq(f.balanceOfOwner(alice), 2 ether);
        assertEq(f.balanceOfOwner(bob), 4 ether);
        assertEq(f.balanceOfOwner(carol), 0);

        assertEq(f.outstanding(), 6 ether);
        assertEq(address(f).balance, 7 ether);
        assertEq(f.freeBalance(), 1 ether);
        assertTrue(f.isSolvent());
        assertEq(f.totalNodes(), 3);
        assertEq(f.totalDistributed(), 7 ether);
        assertEq(f.totalWithdrawn(), 1 ether);
    }

    function test_Views_FreeBalanceClampsAtZero() public {
        // Force an under-funded state via a raw storage write to prove the
        // read helpers do not underflow if the contract ever loses ETH.
        uint256 id = _mint(alice);
        _credit(id, 1 ether);
        vm.deal(address(f), 0.5 ether);
        assertEq(f.freeBalance(), 0);
        assertFalse(f.isSolvent());
    }

    function test_Views_BalanceOfOwnerMatchesOutstandingForSingleHolder() public {
        uint256 a = _mint(alice);
        uint256 b = _mint(alice);
        _credit(a, 1 ether);
        _credit(b, 2 ether);
        assertEq(f.balanceOfOwner(alice), f.outstanding());
    }

    // ================================================== end-to-end lifecycle ==

    function test_Lifecycle() public {
        uint256 a1 = _mint(alice);
        uint256 a2 = _mint(alice);
        uint256 b1 = _mint(bob);

        vm.prank(distributor);
        f.creditBatch{value: 6 ether}(_arr(a1, a2, b1), _arr(1 ether, 2 ether, 3 ether));

        vm.deal(address(this), 1 ether);
        f.fund{value: 1 ether}();

        vm.prank(alice);
        f.withdrawAll(carol);
        assertEq(carol.balance, 3 ether);

        // second distribution round
        vm.prank(distributor);
        f.creditBatch{value: 2 ether}(_arr(a1, b1), _arr(0.5 ether, 1.5 ether));

        vm.prank(bob);
        f.withdraw(b1, bob);
        assertEq(bob.balance, 4.5 ether);

        assertEq(f.outstanding(), 0.5 ether);
        assertEq(address(f).balance, 1.5 ether);
        assertEq(f.freeBalance(), 1 ether);

        f.rescue(owner, 1 ether);
        assertEq(address(f).balance, 0.5 ether);
        assertTrue(f.isSolvent());

        vm.prank(alice);
        f.withdraw(a1, alice);
        assertEq(alice.balance, 0.5 ether);
        assertEq(f.outstanding(), 0);
        assertEq(address(f).balance, 0);
    }
}
