"use client";

import {useEffect, useState} from "react";
import {Button} from "@/components/ui/Button";
import {Panel} from "@/components/ui/Panel";

/**
 * Tier settings.
 *
 * Every field here changes what a buyer is allowed to send and what they get
 * for it, so the form shows the effect of a value beside the value: wei next to
 * the ETH it is, basis points next to the multiple of the base rate they mean,
 * and the sum of the allowances next to the contract cap that has to cover it.
 *
 * Amounts are entered and stored in wei. A field taking decimal ETH would put a
 * float between the operator and a price the payment pipeline matches exactly.
 */

type Tier = {
  id: string;
  label: string;
  priceWei: string;
  maxPerWallet: number;
  holdingWei: string;
  payoutBps: number;
  onSale: boolean;
};

type Payload = {
  tiers: Tier[];
  totalAllowance: number;
  problems: string[];
  warning?: string;
};

function eth(wei: string): string {
  try {
    const v = BigInt(wei);
    const whole = v / 10n ** 18n;
    const frac = (v % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
    return frac === "" ? whole.toString() : `${whole}.${frac}`;
  } catch {
    return "?";
  }
}

function tokens(wei: string): string {
  try {
    const whole = BigInt(wei) / 10n ** 18n;
    return whole.toLocaleString("en-US");
  } catch {
    return "?";
  }
}

function rate(bps: number): string {
  const x = bps / 10_000;
  return `${Number.isInteger(x) ? x : x.toFixed(2)}x base`;
}

export function TiersForm({contractCap}: {contractCap: number | null}) {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      const res = await fetch("/api/admin/tiers");
      if (!res.ok) throw new Error();
      setData((await res.json()) as Payload);
    } catch {
      setError("Could not read the tier settings.");
    }
  }

  async function save(id: string, field: string, value: string) {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch("/api/admin/tiers", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({id, field, value}),
      });
      const payload = (await res.json().catch(() => ({}))) as Payload & {error?: string};
      if (!res.ok) {
        setError(payload.error ?? "That did not save.");
        return;
      }
      setData(payload);
      setSaved(payload.warning ? null : `${id}.${field} saved.`);
      if (payload.warning) setError(payload.warning);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/tiers", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({reset: true}),
      });
      if (res.ok) setData((await res.json()) as Payload);
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <Panel label="Tiers" padding="lg">
        <p className="text-[14px] text-muted">{error ?? "Reading…"}</p>
      </Panel>
    );
  }

  const overCap = contractCap !== null && data.totalAllowance > contractCap;

  return (
    <Panel label="Tiers" padding="lg">
      <div className="flex flex-col gap-5">
        <p className="text-[14px] leading-[1.55] text-muted">
          A tier is identified by its exact price, so two tiers must never share one. Amounts are
          in wei. The gated tiers are unavailable until the token address is published.
        </p>

        {overCap ? (
          <p className="text-[13px] text-red">
            The tier allowances add up to {data.totalAllowance} nodes per wallet, but the contract
            caps a wallet at {contractCap}. Nobody can fill every tier until{" "}
            <code>setMaxPerWallet</code> is at least {data.totalAllowance}.
          </p>
        ) : null}

        {data.problems.length > 0 ? (
          <p className="text-[13px] text-red">{data.problems.join(" ")}</p>
        ) : null}
        {error ? <p className="text-[13px] text-red">{error}</p> : null}
        {saved ? <p className="text-[13px] text-ink">{saved}</p> : null}

        {data.tiers.map((tier) => (
          <div key={tier.id} className="flex flex-col gap-3 border-t border-line pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="text-[15px] font-medium text-ink">{tier.label}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void save(tier.id, "on_sale", tier.onSale ? "false" : "true")}
              >
                {tier.onSale ? "Close to new buyers" : "Open for sale"}
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={`Price · ${eth(tier.priceWei)} ETH`}
                value={tier.priceWei}
                busy={busy}
                onSave={(v) => void save(tier.id, "price_wei", v)}
              />
              <Field
                label="Nodes per wallet"
                value={String(tier.maxPerWallet)}
                busy={busy}
                onSave={(v) => void save(tier.id, "max_per_wallet", v)}
              />
              <Field
                label={`Must hold · ${tokens(tier.holdingWei)} SITOWISE`}
                value={tier.holdingWei}
                busy={busy}
                onSave={(v) => void save(tier.id, "holding_wei", v)}
              />
              <Field
                label={`Accrual · ${rate(tier.payoutBps)}`}
                value={String(tier.payoutBps)}
                busy={busy}
                onSave={(v) => void save(tier.id, "payout_bps", v)}
              />
            </div>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button variant="ghost" onClick={() => void reset()} disabled={busy}>
            Reset tiers to defaults
          </Button>
          <span className="mono-label">
            Allowances total {data.totalAllowance}
            {contractCap === null ? "" : ` · contract cap ${contractCap}`}
          </span>
        </div>
      </div>
    </Panel>
  );
}

function Field({
  label,
  value,
  busy,
  onSave,
}: {
  label: string;
  value: string;
  busy: boolean;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // Re-sync when the server hands back a different value than was typed.
  useEffect(() => setDraft(value), [value]);

  const dirty = draft.trim() !== value;

  return (
    <label className="flex flex-col gap-1.5">
      <span className="mono-label">{label}</span>
      <span className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          className="field field-mono min-w-0 flex-1"
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !dirty}
          onClick={() => onSave(draft.trim())}
        >
          Save
        </Button>
      </span>
    </label>
  );
}
