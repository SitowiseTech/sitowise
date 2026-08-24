"use client";

import {useRouter} from "next/navigation";
import {useState, type FormEvent} from "react";
import {Button} from "@/components/ui/Button";
import {useToast} from "@/components/ui/Toast";
import {formatEth, parseEth} from "@/lib/format";

/**
 * The runtime settings from spec 14.
 *
 * Amounts are entered in ETH because that is how the operator thinks about
 * them, and converted to wei before they leave the browser, because wei is what
 * the worker reads and a decimal string that went through a float would be a
 * different number. Only changed fields are sent, so saving one toggle does not
 * freeze the rest of the configuration into the database.
 *
 * The parent gives this component a key derived from the current values, so a
 * refresh after saving remounts it with the truth rather than leaving stale
 * local state on screen.
 */

export type SettingsFormProps = {
  enabled: boolean;
  mode: "treasury" | "swaps";
  minDelaySec: number;
  maxDelaySec: number;
  minAmountWei: string;
  maxAmountWei: string;
  dailyCapWei: string;
  overridden: readonly string[];
};

function ethInput(wei: string): string {
  const text = formatEth(BigInt(wei), 18).replace(/0+$/, "").replace(/\.$/, "");
  return text === "" ? "0" : text;
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly {value: T; label: string}[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="mono-label">{label}</span>
      <div role="group" aria-label={label} className="flex gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`btn h-9 px-[18px] text-[13px] ${value === option.value ? "btn-dark" : "btn-ghost"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  suffix,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  suffix: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="mono-label">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          value={value}
          inputMode="decimal"
          onChange={(e) => onChange(e.target.value)}
          className="field field-mono"
        />
        <span className="mono-label shrink-0">{suffix}</span>
      </div>
    </div>
  );
}

export function SettingsForm(props: SettingsFormProps) {
  const router = useRouter();
  const toast = useToast();

  const [enabled, setEnabled] = useState(props.enabled);
  const [mode, setMode] = useState(props.mode);
  const [minDelay, setMinDelay] = useState(String(props.minDelaySec));
  const [maxDelay, setMaxDelay] = useState(String(props.maxDelaySec));
  const [minAmount, setMinAmount] = useState(ethInput(props.minAmountWei));
  const [maxAmount, setMaxAmount] = useState(ethInput(props.maxAmountWei));
  const [dailyCap, setDailyCap] = useState(ethInput(props.dailyCapWei));
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(body: Record<string, unknown>, kind: "save" | "reset") {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {error?: string};
      if (!res.ok) {
        setError(data.error ?? "The change was not saved.");
        return;
      }
      toast.push({
        title: kind === "reset" ? "Reverted to the environment" : "Settings saved",
        body: "The worker reads them on its next tick.",
        tone: "success",
      });
      router.refresh();
    } catch {
      setError("The request did not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();

    const patch: Record<string, string> = {};
    if (enabled !== props.enabled) patch.enabled = String(enabled);
    if (mode !== props.mode) patch.mode = mode;

    for (const [key, next, current] of [
      ["minDelaySec", minDelay, String(props.minDelaySec)],
      ["maxDelaySec", maxDelay, String(props.maxDelaySec)],
    ] as const) {
      if (next.trim() === current) continue;
      if (!/^\d+$/.test(next.trim())) {
        setError("Intervals are whole seconds.");
        return;
      }
      patch[key] = next.trim();
    }

    for (const [key, next, current] of [
      ["minAmountWei", minAmount, props.minAmountWei],
      ["maxAmountWei", maxAmount, props.maxAmountWei],
      ["dailyCapWei", dailyCap, props.dailyCapWei],
    ] as const) {
      let wei: bigint;
      try {
        wei = parseEth(next);
      } catch {
        setError("Amounts are decimal ETH, for example 0.000004.");
        return;
      }
      if (wei.toString() !== current) patch[key] = wei.toString();
    }

    if (Object.keys(patch).length === 0) {
      setError("Nothing changed.");
      return;
    }
    void post(patch, "save");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6 p-5 sm:p-6">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Segmented
          label="Distribution"
          value={enabled ? "on" : "off"}
          options={[
            {value: "on", label: "Running"},
            {value: "off", label: "Stopped"},
          ]}
          onChange={(next) => setEnabled(next === "on")}
        />
        <Segmented
          label="Mode"
          value={mode}
          options={[
            {value: "treasury", label: "Treasury funded"},
            {value: "swaps", label: "Swap flow"},
          ]}
          onChange={setMode}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <TextField id="min-amount" label="Minimum per node" value={minAmount} suffix="ETH" onChange={setMinAmount} />
        <TextField id="max-amount" label="Maximum per node" value={maxAmount} suffix="ETH" onChange={setMaxAmount} />
        <TextField id="daily-cap" label="Daily cap" value={dailyCap} suffix="ETH" onChange={setDailyCap} />
        <TextField id="min-delay" label="Minimum interval" value={minDelay} suffix="sec" onChange={setMinDelay} />
        <TextField id="max-delay" label="Maximum interval" value={maxDelay} suffix="sec" onChange={setMaxDelay} />
      </div>

      {error ? (
        <p role="alert" className="text-[13px] text-red">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" loading={busy === "save"}>
          Save settings
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          loading={busy === "reset"}
          disabled={props.overridden.length === 0}
          onClick={() => void post({reset: true}, "reset")}
        >
          Revert to environment
        </Button>
        <span className="text-[13px] text-muted">
          {props.overridden.length === 0
            ? "Every value comes from the environment."
            : `Stored in the database: ${props.overridden.join(", ")}.`}
        </span>
      </div>
    </form>
  );
}
