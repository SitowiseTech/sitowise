"use client";

import {useCallback, useEffect, useRef, useState} from "react";
import {Button} from "@/components/ui/Button";
import {Callout} from "@/components/ui/Callout";
import {CopyButton} from "@/components/ui/CopyButton";
import {Modal} from "@/components/ui/Modal";
import {Skeleton} from "@/components/ui/Skeleton";
import {TierPicker} from "@/components/dashboard/TierPicker";
import {useToast} from "@/components/ui/Toast";
import {useWallet} from "@/components/dashboard/WalletProvider";
import {addressUrl, txUrl} from "@/lib/chain";
import {
  getDeployQuote,
  getMe,
  syncNode,
  type DeployQuote,
  type Me,
  type QuotedTier,
} from "@/lib/apiClient";
import {describeFactoryError, factoryConfigured, readFactoryConfig, waitForReceipt} from "@/lib/factory";
import {formatEth, nodeLabel, shortAddress} from "@/lib/format";
import {ensureChain, sendTransaction} from "@/lib/wallet";
import {FUNDING_NOTE} from "@/lib/site";

/**
 * Buying a node.
 *
 * There is no contract call here. A node is bought by sending exactly the
 * quoted price, as a plain ETH transfer, to the payments wallet. A watcher sees
 * that transfer and the relayer mints the node against its hash and pays that
 * gas, so the node appears a short while after the payment confirms rather than
 * in the same transaction.
 *
 * Three consequences the flow is built around:
 *
 *   1. The node is minted to whichever address sent the ETH. An exchange
 *      withdrawal sends from the exchange's wallet, so the node would be minted
 *      to the exchange and nobody could ever withdraw from it. That warning is
 *      the first thing in the modal, not a footnote.
 *   2. The price is the server's (NODE_PRICE_WEI), because the contract never
 *      sees the payment and has no price to read. It is fetched when the modal
 *      opens and again immediately before the transfer, so a price change
 *      cannot turn into a payment that no longer matches.
 *   3. "Paid" and "minted" are separate moments, so the modal has a state for
 *      the gap. A node that has not appeared yet is queued, not failed, and the
 *      payment hash is on screen throughout.
 */

type Phase =
  /** Fetching the quote. */
  | "loading"
  /** Quote in hand, waiting for the user. */
  | "ready"
  /** Wallet prompt is open. */
  | "sending"
  /** Transfer broadcast, waiting for it to confirm. */
  | "confirming"
  /** Transfer confirmed, waiting for the relayer to mint. */
  | "waiting"
  /** The node exists. */
  | "done"
  /** Paid and confirmed, but the node has not appeared within the wait. */
  | "queued";

/** How often to ask whether the node has appeared. */
const POLL_MS = 5_000;

/** How long to keep asking before calling it queued rather than late. */
const WAIT_MS = 240_000;

const BUSY: ReadonlySet<Phase> = new Set<Phase>(["loading", "sending", "confirming"]);

export type DeployModalProps = {
  open: boolean;
  onClose: () => void;
  /** Called once the node exists on chain, so the dashboard can reload. */
  onDeployed: () => void;
};

