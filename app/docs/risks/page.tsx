import type {Metadata} from "next";
import Link from "next/link";
import {DocPage, DocTable} from "@/components/docs/DocPage";
import {MAX_PER_WALLET_CEILING} from "@/components/docs/protocol";
import {Callout} from "@/components/ui/Callout";
import {CHAIN_ID} from "@/lib/chain";
import {NODE_PRICE_ETH} from "@/lib/site";

export const metadata: Metadata = {
  title: "Risks",
  description:
    "Everything that can go wrong with Sitowise, stated without softening: funding, liquidity, unaudited code, operator discretion, key loss and chain risk.",
};

export default function RisksPage() {
  return (
    <DocPage
      href="/docs/risks"
      lede={
        <>
          Read this before you spend anything. It is the complete list of ways this can go badly
          for you, written plainly, including the parts that are inconvenient to say.
        </>
      }
    >
      <Callout tone="warn" title="The short version">
        <p>
          You pay {NODE_PRICE_ETH} ETH, which is not refundable. What you receive afterwards is
          whatever Sitowise credits to your node, which is currently funded by Sitowise itself and
          can be reduced or stopped at any time. There is no promised return, no rate, and no
          protection if any of this goes wrong. Do not spend money here that you need.
        </p>
      </Callout>

      <h2 id="funding">1. Rewards are funded by Sitowise during the launch period</h2>
      <p>
        Sitowise is a genuine Uniswap v4 hook, and that code is written and deployable. But a v4
        pool fixes its hook at initialisation and a hook cannot be attached to pools that already
        exist. Until Sitowise creates pools that name the hook and those pools carry real volume,
        the hook earns nothing.
      </p>
      <p>
        So the value credited to nodes today comes from Sitowise, not from swap flow. It is
        discretionary. It can be reduced without notice, paused, or stopped permanently. Nothing in
        the contract compels anyone to credit anything to any node, ever.
      </p>
      <p>
        Every round records its funding mode, and that field is public in{" "}
        <Link href="/docs/api/distributions">GET /api/distributions</Link>. You can check for
        yourself which source has been funding rounds.
      </p>

      <h2 id="not-yield">2. This is not a yield, an investment, or a return</h2>
      <p>
        A node is not a deposit, a security, a share of a fund, or a claim on any pool of assets.
        Nothing accrues at a rate. Sitowise publishes no APR, no projection and no payback period,
        because any such figure would be invented.
      </p>
      <p>
        Historical figures on this site, including the charts, describe what has already happened.
        They are not a forecast, and past rounds do not entitle you to future ones. If you are
        buying a node expecting a specific return, you have misunderstood what it is, and you
        should not buy one.
      </p>

      <h2 id="nonrefundable">3. The purchase is final</h2>
      <p>
        The {NODE_PRICE_ETH} ETH is a plain transfer to the payments wallet, which is an ordinary
        account Sitowise controls. It is not escrowed, not held on your behalf, not refundable, and
        not recoverable by retiring the node or by any other action. There is no cancellation
        window and no function that could reverse it, because the contract never receives that
        money in the first place.
      </p>
      <p>
        A node also cannot be sold or transferred, so there is no exit other than withdrawing
        whatever has been credited to it. You may withdraw less in total than you paid. That is a
        realistic outcome, not a remote one.
      </p>

      <h2 id="liquidity">4. A balance is real ETH, and that is a smaller promise than it sounds</h2>
      <p>
        A credit is a payable call: <code>creditBatch</code> reverts unless the ETH sent with it
        equals the amounts being credited, so a balance cannot exist without the money behind it,
        and no withdrawal can fail for want of liquidity. You can check this without asking anyone.{" "}
        <code>outstanding()</code> is the sum of every node balance and{" "}
        <code>isSolvent()</code> returns whether the contract still covers it. Both are public
        views.
      </p>
      <p>
        That removes one risk and leaves the larger one untouched. Nothing obliges anyone to credit
        your node anything, ever. The danger is not that a balance you hold evaporates, it is that
        no balance appears in the first place, or that credits stop after a few rounds. A backed
        balance of zero is still zero.
      </p>
      <p>
        The whole balance moves at once, to an address you name, and the transfer is a raw call. A
        destination that rejects ETH makes the transaction revert with <code>TransferFailed</code>,
        which costs gas and changes nothing else.
      </p>

      <h2 id="code">5. The code is not audited</h2>
      <p>
        No third party has reviewed this contract. There are 112 passing tests including fuzzed
        invariants, which demonstrates that the paths the author thought of behave as intended and
        says nothing about the paths they did not. A fault in a contract holding ETH can mean the
        loss of that ETH, and this one holds every node balance.
      </p>
      <p>
        The contract is small, public and verified on the explorer. Review it yourself or assume
        the risk; see <Link href="/docs/audits">Audits</Link>.
      </p>

      <h2 id="operator">6. Operator discretion and centralisation</h2>
      <p>
        This is not a decentralised protocol and does not claim to be. One party runs the ledger,
        decides what is credited, and holds the owner, relayer and distributor keys.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>The operator can</th>
            <th>The operator cannot</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Decide what, if anything, is credited to nodes</td>
            <td>Take a node from you, or move it</td>
          </tr>
          <tr>
            <td>Retire a node, excluding it from future rounds</td>
            <td>Reduce a node&rsquo;s balance, or either of its running totals</td>
          </tr>
          <tr>
            <td>Pause new mints</td>
            <td>Pause or block a withdrawal</td>
          </tr>
          <tr>
            <td>Change the relayer and the distributor</td>
            <td>Withdraw from a node it does not own</td>
          </tr>
          <tr>
            <td>Change the per-wallet cap, up to a hard ceiling of {MAX_PER_WALLET_CEILING}</td>
            <td>Raise that cap past the ceiling, which is a constant</td>
          </tr>
          <tr>
            <td>
              Remove contract funds that back no node, through <code>rescue</code>
            </td>
            <td>Remove any ETH that backs a node balance</td>
          </tr>
          <tr>
            <td>Change the price and the payments wallet, both of which live off chain</td>
            <td>Charge you anything at withdrawal time, or take a cut of one</td>
          </tr>
          <tr>
            <td>Stop operating entirely</td>
            <td>Upgrade or replace the deployed contract</td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        The full analysis, including what each limit is enforced by, is on{" "}
        <Link href="/docs/security-model">Security model</Link>.
      </p>

      <h2 id="keys">7. Operator keys live on a server</h2>
      <p>
        Two keys sit on the application server because they have to send transactions
        unattended. Neither of them, and no key at all, can withdraw from a node: only the
        node&rsquo;s own owner can, and the contract checks <code>msg.sender</code> against nothing
        else. What a leak costs is still worth stating exactly.
      </p>
      <ul>
        <li>
          <strong>The relayer</strong> may call <code>mintFor</code> and nothing else. Stolen, it
          mints nodes to addresses that never paid, and burns whatever gas the key holds. That
          dilutes future rounds and costs Sitowise money; it does not touch anything you hold.
        </li>
        <li>
          <strong>The distributor</strong> may call <code>creditBatch</code> and nothing else.
          Because that call is payable and has to carry the ETH being credited, the key holds the
          payout float. Stolen, that float is gone, and rounds stop until it is replaced. Only a
          few days of runway is meant to sit on it, but that is an operating practice, not
          something the contract enforces.
        </li>
        <li>
          <strong>The owner key</strong> is the cold deployer key and is meant to stay off the
          server. It can pause new mints, change the relayer and the distributor, change the
          per-wallet cap, and call <code>rescue</code> for at most <code>freeBalance()</code>.
          Stolen, it can halt sales and take unattached funds. It cannot reach a node balance,
          cannot block a withdrawal, and cannot change the code. Ownership transfer is two-step,
          so it also cannot be handed away by a typo.
        </li>
      </ul>

      <h2 id="payment">8. Payment happens off chain, and mistakes there are unrecoverable</h2>
      <p>
        You buy a node by sending ETH to an ordinary wallet. No contract validates that transfer,
        so nothing about it can revert, and nothing about it can be undone.
      </p>
      <ul>
        <li>
          Send to the wrong address and the money is simply gone. There is no contract holding it,
          nobody who can reverse it, and no support process that can recover it. Take the payments
          address from <Link href="/docs/addresses">Addresses</Link>, never from a message.
        </li>
        <li>
          Send the wrong amount and no node is minted. The transfer is held for manual review and
          needs a person to sort out.
        </li>
        <li>
          A payment can be seen and still not minted, if the relayer is out of gas, the contract
          is paused, or the process is down. Your payment hash is the only reference for putting
          that right, so keep it.
        </li>
        <li>
          The node is minted to whichever address sent the ETH. Pay from an exchange and the node
          belongs to the exchange, permanently and irrecoverably.
        </li>
      </ul>

      <h2 id="dependency">9. Dependency on Sitowise continuing to operate</h2>
      <p>
        Withdrawal survives Sitowise disappearing. It needs no server, no signature and no
        permission, and the contract is verified on the explorer, so any node owner can call{" "}
        <code>withdraw</code> or <code>withdrawAll</code> for whatever balance they already hold
        without this site existing.
      </p>
      <p>
        Everything else stops. Only the distributor can call <code>creditBatch</code>, so nothing
        new is ever credited to any node. Only the relayer can call <code>mintFor</code>, so
        payments already sent but not yet minted would need a human who is no longer there. This
        site, the API and the dashboard are conveniences; balances, ownership and the running
        totals are on chain and readable without any of them.
      </p>

      <h2 id="chain">10. Chain and infrastructure risk</h2>
      <ul>
        <li>
          Everything runs on Robinhood Chain, chain id {CHAIN_ID}. Downtime, congestion,
          reorganisation or a change in the network affects Sitowise directly.
        </li>
        <li>
          The RPC endpoint, the explorer and this site are third-party or hosted services and can
          be unavailable.
        </li>
        <li>
          The hook depends on Uniswap v4 contracts on that chain. A problem in the PoolManager
          would affect accrual.
        </li>
        <li>
          Gas prices are outside anyone&rsquo;s control, and you pay gas for your payment and for
          every withdrawal.
        </li>
      </ul>

      <h2 id="user">11. Mistakes you can make that nobody can undo</h2>
      <ul>
        <li>
          <strong>Losing the wallet.</strong> Nodes cannot be reassigned, so losing the key loses
          the node permanently.
        </li>
        <li>
          <strong>Paying from an address you do not control.</strong> The node is minted to
          whichever address the ETH came from, and it can never be moved to you afterwards.
        </li>
        <li>
          <strong>Withdrawing to the wrong address.</strong> You choose the destination and the
          transfer is final. Nobody checks it for you and there is no reversal.
        </li>
        <li>
          <strong>Withdrawing to a contract that cannot receive ETH.</strong> The transaction
          reverts, which costs gas.
        </li>
        <li>
          <strong>Signing something else.</strong> Sitowise never asks for a seed phrase or a
          private key, never asks you to send ETH anywhere except the payments wallet printed on{" "}
          <Link href="/docs/addresses">Addresses</Link>, never asks you to pay to unlock a
          balance, and never sells nodes second-hand, because they cannot be transferred. Anyone
          offering otherwise is impersonating this project.
        </li>
      </ul>

      <h2 id="legal">12. Legal, tax and eligibility</h2>
      <p>
        Nothing on this site is financial, legal or tax advice, and nobody here is licensed to give
        any. How a node and its payouts are treated where you live is your responsibility to
        determine, and the answer may be unfavourable. Access may be restricted or unlawful in some
        jurisdictions. There is no consumer protection, no deposit insurance and no recourse if any
        of the above goes wrong.
      </p>

      <h2 id="summary">In one line</h2>
      <Callout tone="warn">
        You are paying a non-refundable {NODE_PRICE_ETH} ETH for a position whose payouts are
        currently funded at the discretion of one party, settled by unaudited code, on a chain and
        an interface neither of which you control. If that is not acceptable, do not buy a node.
      </Callout>
    </DocPage>
  );
}
