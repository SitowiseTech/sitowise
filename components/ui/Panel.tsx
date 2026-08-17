import type {CSSProperties, ReactNode} from "react";

/**
 * Bordered surface. The optional header row is a mono label plus an action,
 * separated by the same hairline used between table rows, which is how the
 * reference keeps panel headers from reading as a second card.
 */

export type PanelProps = {
  children?: ReactNode;
  /** Mono micro-label above the hairline. */
  label?: ReactNode;
  /** Right-aligned control in the header row. */
  action?: ReactNode;
  className?: string;
  /** Inner padding. `none` suits panels holding a full-bleed table. */
  padding?: "none" | "sm" | "md" | "lg";
  /** Reveal on scroll with the panel variant (scale plus fade). */
  reveal?: boolean;
  revealDelay?: number;
  id?: string;
};

const PADDING = {
  none: "",
  sm: "p-4",
  md: "p-5 sm:p-6",
  lg: "p-6 sm:p-8",
} as const;

type RevealStyle = CSSProperties & {"--reveal-delay"?: string};

export function Panel({
  children,
  label,
  action,
  className,
  padding = "md",
  reveal = false,
  revealDelay,
  id,
}: PanelProps) {
  const hasHeader = label !== undefined || action !== undefined;
  const style: RevealStyle | undefined =
    revealDelay && revealDelay > 0 ? {"--reveal-delay": `${revealDelay}ms`} : undefined;

  return (
    <div
      id={id}
      style={style}
      data-reveal={reveal ? "panel" : undefined}
      className={["panel", className].filter(Boolean).join(" ")}
    >
      {hasHeader ? (
        <>
          <div className="flex min-h-[52px] items-center justify-between gap-4 px-5 sm:px-6">
            {label !== undefined ? <span className="mono-label">{label}</span> : <span />}
            {action}
          </div>
          <hr className="rule" />
        </>
      ) : null}
      <div className={PADDING[padding]}>{children}</div>
    </div>
  );
}
