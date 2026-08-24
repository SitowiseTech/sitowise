"use client";

import {useRouter} from "next/navigation";
import {useState} from "react";
import {Button} from "@/components/ui/Button";

/**
 * Closes one alert. It does not fix the condition: the worker raises the same
 * alert again on its next tick if it still holds.
 */
export function ResolveAlert({id}: {id: number}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function resolve() {
    setBusy(true);
    await fetch("/api/admin/alerts", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({id}),
    }).catch(() => undefined);
    setBusy(false);
    router.refresh();
  }

  return (
    <Button variant="quiet" size="sm" loading={busy} onClick={resolve}>
      Close
    </Button>
  );
}
