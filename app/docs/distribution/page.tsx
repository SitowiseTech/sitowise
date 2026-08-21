import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocFigure, DocPage, DocTable} from "@/components/docs/DocPage";
import {CreditsChart} from "@/components/docs/charts/CreditsChart";
import {Callout} from "@/components/ui/Callout";

export const metadata: Metadata = {
  title: "Distribution",
  description:
    "How value reaches nodes: amounts computed off chain, then settled on chain by one payable creditBatch call that carries the ETH with it.",
};

export default function DistributionPage() {
  return (
    <DocPage
      href="/docs/distribution"
      lede={
        <>
          A round is decided off chain and settled on chain. The worker works out who gets what,
          and one payable call writes those amounts and delivers the ETH behind them in the same
          transaction. After that the value is on the node, and only its owner can move it.
        </>
      }
    >
      <h2 id="round">What a round is</h2>
      <p>
        Value reaches nodes in rounds. A round has an off-chain half and an on-chain half, in that
        order.
      </p>
      <ol>
        <li>
          The worker decides the amounts. It reads which nodes are active and splits the
          round&rsquo;s value across them. Nothing about that step needs the chain, and doing it in
          the database is what makes it cheap to run often.
        </li>
        <li>
          The distributor settles them. One call to{" "}
          <code>creditBatch(uint256[] ids, uint256[] amounts)</code> carries every id, every
          amount, and the ETH for all of them at once.
        </li>
        <li>
          The ledger records the round: a row in <code>distributions</code> with the mode and the
          node count, one row in <code>credits</code> per node, and each node&rsquo;s cumulative
          figure increased by its amount. That is what the dashboard and the public API read.
        </li>
      </ol>
      <p>
        The ledger half is a single database transaction on purpose. A half-applied round would
        leave the ledger claiming value it never credited, and the database enforces the rest:
        cumulative figures are monotonic by trigger, and withdrawn can never exceed cumulative by
        constraint. The ledger is a mirror, though, not the authority. The authority is the
        contract, and the two are reconciled against each other rather than trusted.
      </p>
      <Callout tone="warn">
        The size of a round and how often rounds happen are operational settings, not promises.
        During the launch period the value being credited is funded by Sitowise and can be reduced
        or stopped at any time. Nothing on this site states a rate, an interval, or a payback
        period, because none of those can be honestly guaranteed.
      </Callout>

      <h2 id="live">Rounds that have actually happened</h2>
      <p>
        The chart reads <Link href="/docs/api/distributions">GET /api/distributions</Link>, the
        same public endpoint anyone can call, and buckets the rounds it returns. If nothing has
        been distributed in the window it says so rather than drawing a flat line at zero.
      </p>
      <DocFigure caption="Value credited per hour over the last day, or per day over the last week. Live data from the public API.">
        <CreditsChart />
      </DocFigure>

      <h2 id="settlement">Settlement: one payable call</h2>
      <p>
        <code>creditBatch</code> is <code>payable</code>, and that is the whole design. The
        contract sums the amounts before it writes anything and refuses the call unless{" "}
        <code>msg.value</code> matches that sum exactly. A node balance therefore cannot exist
        without the ETH backing it sitting in the contract, and no later step is needed to make a
        credit real.
      </p>
      <CodeBlock label="SitowiseFactory.creditBatch">{`uint256 sum;
for (uint256 i; i < n; ++i) {
    uint256 amt = amounts[i];
    if (amt == 0) revert BadInput();
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
totalDistributed += sum;`}</CodeBlock>
      <p>
        Each node in the batch emits <code>Credited(id, amount, newBalance)</code>: what it just
        received, and what it holds afterwards. That second figure is the one that matters, because
        it is withdrawable the moment the transaction confirms. There is no unlock, no claim
        window, no approval and nothing to request from Sitowise; the owner calls{" "}
        <code>withdraw</code> or <code>withdrawAll</code> from their own wallet whenever they want.
        See <Link href="/docs/withdrawing">Withdrawing</Link>.
      </p>
      <p>
        The batch is validated before any storage is touched, so a malformed round costs the
        distributor gas and changes nothing. An empty batch, mismatched array lengths, a zero
        amount or an id that was never minted all revert with <code>BadInput</code>; an amount
        above <code>type(uint128).max</code> reverts with <code>AmountTooLarge</code>, because
        balances are <code>uint128</code> and a silent truncation would credit a node less than the
        ETH backing it.
      </p>
      <p>
        <code>outstanding</code> rises by the same sum. It is what the contract considers owed to
        holders, and <code>rescue</code> can only ever touch the balance above it, so the number
        that records what was credited is also the number that stops the owner taking it back. Read{" "}
        <Link href="/docs/security-model">Security model</Link> for the full analysis, and{" "}
        <code>isSolvent()</code> is the public view anyone can call to check the contract still
        covers every balance it has written.
      </p>

      <h2 id="offchain">Why the amounts are decided off chain</h2>
      <p>
        Splitting a round across active nodes is arithmetic. Doing it in a contract would mean
        publishing a rule the operator then cannot change, paying gas to evaluate it, and still
        needing an off-chain job to trigger it. Doing it in the worker costs nothing and keeps the
        chain doing the two things only it can do: hold the money, and record who it belongs to.
      </p>
      <p>
        The credits themselves are not batched off chain to save gas. On this chain that would buy
        nothing. Measured at 0.0297 gwei with ETH around $2,450:
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Action</th>
            <th>Gas</th>
            <th>Paid by</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>creditBatch</code>, batch overhead
            </td>
            <td>About 30k</td>
            <td>The distributor</td>
          </tr>
          <tr>
            <td>
              <code>creditBatch</code>, per node in the batch
            </td>
            <td>About 8k</td>
            <td>The distributor</td>
          </tr>
          <tr>
            <td>
              <code>withdraw</code>, one node
            </td>
            <td>About 55k, roughly $0.004</td>
            <td>The node owner</td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        At a sixty second tick that is roughly $3 a day of batch overhead plus about $0.42 a day
        per node, which is small next to the payouts themselves and is paid by Sitowise, not out of
        anyone&rsquo;s balance. An earlier version of this protocol settled balances with signed
        off-chain messages to avoid exactly this cost. At these gas prices that complexity bought
        nothing and was removed, and the withdrawal path has no signature, no server and no expiry
        in it as a result.
      </p>

      <h2 id="modes">Treasury mode and swaps mode</h2>
      <p>
        <code>DIST_MODE</code> decides where a round&rsquo;s value comes from.{" "}
        <code>treasury</code> is the name of the mode in which Sitowise funds the round out of its
        own funds; there is no treasury contract, and the money for a credit is sent by the
        distributor in the <code>creditBatch</code> call itself either way.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th></th>
            <th>
              <code>treasury</code>
            </th>
            <th>
              <code>swaps</code>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Source of value</td>
            <td>Funded by Sitowise</td>
            <td>
              Read from the hook&rsquo;s <code>SwapAccrued</code> events for the period
            </td>
          </tr>
          <tr>
            <td>Amount per round</td>
            <td>Set by Sitowise</td>
            <td>Whatever the swaps actually produced</td>
          </tr>
          <tr>
            <td>How it is credited and withdrawn</td>
            <td>Identical</td>
            <td>Identical</td>
          </tr>
          <tr>
            <td>Currently running</td>
            <td>Yes</td>
            <td>Not until pools are attached to the hook</td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        The mode of every round is recorded with the round itself and returned in the{" "}
        <code>mode</code> field of <Link href="/docs/api/distributions">GET /api/distributions</Link>
        , so the history says which source funded what. That is part of the public record rather
        than something you have to ask for.
      </p>
    </DocPage>
  );
}
