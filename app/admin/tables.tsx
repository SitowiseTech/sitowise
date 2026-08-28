import {Cell, NoData, TableHead} from "@/app/admin/ui";
import {Panel} from "@/components/ui/Panel";
import {addressUrl, txUrl} from "@/lib/chain";
import type {BuyerRow, TierMoney, WithdrawalRow} from "@/lib/adminData";
import type {DistributionRow} from "@/lib/ledger";
import {formatEth, formatEthLabel, nodeLabel, shortAddress, timeAgo} from "@/lib/format";

/** The last fifty of each (spec 14). Both scroll inside the panel on narrow screens. */

const DISTRIBUTION_COLUMNS = ["Time", "Mode", "Nodes", "Total", "Per node"] as const;
/**
 * No status column: rows are indexed from confirmed `Withdrawn` events, so a
 * row existing IS the confirmation. The block number is shown instead, which is
 * the thing you actually want when reconciling against the explorer.
 */
const WITHDRAWAL_COLUMNS = ["Time", "Node", "To", "Amount", "Block", "Transaction"] as const;

const BUYER_COLUMNS = ["Wallet", "Nodes", "Spent", "First", "Last", "Node ids"] as const;

/**
 * Who bought, largest holder first.
 *
 * The whole row is a link to the wallet on Blockscout, not just the address
 * text, because the reason to look at this table is almost always to go and
 * read that wallet.
 */
export function BuyersTable({rows}: {rows: BuyerRow[]}) {
  return (
    <Panel label="Buyers" padding="none">
      {rows.length === 0 ? (
        <p className="px-5 py-6">
          <NoData>Nobody has bought yet</NoData>
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <TableHead columns={BUYER_COLUMNS} />
            <tbody>
              {rows.map((row) => (
                <tr key={row.address} className="group">
                  <Cell align="left">
                    <a
                      href={addressUrl(row.address)}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={`${row.address} on Blockscout`}
                      className="font-mono text-[12.5px] group-hover:text-orange"
                    >
                      {shortAddress(row.address)}
                    </a>
                  </Cell>
                  <Cell className="tabular">{row.nodes}</Cell>
                  <Cell>{formatEthLabel(row.spentWei)}</Cell>
                  <Cell className="text-muted">
                    <span title={row.firstBuyAt.toISOString()}>{timeAgo(row.firstBuyAt)}</span>
                  </Cell>
                  <Cell className="text-muted">
                    <span title={row.lastBuyAt.toISOString()}>{timeAgo(row.lastBuyAt)}</span>
                  </Cell>
                  {/* Truncated on purpose: a wallet holding twenty five would
                      otherwise stretch the row past every other column. */}
                  <Cell className="text-muted">
                    <span title={row.nodeIds.map((id) => nodeLabel(id)).join(", ")}>
                      {row.nodeIds.slice(0, 4).map((id) => nodeLabel(id)).join(", ")}
                      {row.nodeIds.length > 4 ? ` +${row.nodeIds.length - 4}` : ""}
                    </span>
                  </Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function DistributionsTable({rows}: {rows: DistributionRow[]}) {
  return (
    <Panel label="Last 50 distributions" padding="none">
      {rows.length === 0 ? (
        <p className="px-5 py-6">
          <NoData>No distributions yet</NoData>
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <TableHead columns={DISTRIBUTION_COLUMNS} />
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <Cell align="left">
                    <span title={row.createdAt.toISOString()}>{timeAgo(row.createdAt)}</span>
                  </Cell>
                  <Cell>{row.mode}</Cell>
                  <Cell>{row.nodeCount}</Cell>
                  <Cell>{formatEth(row.totalWei)}</Cell>
                  <Cell className="text-muted">
                    {row.nodeCount > 0 ? formatEth(row.totalWei / BigInt(row.nodeCount)) : "0"}
                  </Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function WithdrawalsTable({rows}: {rows: WithdrawalRow[]}) {
  return (
    <Panel label="Last 50 withdrawals" padding="none">
      {rows.length === 0 ? (
        <p className="px-5 py-6">
          <NoData>No withdrawals yet</NoData>
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <TableHead columns={WITHDRAWAL_COLUMNS} />
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <Cell align="left">
                    <span title={row.observedAt.toISOString()}>{timeAgo(row.observedAt)}</span>
                  </Cell>
                  <Cell>{nodeLabel(row.chainNodeId)}</Cell>
                  <Cell>
                    <a
                      href={addressUrl(row.toAddress)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-mono text-[12.5px] hover:text-orange"
                    >
                      {shortAddress(row.toAddress)}
                    </a>
                  </Cell>
                  <Cell>{formatEth(row.amountWei)}</Cell>
                  <Cell className="tabular">{row.blockNumber.toLocaleString("en-US")}</Cell>
                  <Cell>
                    <a
                      href={txUrl(row.txHash)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-mono text-[12.5px] hover:text-orange"
                    >
                      {shortAddress(row.txHash, 8, 6)}
                    </a>
                  </Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

const TIER_COLUMNS = [
  "Tier",
  "Nodes",
  "Taken in",
  "Paid out",
  "Last 24h",
  "Per credit",
  "Per node, per day",
] as const;

/**
 * Money by tier.
 *
 * Every other panel answers a question about the whole product. This one exists
 * because a tier is a decision that can be reversed: it shows what each one has
 * taken in against what it has paid out, so a tier that is quietly draining the
 * float is visible before the float is gone rather than after.
 *
 * The last two columns are the configured rate rather than history: what one
 * node of this tier draws per credit, and roughly what that comes to in a day.
 * They are what you change in the tier form above, shown here in ETH so the
 * effect of a basis-point edit is not left to arithmetic.
 */
export function TierMoneyTable({rows}: {rows: TierMoney[]}) {
  return (
    <Panel label="Money by tier" padding="none">
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-[14px] text-faint">No data yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <TableHead columns={TIER_COLUMNS} />
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <Cell align="left">{row.label}</Cell>
                  <Cell align="right">{row.nodes}</Cell>
                  <Cell align="right">{formatEthLabel(row.revenueWei)}</Cell>
                  <Cell align="right">{formatEthLabel(row.creditedWei)}</Cell>
                  <Cell align="right">{formatEthLabel(row.credited24hWei)}</Cell>
                  <Cell align="right">
                    {formatEth(row.perCreditMinWei, 8)} to {formatEth(row.perCreditMaxWei, 8)}
                  </Cell>
                  <Cell align="right">{formatEthLabel(row.perDayWei)}</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
