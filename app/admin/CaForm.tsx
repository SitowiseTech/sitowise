"use client";

import {useEffect, useState, type FormEvent} from "react";
import {Button} from "@/components/ui/Button";
import {Panel} from "@/components/ui/Panel";

/**
 * Publish the token address to the site header.
 *
 * This is the control somebody uses once, under pressure, at the exact minute
 * of a launch. So it states plainly what will happen, shows what is live right
 * now, and needs no other step: no rebuild, no redeploy, no environment
 * variable. Save, and the header has it within seconds.
 */
export function CaForm() {
  const [live, setLive] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      const res = await fetch("/api/admin/ca");
      const data = (await res.json().catch(() => ({}))) as {ca?: string | null};
      setLive(data.ca ?? null);
    } catch {
      setError("Could not read the current address.");
    } finally {
      setLoaded(true);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/ca", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({ca: value}),
      });
      const data = (await res.json().catch(() => ({}))) as {error?: string; ca?: string};
      if (!res.ok) {
        setError(data.error ?? "That did not save.");
        return;
      }
      setLive(data.ca ?? null);
      setValue("");
      setSaved(true);
    } catch {
      setError("The request did not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/ca", {method: "DELETE"});
      if (!res.ok) {
        setError("Could not unpublish.");
        return;
      }
      setLive(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel label="Token address in the site header" padding="lg">
      <div className="flex flex-col gap-4">
        <p className="text-[14px] leading-[1.55] text-muted">
          Paste the address here at launch and it appears in the header on every page within a
          few seconds. No deploy, no rebuild. Until it is set, the header shows{" "}
          <span className="font-mono text-ink">CA: soon</span>, and visitors can click the pill
          to copy the address once it is live.
        </p>

        <div className="border-y border-line py-3.5">
          <p className="mono-label">Live on the site right now</p>
          <p className="mt-1.5 break-all font-mono text-[13px] text-ink">
            {!loaded ? "Reading…" : live ? live : "Nothing published yet, the header says soon"}
          </p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <label htmlFor="token-ca" className="mono-label">
            {live ? "Replace with" : "Publish"}
          </label>
          <input
            id="token-ca"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
            }}
            spellCheck={false}
            autoComplete="off"
            placeholder="0x…"
            className={`field field-mono ${error ? "invalid" : ""}`}
          />

          {error ? (
            <p role="alert" className="text-[13px] text-red">
              {error}
            </p>
          ) : null}
          {saved ? (
            <p className="text-[13px] text-ink">
              Published. Reload the site to see it in the header.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={busy} disabled={value.trim() === ""}>
              Publish to header
            </Button>
            {live ? (
              <Button type="button" variant="ghost" onClick={unpublish} disabled={busy}>
                Unpublish
              </Button>
            ) : null}
          </div>
        </form>
      </div>
    </Panel>
  );
}
