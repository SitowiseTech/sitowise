import {Reveal} from "@/components/Reveal";
import {SectionHead} from "@/components/home/SectionHead";

/**
 * The six numbered cards (spec 4.3). Card colour comes from `:nth-child` rules
 * on `.cap-card` in globals.css, so this file carries copy and nothing else.
 *
 * Item 01 used to advertise hook-level accrual, which no pool routes through
 * yet. It now states the property the contract actually enforces today: node
 * balances are backed one for one, and the owner cannot reach them. The hook
 * is described in the docs, where the funding disclosure sits beside it.
 */

type Capability = {
  index: string;
  title: string;
  body: string;
  tags: readonly string[];
};

const CAPABILITIES: readonly Capability[] = [
  {
    index: "01",
    title: "Balances that are backed",
    body: "A balance is only ever written in the same transaction that carries the ETH behind it. The contract tracks the sum it owes, and the one function that moves money out cannot touch it.",
    tags: ["Backed 1:1", "Same tx", "Owner locked out"],
  },
  {
    index: "02",
    title: "One node, one position",
    body: "A node is a position on chain, not a machine. Nothing to install, nothing to keep online, nothing to restake.",
    tags: ["On-chain", "No uptime", "No stake", "No renewal"],
  },
  {
    index: "03",
    title: "Per-node balances",
    body: "Every node carries its own balance. Hold one or hold fifty and see exactly what each of them holds.",
    tags: ["Per node", "Per wallet", "Transparent"],
  },
  {
    index: "04",
    title: "Withdraw to any address",
    body: "Your balance leaves the contract to whatever address you name, whenever you want it.",
    tags: ["Any address", "No lockup", "No queue"],
  },
  {
    index: "05",
    title: "Non-custodial by design",
    body: "The contract holds node balances. Nobody can move them except the wallet that owns the node.",
    tags: ["Non-custodial", "Owner only", "Public code"],
  },
  {
    index: "06",
    title: "Built on Robinhood Chain",
    body: "Native ETH in and out, low fees, and every action is a normal transaction you can look up.",
    tags: ["Chain 4663", "Native ETH", "Blockscout"],
  },
];

export function Capabilities() {
  return (
    <section id="what-sitowise-does" className="shell pt-[72px] sm:pt-[96px]">
      <SectionHead
        label="Capabilities"
        title="What Sitowise does"
        aside="Six responsibilities, all of them settled on chain."
      />

      <div className="mt-9 grid gap-5 sm:mt-11 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
        {CAPABILITIES.map((item, i) => (
          <Reveal
            key={item.index}
            as="article"
            variant="panel"
            index={i % 3}
            className="cap-card flex flex-col gap-4 p-7 sm:min-h-[320px] sm:p-8"
          >
            <span className="mono-label pb-2">{item.index}</span>
            <h3 className="h3">{item.title}</h3>
            <p className="max-w-[34ch] text-[14.5px] leading-[1.55] text-muted">
              {item.body}
            </p>
            <span className="mono-label mt-auto pt-6 leading-[1.6]">
              {item.tags.join(" · ")}
            </span>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
