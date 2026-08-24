import type {ReactNode} from "react";

/**
 * Presentational pieces shared by the admin panels. Server components: nothing
 * here is interactive, and the console should render fully before any client
 * bundle arrives, because it is the page you open when something is wrong.
 */

export type StatTone = "default" | "good" | "bad";

const TONE: Record<StatTone, string> = {
  default: "text-ink",
  good: "text-green",
  bad: "text-red",
};

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatTone;
}) {
  return (
    <div className="flex flex-col gap-[6px] p-5">
      <span className="mono-label">{label}</span>
      <span className={`tabular text-[22px] font-medium leading-none ${TONE[tone]}`}>{value}</span>
      {hint ? <span className="text-[13px] leading-[1.45] text-muted">{hint}</span> : null}
    </div>
  );
}

/** Grid of stats separated by hairlines rather than gaps, as the tables are. */
export function StatGrid({children, columns = 4}: {children: ReactNode; columns?: 2 | 3 | 4}) {
  const cols = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
  }[columns];
  return (
    <div className={`grid grid-cols-1 gap-px bg-line ${cols}`}>
      {children}
    </div>
  );
}

/** One labelled line inside a panel body. */
export function Field({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-[7px]">
      <span className="mono-label">{label}</span>
      <span className="tabular text-[14px] text-ink">{children}</span>
    </div>
  );
}

/** Every place the page has nothing real to show says the same thing. */
export function NoData({children = "No data yet"}: {children?: ReactNode}) {
  return <span className="text-[14px] text-faint">{children}</span>;
}

/** Header row for the tables: same hairline rhythm as Panel's own header. */
export function TableHead({columns}: {columns: readonly string[]}) {
  return (
    <thead>
      <tr>
        {columns.map((column, i) => (
          <th
            key={column}
            scope="col"
            className={`mono-label border-b border-line px-5 py-3 font-normal ${i === 0 ? "text-left" : "text-right"}`}
          >
            {column}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function Cell({
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
