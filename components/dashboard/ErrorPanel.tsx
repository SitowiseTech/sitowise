"use client";

import {Button} from "@/components/ui/Button";
import {WarningIcon} from "@/components/icons";

/**
 * What the dashboard shows instead of a blank page when the API is down
 * (spec 5.3). The message is whatever the server or the network gave us, so it
 * stays specific rather than collapsing into "something went wrong".
 */

export type ErrorPanelProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
};

export function ErrorPanel({
  title = "Could not load your nodes",
  message,
  onRetry,
  retrying = false,
}: ErrorPanelProps) {
  return (
    <div role="alert" className="panel flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
      <WarningIcon size={20} className="shrink-0 text-orange" />
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-ink">{title}</div>
        <p className="mt-1 text-[14px] leading-[1.55] break-words text-muted">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="ghost" size="sm" onClick={onRetry} loading={retrying}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
