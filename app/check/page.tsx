import type {Metadata} from "next";
import Link from "next/link";
import {PaymentCheck} from "@/app/check/PaymentCheck";
import {SITE} from "@/lib/site";

export const metadata: Metadata = {
  title: "Check a payment",
  description:
    "Paste the transaction hash you paid with and see exactly what happened to it: the node it created, or why it is being held.",
  openGraph: {
    title: `Check a payment · ${SITE.name}`,
    description: "Paste your transaction hash and see what happened to it.",
    url: "/check",
  },
};

export default function CheckPage() {
  return (
    <main className="shell flex flex-col gap-8 py-12 sm:py-16">
      <div className="flex max-w-[62ch] flex-col gap-3">
        <span className="mono-label">Check a payment</span>
        <h1 className="text-[34px] leading-[1.08] font-medium tracking-[-0.02em] sm:text-[42px]">
          Where is my node?
        </h1>
        <p className="text-[15px] leading-[1.6] text-muted">
          Paste the transaction you paid with. This says what happened to it: the node it
          created, or why it is being held, in the same words we would use. If we somehow never
          recorded your payment, checking it here records it.
        </p>
      </div>

      <div className="max-w-[720px]">
        <PaymentCheck />
      </div>

      <p className="max-w-[62ch] text-[13.5px] leading-[1.6] text-muted">
        Nothing here needs a wallet or an account, and the hash is only a pointer: every fact
        comes from the chain. You can read the same thing yourself through{" "}
        <Link href="/docs/api/node" className="text-ink underline underline-offset-2">
          the API
        </Link>{" "}
        or on the explorer.
      </p>
    </main>
  );
}
