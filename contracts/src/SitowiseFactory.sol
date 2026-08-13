// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SitowiseFactory
/// @notice Node factory with on-chain balances.
///
///         Payment for a node is taken OUTSIDE this contract: the buyer sends a
///         plain transfer to the payments wallet, a watcher sees it, and the
///         relayer calls `mintFor`. `paymentRef` carries the payment tx hash so
///         anyone can check the sale in the explorer.
///
///         Credits put real ETH on a node's balance. The owner withdraws it
///         himself. There are no signatures, no vouchers and no server in the
///         withdrawal path.
///
///         The guarantee that makes this checkable: `outstanding` is the sum of
///         every node balance, and `rescue` can only ever move
///         `address(this).balance - outstanding`. Holder money is unreachable to
///         the contract owner under all conditions.
contract SitowiseFactory {
    error NotOwner();
    error NotRelayer();
    error NotDistributor();
    error NotNodeOwner();
    error WalletLimit();
    error IsPaused();
    error BadInput();
    error NothingToWithdraw();
    error ValueMismatch();
    error TransferFailed();
    error ExceedsFree();
    error AmountTooLarge();
    error Reentrancy();
    error RefAlreadyUsed();
    error NotPendingOwner();

    struct Node {
        address owner;
        uint64 createdAt;
        uint128 balance; // withdrawable right now
        uint128 totalReceived; // credited over the node's whole life
        uint128 totalWithdrawn;
    }

    address public owner;
    /// @notice Owner-elect. Ownership moves only when this address accepts, so a
    ///         typo cannot brick the admin surface.
    address public pendingOwner;
    address public relayer; // may create nodes
    address public distributor; // may credit nodes
    uint256 public maxPerWallet = 25;
    uint256 public constant MAX_PER_WALLET_CEILING = 100;
    bool public paused;

    uint256 public totalNodes;
    uint256 public totalDistributed;
    uint256 public totalWithdrawn;

    /// @notice Sum of every node balance. The contract must always hold at least this.
    uint256 public outstanding;

    /// @dev Non-reentrancy flag. Every ETH-sending path is already
    ///      checks-effects-interactions, so this is belt and braces rather than
    ///      the primary defence.
    uint256 private _entered;

    /// @notice Payment tx hashes already used to mint. Without this the
    ///         `paymentRef` in `NodeMinted` proves nothing: one payment could
    ///         back unlimited nodes, and the explorer trail would be theatre.
    mapping(bytes32 => bool) public paymentRefUsed;

    mapping(uint256 => Node) private _node;
    mapping(address => uint256[]) private _owned;

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

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    modifier onlyDistributor() {
        if (msg.sender != distributor) revert NotDistributor();
        _;
    }

    modifier nonReentrant() {
        if (_entered == 1) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(address relayer_, address distributor_) {
        if (relayer_ == address(0) || distributor_ == address(0)) revert BadInput();
        owner = msg.sender;
        relayer = relayer_;
        distributor = distributor_;
        emit OwnerChanged(msg.sender);
        emit RelayerChanged(relayer_);
        emit DistributorChanged(distributor_);
    }

    // ----------------------------------------------------------------- mint --

    /// @notice Create a node for `to`. Payment was taken off-chain; `paymentRef`
    ///         is that transaction's hash so the sale can be verified.
    function mintFor(address to, bytes32 paymentRef) external onlyRelayer returns (uint256 id) {
        if (paused) revert IsPaused();
        if (to == address(0)) revert BadInput();
        if (paymentRef == bytes32(0)) revert BadInput();
        if (paymentRefUsed[paymentRef]) revert RefAlreadyUsed();
        if (_owned[to].length >= maxPerWallet) revert WalletLimit();

        paymentRefUsed[paymentRef] = true;

        id = ++totalNodes;
        _node[id] =
            Node({owner: to, createdAt: uint64(block.timestamp), balance: 0, totalReceived: 0, totalWithdrawn: 0});
        _owned[to].push(id);
        emit NodeMinted(id, to, paymentRef, uint64(block.timestamp));
    }

    // --------------------------------------------------------------- credit --

    /// @notice Put ETH on node balances. `msg.value` must equal the sum of
    ///         `amounts`, otherwise the balances would not be backed.
    function creditBatch(uint256[] calldata ids, uint256[] calldata amounts) external payable onlyDistributor {
        uint256 n = ids.length;
        if (n == 0 || n != amounts.length) revert BadInput();

        // Sum and validate against msg.value BEFORE touching storage: a bad
        // batch then costs the caller memory-only gas instead of n SSTOREs.
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            uint256 amt = amounts[i];
            if (amt == 0) revert BadInput();
            // Balances are uint128. An explicit narrowing cast does NOT revert in
            // Solidity, it silently truncates, which would credit a node less
            // than the ETH backing it and permanently break `outstanding`.
            if (amt > type(uint128).max) revert AmountTooLarge();
            sum += amt;
        }
        if (sum != msg.value) revert ValueMismatch();

        for (uint256 i; i < n; ++i) {
            uint256 id = ids[i];
            Node storage node = _node[id];
            if (node.owner == address(0)) revert BadInput();

            uint128 amt = uint128(amounts[i]);
            uint128 newBalance = node.balance + amt;
            node.balance = newBalance;
            node.totalReceived += amt;
            emit Credited(id, amt, newBalance);
        }

        outstanding += sum;
        totalDistributed += sum;
    }

    // ------------------------------------------------------------- withdraw --

    function withdraw(uint256 id, address to) external nonReentrant {
        Node storage node = _node[id];
        if (node.owner != msg.sender) revert NotNodeOwner();
        if (to == address(0)) revert BadInput();

        uint256 amount = node.balance;
        if (amount == 0) revert NothingToWithdraw();

        node.balance = 0;
        node.totalWithdrawn += uint128(amount);
        outstanding -= amount;
        totalWithdrawn += amount;

        emit Withdrawn(id, to, amount);
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Sweep every node the caller owns in one transaction.
    function withdrawAll(address to) external nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert BadInput();
        uint256[] storage ids = _owned[msg.sender];

        for (uint256 i; i < ids.length; ++i) {
            uint256 id = ids[i];
            Node storage node = _node[id];
            uint256 bal = node.balance;
            if (bal == 0) continue;
            node.balance = 0;
            node.totalWithdrawn += uint128(bal);
            amount += bal;
            emit Withdrawn(id, to, bal);
        }
        if (amount == 0) revert NothingToWithdraw();

        outstanding -= amount;
        totalWithdrawn += amount;

        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ----------------------------------------------------------------- read --

    /// @notice Everything about one node in a single call, for the explorer's
    ///         Read Contract tab.
    function nodeInfo(uint256 id)
        external
        view
        returns (
            address nodeOwner,
            uint64 createdAt,
            uint256 balance,
            uint256 totalReceived,
            uint256 totalWithdrawnByNode
        )
    {
        Node storage node = _node[id];
        return (node.owner, node.createdAt, node.balance, node.totalReceived, node.totalWithdrawn);
    }

    function nodesOf(address who) external view returns (uint256[] memory) {
        return _owned[who];
    }

    function nodeCountOf(address who) external view returns (uint256) {
        return _owned[who].length;
    }

    /// @notice Combined withdrawable balance across every node of a wallet.
    function balanceOfOwner(address who) external view returns (uint256 total) {
        uint256[] storage ids = _owned[who];
        for (uint256 i; i < ids.length; ++i) {
            total += _node[ids[i]].balance;
        }
    }

    /// @notice Contract funds that belong to no node.
    function freeBalance() public view returns (uint256) {
        uint256 bal = address(this).balance;
        return bal > outstanding ? bal - outstanding : 0;
    }

    /// @notice True while every node balance is fully backed.
    function isSolvent() external view returns (bool) {
        return address(this).balance >= outstanding;
    }

    // ---------------------------------------------------------------- admin --

    function setRelayer(address v) external onlyOwner {
        if (v == address(0)) revert BadInput();
        relayer = v;
        emit RelayerChanged(v);
    }

    function setDistributor(address v) external onlyOwner {
        if (v == address(0)) revert BadInput();
        distributor = v;
        emit DistributorChanged(v);
    }

    /// @dev Bounded because `withdrawAll` loops over every node a wallet owns.
    ///      An unbounded cap could make that sweep exceed the block gas limit.
    ///      Per-node `withdraw` always remains available regardless.
    function setMaxPerWallet(uint256 v) external onlyOwner {
        if (v == 0 || v > MAX_PER_WALLET_CEILING) revert BadInput();
        maxPerWallet = v;
        emit MaxPerWalletChanged(v);
    }

    function setPaused(bool v) external onlyOwner {
        paused = v;
        emit PausedChanged(v);
    }

    function transferOwnership(address v) external onlyOwner {
        if (v == address(0)) revert BadInput();
        pendingOwner = v;
        emit OwnershipOfferStarted(v);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnerChanged(msg.sender);
    }

    /// @notice Top the contract up without attaching the money to any node.
    function fund() external payable {
        emit Funded(msg.sender, msg.value);
    }

    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    /// @notice Withdraw ONLY unattached funds. Node balances are unreachable to
    ///         the owner under all conditions: this is the holders' guarantee.
    function rescue(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert BadInput();
        if (amount > freeBalance()) revert ExceedsFree();
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Rescued(to, amount);
    }
}
