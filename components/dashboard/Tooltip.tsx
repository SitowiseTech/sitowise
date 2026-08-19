"use client";

import {useId, type ReactNode} from "react";

/**
 * A hover and focus hint for a control that cannot explain itself, which in
 * practice means the disabled Withdraw button (spec 5.3). A disabled button
 * takes no pointer events and no focus, so the wrapper carries both: it is the
 * hover target and it is keyboard reachable, otherwise the explanation would
 * exist only for mouse users.
 */

export type TooltipProps = {
  label: string;
  children: ReactNode;
  className?: string;
};

export function Tooltip({label, children, className}: TooltipProps) {
  const id = useId();

  return (
    <span
      tabIndex={0}
      aria-describedby={id}
      className={["group relative inline-flex focus:outline-none", className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+8px)] right-0 z-20 w-[228px] rounded-sharp border border-line-dark bg-paper-bright p-3 text-[13px] leading-[1.45] text-muted opacity-0 shadow-[0_10px_28px_rgba(17,18,16,0.14)] transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
