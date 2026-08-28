import {CheckIcon} from "@/components/icons";
import {Reveal} from "@/components/Reveal";
import {SectionHead} from "@/components/home/SectionHead";
import {MAX_NODES_PER_WALLET} from "@/lib/site";

/**
 * The two-column comparison (spec 4.5).
 *
 * The rows have to line up across the two columns or the comparison stops
 * reading as a comparison, so the box declares six rows and each column is a
 * subgrid of them: the tallest cell in a row sets the height on both sides.
 * Below the two-column breakpoint the subgrid is dropped and the columns
 * simply stack, which is why the grid classes are all prefixed.
 */

const ROWS: readonly (readonly [string, string])[] = [
  ["Rent a server and keep it alive", "Nothing to run"],
  ["Stake and wait out a lockup", "One payment, no lockup"],
  ["Miss a claim window, lose the payout", "Balances sit until you take them"],
  ["Trust a number on a dashboard", "Read the balance from the contract"],
  ["One address, one position", `Up to ${MAX_NODES_PER_WALLET} nodes per wallet`],
];

export function Comparison() {
  return (
    <section id="comparison" className="shell pt-[72px] sm:pt-[96px]">
      <SectionHead
        label="Comparison"
        title="What changes"
        aside="The same job, without the parts of it that were never the point."
      />

      <Reveal
        variant="panel"
        className="mt-9 grid overflow-hidden rounded-[var(--radius-lg)] border border-line-dark sm:mt-11 lg:grid-cols-2 lg:grid-rows-[auto_repeat(5,auto)]"
      >
        <article className="flex flex-col gap-[18px] border-line-dark p-7 text-muted sm:p-10 lg:row-span-full lg:grid lg:grid-rows-subgrid lg:border-r">
          <h2 className="h2 pb-2">Running a node the old way</h2>
          <ul className="flex flex-col gap-[18px] lg:row-[2/-1] lg:grid lg:grid-rows-subgrid">
            {ROWS.map(([before], i) => (
              <Reveal
                as="li"
                key={before}
                index={i + 1}
                className="flex items-start gap-4 self-start"
              >
                {/* A dash rather than a cross: the old way is not wrong, it is
                    just work nobody needed to be doing. */}
                <span
                  aria-hidden="true"
                  className="mt-[0.72em] h-px w-3 shrink-0 bg-line-dark"
                />
                <span className="min-w-0 text-[15px] leading-[1.4] sm:text-[17px]">
                  {before}
                </span>
              </Reveal>
            ))}
          </ul>
        </article>

        <article className="flex flex-col gap-[18px] border-t border-line-dark bg-paper-bright p-7 sm:p-10 lg:row-span-full lg:grid lg:grid-rows-subgrid lg:border-t-0">
          <h2 className="h2 pb-2">With Sitowise</h2>
          <ul className="flex flex-col gap-[18px] lg:row-[2/-1] lg:grid lg:grid-rows-subgrid">
            {ROWS.map(([, after], i) => (
              <Reveal
                as="li"
                key={after}
                index={i + 1}
                className="flex items-start gap-4 self-start"
              >
                <CheckIcon
                  size={16}
                  className="mt-[0.28em] shrink-0 text-orange"
                />
                <span className="min-w-0 text-[15px] leading-[1.4] sm:text-[17px]">
                  {after}
                </span>
              </Reveal>
            ))}
          </ul>
        </article>
      </Reveal>
    </section>
  );
}
