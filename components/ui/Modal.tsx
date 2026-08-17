"use client";

import {useCallback, useEffect, useId, useRef, useState, type ReactNode} from "react";
import {createPortal} from "react-dom";
import {CloseIcon} from "@/components/icons";

/**
 * Accessible dialog. Used for the deploy and withdraw flows, both of which
 * move real ETH, so the keyboard has to be able to reach and leave it without
 * a mouse: focus moves in on open, Tab cycles inside, Escape closes, and focus
 * returns to whatever opened it.
 */

const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Read out with the title. Also rendered under it. */
  description?: ReactNode;
  children?: ReactNode;
  /** Actions pinned below a hairline. */
  footer?: ReactNode;
  size?: "sm" | "md";
  /** Set false while a transaction is in flight. */
  dismissible?: boolean;
};

const WIDTH = {
  sm: "max-w-[400px]",
  md: "max-w-[520px]",
} as const;

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
}: ModalProps) {
  const titleId = useId();
  const descId = useId();
  const dialog = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const close = useCallback(() => {
    if (dismissible) onClose();
  }, [dismissible, onClose]);

  useEffect(() => {
    if (!open) return;

    opener.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Lock the page behind the dialog, compensating for the scrollbar so the
    // layout underneath does not jump sideways as it disappears.
    const {body} = document;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    body.style.overflow = "hidden";
    if (gap > 0) body.style.paddingRight = `${gap}px`;

    // Focus the dialog itself so the title is announced, unless the content
    // names a field worth landing in with `data-autofocus`. Grabbing the first
    // focusable would put the caret on the close button every time.
    const focusTimer = window.setTimeout(() => {
      const panel = dialog.current;
      if (!panel) return;
      const preferred = panel.querySelector<HTMLElement>("[data-autofocus]");
      (preferred ?? panel).focus();
    }, 0);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = dialog.current;
      if (!panel) return;
      const targets = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (targets.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = targets[0];
      const last = targets[targets.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      window.clearTimeout(focusTimer);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
      opener.current?.focus();
    };
  }, [open, close]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={close}
        className="absolute inset-0 cursor-default bg-ink/25 backdrop-blur-[3px]"
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`panel relative w-full ${WIDTH[size]} shadow-[0_24px_60px_rgba(17,18,16,0.18)] focus:outline-none`}
      >
        <div className="flex items-start justify-between gap-4 p-5 sm:p-6">
          <div className="min-w-0">
            <h2 id={titleId} className="h3">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-2 text-[14px] leading-[1.55] text-muted">
                {description}
              </p>
            ) : null}
          </div>
          {dismissible ? (
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="-mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-sharp text-faint transition-colors hover:bg-panel hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
            >
              <CloseIcon size={16} />
            </button>
          ) : null}
        </div>

        {children ? (
          <>
            <hr className="rule" />
            <div className="p-5 sm:p-6">{children}</div>
          </>
        ) : null}

        {footer ? (
          <>
            <hr className="rule" />
            <div className="flex flex-wrap justify-end gap-3 p-5 sm:p-6">{footer}</div>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
