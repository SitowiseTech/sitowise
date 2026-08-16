import {ArrowRightIcon} from "@/components/icons";
import {Reveal} from "@/components/Reveal";
import {Button} from "@/components/ui/Button";
import {DEPLOY_CTA_LABEL, DEPLOY_HREF} from "@/lib/site";

/**
 * Closing call to action (spec 4.7).
 *
 * The plan's headline was "One payment. Every swap after that works for you."
 * No pool is attached to the hook yet, so on the day this ships that sentence
 * would be a promise about money that is not moving. The claim is narrowed to
 * the two things that are true the moment the transaction confirms: the price
 * is paid once, and the balance is the holder's to withdraw. The funding note
 * sits next to it rather than in small print.
 *
 * The headline takes a full-width row instead of the reference's first column,
 * which is what the reference itself falls back to once its three tracks stop
 * fitting. At the shell width the whole sentence then sits on one line.
 */

export function FinalCta() {
  return (
    <section className="shell pt-[72px] pb-[88px] sm:pt-[96px] sm:pb-[112px]">
      <Reveal
        variant="panel"
        className="wash wash-cta rounded-[var(--radius-lg)] border border-line-dark px-7 py-10 sm:px-12 sm:py-12"
      >
        <Reveal as="div" index={1}>
          <h2 className="h2">One payment. One node. Yours to withdraw whenever.</h2>
        </Reveal>

        <div className="mt-9 flex flex-col gap-7 lg:flex-row lg:items-center lg:justify-between lg:gap-14">
          <Reveal
            as="p"
            index={2}
            className="max-w-[58ch] text-[14.5px] leading-[1.62] text-muted"
          >
            Twenty five nodes per wallet, no lockup and no claim window. During
            the launch period rewards are funded by Sitowise, not by trading
            volume. What each node holds is readable on chain at any time.
          </Reveal>

          <Reveal as="div" index={3} className="shrink-0 self-start lg:self-auto">
            <Button href={DEPLOY_HREF} trailing={<ArrowRightIcon size={15} />}>
              {DEPLOY_CTA_LABEL}
            </Button>
          </Reveal>
        </div>
      </Reveal>
    </section>
  );
}
