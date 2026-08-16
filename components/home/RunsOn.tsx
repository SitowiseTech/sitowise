import {ArrowUpRightIcon} from "@/components/icons";
import {Reveal} from "@/components/Reveal";
import {addressUrl, FACTORY_ADDRESS} from "@/lib/chain";
import {paymentAddress} from "@/lib/env";

/** FACTORY_ADDRESS falls back to this when NEXT_PUBLIC_FACTORY is unset. */
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * "Runs on" (spec 4.6). Three groups of plain text.
 *
 * The reference fills this band with third-party logos. We use none: Sitowise
 * has no partnerships to show, and borrowed marks would imply endorsements
 * that do not exist. The facts alone carry the section.
 */

type Group = {
  label: string;
  items: readonly string[];
};

const GROUPS: readonly Group[] = [
  {
    label: "Chain",
    items: ["Robinhood Chain", "Chain ID 4663", "Native ETH"],
  },
  {
    label: "Contract",
    items: ["Verified source", "No imports on the money path", "Backed balances"],
  },
  {
    label: "Wallets",
    items: ["Any injected EVM wallet", "EIP-6963 discovery"],
  },
];

export function RunsOn() {
  return (
    <section id="runs-on" className="shell pt-[72px] sm:pt-[96px]">
      <div className="border-y border-line py-11 sm:py-14">
        <Reveal className="flex flex-col gap-3">
          <p className="mono-label">Runs on</p>
          <h2 className="h2 max-w-[20ch]">Plain infrastructure, named</h2>
        </Reveal>

        <div className="mt-9 grid gap-8 sm:mt-11 sm:grid-cols-3 sm:gap-7">
          {GROUPS.map((group, i) => (
            <Reveal
              key={group.label}
              index={i}
              className="border-t border-line-dark pt-4"
            >
              {/* `.accent` is declared after `.mono-label` in globals.css, so it
                  wins the colour without a utility fighting an unlayered rule. */}
              <p className="mono-label accent">{group.label}</p>
              <ul className="mt-3.5 flex flex-col gap-2.5">
                {group.items.map((item, j) => (
                  <Reveal
                    as="li"
                    key={item}
                    index={i + j + 1}
                    className="text-[14px] font-semibold"
                  >
                    {item}
                  </Reveal>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>

        <Addresses />
      </div>
    </section>
  );
}

/**
 * The addresses, on the landing page rather than only in the docs.
 *
 * Everything above this is a claim. These two links are how somebody checks it
 * without taking our word for anything: the factory's source is verified, so
 * `outstanding`, `freeBalance` and `isSolvent` can be read straight off the
 * Read Contract tab.
 *
 * The two are labelled by what you do with them, not by what they are. One is
 * the wallet a purchase is sent to; the other is a contract that accepts plain
 * transfers and gives nothing back for them. Confusing the two costs somebody
 * 0.02 ETH, so the difference is stated rather than implied.
 */
function Addresses() {
  const factory = FACTORY_ADDRESS.toLowerCase() === ZERO_ADDRESS ? null : FACTORY_ADDRESS;

  // The landing page must render even when the environment is incomplete: a
  // missing variable is an operator problem, not a reason to serve a broken page.
  let payments: `0x${string}` | null = null;
  try {
    payments = paymentAddress();
  } catch {
    payments = null;
  }

  if (!factory && !payments) return null;

  return (
    <Reveal variant="panel" index={4} className="mt-10 sm:mt-12">
      <p className="mono-label accent">Check it yourself</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {factory ? (
          <AddressCard
            label="SitowiseFactory"
            address={factory}
            note="Verified source. Read outstanding, freeBalance and isSolvent here."
          />
        ) : null}
        {payments ? (
          <AddressCard
            label="Payments wallet"
            address={payments}
            note="The only address a purchase is sent to. Never send to the contract."
          />
        ) : null}
      </div>
    </Reveal>
  );
}

function AddressCard({label, address, note}: {label: string; address: string; note: string}) {
  return (
    <a
      href={addressUrl(address)}
      target="_blank"
      rel="noreferrer noopener"
      className="panel group block p-4 transition-colors hover:border-line-dark sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="mono-label">{label}</span>
        <ArrowUpRightIcon
          size={14}
          className="shrink-0 text-faint transition-colors group-hover:text-orange"
        />
      </div>
      {/* `break-all` rather than a truncation: a half-shown address cannot be
          compared against the one in a wallet, which is the whole point of
          printing it. */}
      <p className="mt-2.5 break-all font-mono text-[12.5px] leading-[1.5] text-ink">{address}</p>
      <p className="mt-2 text-[13px] leading-[1.5] text-muted">{note}</p>
    </a>
  );
}
