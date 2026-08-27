import type {ReactNode} from "react";
import {ArrowUpRightIcon} from "@/components/icons";
import {CopyButton} from "@/components/ui/CopyButton";
import {addressUrl} from "@/lib/chain";

/**
 * One labelled address with a copy control and an explorer link.
 *
 * The full address is printed, never truncated. A reader checking a contract
 * needs all forty characters, and shortening them here would mean the copy
 * button is the only way to get the real value.
 */

const ZERO = "0x0000000000000000000000000000000000000000";

export type AddressRowProps = {
  label: string;
  address: string;
  /** Shown under the address: what this contract is for. */
  note?: ReactNode;
  /**
   * What to print instead of an address when there is none. Defaults to the
   * contract wording; a wallet that has not been configured is not "not
   * deployed", and saying so would be a small lie on a page whose whole job is
   * telling a reader which addresses are real.
   */
  missingLabel?: string;
};

export function AddressRow({label, address, note, missingLabel}: AddressRowProps) {
  const deployed = address.toLowerCase() !== ZERO;

  return (
    <div className="border-line border-b p-4 last:border-b-0 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="mono-label">{label}</span>
        {deployed ? (
          <div className="flex items-center gap-1">
            <CopyButton value={address} label={`Copy ${label} address`} />
            <a
              href={addressUrl(address)}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-7 items-center gap-1 rounded-sharp px-[7px] font-mono text-[12px] text-faint transition-colors hover:bg-panel hover:text-ink"
            >
              Explorer
              <ArrowUpRightIcon size={12} />
            </a>
          </div>
        ) : null}
      </div>
      <div className="mt-2 font-mono text-[13px] break-all text-ink">
        {deployed ? (
          address
        ) : (
          <span className="text-faint">{missingLabel ?? "Not deployed yet"}</span>
        )}
      </div>
      {note ? <div className="mt-2 text-[13.5px] text-muted">{note}</div> : null}
    </div>
  );
}
