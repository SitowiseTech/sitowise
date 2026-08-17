"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {createPortal} from "react-dom";
import {CloseIcon} from "@/components/icons";
import {StatusDot, type StatusTone} from "@/components/ui/StatusDot";

/**
 * Transient status for actions that leave the page: a submitted transaction, a
 * failed signature, a withdrawal that landed. Deliberately small and
 * dependency free.
 *
 * Errors stay up longer than confirmations, and a toast with `duration: 0`
 * stays until it is dismissed, which is what a pending transaction wants.
 */

export type ToastTone = "info" | "success" | "error";

export type ToastInput = {
  title: string;
  body?: string;
  tone?: ToastTone;
  /** Milliseconds on screen. 0 keeps it until dismissed. */
  duration?: number;
  /** Optional trailing link, typically the explorer. */
  href?: string;
  hrefLabel?: string;
};

type ToastRecord = ToastInput & {id: number};

type ToastApi = {
  push: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
};

const DEFAULT_MS: Record<ToastTone, number> = {
  info: 5000,
  success: 5000,
  error: 9000,
};

const DOT: Record<ToastTone, StatusTone> = {
  info: "pending",
  success: "live",
  error: "error",
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}

export function ToastProvider({children}: {children: ReactNode}) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const [mounted, setMounted] = useState(false);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => setMounted(true), []);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++;
      setToasts((current) => [...current, {...toast, id}]);
      const ms = toast.duration ?? DEFAULT_MS[toast.tone ?? "info"];
      if (ms > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), ms),
        );
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({push, dismiss}), [push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {mounted
        ? createPortal(
            <div className="pointer-events-none fixed right-0 bottom-0 z-[120] flex w-full max-w-[420px] flex-col gap-2 p-4 sm:p-6">
              {toasts.map((toast) => (
                <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
              ))}
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastRecord;
  onDismiss: (id: number) => void;
}) {
  const tone = toast.tone ?? "info";
  // Enter transition runs off a state flip rather than a keyframe, so the
  // reduced-motion rule in globals.css neutralises it along with everything else.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={`panel pointer-events-auto flex w-full items-start gap-3 p-4 shadow-[0_16px_40px_rgba(17,18,16,0.14)] transition-[opacity,transform] duration-300 ease-out ${
        entered ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      <StatusDot tone={DOT[tone]} className="mt-[7px]" />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-ink">{toast.title}</div>
        {toast.body ? (
          <div className="mt-1 text-[13px] leading-[1.5] break-words text-muted">
            {toast.body}
          </div>
        ) : null}
        {toast.href ? (
          <a
            href={toast.href}
            target="_blank"
            rel="noreferrer noopener"
            className="mono-label mt-2 inline-block text-orange hover:underline"
          >
            {toast.hrefLabel ?? "View"}
          </a>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-sharp text-faint transition-colors hover:bg-panel hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}
