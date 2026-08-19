"use client";

import {Button} from "@/components/ui/Button";
import {useWallet} from "@/components/dashboard/WalletProvider";

/**
 * Shown whenever a connected wallet reports a chain other than Robinhood Chain,
 * at every phase after connect: the switch is worth offering before the user
 * reaches a button that needs it. Reading balances works from any network, so
 * this warns and offers the switch rather than blocking the page.
 */
export function NetworkBanner() {
  const {wrongChain, switchNetwork, switchingChain} = useWallet();
  if (!wrongChain) return null;

  return (
    <div
      role="alert"
      className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-sharp border border-orange/45 bg-orange-soft px-5 py-4"
    >
      <div className="min-w-0">
        <div className="text-[15px] font-semibold text-ink">Wrong network</div>
        <p className="mt-1 text-[14px] leading-[1.5] text-muted">
          Your wallet is on another chain. Deploys and withdrawals happen on Robinhood Chain.
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={() => void switchNetwork()} loading={switchingChain}>
        Switch to Robinhood Chain
      </Button>
    </div>
  );
}
