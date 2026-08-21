import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocPage, DocFigure, DocTable} from "@/components/docs/DocPage";
import {FlowSchematic} from "@/components/docs/charts/FlowSchematic";
import {Callout} from "@/components/ui/Callout";
import {FUNDING_NOTE, NODE_PRICE_ETH} from "@/lib/site";

export const metadata: Metadata = {
  title: "Settlement",
  description:
    "How a payment becomes a node and how a node balance becomes ETH in your wallet, and the one invariant that keeps holder money out of the operator's reach.",
};

export default function SettlementPage() {
  return (
    <DocPage
      href="/docs/settlement"
      lede={
        <>
          Money moves twice in Sitowise: once in, when a transfer buys a node, and once out, when
          a node&rsquo;s owner takes their balance. This page is the mechanism for both, at the
          level of the calls the contract actually makes.
        </>
      }
    >
      <DocFigure caption="Payment lands in a wallet, the relayer mints against that transaction, the distributor sends ETH onto balances, and the owner withdraws. Nothing in the chain of custody is a signature.">
        <FlowSchematic />
      </DocFigure>

      <h2 id="design">Why it looks like this</h2>
      <p>
        An earlier design kept balances off chain and settled them with EIP-712 vouchers: the
        server signed a cumulative allowance and you spent it against the contract. That saves gas
        when gas is expensive. Gas on this chain is around 0.03 gwei, so it saved nothing worth
        having and cost something that mattered, because it put a server key in the path between a
        holder and their own money. The vouchers are gone. Balances are held on chain and the
        owner moves them directly.
      </p>
      <Callout tone="info" title="Nothing in the withdrawal path belongs to Sitowise">
        No signature, no session, no server, no expiry, no approval step, and no amount to
        request. If every Sitowise machine were switched off, every node owner could still take
        the whole balance they hold, from a block explorer, with the ABI alone.
      </Callout>

      <h2 id="payment">A payment becomes a node</h2>
      <p>
        Payment happens entirely outside the contract. You send a plain {NODE_PRICE_ETH} ETH
        transfer to the payments wallet. A watcher sees it and the relayer calls{" "}
        <code>mintFor(to, paymentRef)</code>, paying that gas itself. The contract never holds
        purchase money, so there is no forwarding step that could fail and no treasury for it to
        sit in.
      </p>
      <p>
        <code>paymentRef</code> is the payment transaction&rsquo;s own hash. It is written into{" "}
        <code>paymentRefUsed</code> and emitted in <code>NodeMinted</code>, which is what makes
        the sale checkable rather than merely asserted: a node points at the exact transfer that
        paid for it, and that transfer can never point at a second node.
      </p>
      <CodeBlock label="SitowiseFactory.mintFor">{`function mintFor(address to, bytes32 paymentRef) external onlyRelayer returns (uint256 id) {
    if (paused) revert IsPaused();
    if (to == address(0)) revert BadInput();
    if (paymentRef == bytes32(0)) revert BadInput();
    if (paymentRefUsed[paymentRef]) revert RefAlreadyUsed();
    if (_owned[to].length >= maxPerWallet) revert WalletLimit();

    paymentRefUsed[paymentRef] = true;

    id = ++totalNodes;
    // ...
    emit NodeMinted(id, to, paymentRef, uint64(block.timestamp));
}`}</CodeBlock>
      <p>
        Without that mapping the <code>paymentRef</code> in the log would prove nothing: one
        payment could back unlimited nodes and the explorer trail would be theatre. With it, the
        check anyone can run is simple. Take the node&rsquo;s <code>paymentRef</code>, open that
        transaction, and confirm it paid the price to the payments wallet. Full steps are on{" "}
        <Link href="/docs/deploying">Deploying a node</Link>.
      </p>

      <h2 id="credit">ETH becomes a balance</h2>
      <p>
        Credits are decided off chain and settled on chain in one payable call. The distributor
        calls <code>creditBatch(ids, amounts)</code> and sends the money with it. If{" "}
        <code>msg.value</code> is not exactly the sum of <code>amounts</code>, the call reverts
        with <code>ValueMismatch</code> and nothing is recorded.
      </p>
      <CodeBlock label="SitowiseFactory.creditBatch, the check that matters">{`uint256 sum;
for (uint256 i; i < n; ++i) {
    uint256 amt = amounts[i];
    if (amt == 0) revert BadInput();
    if (amt > type(uint128).max) revert AmountTooLarge();
    sum += amt;
}
if (sum != msg.value) revert ValueMismatch();`}</CodeBlock>
      <p>
        So a balance can never exist without the ETH behind it. There is no state in which the
        interface shows you a number that the contract cannot pay. The sum is validated before any
        storage is written, which also means a malformed batch costs the caller memory-only gas
        instead of a write per node.
      </p>
      <p>
        The <code>uint128</code> guard is not decoration either. Balances are <code>uint128</code>,
        and an explicit narrowing cast in Solidity truncates silently rather than reverting. Left
        unguarded, an oversized amount would credit a node less than the ETH backing it and break
        the accounting below permanently.
      </p>
      <p>
        Each credited node emits <code>Credited(id, amount, newBalance)</code>. The balance is
        withdrawable from that moment; there is no unlock, no vesting and no waiting period.
      </p>
      <Callout tone="info">{FUNDING_NOTE}</Callout>

      <h2 id="withdraw">A balance becomes ETH in your wallet</h2>
      <p>
        The node&rsquo;s owner calls <code>withdraw(id, to)</code>, or{" "}
        <code>withdrawAll(to)</code> to sweep every node they hold in one transaction. The caller
        is checked against <code>node.owner</code> and against nothing else. It always moves the
        node&rsquo;s whole balance, because a partial withdrawal would be an amount argument whose
        only purpose is to be got wrong.
      </p>
      <CodeBlock label="SitowiseFactory.withdraw">{`function withdraw(uint256 id, address to) external nonReentrant {
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
}`}</CodeBlock>
      <p>
        The balance is zeroed and the totals are updated <em>before</em> the ETH is sent, so a
        destination that calls back into the contract finds nothing left to take. The{" "}
        <code>nonReentrant</code> guard on top of that is belt and braces rather than the primary
        defence. Failure modes and gas are on{" "}
        <Link href="/docs/withdrawing">Withdrawing</Link>.
      </p>
      <p>
        Pausing blocks <code>mintFor</code> and nothing else. There is no state of the contract,
        and no action available to the owner, that stops or delays a withdrawal.
      </p>

      <h2 id="outstanding">The invariant that holds it together</h2>
      <p>
        <code>outstanding</code> is the sum of every node balance. It rises by the exact{" "}
        <code>msg.value</code> of every credit and falls by the exact amount of every withdrawal.
        Its job is to bound what the contract owner can take out.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Read</th>
            <th>Means</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>outstanding()</code>
            </td>
            <td>Everything the contract owes to node balances</td>
          </tr>
          <tr>
            <td>
              <code>freeBalance()</code>
            </td>
            <td>
              <code>address(this).balance - outstanding</code>, contract funds attached to no node
            </td>
          </tr>
          <tr>
            <td>
              <code>isSolvent()</code>
            </td>
            <td>
              <code>balance &gt;= outstanding</code>. False would mean balances are not fully
              backed
            </td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        <code>rescue(to, amount)</code> reverts with <code>ExceedsFree</code> for anything above{" "}
        <code>freeBalance()</code>. That is the whole guarantee: under every sequence of calls
        available to the owner, holder money is unreachable. It is enforced by a fuzz invariant in
        the test suite, and the invariant is verified by mutation, meaning the bound was
        deliberately changed to the full balance to confirm the suite fails when the property is
        broken. A test that cannot fail proves nothing. See{" "}
        <Link href="/docs/security-model">Security model</Link> and{" "}
        <Link href="/docs/audits">Audits</Link>.
      </p>

      <h2 id="gone">What used to be here</h2>
      <p>
        If you have read an older version of these docs, or a copy of them somewhere else, the
        following do not exist and never will in this deployment. None of them are functions on
        the contract at <Link href="/docs/addresses">the published address</Link>.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Old mechanism</th>
            <th>What is true now</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>An EIP-712 voucher signed by a server</td>
            <td>You call the contract yourself. There is no signer key and no signature.</td>
          </tr>
          <tr>
            <td>A cumulative allowance and a deadline</td>
            <td>A balance, which does not expire and cannot be replayed because it is spent.</td>
          </tr>
          <tr>
            <td>
              <code>POST /api/withdraw/prepare</code> and <code>/confirm</code>
            </td>
            <td>Deleted. Withdrawing touches no API at all.</td>
          </tr>
          <tr>
            <td>A treasury contract receiving mint payments</td>
            <td>A plain payments wallet, outside the contract, holding no code.</td>
          </tr>
        </tbody>
      </DocTable>
      <Callout tone="warn">
        Anyone asking you to sign a message, a permit or a voucher in order to withdraw from
        Sitowise is not Sitowise. Withdrawing is one ordinary contract call that you send.
      </Callout>
    </DocPage>
  );
}
