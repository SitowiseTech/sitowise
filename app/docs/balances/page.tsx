import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocFigure, DocPage, DocTable} from "@/components/docs/DocPage";
import {NodeBarsChart} from "@/components/docs/charts/NodeBarsChart";
import {Callout} from "@/components/ui/Callout";

export const metadata: Metadata = {
  title: "Balances",
  description:
    "What a balance is, why the ETH behind it always exists, the three numbers on every node, and how to read them without trusting the website.",
};

export default function BalancesPage() {
  return (
    <DocPage
      href="/docs/balances"
      lede={
        <>
          A balance is real ETH, held by the factory contract and attributed to one node id. It is
          not a promise, a ledger entry or a figure waiting to be approved. Only the node owner can
          move it, and they move it themselves.
        </>
      }
    >
      <h2 id="three">The three numbers</h2>
      <p>
        Every node carries three figures, and all three live in the contract. One call returns
        them together.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Number</th>
            <th>What it is</th>
            <th>Moves when</th>
            <th>Can decrease</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>balance</code>
            </td>
            <td>ETH held for this node and withdrawable right now</td>
            <td>
              A credit adds to it, a withdrawal empties it
            </td>
            <td>Yes, to zero, and only by the owner withdrawing</td>
          </tr>
          <tr>
            <td>
              <code>totalReceived</code>
            </td>
            <td>Everything ever credited to the node</td>
            <td>A distribution round credits it</td>
            <td>No, it only advances</td>
          </tr>
          <tr>
            <td>
              <code>totalWithdrawn</code>
            </td>
            <td>Everything ever paid out against the node</td>
            <td>A withdrawal confirms</td>
            <td>No, it only advances</td>
          </tr>
        </tbody>
      </DocTable>
      <CodeBlock label="SitowiseFactory">{`function nodeInfo(uint256 id) external view returns (
    address nodeOwner,
    uint64  createdAt,
    uint256 balance,
    uint256 totalReceived,
    uint256 totalWithdrawnByNode
);`}</CodeBlock>
      <p>
        The relationship between them holds by construction:{" "}
        <code>balance == totalReceived - totalWithdrawn</code>, because the only two operations
        that exist are a credit that raises the first two and a withdrawal that zeroes the balance
        while raising the third by the same amount.
      </p>

      <h2 id="backed">Where the ETH actually is</h2>
      <p>
        Balances are created by <code>creditBatch(ids, amounts)</code>, which the distributor
        calls. It is a <strong>payable</strong> call, and <code>msg.value</code> must equal the sum
        of <code>amounts</code> exactly, otherwise it reverts with <code>ValueMismatch</code>{" "}
        before a single balance is touched.
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
        That is the whole point of doing it this way. A balance cannot exist without the ETH behind
        it, because the transaction that creates the balance is the transaction that delivers the
        money. There is no window in which the contract owes something it does not hold. A zero
        amount, a length mismatch, an empty batch or an unknown node id all revert with{" "}
        <code>BadInput</code>, so a malformed round credits nothing rather than crediting part of
        itself. How rounds are funded is on{" "}
        <Link href="/docs/distribution">Distribution</Link>.
      </p>

      <h2 id="live">Balances for a wallet</h2>
      <p>
        The chart reads <Link href="/docs/api/nodes">GET /api/nodes/:address</Link> for any address
        you enter. Each bar is one node: the filled part is still on the contract, the outlined part
        has already been withdrawn.
      </p>
      <DocFigure caption="Live from the public API. No address is filled in by default, and nothing is drawn until you enter one.">
        <NodeBarsChart />
      </DocFigure>

      <h2 id="who">Who can move a balance</h2>
      <ul>
        <li>
          <strong>You</strong>, by calling <code>withdraw</code> or <code>withdrawAll</code>{" "}
          yourself. The contract compares <code>node.owner</code> with <code>msg.sender</code> and
          nothing else, so there is no message, signature or approval anybody else could hold that
          would let them move it.
        </li>
        <li>
          <strong>The distributor</strong> can add to a balance and can decide not to add to it
          again. It has no path that lowers one and no path that withdraws.
        </li>
        <li>
          <strong>The contract owner</strong> can pause minting, change roles and take{" "}
          <em>free</em> funds, meaning contract ETH attached to no node. Node balances are outside
          what that role can reach, by the bound described below.
        </li>
      </ul>

      <h2 id="outstanding">Outstanding, free balance and solvency</h2>
      <p>
        <code>outstanding</code> is the sum of every node balance. It goes up by exactly what{" "}
        <code>creditBatch</code> delivers and down by exactly what a withdrawal sends, so it is
        always the total the contract owes to nodes.
      </p>
      <p>
        Everything above that is free: <code>freeBalance()</code> returns{" "}
        <code>address(this).balance - outstanding</code>, and <code>rescue(to, amount)</code>{" "}
        reverts with <code>ExceedsFree</code> for anything larger. That single bound is the reason
        the owner key cannot reach holder money under any sequence of calls. It is enforced by a
        fuzz invariant, and the invariant is verified by mutation: widening the bound to the full
        balance makes the test suite fail. The rest of what the owner can and cannot do is on{" "}
        <Link href="/docs/security-model">Security model</Link>.
      </p>
      <p>
        <code>isSolvent()</code> returns whether the contract holds at least{" "}
        <code>outstanding</code>. Under normal operation it is always true, because credits arrive
        with their own funding. It is worth reading anyway: it is the one call that checks the
        invariant the whole design rests on, and it costs nothing to make.
      </p>
      <Callout>
        Nothing on this page depends on the operator staying online. The balance is in the
        contract, the check is a public view function, and the withdrawal is your own transaction.
        See <Link href="/docs/withdrawing">Withdrawing</Link>.
      </Callout>

      <h2 id="units">Units and rounding</h2>
      <p>
        Everything is wei. Balances are stored as <code>uint128</code> and passed to the contract
        as exact integers, so nothing is rounded anywhere in the accounting path. An amount above{" "}
        <code>type(uint128).max</code> is rejected rather than silently truncated, because a
        truncated credit would put a balance on a node that the delivered ETH did not match.
      </p>
      <p>
        Display rounds to six decimal places and truncates rather than rounding up, so the number
        shown is never more than you can actually withdraw. If a node holds a very small balance,
        the display can read <code>0.000000</code> while the underlying figure is non-zero; the
        withdrawal path uses the exact figure regardless, and takes all of it.
      </p>
      <CodeBlock label="What the API returns, field shapes rather than real figures">{`{
  "id": 1,
  "chainNodeId": "1",
  "balanceWei":    "0",   // node.balance,       withdrawable now
  "cumulativeWei": "0",   // node.totalReceived, ever credited
  "withdrawnWei":  "0"    // node.totalWithdrawn, ever paid out
}`}</CodeBlock>
      <p>
        Wei figures are strings in JSON on purpose. They routinely exceed what a double can hold
        exactly, and a client that parses them as numbers will silently lose precision. Parse them
        with a big-integer type. The full response, including the mint transaction, is on{" "}
        <Link href="/docs/api/nodes">GET /api/nodes/:address</Link>.
      </p>

      <h2 id="verify">Verifying a balance</h2>
      <p>
        All three numbers are on chain, so none of them has to be taken on trust from this website
        or the API.
      </p>
      <CodeBlock label="cast">{`# owner, createdAt, balance, totalReceived, totalWithdrawn for one node
cast call $FACTORY "nodeInfo(uint256)(address,uint64,uint256,uint256,uint256)" $NODE_ID

# combined withdrawable balance across every node of a wallet
cast call $FACTORY "balanceOfOwner(address)(uint256)" $YOUR_ADDRESS

# what the contract owes to nodes, what is unattached, and whether it is covered
cast call $FACTORY "outstanding()(uint256)"
cast call $FACTORY "freeBalance()(uint256)"
cast call $FACTORY "isSolvent()(bool)"`}</CodeBlock>
      <p>
        The same reads are available in the Read Contract tab of the explorer, which is why the
        contract is verified there. Addresses are on{" "}
        <Link href="/docs/addresses">Addresses</Link> and every function is listed on{" "}
        <Link href="/docs/factory-interface">Factory interface</Link>.
      </p>

      <h2 id="several">Several nodes at once</h2>
      <p>
        <code>balanceOfOwner(who)</code> adds up the balances of every node a wallet owns, which is
        the total the dashboard shows. Each node still holds its own balance underneath, and{" "}
        <code>withdrawAll(to)</code> empties all of them into one destination in a single
        transaction. See <Link href="/docs/withdrawing">Withdrawing</Link>.
      </p>
    </DocPage>
  );
}
