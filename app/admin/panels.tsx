import {DistributeNow} from "@/app/admin/DistributeNow";
import {FundButton} from "@/app/admin/FundButton";
import {ResolveAlert} from "@/app/admin/ResolveAlert";
import {Field, NoData, Stat, StatGrid} from "@/app/admin/ui";
import {CopyButton} from "@/components/ui/CopyButton";
import {Panel} from "@/components/ui/Panel";
import {StatusDot} from "@/components/ui/StatusDot";
import type {Alert} from "@/lib/alerts";
import type {AdminSnapshot} from "@/lib/adminData";
import {addressUrl} from "@/lib/chain";
import {formatEthLabel, shortAddress, timeAgo} from "@/lib/format";
import {WORKER_STALL_SEC} from "@/lib/settings";

/**
 * The state panels of the console. Labels say what things are: this is the
 * internal surface, so the wallet that receives node payments is called the
 * treasury here even though no public page uses that word.
 */

const ALERT_LABEL: Record<string, string> = {
  low_liquidity: "Low liquidity",
  daily_cap: "Daily cap",
  distributor_float: "Distributor float",
  credit_unrecorded: "Credit not recorded",
  unknown_nodes: "Unknown node ids",
  swaps_unconfigured: "Swaps mode unavailable",
  config: "Settings",
  worker_error: "Worker error",
  payment_discovery: "Payment discovery",
};

function label(kind: string): string {
  return ALERT_LABEL[kind] ?? kind.replace(/_/g, " ");
}

function when(date: Date | null): string {
  return date ? `${timeAgo(date)}` : "never";
}

/* ------------------------------------------------------------------ money */

