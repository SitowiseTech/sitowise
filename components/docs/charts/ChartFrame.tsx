import type {ReactNode} from "react";

/**
 * The shell every chart on these pages sits in: mono label, optional control on
 * the right, hairline, then the plot.
 *
 * `empty` is not decoration. Docs charts read live API data, and a chart with
 * nothing behind it must say so rather than draw an axis around zero and look
 * like a measurement.
 */

export type ChartFrameProps = {
  label: string;
  /** Range toggles, address inputs, and other controls for the plot. */
  control?: ReactNode;
  /** Mono readout line under the plot: hovered value, totals, source. */
  footer?: ReactNode;
  /** When set, the plot is replaced by this message. */
  empty?: string | null;
  children: ReactNode;
};

export function ChartFrame({label, control, footer, empty, children}: ChartFrameProps) {
  return (
    <div className="panel">
      <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-5">
        <span className="mono-label">{label}</span>
        {control}
      </div>
      <hr className="rule" />
      {empty ? (
        <div className="doc-chart-empty">
          <span className="font-mono text-[13px] text-ink">No data yet</span>
          <span className="max-w-[38ch] text-[13px] text-faint">{empty}</span>
        </div>
      ) : (
        <div className="p-4 sm:p-5">{children}</div>
      )}
      {footer ? (
        <>
          <hr className="rule" />
          <div className="px-4 py-3 sm:px-5">{footer}</div>
        </>
      ) : null}
    </div>
  );
}
