"use client";

import {startRegistration} from "@simplewebauthn/browser";
import {useEffect, useState} from "react";
import {Button} from "@/components/ui/Button";
import {Panel} from "@/components/ui/Panel";

type Row = {id: number; label: string; createdAt: string; lastUsedAt: string | null};

function when(iso: string | null): string {
  if (!iso) return "never used";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {dateStyle: "medium", timeStyle: "short"});
}

/**
 * Enrol and remove Touch ID passkeys.
 *
 * Only reachable from inside the console, which is the point: enrolling a
 * passkey is granting a key to the building, so it takes an authenticated
 * session to do it.
 */
export function Passkeys() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && !!window.PublicKeyCredential);
    void refresh();
  }, []);

  async function refresh() {
    try {
      const res = await fetch("/api/admin/passkey");
      const data = (await res.json().catch(() => ({}))) as {passkeys?: Row[]; error?: string};
      if (!res.ok) {
        setError(data.error ?? "Could not read the passkey list.");
        setRows([]);
        return;
      }
      setRows(data.passkeys ?? []);
    } catch {
      setError("Could not reach the server.");
      setRows([]);
    }
  }

  async function enrol() {
    setBusy(true);
    setError(null);
    try {
      const optionsRes = await fetch("/api/admin/passkey?action=options");
      const optionsData = (await optionsRes.json().catch(() => ({}))) as {
        options?: Parameters<typeof startRegistration>[0]["optionsJSON"];
        error?: string;
      };
      if (!optionsRes.ok || !optionsData.options) {
        setError(optionsData.error ?? "Could not start enrolment.");
        return;
      }

      const attestation = await startRegistration({optionsJSON: optionsData.options});

      const label =
        typeof navigator !== "undefined" && navigator.platform
          ? `Touch ID on ${navigator.platform}`
          : "Touch ID";

      const res = await fetch("/api/admin/passkey", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({response: attestation, label}),
      });
      const data = (await res.json().catch(() => ({}))) as {error?: string};
      if (!res.ok) {
        setError(data.error ?? "That passkey was not accepted.");
        return;
      }
      await refresh();
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "AbortError") {
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : "Enrolment did not complete.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/passkey", {
        method: "DELETE",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({id}),
      });
      const data = (await res.json().catch(() => ({}))) as {error?: string};
      if (!res.ok) setError(data.error ?? "Could not remove that passkey.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel label="Touch ID" padding="lg">
      <div className="flex flex-col gap-4">
        <p className="text-[14px] leading-[1.55] text-muted">
          Enrol this Mac to unlock the console with Touch ID instead of typing the key. The
          admin key keeps working: it is what you use from another machine, and what gets you
          back in if this one is lost.
        </p>

        {rows === null ? (
          <p className="text-[13px] text-muted">Reading…</p>
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-muted">No passkey enrolled yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold">{row.label}</p>
                  <p className="text-[13px] text-muted">Last used {when(row.lastUsedAt)}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => remove(row.id)}
                  disabled={busy}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        {error ? (
          <p role="alert" className="text-[13px] text-red">
            {error}
          </p>
        ) : null}

        {supported ? (
          <Button type="button" onClick={enrol} loading={busy}>
            Enrol this Mac
          </Button>
        ) : (
          <p className="text-[13px] text-muted">
            This browser does not support passkeys.
          </p>
        )}
      </div>
    </Panel>
  );
}
