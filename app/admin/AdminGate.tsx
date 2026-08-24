"use client";

import {startAuthentication} from "@simplewebauthn/browser";
import {useRouter} from "next/navigation";
import {useEffect, useState, type FormEvent} from "react";
import {Button} from "@/components/ui/Button";
import {Panel} from "@/components/ui/Panel";

/**
 * Two ways in.
 *
 * Touch ID is the everyday one and is offered first when a passkey is enrolled.
 * The key stays below it, because it is what enrols the first passkey and what
 * gets the operator back in from a machine that has none.
 */
export function AdminGate({passkeysEnrolled}: {passkeysEnrolled: boolean}) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touchBusy, setTouchBusy] = useState(false);
  const [supported, setSupported] = useState(false);

  // Rendered on the server too, where `window` does not exist: decide after mount.
  useEffect(() => {
    setSupported(typeof window !== "undefined" && !!window.PublicKeyCredential);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/session", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({key}),
      });
      const data = (await res.json().catch(() => ({}))) as {error?: string};
      if (!res.ok) {
        setError(data.error ?? "That did not work.");
        return;
      }
      setKey("");
      router.refresh();
    } catch {
      setError("The request did not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function touchId() {
    setTouchBusy(true);
    setError(null);
    try {
      const optionsRes = await fetch("/api/admin/passkey/login");
      const optionsData = (await optionsRes.json().catch(() => ({}))) as {
        options?: Parameters<typeof startAuthentication>[0]["optionsJSON"];
        error?: string;
      };
      if (!optionsRes.ok || !optionsData.options) {
        setError(optionsData.error ?? "Touch ID is not available right now.");
        return;
      }

      const assertion = await startAuthentication({optionsJSON: optionsData.options});

      const res = await fetch("/api/admin/passkey/login", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({response: assertion}),
      });
      const data = (await res.json().catch(() => ({}))) as {error?: string};
      if (!res.ok) {
        setError(data.error ?? "That passkey was not accepted.");
        return;
      }
      router.refresh();
    } catch (err) {
      // Cancelling the system prompt lands here and is not an error worth shouting about.
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "AbortError") {
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : "Touch ID did not complete.");
      }
    } finally {
      setTouchBusy(false);
    }
  }

  const showTouch = passkeysEnrolled && supported;

  return (
    <Panel label="Admin" className="max-w-[440px]" padding="lg">
      <div className="flex flex-col gap-4">
        {showTouch ? (
          <>
            <Button type="button" onClick={touchId} loading={touchBusy}>
              Unlock with Touch ID
            </Button>
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <span className="mono-label">or</span>
              <span className="h-px flex-1 bg-line" />
            </div>
          </>
        ) : null}

        <form onSubmit={submit} className="flex flex-col gap-4">
          <label htmlFor="admin-key" className="text-[14px] text-muted">
            {showTouch
              ? "Or enter the admin key."
              : "Enter the admin key to open the console."}
          </label>
          <input
            id="admin-key"
            type="password"
            value={key}
            autoComplete="off"
            autoFocus={!showTouch}
            onChange={(e) => setKey(e.target.value)}
            className={`field field-mono ${error ? "invalid" : ""}`}
            placeholder="ADMIN_KEY"
          />
          {error ? (
            <p role="alert" className="text-[13px] text-red">
              {error}
            </p>
          ) : null}
          <Button type="submit" loading={busy} disabled={key.trim() === ""}>
            Open console
          </Button>
        </form>
      </div>
    </Panel>
  );
}
