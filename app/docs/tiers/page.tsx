import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocPage, DocTable} from "@/components/docs/DocPage";
import {Callout} from "@/components/ui/Callout";

export const metadata: Metadata = {
  title: "Tiers",
  description:
    "What each node tier costs, how many one wallet may hold, the SITOWISE holding that unlocks the gated tiers, and exactly which of those rules the contract enforces.",
};

export default function TiersPage() {
  return (
    <DocPage
      href="/docs/tiers"
      title="Tiers"
      lede={
        <>
          A tier is the price a node was bought at. The price decides how many of
          them one wallet may hold, how fast the node accrues, and whether you
          have to hold SITOWISE to buy one at all.
        </>
      }
    >
      <h2 id="tiers">The tiers</h2>
      <DocTable>
        <thead>
          <tr>
            <th>Tier</th>
            <th>Price</th>
            <th>Per wallet</th>
            <th>Must hold</th>
            <th>Accrual</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Base</td>
            <td>0.02 ETH</td>
            <td>50</td>
            <td>Nothing</td>
            <td>Base rate</td>
          </tr>
          <tr>
            <td>Plus</td>
            <td>0.04 ETH</td>
            <td>15</td>
            <td>1,000,000 SITOWISE</td>
            <td>2.4x base</td>
          </tr>
          <tr>
            <td>Prime</td>
            <td>0.10 ETH</td>
            <td>5</td>
            <td>3,000,000 SITOWISE</td>
            <td>7.5x base</td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        Prices are fixed in ETH, not in dollars. A payment mints only on an exact
        amount match, so a price that moved with an exchange rate would mean the
        amount you have to send is never quite the amount you were quoted.
      </p>

      <h2 id="buying">Buying one</h2>
      <p>
        Nothing changes about how a purchase works: you send a plain transfer to
        the payments wallet and the tier is decided by the exact amount you sent.
        There is one payments wallet for every tier. Sending 0.04 buys a Plus
        node, sending 0.10 buys a Prime one, and an amount matching no tier is
        parked for a human rather than minted.
      </p>

      <Callout tone="warn" title="Eligibility is read when the payment is processed">
        The dashboard checks your balance when it draws the screen, but the check
        that counts happens when the watcher picks your payment up. If the
        SITOWISE is not in the paying wallet at that moment, the payment is
        parked instead of minted and has to be refunded by hand. Do not move the
        tokens out between sending the ETH and the node appearing.
      </Callout>

      <h2 id="enforcement">What enforces what</h2>
      <p>
        This is the part worth reading twice, because it is a real difference
        from the per-wallet cap.
      </p>
      <p>
        The contract knows <strong>one</strong> limit, <code>maxPerWallet</code>,
        and it is the ceiling across every tier together. It is enforced in{" "}
        <code>mintFor</code> and neither we nor anyone else can mint past it:
      </p>
      <CodeBlock label="SitowiseFactory.mintFor">{`if (_owned[to].length >= maxPerWallet) revert WalletLimit();`}</CodeBlock>
      <p>
        The <strong>per-tier</strong> allowances and the SITOWISE thresholds are
        not in the contract. The contract has no idea tiers exist. Those rules
        are applied by us, off chain, before a node is minted, and a payment that
        fails one of them is parked and refunded rather than turned into a node.
      </p>
      <p>
        So: if you want a guarantee that does not depend on us, the one you have
        is <code>maxPerWallet</code>. The rest is our bookkeeping, and you should
        read it as our bookkeeping. See{" "}
        <Link href="/docs/limits">Limits</Link> for the cap itself.
      </p>

      <h2 id="accrual">Accrual</h2>
      <p>
        A tier accrues at a multiple of the base per-credit range. Everything on{" "}
        <Link href="/docs/accrual">Accrual</Link> still applies: the amount is
        drawn per node inside a range, the timer is drawn per node, and during
        the launch period the money is funded by Sitowise rather than by trading
        volume.
      </p>
      <Callout tone="warn" title="A multiple is not a yield">
        2.4x base means the range a Plus node draws from is 2.4 times the base
        range. It is not an interest rate, not an APR, and not a payback period.
        The rate is set by us, it is funded by us today, and it can be reduced or
        stopped. Nothing here is a promise about what a node will return.
      </Callout>

      <h2 id="existing">Nodes bought before tiers</h2>
      <p>
        Every node sold before this page existed is a Base node, at the price it
        was bought for, and nothing about it changed. A tier is recorded against
        a node when it is minted and is never recalculated afterwards, so
        changing a tier&rsquo;s price later does not reprice or reclassify a
        single node already sold.
      </p>
    </DocPage>
  );
}
