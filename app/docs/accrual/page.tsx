import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocFigure, DocPage, DocTable} from "@/components/docs/DocPage";
import {FlowSchematic} from "@/components/docs/charts/FlowSchematic";
import {
  DEFAULT_HOOK_SHARE_BPS,
  MAX_HOOK_SHARE_BPS,
  POOL_MANAGER,
} from "@/components/docs/protocol";
import {Callout} from "@/components/ui/Callout";
import {CHAIN_ID} from "@/lib/chain";

export const metadata: Metadata = {
  title: "How accrual works",
  description:
    "What the Sitowise hook is designed to measure inside a Uniswap v4 swap, which side of the trade pays it, and what actually credits nodes during the launch period.",
};

export default function AccrualPage() {
  return (
    <DocPage
      href="/docs/accrual"
      lede={
        <>
          Accrual is the moment value is taken out of a swap. The hook that does it is not deployed
          yet, so this page describes what it measures and who pays it, and then says plainly what
          is putting ETH on node balances today instead.
        </>
      }
    >
      <h2 id="mechanism">The mechanism</h2>
      <p>
        Uniswap v4 keeps every pool inside one contract, the PoolManager, and lets a pool nominate
        a hook contract that the manager calls at fixed points during an operation. Sitowise
        implements a single one of those points: <code>afterSwap</code>. It runs in the same
        transaction as the swap, after the pool has computed the trade but before the manager
        settles balances.
      </p>
      <p>
        At that moment the hook takes a fixed share of the swap and keeps it. That share is{" "}
        <code>shareBps</code>, expressed in basis points, currently {DEFAULT_HOOK_SHARE_BPS} bps,
        which is {DEFAULT_HOOK_SHARE_BPS / 100}% of the measured side. The contract also carries a
        constant <code>MAX_SHARE_BPS</code> of {MAX_HOOK_SHARE_BPS} bps, which the owner cannot
        raise. A cap the owner cannot move is the only kind of cap a swapper can read once and rely
        on.
      </p>
      <CodeBlock label="SitowiseHook.afterSwap, the measurement">{`bool specifiedTokenIs0 = (params.amountSpecified < 0) == params.zeroForOne;
(Currency feeCurrency, int128 swapAmount) =
    specifiedTokenIs0 ? (key.currency1, delta.amount1())
                      : (key.currency0, delta.amount0());
if (swapAmount < 0) swapAmount = -swapAmount;

uint256 amount = (uint256(uint128(swapAmount)) * bps) / 10_000;
if (amount == 0) return (IHooks.afterSwap.selector, int128(0));

poolManager.take(feeCurrency, address(this), amount);`}</CodeBlock>
      <p>
        Everything in this section and the two below it describes the hook as it is being written.
        None of it is running: the hook is not deployed and no pool names it. What is actually
        putting ETH on node balances today is described further down, under What is funding rewards
        today.
      </p>

      <h2 id="unspecified">Which side pays</h2>
      <p>
        A swap has a specified side and an unspecified side. If you ask to sell exactly one token,
        the input is specified and the output is not. If you ask to receive exactly one token, the
        output is specified and the input is not.
      </p>
      <p>
        Uniswap v4 only permits an <code>afterSwap</code> hook to move the unspecified currency, so
        that is where the share is charged. The consequence is worth stating plainly:
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Swap type</th>
            <th>Charged from</th>
            <th>What the trader sees</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Exact input</td>
            <td>The output</td>
            <td>Slightly less of the token they are buying</td>
          </tr>
          <tr>
            <td>Exact output</td>
            <td>The input</td>
            <td>Slightly more of the token they are selling</td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        Liquidity providers are untouched. The <code>int128</code> the hook returns tells the
        PoolManager that the hook owes that amount to pool accounting, which is what makes the
        swapper carry it rather than the LPs. If you write a test or an integration that asserts on
        swap output, note that the delta a router reports is already net of the hook&rsquo;s share.
      </p>
      <p>
        Dust rounds to nothing. When the computed share truncates to zero the hook returns
        immediately, so tiny swaps neither pay nor pay for the extra gas of a zero-value take.
      </p>

      <h2 id="currency">What is accrued, and in what</h2>
      <p>
        The hook accrues in whatever token sat on the unspecified side, and keeps a per-currency
        cumulative total in <code>accrued(address currency)</code>, where{" "}
        <code>address(0)</code> means native ETH. That figure only ever increases, including across
        sweeps, so it doubles as an on-chain total to reconcile against.
      </p>
      <ul>
        <li>
          Native accruals are moved into the factory by <code>sweepNative()</code>, which anyone
          may call. It arrives through the factory&rsquo;s <code>fund()</code>, so it lands as
          unattached balance the distributor can then credit to nodes. The destination is fixed in
          code, so there is nothing for a caller to redirect and a stalled operator cannot strand
          the value.
        </li>
        <li>
          Token accruals go to <code>sweepRecipient</code> through <code>sweepToken()</code>, an
          owner-only call, because node balances are native ETH only. Those are converted off
          chain.
        </li>
      </ul>
      <p>
        Every accrual emits an event, which is the interface anyone auditing the protocol should
        use. It is documented on <Link href="/docs/events">Events</Link>.
      </p>

      <h2 id="today">What is funding rewards today</h2>
      <Callout tone="warn" title="The honest position">
        <p>
          A Uniswap v4 pool fixes its hook when the pool is initialised. It cannot be changed
          later, and a hook cannot be attached to pools that already exist. So the hook earns
          nothing until Sitowise creates pools that name it and those pools carry real volume.
        </p>
        <p>
          Until then, <code>accrued</code> stays at zero and the value credited to nodes is funded
          by Sitowise out of its own funds. It is not swap revenue and is not presented as swap
          revenue. Sitowise can reduce or stop that funding at any time.
        </p>
      </Callout>
      <p>
        What credits a node is the same call in either case. The distributor sends{" "}
        <code>creditBatch(ids, amounts)</code> to the factory as a payable call, and{" "}
        <code>msg.value</code> has to equal the sum of <code>amounts</code> or the call reverts
        with <code>ValueMismatch</code>. The ETH lands on the balances in the same transaction that
        records them, so a balance can never exist without the money behind it.
      </p>
      <CodeBlock label="SitowiseFactory.creditBatch, the check that backs a balance">{`uint256 sum;
for (uint256 i; i < n; ++i) {
    uint256 amt = amounts[i];
    if (amt == 0) revert BadInput();
    if (amt > type(uint128).max) revert AmountTooLarge();
    sum += amt;
}
if (sum != msg.value) revert ValueMismatch();`}</CodeBlock>
      <p>
        The switch between the two sources is a single operational setting,{" "}
        <code>DIST_MODE</code>. In <code>treasury</code> mode the amount credited each round is
        funded and decided by Sitowise. In <code>swaps</code> mode the worker reads real accrual
        from the hook&rsquo;s <code>SwapAccrued</code> events over the period and splits that
        instead. Nothing downstream changes: the same <code>creditBatch</code> call puts the same
        ETH on the same node balances, and the owner withdraws it themselves, from their own
        wallet, with no server in the path. The mechanics are on{" "}
        <Link href="/docs/distribution">Distribution</Link>.
      </p>

      <DocFigure
        caption={
          <>
            The path a unit of value takes today. The branch dropping into <code>creditBatch</code>{" "}
            is launch-period funding, which is where the credited value is actually coming from.
          </>
        }
      >
        <FlowSchematic />
      </DocFigure>

      <h2 id="verify">Verifying accrual yourself</h2>
      <p>
        You do not have to take any of this on trust. There is no hook address to read yet, and
        that absence is itself the check: if no hook is deployed on chain {CHAIN_ID}, no swap has
        paid one. The PoolManager any future hook would have to point at is{" "}
        <code>{POOL_MANAGER}</code>, and the addresses that do exist are listed on{" "}
        <Link href="/docs/addresses">Addresses</Link>.
      </p>
      <CodeBlock label="cast, once a hook exists">{`# native value the hook has ever taken
cast call $HOOK "accrued(address)(uint256)" \\
  0x0000000000000000000000000000000000000000

# the share it charges, and the cap the owner cannot exceed
cast call $HOOK "shareBps()(uint16)"
cast call $HOOK "MAX_SHARE_BPS()(uint16)"`}</CodeBlock>
      <p>
        Until then the reads that mean something are on the factory:{" "}
        <code>totalDistributed</code> is every wei ever credited to nodes, and{" "}
        <code>outstanding</code> is what is credited and not yet withdrawn. Continue with{" "}
        <Link href="/docs/hook-lifecycle">The hook lifecycle</Link> for what deploying the hook
        involves.
      </p>
    </DocPage>
  );
}