export function MoneyPanel({snapshot}: {snapshot: AdminSnapshot}) {
  const {chain, treasury, ledger, coverageWei, suggestedTopUpWei, dailySpendWei} = snapshot;

  // Both halves of the sum have to be readable before the page may claim a
  // number, or the absence of data reads as "nothing needed".
  const sizable = coverageWei !== null && dailySpendWei !== null;

  return (
    <Panel
      label="Liquidity"
      padding="none"
      action={
        chain.ok ? (
          <FundButton
            factory={chain.data.address}
            suggestedWei={suggestedTopUpWei === null ? null : suggestedTopUpWei.toString()}
          />
        ) : null
      }
    >
      <StatGrid columns={4}>
        <Stat
          label="Contract balance"
          value={chain.ok ? formatEthLabel(chain.data.balanceWei) : <NoData>Unreachable</NoData>}
          hint={chain.ok ? undefined : chain.error}
        />
        <Stat
          label="Treasury balance"
          value={
            treasury.balance?.ok ? formatEthLabel(treasury.balance.data) : <NoData>Unreachable</NoData>
          }
          hint={
            treasury.address ? (
              <span className="inline-flex items-center gap-1">
                <a
                  href={addressUrl(treasury.address)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-mono text-[12px] hover:text-orange"
                >
                  {shortAddress(treasury.address)}
                </a>
                <CopyButton value={treasury.address} label="Copy treasury address" />
              </span>
            ) : (
              treasury.error ?? undefined
            )
          }
        />
        <Stat
          label="Owed to node holders"
          value={ledger ? formatEthLabel(ledger.unwithdrawnWei) : <NoData />}
          hint="Credited in the ledger and not withdrawn"
        />
        <Stat
          label="Difference"
          value={coverageWei === null ? <NoData /> : formatEthLabel(coverageWei)}
          tone={coverageWei === null ? "default" : coverageWei < 0n ? "bad" : "good"}
          hint={
            coverageWei === null
              ? undefined
              : coverageWei < 0n
                ? "The contract cannot cover what it owes"
                : "Contract balance above obligations"
          }
        />
      </StatGrid>

      <div className="flex flex-col gap-1 border-t border-line px-5 py-4 text-[13px] text-muted">
        <p>
          {!sizable
            ? "A top-up cannot be sized until both the contract and the ledger are readable."
            : suggestedTopUpWei === null
              ? "No top-up needed at the current settings."
              : `Suggested top-up: ${formatEthLabel(suggestedTopUpWei)}. That covers what is owed plus three days at the current rate.`}
        </p>
        {dailySpendWei !== null && dailySpendWei > 0n ? (
          <p>Projected spend at the current settings and node count: {formatEthLabel(dailySpendWei)} per day.</p>
        ) : null}
        {chain.ok ? (
          <p className="flex flex-wrap items-center gap-1">
            <span>Contract</span>
            <a
              href={addressUrl(chain.data.address)}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-[12px] text-ink hover:text-orange"
            >
              {chain.data.address}
            </a>
            <CopyButton value={chain.data.address} label="Copy contract address" />
            <span>
              credited {formatEthLabel(chain.data.totalDistributedWei)}, withdrawn{" "}
              {formatEthLabel(chain.data.totalWithdrawnWei)}, owed to nodes{" "}
              {formatEthLabel(chain.data.outstandingWei)}
              {chain.data.isSolvent ? "" : " (NOT fully backed)"}
            </span>
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

/* ----------------------------------------------------------------- counts */

/**
 * Money in, for the whole life of the project.
 *
 * `soldNodes` counts payments that actually became a node. Payments still in
 * flight are shown beside it rather than folded into it: counting a sale before
 * it mints would overstate revenue and every figure derived from it.
 */
export function SalesPanel({snapshot}: {snapshot: AdminSnapshot}) {
  const {ledger, ledgerError} = snapshot;
  const needsAttention = (ledger?.reviewPayments ?? 0) + (ledger?.failedPayments ?? 0);

  return (
    <Panel label="Sales, all time" padding="none">
      <StatGrid columns={4}>
        <Stat
          label="Nodes sold"
          value={ledger ? ledger.soldNodes : <NoData />}
          hint={
            ledger?.firstSaleAt ? `First sale ${when(ledger.firstSaleAt)}` : "No sale yet"
          }
        />
        <Stat
          label="Taken in"
          value={ledger ? formatEthLabel(ledger.revenueWei) : <NoData />}
          hint="Paid to the payments wallet for minted nodes"
        />
        <Stat
          label="Sold in 24h"
          value={ledger ? ledger.soldNodes24h : <NoData />}
          hint={ledger ? `${formatEthLabel(ledger.revenue24hWei)} in` : undefined}
        />
        <Stat
          label="In flight"
          value={ledger ? ledger.pendingPayments : <NoData />}
          hint={
            needsAttention > 0
              ? `${needsAttention} need a look: ${ledger?.reviewPayments ?? 0} review, ${ledger?.failedPayments ?? 0} failed`
              : "Seen but not minted yet"
          }
          tone={needsAttention > 0 ? "bad" : "default"}
        />
      </StatGrid>
      {ledgerError ? (
        <p className="border-t border-line px-5 py-4 text-[13px] text-red">Database: {ledgerError}</p>
      ) : null}
    </Panel>
  );
}

/**
 * Money out, for the whole life of the project.
 *
 * "Net" is what came in minus everything credited to holders, which is the one
 * number that says whether the node sale is ahead or behind. It is deliberately
 * measured against `cumulativeWei` (credited) rather than `withdrawnWei` (taken
 * out): the moment a balance is credited the money has left, whether or not the
 * holder has pulled it yet.
 */
export function PayoutsPanel({snapshot}: {snapshot: AdminSnapshot}) {
  const {ledger, ledgerError} = snapshot;
  const net =
    ledger === null ? null : ledger.revenueWei - ledger.cumulativeWei;

  return (
    <Panel label="Payouts, all time" padding="none">
      <StatGrid columns={4}>
        <Stat
          label="Credited to nodes"
          value={ledger ? formatEthLabel(ledger.cumulativeWei) : <NoData />}
          hint="Everything ever accrued, withdrawn or not"
        />
        <Stat
          label="Withdrawn by holders"
          value={ledger ? formatEthLabel(ledger.withdrawnWei) : <NoData />}
          hint={
            ledger
              ? `${ledger.withdrawalCount} withdrawal${ledger.withdrawalCount === 1 ? "" : "s"} by ${ledger.withdrawers} wallet${ledger.withdrawers === 1 ? "" : "s"}` +
                (ledger.lastWithdrawalAt ? `, last ${when(ledger.lastWithdrawalAt)}` : "")
              : undefined
          }
        />
        <Stat
          label="Still owed"
          value={ledger ? formatEthLabel(ledger.unwithdrawnWei) : <NoData />}
          hint="Credited but not yet pulled out"
        />
        <Stat
          label="Net"
          value={net === null ? <NoData /> : formatEthLabel(net)}
          hint="Taken in minus credited to nodes"
          tone={net === null ? "default" : net < 0n ? "bad" : "good"}
        />
      </StatGrid>
      {ledgerError ? (
        <p className="border-t border-line px-5 py-4 text-[13px] text-red">Database: {ledgerError}</p>
      ) : null}
    </Panel>
  );
}

export function CountsPanel({snapshot}: {snapshot: AdminSnapshot}) {
  const {ledger, ledgerError} = snapshot;

  return (
    <Panel label="Nodes and rounds" padding="none">
      <StatGrid columns={4}>
        <Stat label="Active nodes" value={ledger ? ledger.activeNodes : <NoData />} />
        <Stat
          label="Operators"
          value={ledger ? ledger.operators : <NoData />}
          hint="Distinct wallets holding an active node"
        />
        <Stat label="Rounds in 24h" value={ledger ? ledger.rounds24h : <NoData />} />
        <Stat
          label="Distributed in 24h"
          value={ledger ? formatEthLabel(ledger.distributed24hWei) : <NoData />}
          hint={ledger?.lastDistributionAt ? `Last round ${when(ledger.lastDistributionAt)}` : undefined}
        />
      </StatGrid>
      {ledgerError ? (
        <p className="border-t border-line px-5 py-4 text-[13px] text-red">Database: {ledgerError}</p>
      ) : null}
    </Panel>
  );
}

/* ----------------------------------------------------------------- worker */

export function WorkerPanel({snapshot}: {snapshot: AdminSnapshot}) {
  const {worker, settings, ledger, chain} = snapshot;
  const state = worker.state;

  const running = state?.lastTickAt != null && !worker.stalled;
  const status = state?.lastTickAt == null ? "never started" : worker.stalled ? "silent" : "running";
  const tone = state?.lastTickAt == null ? "idle" : worker.stalled ? "error" : "live";

  const publishedWei = state?.publishedWei ?? null;
  const creditedWei = ledger?.cumulativeWei ?? null;
  const publishGap =
    publishedWei !== null && creditedWei !== null ? creditedWei - publishedWei : null;

  return (
    <Panel
      label="Worker"
      padding="none"
      action={
        <DistributeNow
          disabled={!running || !(settings?.config.enabled ?? false)}
          reason={
            !running
              ? "The worker is not checking in."
              : settings?.config.enabled
                ? undefined
                : "Distribution is switched off."
          }
        />
      }
    >
      <div className="flex flex-col gap-1 px-5 py-4">
        <div className="flex items-center gap-2 pb-2">
          <StatusDot tone={tone} label={status} />
          {worker.silentSec !== null && worker.stalled ? (
            <span className="text-[13px] text-red">
              No heartbeat for {Math.floor(worker.silentSec / 60)} minutes.
            </span>
          ) : null}
        </div>
        <Field label="Last heartbeat">{when(state?.lastTickAt ?? null)}</Field>
        <Field label="Last round">{when(state?.lastRunAt ?? null)}</Field>
        <Field label="Next round">
          {state?.nextRunAt ? state.nextRunAt.toISOString().slice(11, 19) + " UTC" : "unscheduled"}
        </Field>
        <Field label="Mode">{settings ? settings.config.mode : <NoData />}</Field>
        <Field label="Credited on chain">
          {publishedWei === null ? (
            <NoData />
          ) : publishGap !== null && publishGap > 0n ? (
            <span className="text-red">{formatEthLabel(publishGap)} behind the ledger</span>
          ) : (
            "level with the ledger"
          )}
        </Field>
        {chain.ok ? (
          <Field label="Minting">{chain.data.paused ? "paused" : "open"}</Field>
        ) : null}
        {state?.pausedReason ? (
          <p className="pt-2 text-[13px] text-muted">Holding: {state.pausedReason}</p>
        ) : null}
        {state?.lastError ? (
          <p className="pt-1 text-[13px] text-red">Last error: {state.lastError}</p>
        ) : null}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------- discovery */

/**
 * Payment discovery, which is a different question from "is the worker alive".
 *
 * Incoming purchases are found through the explorer's address index, so the two
 * things worth showing are whether that index answered and how far behind the
 * cursor is. The block gap is also given in minutes: nobody knows off-hand what
 * 57,000 blocks feels like, and "a day behind" is the sentence that makes
 * somebody act.
 */
export function DiscoveryPanel({snapshot}: {snapshot: AdminSnapshot}) {
  const {watcher, watcherError} = snapshot;

  if (!watcher) {
    return (
      <Panel label="Payment discovery" padding="none">
        <p className="px-5 py-6 text-[14px] text-red">
          Discovery status is unreadable{watcherError ? `: ${watcherError}` : "."}
        </p>
      </Panel>
    );
  }

  const behind = Number(watcher.behindBlocks);
  // Two minutes of chain. Below that the watcher is simply mid-pass.
  const lagging = behind > 1_200;
  const tone = !watcher.explorerOk ? "error" : lagging ? "pending" : "live";
  const status = !watcher.explorerOk ? "blind" : lagging ? "behind" : "watching";

  return (
    <Panel label="Payment discovery" padding="none">
      <div className="flex flex-col gap-1 px-5 py-4">
        <div className="flex items-center gap-2 pb-2">
          <StatusDot tone={tone} label={status} />
          {watcher.explorerOk ? null : (
            <span className="text-[13px] text-red">
              The address index is not answering, so new payments are not being found.
            </span>
          )}
        </div>
        <Field label="Cursor">{watcher.cursor ?? <NoData>Not set</NoData>}</Field>
        <Field label="Chain head">{watcher.headBlock}</Field>
        <Field label="Behind">
          {behind === 0 ? (
            "level with the head"
          ) : (
            <span className={lagging ? "text-red" : undefined}>
              {watcher.behindBlocks} blocks, about {minutes(watcher.behindSeconds)}
            </span>
          )}
        </Field>
        <Field label="Explorer index">
          {watcher.explorerOk ? (
            `${watcher.indexedHead ?? "?"} (${watcher.indexLagBlocks ?? "?"} behind the head)`
          ) : (
            <span className="text-red">{watcher.explorerError ?? "unreachable"}</span>
          )}
        </Field>
        <Field label="Waiting to mint">{watcher.pendingPayments}</Field>
      </div>
    </Panel>
  );
}

/** Seconds as the unit an operator thinks in. */
function minutes(seconds: number): string {
  if (seconds < 90) return `${seconds} seconds`;
  if (seconds < 5_400) return `${Math.round(seconds / 60)} minutes`;
  return `${(seconds / 3_600).toFixed(1)} hours`;
}

/* ----------------------------------------------------------------- alerts */

export function AlertsPanel({snapshot}: {snapshot: AdminSnapshot}) {
  const {alerts, alertHistory, worker} = snapshot;
  // The worker cannot write an alert saying it is down, so this one is derived
  // from the heartbeat rather than read from the table.
  const silent = worker.state?.lastTickAt == null || worker.stalled;
  const closed = alertHistory.filter((alert) => alert.resolvedAt !== null).slice(0, 5);

  if (!silent && alerts.length === 0) {
    return (
      <Panel label="Alerts" padding="none">
        <p className="px-5 py-4 text-[14px] text-muted">Nothing to report.</p>
        <ClosedAlerts alerts={closed} />
      </Panel>
    );
  }

  return (
    <Panel label="Alerts" padding="none">
      <ul>
        {silent ? (
          <li className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 last:border-b-0">
            <div className="min-w-0">
              <span className="mono-label text-red">Worker silent</span>
              <p className="mt-1 text-[14px] text-ink">
                {worker.state?.lastTickAt == null
                  ? "The worker has never checked in."
                  : `No heartbeat for ${Math.floor((worker.silentSec ?? 0) / 60)} minutes, past the ${WORKER_STALL_SEC / 60} minute limit.`}
              </p>
            </div>
          </li>
        ) : null}

        {alerts.map((alert) => (
          <li
            key={alert.id}
            className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 last:border-b-0"
          >
            <div className="min-w-0">
              <span className={`mono-label ${alert.severity === "stop" ? "text-red" : "text-orange"}`}>
                {label(alert.kind)}
              </span>
              <p className="mt-1 text-[14px] text-ink">{alert.message}</p>
              <p className="mt-1 text-[12.5px] text-faint">
                raised {timeAgo(alert.createdAt)}, last seen {timeAgo(alert.updatedAt)}
              </p>
            </div>
            <ResolveAlert id={alert.id} />
          </li>
        ))}
      </ul>
      <ClosedAlerts alerts={closed} />
    </Panel>
  );
}

/** Recently closed alerts, so a condition that keeps coming back is visible. */
function ClosedAlerts({alerts}: {alerts: Alert[]}) {
  if (alerts.length === 0) return null;
  return (
    <div className="border-t border-line px-5 py-4">
      <span className="mono-label">Recently closed</span>
      <ul className="mt-2 flex flex-col gap-1">
        {alerts.map((alert) => (
          <li key={alert.id} className="text-[13px] text-muted">
            {label(alert.kind)}: {alert.message}{" "}
            <span className="text-faint">
              ({alert.resolvedAt ? timeAgo(alert.resolvedAt) : "open"})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
