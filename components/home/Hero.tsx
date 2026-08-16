import {ArrowRightIcon} from "@/components/icons";
import {HeroDiagram} from "@/components/home/HeroDiagram";
import {Reveal} from "@/components/Reveal";
import {Button} from "@/components/ui/Button";
import {DEPLOY_CTA_LABEL, DEPLOY_HREF} from "@/lib/site";

/**
 * Hero (spec 4.2). Three headline lines, the third in accent orange, then the
 * mechanism in plain words and the two calls to action.
 *
 * The second paragraph is the honest one. Nodes are paid for in real ETH, and
 * no pool is attached to the hook yet, so the hero sells only what the contract
 * does today and leaves the hook to the docs. No rate, no interval
 * and no projection appears anywhere on this page.
 */

export function Hero() {
  return (
    <section
      id="product"
      className="shell grid items-center gap-10 pt-10 pb-4 min-[1180px]:grid-cols-[58%_38%] min-[1180px]:gap-[4%] min-[1180px]:pt-3"
    >
      <div className="flex flex-col gap-6 sm:gap-7">
        <Reveal className="flex items-center gap-[9px]">
          <span className="h-1.5 w-1.5 rounded-full bg-orange" />
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.04em] text-ink">
            On-chain balances · Chain 4663
          </span>
        </Reveal>

        <Reveal index={1}>
          <h1 className="h1 max-w-[620px]">
            Deploy a node.
            <br />
            The balance lives
            <br />
            <span className="accent">in the contract.</span>
          </h1>
        </Reveal>

        <Reveal index={2} className="flex max-w-[520px] flex-col gap-4">
          <p className="lede">
            Every wei credited to a node is a wei sitting in the contract. Read
            the balance on the explorer, withdraw it to any address you name,
            and no signature from us sits anywhere in that path.
          </p>
          {/* The disclosure gets a rule rather than a lighter grey: it is the
              one sentence on the page a buyer most needs to be able to read. */}
          <p className="border-l border-line-dark pl-4 text-[14px] leading-[1.6] text-muted">
            During the launch period rewards are funded by Sitowise. The
            Uniswap v4 hook meant to replace that funding has no pools attached
            to it yet, so nothing you see here comes from swap flow.
          </p>
        </Reveal>

        <Reveal index={3} className="flex flex-wrap items-center gap-3 sm:gap-4">
          <Button href={DEPLOY_HREF} trailing={<ArrowRightIcon size={15} />}>
            {DEPLOY_CTA_LABEL}
          </Button>
          <Button
            href="/docs"
            variant="ghost"
            trailing={<ArrowRightIcon size={15} />}
          >
            Read the docs
          </Button>
        </Reveal>
      </div>

      {/* Slot for the diagram. It carries its own aspect ratio and minimum
          height, so the wrapper only reserves the column and never clips it.
          The 1180px breakpoint is where a 58% column finally clears the widest
          headline line (605px at 64px); below it the hero stacks instead of
          breaking "The balance lives" across two lines. */}
      <Reveal
        index={2}
        variant="panel"
        className="relative mx-auto w-full max-w-[560px] min-[1180px]:mx-0 min-[1180px]:max-w-none"
      >
        <HeroDiagram />
      </Reveal>
    </section>
  );
}
