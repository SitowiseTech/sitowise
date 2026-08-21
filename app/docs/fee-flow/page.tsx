import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocFigure, DocPage, DocTable} from "@/components/docs/DocPage";
import {FlowSchematic} from "@/components/docs/charts/FlowSchematic";
import {Callout} from "@/components/ui/Callout";
import {NODE_PRICE_ETH} from "@/lib/site";

export const metadata: Metadata = {
  title: "Fee flow",
  description:
    "Every hop a unit of value takes: the transfer that buys a node, the credit that funds one, and the withdrawal that ends it, plus where swap flow will enter later.",
};

export default function FeeFlowPage() {
  return (
    <DocPage
      href="/docs/fee-flow"
      lede={
        <>
          Follow one unit of value from end to end. Purchase money and payout money never mix, they
          arrive at different addresses, and only one of them can ever reach a holder. Knowing
          which is which answers most questions about the protocol.
        </>
      }
    >
      <h2 id="pots">Two pots, kept apart</h2>
      <DocTable>
        <thead>
          <tr>
            <th>Pot</th>
            <th>Holds</th>
            <th>Can pay holders</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Payments wallet</td>
            <td>Node purchases, received as plain transfers</td>
            <td>No. It is an ordinary account outside the contract entirely.</td>
          </tr>
          <tr>
            <td>Factory balance</td>
            <td>
              Payout money, sent by the distributor with <code>creditBatch</code>, plus anything
              added through <code>fund()</code> or a plain transfer
            </td>
            <td>Yes. This is the only balance a withdrawal draws from.</td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        The separation is not a policy, it is a consequence of where the money is sent. Buying a
        node is a transfer to a wallet; the factory has no <code>payable</code> mint and never sees
        your {NODE_PRICE_ETH} ETH, not for one block. Purchase money cannot become payout liquidity
        because it is never in the contract to begin with.
      </p>
      <p>
        Payout money arrives the other way round, from the distributor, and it arrives attached to
        specific nodes. If the two shared an address every payout would be partly funded by the
        next buyer and the contract could not tell them apart. Keeping them separate is what gives{" "}
        <code>outstanding</code> and <code>freeBalance()</code> a meaning that can be checked from
        outside.
      </p>

      <h2 id="path">The path, hop by hop</h2>
      <DocFigure caption="The spine is what happens today. The branch dropping into creditBatch is launch-period funding.">
        <FlowSchematic />
      </DocFigure>
      <ol>
        <li>
          <strong>Payment.</strong> The buyer sends exactly {NODE_PRICE_ETH} ETH to the payments
          wallet. Plain transfer, no calldata, no contract involved. That money has left the flow
          at this point: it funds the operation, and nothing downstream draws on it.
        </li>
        <li>
          <strong>Watcher.</strong> The server reads blocks, finds the transfer, and records it
          with its transaction hash before anything is minted. See{" "}
          <Link href="/docs/deploying">Deploying a node</Link>.
        </li>
        <li>
          <strong>
            <code>mintFor</code>.
          </strong>{" "}
          The relayer creates the node for the paying address and pays that gas itself. The payment
          transaction hash goes in as <code>paymentRef</code>, which is what ties the sale to the
          node in the explorer.
        </li>
        <li>
          <strong>
            <code>creditBatch</code>.
          </strong>{" "}
          The distributor sends the round&rsquo;s ETH and the per-node amounts in one payable call.{" "}
          <code>msg.value</code> must equal the sum of the amounts, so the money and the record
          land together. See <Link href="/docs/distribution">Distribution</Link>.
        </li>
        <li>
          <strong>Node balance.</strong> The value now sits in the factory, attached to your node
          and counted in <code>outstanding</code>. It stays there until you move it. Nobody else
          can, including the contract owner.
        </li>
        <li>
          <strong>
            <code>withdraw</code>.
          </strong>{" "}
          You call it yourself, from the wallet that owns the node, naming any destination. The
          whole balance of that node moves. <code>withdrawAll</code> does the same across every
          node you own in one transaction. See <Link href="/docs/withdrawing">Withdrawing</Link>.
        </li>
      </ol>

      <h2 id="today">Where the value comes from today</h2>
      <Callout tone="warn">
        <p>
          There is no swap flow yet. A Uniswap v4 pool fixes its hook at initialisation and a hook
          cannot be attached afterwards, so until Sitowise deploys the hook, runs pools on it, and
          those pools carry volume, the protocol accrues nothing from trading.
        </p>
        <p>
          During the launch period rewards are funded by Sitowise. Once pools are attached to the
          hook, accrual comes from swap flow. Sitowise can reduce or stop launch-period funding at
          any time.
        </p>
      </Callout>
      <p>
        When that changes, it changes one hop only. A swap through a pool naming the hook would
        pay a share of the unspecified side into the hook, and{" "}
        <code>sweepNative()</code> would move it into the factory, giving the distributor money to
        credit that it did not have to fund. The mechanism is described on{" "}
        <Link href="/docs/accrual">How accrual works</Link>, and it is described as intended, not
        as running. Everything from <code>creditBatch</code> onward is identical either way: the
        same call, the same balances, the same withdrawal from your own wallet.
      </p>

      <h2 id="who-pays">Who pays what</h2>
      <DocTable>
        <thead>
          <tr>
            <th>Cost</th>
            <th>Paid by</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{NODE_PRICE_ETH} ETH node price</td>
            <td>You</td>
            <td>Once, as a transfer to the payments wallet</td>
          </tr>
          <tr>
            <td>Gas for the transfer</td>
            <td>You</td>
            <td>With the payment</td>
          </tr>
          <tr>
            <td>
              Gas for <code>mintFor</code>
            </td>
            <td>Sitowise, from the relayer</td>
            <td>When your node is created</td>
          </tr>
          <tr>
            <td>
              Gas for <code>creditBatch</code>, and the ETH it carries
            </td>
            <td>Sitowise, from the distributor</td>
            <td>Every round</td>
          </tr>
          <tr>
            <td>Gas to withdraw</td>
            <td>You</td>
            <td>Every withdrawal</td>
          </tr>
          <tr>
            <td>The hook&rsquo;s share of a swap</td>
            <td>The swapper</td>
            <td>Later, inside the swap, on the unspecified side</td>
          </tr>
        </tbody>
      </DocTable>

      <h2 id="check">Checking the flow yourself</h2>
      <p>
        A handful of reads describe the state of the payout pot at any moment, and none of them
        require this website.
      </p>
      <CodeBlock label="cast">{`cast call $FACTORY "totalDistributed()(uint256)"  # every wei ever credited to nodes
cast call $FACTORY "totalWithdrawn()(uint256)"    # every wei owners have taken out
cast call $FACTORY "outstanding()(uint256)"       # credited, not yet withdrawn
cast call $FACTORY "freeBalance()(uint256)"       # balance above what is owed
cast call $FACTORY "isSolvent()(bool)"

cast balance $FACTORY                             # the pot itself`}</CodeBlock>
      <p>
        <code>outstanding</code> is the sum of every node balance, and <code>freeBalance()</code>{" "}
        is what is left over. Those two are the whole guarantee: <code>rescue</code> is bounded by
        the second, so no sequence of owner calls reaches the first. If{" "}
        <code>isSolvent()</code> ever returns false the contract is not holding enough to cover the
        balances it has written, which is a state worth watching for and is listed among the
        failure modes on <Link href="/docs/risks">Risks</Link>.
      </p>
    </DocPage>
  );
}
