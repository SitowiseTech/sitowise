# The credit worker

What puts ETH on node balances.

A credit pass takes whichever nodes' timers have come up, draws a separate
amount for each of them, sends one `creditBatch` transaction carrying that ETH,
and only then records the round and moves the timers. The pass itself lives in
`lib/credit.ts`. This directory holds the process that can run it in a loop, the
chain primitives it uses, and the rules that decide whether it may run at all.

## Two ways to run it, one pass

- **Scheduler.** `POST /api/cron/credit` (or `GET`, because several cron
  services only issue GET), with the secret in an `x-cron-key` header.
- **Process.** `npm run worker`, which loops on `DIST_TICK_SEC` and calls the
  same function.

Both take the same Postgres advisory lock (`918273`), so running both is safe:
whichever arrives first does the pass and the other reports `ran: false`. That
is a normal outcome, not an error.

Note that Vercel's built-in cron cannot send a custom header, so the scheduler
is an external one (cron-job.org, a GitHub Action, an uptime service with a
custom header, or a supervised `npm run worker` somewhere).

```
npm install
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/002_worker_admin.sql
psql "$DATABASE_URL" -f db/migrations/002_onchain.sql
npm run worker
```

The process reads `.env.local` then `.env` on start, and a variable already
present in the real environment always wins, so systemd, Docker and a PaaS
dashboard all work unchanged. `SIGTERM` stops it: the loop finishes what it is
doing, closes the connection pool and exits.

## What one pass does

1. Read the settings (env, with any `/admin` overrides applied on top).
2. Refuse, with a reason, if distribution is off, the mode is unavailable, or no
   distributor key is configured.
3. Take up to `MAX_NODES_PER_TICK` (200) nodes whose `next_credit_at` has
   passed. None due means the pass ends here, before any RPC call.
4. Read the factory. Refuse if it cannot be read, if it is paused, or if the
   configured key is not the address the contract stores as `distributor`.
5. Drop any scheduled id the contract or the ledger does not know, and say which.
6. Draw a **separate** amount per node from
   `[DIST_MIN_AMOUNT_WEI, DIST_MAX_AMOUNT_WEI]` with the CSPRNG. Never one
   amount reused across the batch: per-node randomness is the entire point.
7. Check the rails.
8. Send `creditBatch` and wait for the receipt.
9. Only then: insert the `distributions` row, the `credits` rows, and move each
   node's timer forward by its own freshly drawn delay, in one transaction.

### The order is the design

The chain call comes first and the writes come second. If the transaction fails,
the timers are still in the past, nothing was recorded, and the next pass
retries by itself. The opposite order would record credits that never happened.

A node is credited **at most once per pass**, and its next due time is measured
from now, not from when it was due. After an outage the timers move forward from
the moment the worker comes back; a missed interval is never owed and never
paid out as a backlog.

## Safety rails

Every one of these refuses the whole pass and reports a distinct reason. None of
them stops the process, and none of them is silent.

| reason | what it means |
| --- | --- |
| `disabled` | `DIST_ENABLED` is false. |
| `mode_unavailable` | `DIST_MODE=swaps`, which no longer has a chain source. |
| `distributor_missing` | `DISTRIBUTOR_PRIVATE_KEY` is not set. |
| `distributor_mismatch` | The key is not the contract's `distributor`. |
| `no_nodes_due` | No timer has come up. |
| `chain_unreadable` | The factory could not be read, so solvency is unverifiable. |
| `contract_paused` | The factory is paused. |
| `no_creditable_nodes` | Every due id was dropped as unknown. |
| `insolvent` | The contract holds less than it already owes holders. |
| `daily_cap` | The rolling 24h total would pass `DIST_DAILY_CAP_WEI`. |
| `distributor_float` | The distributor cannot cover the batch plus its gas. |
| `chain_call_failed` | `creditBatch` reverted or never confirmed. |

Two of them deserve their reasoning spelled out:

**Solvency.** If the contract's balance is below `outstanding`, the pass stops
and raises a `low_liquidity` alert. Being unable to cover obligations that
already exist is worse than missing a tick. The check does not need an "after"
form: `creditBatch` is payable and carries its own value, so balance and
`outstanding` rise by exactly the same amount and a credit can never push a
solvent contract into deficit.

**Unknown ids.** `creditBatch` reverts on the first id the contract does not
know and takes the whole batch with it, so one stray schedule row would stall
every payout for everyone. Ids are validated against `totalNodes()` before
sending; the contract mints `1..totalNodes` with no gaps and never deletes one,
so that bound is exactly equivalent to checking each node's owner, at one
`eth_call` instead of two hundred.

Conditions that are the operator's rather than any node's (paused, cap reached,
float low) also push the due timers out by `DIST_MAX_DELAY_SEC`. Nobody loses a
credit, and the first pass after the condition lifts is a normal-sized batch
instead of a full 200 that says nothing about how long the outage was.

## When the money moves and the write does not

The one bad case the ordering cannot remove: `creditBatch` confirms and the
ledger transaction then fails. The worker responds by moving the timers on their
own (a repeat payout cannot be taken back; a missing history row can be
reconstructed) and raising a `credit_unrecorded` alert at `stop` severity
carrying the transaction hash and every id and amount in the batch. That alert
means: go and reconcile by hand.

## Health

`GET /api/cron/health` is public and unauthenticated, because everything in it
is already readable from the chain by anyone:

```json
{
  "lastTickAt": "...", "secondsSinceLastTick": 41, "stale": false,
  "distEnabled": true, "paused": false,
  "dueNodes": 3, "scheduledNodes": 42,
  "distributorBalanceWei": "...", "contractBalanceWei": "...",
  "outstandingWei": "...", "isSolvent": true
}
```

Anything older than five minutes is `stale: true`. No key addresses, no alert
detail, no error text from the database or the RPC appear in it. Point a monitor
at `stale` and at `isSolvent`.

`GET /api/admin/health` is the operator's version: it needs `x-admin-key` and
carries the pause reason, the last error and the open alerts.

## Settings

`.env` is the source of truth. A row in the `settings` table overrides one
field, and `/admin` is what writes those rows: nothing a request handler puts in
`process.env` could ever reach a separate worker process, which is the whole
reason the table exists. "Revert to environment" deletes the rows.

Amounts are wei (`DIST_MIN_AMOUNT_WEI`, `DIST_MAX_AMOUNT_WEI`,
`DIST_DAILY_CAP_WEI`) so a value cannot change meaning by passing through a
float on the way in or out. The older `DIST_*_ETH` spellings still work as a
fallback.

`DIST_TICK_SEC` is how often a pass runs. It is not the same as
`DIST_MIN_DELAY_SEC`, which is how long one node waits between its own credits.
Keep the tick no longer than the minimum delay, or timers are routinely overdue
by the difference.

## Keys and gas

`DISTRIBUTOR_PRIVATE_KEY` must be the address the contract stores as
`distributor`, and it holds the payout float: `creditBatch` is payable, so the
same balance pays both the credited amounts and the gas. The worker checks the
address against the contract at startup and again on every pass, because a
rotated role would otherwise fail once a minute forever.

The relayer key is a different account with a different power (`mintFor` only)
and is not used here. Neither key can touch a node balance; only a node's owner
can withdraw.

## What this actually funds

Payouts come from the distributor float, not from swap flow. `DIST_MODE=swaps`
existed to credit what a Uniswap v4 hook took from real swaps; that hook is no
longer part of the system, so the mode has no chain source and now says so
plainly instead of quietly behaving like `treasury`. The site says the same
thing.
