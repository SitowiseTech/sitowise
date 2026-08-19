"use client";

import {useCallback, useEffect, useRef, useState} from "react";
import {Button} from "@/components/ui/Button";
import {Callout} from "@/components/ui/Callout";
import {Modal} from "@/components/ui/Modal";
import {Skeleton} from "@/components/ui/Skeleton";
import {useToast} from "@/components/ui/Toast";
import {ErrorPanel} from "@/components/dashboard/ErrorPanel";
import {TextField} from "@/components/dashboard/TextField";
import {WithdrawSummary, type WithdrawResult} from "@/components/dashboard/WithdrawSummary";
import {useWallet} from "@/components/dashboard/WalletProvider";
import type {WithdrawalApplied} from "@/components/dashboard/useDashboardData";
import {FACTORY_ADDRESS, txUrl} from "@/lib/chain";
import {
  describeFactoryError,
  encodeWithdraw,
  encodeWithdrawAll,
  factoryConfigured,
  readNodeBalance,
  readOwnerBalance,
  waitForReceipt,
  withdrawalsFromReceipt,
} from "@/lib/factory";
import {formatEth, isAddress, nodeLabel, shortAddress} from "@/lib/format";
import {ensureChain, sendTransaction} from "@/lib/wallet";

/**
 * Taking money out.
 *
 * This is the user's own wallet calling the contract directly: `withdraw(id, to)`
 * for one node, `withdrawAll(to)` for the lot. No server, no signature, nothing
 * to authorise. The only thing that can stop it is the contract itself.
 *
 * There is deliberately no amount field. `withdraw` sends the node's entire
 * balance or reverts; it takes no amount at all. An input box and a MAX button
 * would be a control over something the chain does not let anyone control, and
 * a partial figure typed into it would be quietly ignored by the transaction it
 * appeared to configure.
 *
 * The balance shown is read from the contract when the modal opens, not carried
 * in from the ledger. What a node holds is a fact about the contract's storage,
 * and a number from anywhere else is a guess about it. If that read fails, the
 * modal says so and refuses to send rather than showing a figure it cannot
 * stand behind.
 *
 * The destination stays editable because the contract genuinely accepts any
 * recipient. It defaults to the connected wallet and warns when it is changed.
 */

/**
 * The two ids a node has. No balance: the modal reads that from the contract,
 * and carrying a second figure alongside would invite something to render it.
 */
export type WithdrawTarget = {
  /** Ledger row id, for updating the table in place. */
  nodeId: number;
  /** Chain node id, which is what the contract call takes. */
  chainNodeId: bigint;
};

export type WithdrawMode = "single" | "all";

export type WithdrawModalProps = {
  open: boolean;
  /** `all` sweeps every node the wallet owns in one transaction. */
  mode: WithdrawMode;
  targets: WithdrawTarget[];
  onClose: () => void;
  onWithdrawn: (applied: WithdrawalApplied[]) => void;
};

type Phase = "form" | "running" | "done";

