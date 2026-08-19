"use client";

import type {ReactNode} from "react";
import {Button} from "@/components/ui/Button";
import {Callout} from "@/components/ui/Callout";
import {Skeleton} from "@/components/ui/Skeleton";
import {useWallet} from "@/components/dashboard/WalletProvider";
import {requestProviders} from "@/lib/wallet";
import {shortAddress} from "@/lib/format";

/**
 * The two screens that stand in front of the dashboard: no wallet, and a wallet
 * with no signature. One centred card frame, two sets of contents.
 *
 * There used to be a third, for a signed-in wallet holding no nodes. It is
 * gone: owning nothing is a state of the dashboard, not a substitute for it, so
 * that case now renders the real page with the contract's zeros in it.
 */

function CenteredCard({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex justify-center py-14 sm:py-20">
      <div className="panel w-full max-w-[440px] p-6 sm:p-8" data-reveal="panel">
        <h2 className="h3">{title}</h2>
        <p className="mt-2 text-[15px] leading-[1.55] text-muted">{description}</p>
        <div className="mt-6 flex flex-col gap-3">{children}</div>
      </div>
    </div>
  );
}

/** Spec 5.1 state 1. Wallets come from EIP-6963, so the list is what announced itself. */
export function ConnectScreen() {
  const {wallets, connectWallet, phase, error} = useWallet();
  const connecting = phase === "connecting";

  return (
    <CenteredCard
      title="Connect your wallet"
      description="Your nodes are held by your wallet. Connect it to see what they hold."
    >
      {wallets.length === 0 ? (
        <>
          <p className="text-[14px] leading-[1.55] text-muted">
            No wallet announced itself on this page. Install a browser wallet, or open Sitowise
            in the browser built into your wallet app.
          </p>
          <Button variant="ghost" onClick={() => requestProviders()}>
            Look again
          </Button>
        </>
      ) : (
        wallets.map((option) => (
          <button
            key={option.info.rdns}
            type="button"
            disabled={connecting}
            onClick={() => void connectWallet(option)}
            className="flex h-[56px] items-center gap-3 rounded-sharp border border-line-dark px-4 text-left text-[15px] font-semibold transition-colors hover:border-ink hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange disabled:cursor-not-allowed disabled:opacity-50"
          >
            {/* Wallet icons arrive as data URIs in the announcement; there is
                nothing for next/image to optimise and no host to allow. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={option.info.icon} alt="" width={24} height={24} className="rounded-sharp" />
            <span className="flex-1">{option.info.name}</span>
            <span className="mono-label">{connecting ? "Waiting" : "Connect"}</span>
          </button>
        ))
      )}

      {error ? <Callout tone="warn">{error}</Callout> : null}
    </CenteredCard>
  );
}

/** Spec 5.1 state 2. */
export function SignScreen() {
  const {address, signIn, phase, error, disconnect} = useWallet();

  return (
    <CenteredCard
      title="Sign to continue"
      description="One signature proves this wallet is yours. It is free and it does not move any funds."
    >
      <Button onClick={() => void signIn()} loading={phase === "signing"}>
        Sign message
      </Button>

      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="font-mono text-[13px] text-muted">
          {address ? shortAddress(address) : ""}
        </span>
        <Button variant="quiet" size="sm" onClick={() => void disconnect()}>
          Use another wallet
        </Button>
      </div>

      {error ? <Callout tone="warn">{error}</Callout> : null}
    </CenteredCard>
  );
}

/**
 * Spec 5.3: skeletons while the session and the node list resolve.
 *
 * Laid out as the same furniture the loaded page uses — account bar, balance
 * panel, three tiles, node list, activity — so the page does not rearrange
 * itself under the reader the moment the data lands.
 */
export function LoadingScreen() {
  return (
    <div className="flex flex-col gap-6 py-10">
      <div className="panel flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <Skeleton className="h-5 w-[180px]" />
        <div className="flex gap-3">
          <Skeleton className="h-9 w-[132px]" />
          <Skeleton className="h-9 w-[104px]" />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="panel flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-11 w-[260px] max-w-full" />
            <Skeleton className="h-4 w-[220px] max-w-full" />
          </div>
          <Skeleton className="h-11 w-[150px]" />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="panel flex flex-col gap-3 p-5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-32" />
            </div>
          ))}
        </div>
      </div>

      <div className="panel flex flex-col gap-4 p-5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>

      <div className="panel flex flex-col gap-3 p-5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </div>
  );
}
