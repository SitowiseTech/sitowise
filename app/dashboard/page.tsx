import type {Metadata} from "next";
import {Dashboard} from "@/components/dashboard/Dashboard";
import {CHAIN_ID} from "@/lib/chain";

/**
 * Everything below the page frame is client side: it depends on a wallet that
 * only exists in the browser. The frame stays a server component so the header,
 * heading and metadata render without waiting for any of it.
 */

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "Connect your wallet to see the nodes it holds on Robinhood Chain, what they have accrued, and to withdraw.",
  // Nothing here is meaningful without a wallet, so there is nothing to index.
  robots: {index: false, follow: true},
};

export default function DashboardPage() {
  return (
    <div className="shell">
      {/* Plain `data-reveal` rather than the component: this stays a server
          component, and RevealRoot in the layout picks the attribute up. */}
      <header className="pt-10 sm:pt-14" data-reveal>
        <span className="mono-label">Robinhood Chain · {CHAIN_ID}</span>
        <h1 className="h2 mt-3">Dashboard</h1>
        <p className="lede mt-3 max-w-[56ch]">
          Every balance below is read from the contract. Withdraw one node or all
          of them, to any address you name.
        </p>
      </header>

      <Dashboard />
    </div>
  );
}
