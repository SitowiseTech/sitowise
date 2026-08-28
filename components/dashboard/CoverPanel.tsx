"use client";

import {useEffect, useState} from "react";
import {ArrowUpRightIcon} from "@/components/icons";
import {Reveal} from "@/components/Reveal";
import {StatusDot} from "@/components/ui/StatusDot";
import {EthAmount} from "@/components/dashboard/EthAmount";
import {getCover, type Cover} from "@/lib/apiClient";
import {addressUrl} from "@/lib/chain";

/**
 * Is the money owed to holders actually in the contract.
 *
 * The rest of the dashboard answers "what am I owed". This answers the
 * question underneath it, which nothing in the interface asked before: is
 * there anything behind that number. Both figures are read from the chain, not
 * from our database, so the panel is checkable against Blockscout by anyone
 * who does not believe it, and the link to do so is right here.
 *
 * On any failure the panel renders nothing. A cover figure is only worth
 * showing while it can be trusted, and "probably covered" is not a thing worth
 * telling somebody about their own money.
 */

export function CoverPanel({ethUsd}: {ethUsd: number | null}) {
  const [cover, setCover] = useState<Cover | null>(null);

  useEffect(() => {
    let alive = true;
    void getCover().then((value) => {
      if (alive) setCover(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!cover) return null;

  return (
    <Reveal variant="panel" className="panel flex flex-col gap-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="mono-label">Contract cover</span>
        <StatusDot
          tone={cover.covered ? "live" : "error"}
          label={cover.covered ? "Fully covered" : "Not covered"}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="mono-label">Owed to all holders</span>
          <EthAmount wei={cover.outstandingWei} ethUsd={ethUsd} size="lg" />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="mono-label">Held by the contract</span>
          <EthAmount wei={cover.balanceWei} ethUsd={ethUsd} size="lg" />
        </div>
      </div>

      <p className="text-[14px] leading-[1.55] text-muted">
        {cover.covered
          ? "Every node balance, including yours, is backed by ETH sitting in the contract right now. Both figures are read from the chain, not from our records."
          : "The contract currently holds less than it owes. Do not take our word for either number, read them yourself."}
        {cover.paused ? " Minting is paused. Withdrawals are not, and pausing cannot stop one." : ""}
      </p>

      <a
        href={addressUrl(cover.contract)}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex w-max items-center gap-1.5 font-mono text-[13px] text-ink transition-colors hover:text-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
      >
        Check it on Blockscout
        <ArrowUpRightIcon size={13} />
      </a>
    </Reveal>
  );
}
