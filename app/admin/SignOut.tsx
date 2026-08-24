"use client";

import {useRouter} from "next/navigation";
import {useState} from "react";
import {Button} from "@/components/ui/Button";

/** Drops the admin cookie. The key itself is unchanged. */
export function SignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await fetch("/api/admin/session", {method: "DELETE"}).catch(() => undefined);
    setBusy(false);
    router.refresh();
  }

  return (
    <Button variant="ghost" size="sm" loading={busy} onClick={signOut}>
      Sign out
    </Button>
  );
}