export function WithdrawModal({open, mode, targets, onClose, onWithdrawn}: WithdrawModalProps) {
  const {wallet, address} = useWallet();
  const toast = useToast();

  const single = mode === "single" ? (targets[0] ?? null) : null;

  const [phase, setPhase] = useState<Phase>("form");
  const [destination, setDestination] = useState("");
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingHash, setPendingHash] = useState<`0x${string}` | null>(null);
  const [results, setResults] = useState<WithdrawResult[]>([]);

  /** Contract balance. `null` means "not known", never "zero". */
  const [balance, setBalance] = useState<bigint | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  // Guards the balance read so a slow answer for a node the user has closed
  // cannot land in the modal that replaced it.
  const gen = useRef(0);

  const loadBalance = useCallback(async () => {
    if (!address) return;
    const mine = ++gen.current;

    if (!factoryConfigured()) {
      setBalance(null);
      setBalanceError("This deployment has no factory contract configured yet.");
      return;
    }

    setReading(true);
    setBalanceError(null);
    try {
      // One node reads that node. "All" reads the wallet's combined balance,
      // which is the same figure `withdrawAll` will move.
      const value = single
        ? await readNodeBalance(single.chainNodeId)
        : await readOwnerBalance(address);
      if (gen.current !== mine) return;
      setBalance(value);
    } catch (err) {
      if (gen.current !== mine) return;
      setBalance(null);
      setBalanceError(describeFactoryError(err));
    } finally {
      if (gen.current === mine) setReading(false);
    }
  }, [address, single]);

  useEffect(() => {
    if (!open) {
      gen.current++;
      return;
    }
    setPhase("form");
    setDestination(address ?? "");
    setDestinationError(null);
    setError(null);
    setPendingHash(null);
    setResults([]);
    setBalance(null);
    void loadBalance();
  }, [open, address, loadBalance]);

  const submit = useCallback(async () => {
    if (!wallet || !address) return;
    if (!factoryConfigured()) {
      setError("This deployment has no factory contract configured yet.");
      return;
    }

    const to = destination.trim();
    if (!isAddress(to)) {
      setDestinationError("Enter a valid address.");
      return;
    }
    setDestinationError(null);
    setError(null);
    setPhase("running");

    try {
      await ensureChain(wallet.provider);

      const data = single
        ? encodeWithdraw({nodeId: single.chainNodeId, to})
        : encodeWithdrawAll({to});

      const hash = await sendTransaction(wallet.provider, {
        from: address,
        to: FACTORY_ADDRESS,
        data,
      });
      setPendingHash(hash);

      const receipt = await waitForReceipt(hash);

      // What moved is read out of the contract's own Withdrawn events, not out
      // of the balance shown a moment ago: a credit landing between the read
      // and the transaction is paid out too, and the receipt is the only place
      // that says so.
      const events = withdrawalsFromReceipt(receipt);
      if (events.length === 0) {
        setPhase("form");
        setError(
          "The transaction confirmed but the contract reported no withdrawal. Nothing was moved.",
        );
        void loadBalance();
        return;
      }

      const byChainId = new Map(targets.map((target) => [target.chainNodeId, target.nodeId]));
      const applied: WithdrawalApplied[] = [];
      for (const event of events) {
        const nodeId = byChainId.get(event.nodeId);
        // A node the table does not know about is still reported below; there
        // is simply no row to decrement for it.
        if (nodeId !== undefined) applied.push({nodeId, amountWei: event.amountWei});
      }

      const moved = events.reduce((sum, event) => sum + event.amountWei, 0n);
      setResults(events.map((event) => ({chainNodeId: event.nodeId, hash, amountWei: event.amountWei})));
      setBalance(0n);
      onWithdrawn(applied);
      setPhase("done");

      toast.push({
        title: "Withdrawal sent",
        body: `${formatEth(moved, 6)} ETH to ${shortAddress(to)}`,
        tone: "success",
        href: txUrl(hash),
        hrefLabel: "View transaction",
      });
    } catch (err) {
      setError(describeFactoryError(err));
      setPhase("form");
      // The balance on screen was read before a transaction that may or may not
      // have touched it, so re-read rather than leaving it there.
      void loadBalance();
    }
  }, [wallet, address, destination, single, targets, onWithdrawn, toast, loadBalance]);

  const running = phase === "running";
  const nothingToSend = balance !== null && balance === 0n;

  const title =
    phase === "done"
      ? "Withdrawal sent"
      : single
        ? `Withdraw from NODE ${nodeLabel(single.chainNodeId.toString())}`
        : "Withdraw everything";

  const foreignDestination =
    isAddress(destination.trim()) &&
    address !== null &&
    destination.trim().toLowerCase() !== address.toLowerCase();

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!running}
      title={title}
      description={
        phase === "done"
          ? undefined
          : single
            ? "This sends the node's whole balance. The contract does not do partial withdrawals."
            : "This empties every node this wallet holds, in one transaction."
      }
      footer={
        phase === "done" ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={running}>
              Cancel
            </Button>
            <Button
              onClick={() => void submit()}
              loading={running}
              disabled={balance === null || nothingToSend}
            >
              {balance === null || nothingToSend
                ? "Withdraw"
                : `Withdraw ${formatEth(balance, 6)} ETH`}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-5">
        {phase === "done" ? (
          <WithdrawSummary results={results} destination={destination.trim()} />
        ) : (
          <>
            {balanceError ? (
              <ErrorPanel
                title="Could not read the balance"
                message={`${balanceError} Balances are only shown when they come from the contract, so nothing is shown here instead.`}
                onRetry={() => void loadBalance()}
                retrying={reading}
              />
            ) : (
              <dl className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="mono-label">{single ? "Node balance" : "Total balance"}</dt>
                  <dd className="tabular text-[15px]">
                    {balance === null ? (
                      <Skeleton className="h-4 w-28" />
                    ) : (
                      `${formatEth(balance, 6)} ETH`
                    )}
                  </dd>
                </div>
                {single ? null : (
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="mono-label">Nodes</dt>
                    <dd className="tabular text-[15px]">{targets.length}</dd>
                  </div>
                )}
              </dl>
            )}

            <TextField
              id="withdraw-destination"
              label="Destination address"
              value={destination}
              onChange={(next) => {
                setDestination(next);
                setDestinationError(null);
              }}
              disabled={running}
              error={destinationError}
              hint="Defaults to the wallet you are signed in with."
              autoFocus
            />

            <p className="text-[14px] leading-[1.55] text-muted">
              Sent as native ETH on Robinhood Chain. You pay the network fee.
            </p>

            {nothingToSend ? (
              <Callout>
                {single
                  ? "This node has nothing in it. There is nothing to withdraw."
                  : "These nodes have nothing in them. There is nothing to withdraw."}
              </Callout>
            ) : null}

            {foreignDestination ? (
              <Callout tone="warn">
                This is not the wallet you are signed in with. Check the address before confirming.
              </Callout>
            ) : null}

            {running ? (
              <Callout>
                {pendingHash
                  ? "Waiting for confirmation. Keep this open until the transaction lands."
                  : "Confirm the transaction in your wallet."}
              </Callout>
            ) : null}

            {pendingHash ? (
              <a
                href={txUrl(pendingHash)}
                target="_blank"
                rel="noreferrer noopener"
                className="mono-label text-orange hover:underline"
              >
                View transaction
              </a>
            ) : null}

            {error ? (
              <Callout tone="warn" title="Withdrawal did not go through">
                {error}
              </Callout>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
