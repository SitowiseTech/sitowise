"use client";

import {useRouter} from "next/navigation";
import {useState} from "react";
import {Button} from "@/components/ui/Button";
import {useToast} from "@/components/ui/Toast";

/**
 * Asks the worker for a round now. Nothing is credited here: the request leaves
 * a flag the worker claims within seconds, so the ledger keeps a single writer.
 */
export function DistributeNow({disabled, reason}: {disabled: boolean; reason?: string}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/distribute", {method: "POST"});
      const data = (await res.json().catch(() => ({}))) as {error?: string};
      if (!res.ok) {
        toast.push({title: "Not requested", body: data.error ?? "The request failed.", tone: "error"});
        return;
      }
      toast.push({
        title: "Round requested",
        body: "The worker picks it up within a few seconds.",
        tone: "success",
      });
      // Give the worker its poll interval before showing the result.
      setTimeout(() => router.refresh(), 6000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" loading={busy} disabled={disabled} title={reason} onClick={run}>
      Distribute now
    </Button>
  );
}
