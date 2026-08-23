import type {ReactNode} from "react";

/** Presentational pieces for the ledger feed. Server components, no state. */

export function Summary({label, value, hint}: {label: string; value: ReactNode; hint?: string}) {
  return (
    <div className="flex flex-col gap-[6px] p-5">
      <span className="mono-label">{label}</span>
      <span className="tabular text-[22px] font-medium leading-none text-ink">{value}</span>
      {hint ? <span className="text-[13px] text-muted">{hint}</span> : null}
    </div>
  );
}

export function Th({children, align = "right"}: {children: ReactNode; align?: "left" | "right"}) {
  return (
    <th
      scope="col"
      className={`mono-label border-b border-line px-5 py-3 font-normal ${align === "left" ? "text-left" : "text-right"}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "right",
  className,
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={`tabular border-b border-line px-5 py-3 text-[13.5px] ${align === "left" ? "text-left" : "text-right"} ${className ?? ""}`}
    >
      {children}
    </td>
  );
}
