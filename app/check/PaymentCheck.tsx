"use client";

import {useState, type FormEvent} from "react";
import Link from "next/link";
import {Button} from "@/components/ui/Button";
import {Panel} from "@/components/ui/Panel";
import {formatEth, nodeLabel, shortAddress} from "@/lib/format";
import {TIER_LABEL} from "@/lib/tierLabels";

/**
 * Where is my node.
 *
 * Every one of these was answered by hand this week: somebody paid, nothing
 * appeared, and the only way to find out why was to send us the transaction
 * hash and wait for a person to look. The answer was never secret. It was a
 * row in a table, and there was no way for the person who paid to read it.
 *
 * So this reads it for them, and does not stop at reading. If the payment is
 * not recorded at all, which is exactly the failure that cost us two days, the
 * lookup records it: the same chain-verified path a discovered payment takes.
 * Checking and fixing are the same button, because a page that tells somebody
 * their payment is missing and then leaves them to write in has not helped.
 */

type Result = {
  status: string;
  tier: string | null;
  nodeChainId: string | null;
  from: string | null;
  amountWei: string | null;
  reason: string | null;
  known: boolean;
};

const HASH = /^0x[0-9a-fA-F]{64}$/;

export function PaymentCheck() {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const txHash = value.trim();
    setResult(null);
    setError(null);

    if (!HASH.test(txHash)) {
      setError("That is not a transaction hash. It starts with 0x and is 66 characters long.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/payments/claim", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({txHash}),
      });
      const data = (await res.json().catch(() => ({}))) as Result & {error?: string};
      if (!res.ok) {
        setError(data.error ?? "That could not be checked right now. Try again in a moment.");
        return;
      }
      setResult(data);
    } catch {
      setError("Could not reach Sitowise. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label htmlFor="tx" className="mono-label">
          Payment transaction hash
        </label>
        <input
          id="tx"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          placeholder="0x…"
          className={`field field-mono ${error ? "invalid" : ""}`}
        />
        <div>
          <Button type="submit" loading={busy} disabled={value.trim() === ""}>
            Check it
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-[14px] text-red">
            {error}
          </p>
        ) : null}
      </form>

      {result ? <Answer result={result} /> : null}
    </div>
  );
}

function Answer({result}: {result: Result}) {
  const tier = result.tier ? (TIER_LABEL[result.tier] ?? null) : null;
  const amount = result.amountWei ? `${formatEth(BigInt(result.amountWei), 6)} ETH` : null;

  return (
    <Panel label="Answer" padding="lg">
      <div className="flex flex-col gap-4">
        {result.status === "minted" && result.nodeChainId ? (
          <>
            <p className="text-[17px] leading-[1.5] text-ink">
              Your node exists. It is{" "}
              <Link
                href={`/node/${result.nodeChainId}`}
                className="text-orange underline underline-offset-2"
              >
                node {nodeLabel(result.nodeChainId)}
              </Link>
              .
            </p>
            <p className="text-[14px] leading-[1.6] text-muted">
              Open the dashboard with the wallet you paid from and it will be there. The node
              page above needs no wallet at all.
            </p>
          </>
        ) : result.status === "manual_review" ? (
          <>
            <p className="text-[17px] leading-[1.5] text-ink">
              This payment is held, and it needs a person rather than more waiting.
            </p>
            {result.reason ? (
              <p className="rounded-sharp border border-line-dark bg-panel p-3.5 font-mono text-[13px] leading-[1.6] text-ink">
                {result.reason}
              </p>
            ) : null}
            <p className="text-[14px] leading-[1.6] text-muted">
              Most of these are a wrong amount, or a tier whose SITOWISE requirement was not met
              by the paying wallet at the moment the payment was processed. Nothing is lost. Send
              us this hash and we will either release the node or refund you.
            </p>
          </>
        ) : result.status === "refunded" ? (
          <p className="text-[17px] leading-[1.5] text-ink">
            This payment was refunded, so no node was created for it.
          </p>
        ) : (
          <>
            <p className="text-[17px] leading-[1.5] text-ink">
              {result.known
                ? "This payment is queued. Your node is minted within a minute or two."
                : "Found it. We had not recorded this payment, and it is queued now."}
            </p>
            <p className="text-[14px] leading-[1.6] text-muted">
              Check again shortly and this page will give you the node number.
            </p>
          </>
        )}

        <dl className="grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <dt className="mono-label">Paid from</dt>
            <dd className="font-mono text-[13px] text-muted">
              {result.from ? (
                <Link
                  href={`/holder/${result.from}`}
                  className="text-ink transition-colors hover:text-orange"
                >
                  {shortAddress(result.from)}
                </Link>
              ) : (
                "Unknown"
              )}
            </dd>
          </div>
          <div className="flex flex-col gap-1.5">
            <dt className="mono-label">Amount</dt>
            <dd className="tabular text-[13.5px] text-muted">{amount ?? "Unknown"}</dd>
          </div>
          <div className="flex flex-col gap-1.5">
            <dt className="mono-label">Tier</dt>
            <dd className="text-[13.5px] text-muted">{tier ?? "Not a tier price"}</dd>
          </div>
        </dl>
      </div>
    </Panel>
  );
}
