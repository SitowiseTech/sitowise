import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocPage, DocTable} from "@/components/docs/DocPage";
import {MAX_PER_WALLET_CEILING} from "@/components/docs/protocol";
import {Callout} from "@/components/ui/Callout";
import {EXPLORER_URL, RPC_URL} from "@/lib/chain";
import {MAX_NODES_PER_WALLET} from "@/lib/site";

export const metadata: Metadata = {
  title: "Withdrawing",
  description:
    "One call from the wallet that owns the node: what the contract does, what it costs, and how each failure behaves.",
};

export default function WithdrawingPage() {
  return (
    <DocPage
      href="/docs/withdrawing"
      lede={
        <>
          Withdrawing is a single transaction, sent by you from the wallet that owns the node.
          There is nothing to prepare, nothing that expires, and no server in the path. The
          contract always sends the whole balance.
        </>
      }
    >
      <h2 id="call">One call, sent by you</h2>
      <p>
        There are two functions and you call one of them directly. Neither takes an amount,
        because both take everything the node holds.
      </p>
      <CodeBlock label="SitowiseFactory">{`function withdraw(uint256 id, address to) external;
function withdrawAll(address to) external returns (uint256 amount);`}</CodeBlock>
      <ul>
        <li>
          <code>withdraw(id, to)</code> empties one node.
        </li>
        <li>
          <code>withdrawAll(to)</code> sweeps every node the calling wallet owns in one
          transaction, and pays the combined total in one transfer.
        </li>
      </ul>
      <p>
        No signature, no approval step, no allowance, no second transaction, no API call. A balance is already
        real ETH held by the factory against your node id, so the only question at withdrawal
        time is who is asking, and <code>msg.sender</code> answers it. Where that ETH came from
        is on <Link href="/docs/balances">Balances</Link>.
      </p>

      <h2 id="onchain">What the contract does</h2>
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
      <p>Three checks and one transfer, in an order chosen deliberately.</p>
      <ul>
        <li>
          Ownership is checked against <code>msg.sender</code>, and against nothing else. There
          is no second party whose permission is needed and none who could stand in for you.
        </li>
        <li>
          The destination is checked before any storage is touched, so a zero address costs you
          almost nothing.
        </li>
        <li>
          The balance is zeroed and <code>outstanding</code> is reduced <strong>before</strong>{" "}
          the ETH is sent, and the function carries <code>nonReentrant</code>. A recipient that
          calls back in finds the balance already zero and the guard already set.
        </li>
        <li>
          Pausing the contract blocks new mints. It never blocks a withdrawal, and there is no
          setting that can.
        </li>
      </ul>

      <h2 id="batch">Sweeping every node at once</h2>
      <p>
        <code>withdrawAll</code> walks the list of nodes the caller owns, zeroes each non-empty
        balance, and sends the sum to a single destination in one transfer. Nodes with nothing in
        them are skipped rather than reverting the sweep, so one empty node does not block the
        rest. The call reverts with <code>NothingToWithdraw</code> only when the whole sweep comes
        to zero.
      </p>
      <CodeBlock label="SitowiseFactory.withdrawAll, the loop">{`for (uint256 i; i < ids.length; ++i) {
    uint256 id = ids[i];
    Node storage node = _node[id];
    uint256 bal = node.balance;
    if (bal == 0) continue;
    node.balance = 0;
    node.totalWithdrawn += uint128(bal);
    amount += bal;
    emit Withdrawn(id, to, bal);
}
if (amount == 0) revert NothingToWithdraw();`}</CodeBlock>
      <p>
        This loop is the reason the per-wallet cap exists at all. <code>maxPerWallet</code> starts
        at {MAX_NODES_PER_WALLET} and the owner cannot raise it above{" "}
        {MAX_PER_WALLET_CEILING}, because an unbounded cap could push the sweep past the block gas
        limit and leave a wallet unable to use it. Per-node <code>withdraw</code> keeps working
        regardless of how many nodes a wallet holds. See <Link href="/docs/limits">Limits</Link>.
      </p>

      <h2 id="whole">The whole balance, always</h2>
      <p>
        There is no amount argument and no partial withdrawal. Both functions take everything the
        node has at that moment. If you want part of it somewhere else, withdraw to a wallet you
        control and split it from there.
      </p>
      <p>
        Withdrawing does not close or change the node. Anything credited afterwards builds a new
        balance on the same id, and you withdraw that the same way. There is no reason to wait for
        a balance to grow except gas efficiency: nothing accrues faster for being left in place,
        and nothing is lost by taking it out.
      </p>

      <h2 id="costs">What it costs</h2>
      <DocTable>
        <thead>
          <tr>
            <th>Item</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>withdraw</code> gas
            </td>
            <td>About 55,000, around $0.004, paid by you</td>
          </tr>
          <tr>
            <td>
              <code>withdrawAll</code> gas, {MAX_NODES_PER_WALLET} nodes
            </td>
            <td>About 700,000, around $0.05, paid by you</td>
          </tr>
          <tr>
            <td>Protocol fee on withdrawal</td>
            <td>None. The full balance is transferred.</td>
          </tr>
          <tr>
            <td>Minimum withdrawal</td>
            <td>None, beyond needing a non-zero balance</td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        Both gas figures were measured on chain at 0.0297 gwei with ETH around $2,450, and the
        table in the contracts README is where they come from. Gas prices move, so treat the gas
        numbers as the stable part and the dollar figures as what they were at that price.
      </p>

      <h2 id="failures">Failure modes</h2>
      <DocTable>
        <thead>
          <tr>
            <th>Error</th>
            <th>Cause</th>
            <th>Effect on your balance</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>NotNodeOwner</code>
            </td>
            <td>The sending address is not the node owner</td>
            <td>None. Send from the wallet that owns it.</td>
          </tr>
          <tr>
            <td>
              <code>NothingToWithdraw</code>
            </td>
            <td>
              The balance is zero, either because nothing has been credited since the last
              withdrawal or because <code>withdrawAll</code> already took it
            </td>
            <td>None. There was nothing there to lose.</td>
          </tr>
          <tr>
            <td>
              <code>BadInput</code>
            </td>
            <td>The destination was the zero address</td>
            <td>None. Pass a real address.</td>
          </tr>
          <tr>
            <td>
              <code>TransferFailed</code>
            </td>
            <td>
              The destination rejected the ETH, for example a contract with no payable receive
            </td>
            <td>None. Withdraw to an address that can receive plain transfers.</td>
          </tr>
          <tr>
            <td>
              <code>Reentrancy</code>
            </td>
            <td>
              The destination called back into the factory while the transfer was still in flight
            </td>
            <td>None. Withdraw to a plain wallet instead.</td>
          </tr>
        </tbody>
      </DocTable>
      <Callout>
        Every one of these reverts the whole transaction. A reverted withdrawal costs gas and
        changes nothing else: the balance, the node and the withdrawn figure are exactly as they
        were. Practical fixes for each are on{" "}
        <Link href="/docs/troubleshooting">Troubleshooting</Link>.
      </Callout>

      <h2 id="direct">Withdrawing without the website</h2>
      <p>
        A withdrawal needs nothing from Sitowise&rsquo;s servers. Everything it depends on is the
        contract and your key, so the Write Contract tab of the explorer at{" "}
        <code>{EXPLORER_URL}</code> works, and so does <code>cast</code>. If this site were down
        or gone, the money would still come out.
      </p>
      <CodeBlock label="cast">{`# one node
cast send $FACTORY "withdraw(uint256,address)" $NODE_ID $TO \\
  --rpc-url ${RPC_URL} --private-key $YOUR_KEY

# every node this wallet owns, in one transaction
cast send $FACTORY "withdrawAll(address)" $TO \\
  --rpc-url ${RPC_URL} --private-key $YOUR_KEY`}</CodeBlock>
      <p>
        The transaction must be sent from the address that owns the node. Where the ETH lands is a
        separate choice, described on{" "}
        <Link href="/docs/destination-addresses">Destination addresses</Link>. The deployed address
        is on <Link href="/docs/addresses">Addresses</Link>.
      </p>
    </DocPage>
  );
}
