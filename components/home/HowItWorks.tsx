import {Reveal} from "@/components/Reveal";
import {SectionHead} from "@/components/home/SectionHead";

/**
 * The five steps (spec 4.4), verbatim.
 *
 * The reference arranges its steps around a rendered loop image. We have no
 * such asset and inventing one would be decoration, so the steps run as
 * hairline-separated rows instead: same cadence, same mono numbering, and it
 * degrades to a single column without a second layout.
 */

type Step = {
  n: string;
  title: string;
  body: string;
};

const STEPS: readonly Step[] = [
  {
    n: "1",
    title: "Connect your wallet",
    body: "Sign once to prove the wallet is yours. No email, no password, no signup.",
  },
  {
    n: "2",
    title: "Deploy a node",
    body: "Confirm one transfer of 0.02 ETH to the payments wallet. Sitowise sees it and mints your node, paying that gas itself.",
  },
  {
    n: "3",
    title: "Your node is credited",
    body: "Each round sends real ETH onto node balances in the same transaction that records them. During the launch period Sitowise funds it.",
  },
  {
    n: "4",
    title: "Watch it in the dashboard",
    body: "Each node shows its own balance, and the header shows the total across every node you own.",
  },
  {
    n: "5",
    title: "Withdraw whenever",
    body: "Call the contract from your own wallet, name an address, and the whole balance leaves for it. No approval, nothing to request.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="shell pt-[72px] sm:pt-[96px]">
      <SectionHead
        label="How it works"
        title="Five steps, one transaction each"
        aside="Nothing runs on your machine. Every step is a call you can look up on the explorer."
      />

      <ol className="mt-9 sm:mt-11">
        {STEPS.map((step, i) => (
          <Reveal
            as="li"
            key={step.n}
            index={i}
            className="grid grid-cols-[36px_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 border-t border-line py-6 last:border-b sm:grid-cols-[56px_minmax(0,260px)_minmax(0,1fr)] sm:gap-x-8 sm:py-7"
          >
            <span className="mono-label">{step.n.padStart(2, "0")}</span>
            <h3 className="h3">{step.title}</h3>
            <p className="col-start-2 max-w-[62ch] text-[15px] leading-[1.6] text-muted sm:col-start-3">
              {step.body}
            </p>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}
