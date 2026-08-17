import type {ReactNode} from "react";
import {InfoIcon, WarningIcon} from "@/components/icons";

/**
 * Inline notice. Two tones only: `info` for context the reader can ignore,
 * `warn` for anything about money leaving a wallet or a risk being taken.
 */

export type CalloutTone = "info" | "warn";

export type CalloutProps = {
  children: ReactNode;
  tone?: CalloutTone;
  title?: ReactNode;
  className?: string;
};

const TONE = {
  info: {
    box: "border-line bg-panel",
    icon: "text-faint",
  },
  warn: {
    box: "border-orange/45 bg-orange-soft",
    icon: "text-orange",
  },
} as const;

export function Callout({children, tone = "info", title, className}: CalloutProps) {
  const style = TONE[tone];
  const Icon = tone === "warn" ? WarningIcon : InfoIcon;

  return (
    <div
      role={tone === "warn" ? "alert" : undefined}
      className={[
        "flex gap-3 rounded-sharp border p-4 text-[14px] leading-[1.55] text-muted",
        style.box,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Icon size={17} className={`mt-[2px] shrink-0 ${style.icon}`} />
      <div className="min-w-0">
        {title ? <div className="mb-1 font-semibold text-ink">{title}</div> : null}
        {children}
      </div>
    </div>
  );
}