/** Every chain node id this wallet is known to hold, ledger and contract alike. */
function ownedIds(me: Me): Set<string> {
  const ids = new Set(me.nodes.map((node) => node.chainNodeId.toString()));
  for (const id of me.unsyncedChainNodeIds ?? []) ids.add(id.toString());
  return ids;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function DeployModal({open, onClose, onDeployed}: DeployModalProps) {
  const {wallet, address} = useWallet();
  const toast = useToast();

  const [phase, setPhase] = useState<Phase>("loading");
  const [quote, setQuote] = useState<DeployQuote | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [mintedId, setMintedId] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tierId, setTierId] = useState<QuotedTier["id"]>("base");

  // Bumped on every open and on close, so a poll loop from a previous run can
  // never write into a modal the user has already moved on from.
  const run = useRef(0);

  const loadQuote = useCallback(async () => {
    const mine = run.current;
    setPhase("loading");
    setError(null);
    try {
      const next = await getDeployQuote(address);
      if (run.current !== mine) return;
      setQuote(next);
      setPhase("ready");
    } catch (err) {
      if (run.current !== mine) return;
      setQuote(null);
      setPhase("ready");
      setError(err instanceof Error ? err.message : "Could not read the node price.");
    }
  }, []);

  useEffect(() => {
    run.current++;
    if (!open) return;

    setHash(null);
    setMintedId(null);
    setNote(null);
    void loadQuote();
  }, [open, loadQuote]);

  /**
   * Poll until the wallet holds a node it did not hold before the payment.
   *
   * `/api/me` is the right thing to watch because it answers from both sides:
   * the ledger, and `nodesOf()` on the contract for anything the ledger has not
   * recorded yet. A node that has been minted but not yet synced still shows up.
   */
  const awaitNode = useCallback(
    async (before: Set<string>, mine: number): Promise<bigint | null> => {
      const deadline = Date.now() + WAIT_MS;
      while (Date.now() < deadline) {
        await sleep(POLL_MS);
        if (run.current !== mine) return null;

        let me: Me | null = null;
        try {
          me = await getMe();
        } catch {
          // A dropped poll is not an answer. Keep waiting.
          continue;
        }
        if (run.current !== mine) return null;
        if (!me) continue;

        for (const id of ownedIds(me)) {
          if (!before.has(id)) return BigInt(id);
        }
      }
      return null;
    },
    [],
  );

  const pay = useCallback(async () => {
    if (!wallet || !address) return;
    setError(null);
    setNote(null);
    setPhase("sending");
    const mine = run.current;
    // Local, not the `hash` state: this closure was built before the state
    // existed, and the failure path below has to know whether money already
    // left the wallet.
    let broadcast: `0x${string}` | null = null;

    try {
      await ensureChain(wallet.provider);

      // Re-read rather than trusting what the modal opened with: a price change
      // while the modal sat open would otherwise produce a transfer that has to
      // be sorted out by hand.
      const fresh = await getDeployQuote(address);
      if (run.current !== mine) return;
      setQuote(fresh);

      // Minting is the relayer's job, and a paused contract refuses it. Taking
      // the money first and finding that out afterwards is not acceptable, so
      // the check happens before the wallet is ever opened.
      if (factoryConfigured()) {
        const config = await readFactoryConfig();
        if (run.current !== mine) return;
        if (config.paused) {
          setPhase("ready");
          setError("Deploys are paused right now, so a payment could not be minted. Try again later.");
          return;
        }
      }

      // The baseline for "a node appeared" has to be taken before the payment,
      // or a node bought in another tab would be mistaken for this one.
      const before = ownedIds((await getMe()) ?? {address, nodes: [], unsyncedChainNodeIds: []});
      if (run.current !== mine) return;

      // The tier is chosen by the exact amount sent, so the price has to come
      // from the freshly read quote rather than from what the modal opened
      // with. A stale amount would either buy the wrong tier or match none.
      const chosen = fresh.tiers.find((t) => t.id === tierId) ?? null;
      if (!chosen) {
        setPhase("ready");
        setError("That tier is no longer available. Reopen the deploy window and pick again.");
        return;
      }
      if (chosen.eligible === false) {
        setPhase("ready");
        setError(chosen.blockedReason ?? "This wallet cannot buy that tier right now.");
        return;
      }

      const txHash = await sendTransaction(wallet.provider, {
        from: address,
        to: fresh.paymentAddress,
        value: chosen.priceWei,
      });
      if (run.current !== mine) return;
      broadcast = txHash;
      setHash(txHash);
      setPhase("confirming");

      await waitForReceipt(txHash);
      if (run.current !== mine) return;
      setPhase("waiting");

      const id = await awaitNode(before, mine);
      if (run.current !== mine) return;

      if (id === null) {
        setPhase("queued");
        onDeployed();
        return;
      }

      setMintedId(id);
      try {
        await syncNode({nodeId: id});
      } catch {
        // The node is already on chain and the reconciler picks up anything
        // sync missed, so this is a delay in the ledger, not a lost node.
        setNote("Your node is on chain. It will appear in the list here shortly.");
      }

      if (run.current !== mine) return;
      setPhase("done");
      onDeployed();
      toast.push({
        title: `Node ${nodeLabel(id.toString())} deployed`,
        tone: "success",
        href: txUrl(txHash),
        hrefLabel: "View payment",
      });
    } catch (err) {
      if (run.current !== mine) return;
      // Anything thrown after the transfer landed would strand the user on a
      // failure screen for money that is already paid, so once there is a hash
      // the flow reports queued instead.
      setError(describeFactoryError(err));
      setPhase(broadcast ? "queued" : "ready");
    }
  }, [wallet, address, awaitNode, onDeployed, toast, tierId]);

  const busy = BUSY.has(phase);
  const tiers = quote?.tiers ?? [];
  const selected = tiers.find((t) => t.id === tierId) ?? null;
  const price = selected === null ? null : `${formatEth(selected.priceWei, 6)} ETH`;
  const blocked = selected?.eligible === false;

  const title =
    phase === "done"
      ? "Node deployed"
      : phase === "queued"
        ? "Payment sent"
        : "Deploy a node";

  const description =
    phase === "done"
      ? "It is registered to your wallet on Robinhood Chain."
      : phase === "queued"
        ? "Your payment is confirmed. The node is minted for you once it is picked up."
        : "You send the price to the payments wallet as a plain transfer. Your node is minted to the address you send from.";

  const footer =
    phase === "done" || phase === "queued" ? (
      <Button onClick={onClose}>Done</Button>
    ) : (
      <>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {phase === "waiting" ? "Close" : "Cancel"}
        </Button>
        {phase === "waiting" ? null : (
          <Button
            onClick={() => void pay()}
            loading={busy}
            disabled={quote === null || phase === "loading" || blocked}
          >
            {price === null ? "Send payment" : `Send ${price}`}
          </Button>
        )}
      </>
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title={title}
      description={description}
      footer={footer}
    >
      <div className="flex flex-col gap-4">
        {phase === "done" || phase === "queued" ? null : (
          <Callout tone="warn" title="Pay from a wallet you control">
            The node is minted to the address the ETH comes from. If you pay from an exchange, it
            is minted to the exchange&rsquo;s address, which means you cannot withdraw from it and
            it cannot be moved to you. Send from this wallet, never from an exchange withdrawal.
          </Callout>
        )}

        {phase === "done" || phase === "queued" ? null : (
          <TierPicker
            tiers={tiers}
            selected={tierId}
            onSelect={setTierId}
            holdingWei={quote?.holdingWei ?? null}
            disabled={busy}
          />
        )}

        <dl className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="mono-label">Amount</dt>
            <dd className="tabular text-[15px]">
              {price === null ? <Skeleton className="h-4 w-24" /> : price}
            </dd>
          </div>

          <div className="flex items-baseline justify-between gap-4">
            <dt className="mono-label">To</dt>
            <dd className="flex min-w-0 items-center gap-2">
              {quote === null ? (
                <Skeleton className="h-4 w-32" />
              ) : (
                <>
                  <a
                    href={addressUrl(quote.paymentAddress)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-mono text-[13px] text-ink transition-colors hover:text-orange"
                  >
                    {shortAddress(quote.paymentAddress)}
                  </a>
                  <CopyButton value={quote.paymentAddress} label="Copy payment address" />
                </>
              )}
            </dd>
          </div>

          <div className="flex items-baseline justify-between gap-4">
            <dt className="mono-label">Network</dt>
            <dd className="text-[15px]">Robinhood Chain</dd>
          </div>

          {mintedId !== null ? (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="mono-label">Node</dt>
              <dd className="font-mono text-[14px]">NODE {nodeLabel(mintedId.toString())}</dd>
            </div>
          ) : null}
        </dl>

        {phase === "done" || phase === "queued" ? null : (
          <p className="text-[14px] leading-[1.55] text-muted">
            The amount has to be exact. A transfer for anything else is held for manual review
            instead of minting a node. You also pay the network fee. {FUNDING_NOTE}
          </p>
        )}

        {phase === "confirming" ? (
          <Callout>Waiting for your payment to confirm. Keep this open until it lands.</Callout>
        ) : null}

        {phase === "waiting" ? (
          <Callout title="Waiting for your node">
            Your payment is confirmed. The node is minted for you and usually appears within a
            minute. You can close this window; it will show up in your list.
          </Callout>
        ) : null}

        {phase === "queued" ? (
          <Callout title="Your node is queued">
            The payment landed but the node has not appeared yet. Nothing is lost: it is minted
            against this transaction. Keep the hash below. If the amount was not exact, it is held
            for review and sorted out by hand.
          </Callout>
        ) : null}

        {note ? <Callout>{note}</Callout> : null}

        {hash ? (
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={txUrl(hash)}
              target="_blank"
              rel="noreferrer noopener"
              className="mono-label text-orange hover:underline"
            >
              View payment
            </a>
            <span className="font-mono text-[13px] break-all text-muted">
              {shortAddress(hash, 10, 8)}
            </span>
            <CopyButton value={hash} label="Copy payment hash" />
          </div>
        ) : null}

        {error ? (
          <Callout tone="warn" title={hash ? "The rest did not finish" : "Payment did not go through"}>
            {error}
          </Callout>
        ) : null}
      </div>
    </Modal>
  );
}
