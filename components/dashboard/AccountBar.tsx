"use client";

import {Button} from "@/components/ui/Button";
import {CopyButton} from "@/components/ui/CopyButton";
import {Reveal} from "@/components/Reveal";
import {Tooltip} from "@/components/dashboard/Tooltip";
import {useWallet} from "@/components/dashboard/WalletProvider";
import {addressUrl} from "@/lib/chain";
import {shortAddress} from "@/lib/format";

/**
 * The signed-in header: which wallet this is, and the two things it can do.
 * Deploy is blocked at the per-wallet cap with the reason attached, since the
 * contract would reject the transaction anyway and the user should not pay a
 * failed one.
 *
 * The deploy dialog itself lives one level up in Dashboard.tsx: the empty node
 * list opens the same flow, and two mounted copies of a modal that sends a
 * payment is one copy too many.
 */

export type AccountBarProps = {
  nodeCount: number;
  limit: number;
  onDeploy: () => void;
};

export function AccountBar({nodeCount, limit, onDeploy}: AccountBarProps) {
  const {address, disconnect} = useWallet();
  const atLimit = nodeCount >= limit;

  return (
    <Reveal
      variant="panel"
      className="panel flex flex-wrap items-center justify-between gap-4 px-5 py-4"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="mono-label">Wallet</span>
        <a
          href={address ? addressUrl(address) : "#"}
          target="_blank"
          rel="noreferrer noopener"
          className="font-mono text-[14px] text-ink transition-colors hover:text-orange"
        >
          {address ? shortAddress(address) : ""}
        </a>
        {address ? <CopyButton value={address} label="Copy address" /> : null}
      </div>

      <div className="flex items-center gap-3">
        {atLimit ? (
          <Tooltip label={`This wallet already holds the maximum of ${limit} nodes.`}>
            <Button size="sm" disabled>
              Deploy a node
            </Button>
          </Tooltip>
        ) : (
          <Button size="sm" onClick={onDeploy}>
            Deploy a node
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => void disconnect()}>
          Disconnect
        </Button>
      </div>
    </Reveal>
  );
}
