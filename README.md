# Sitowise

Node sales on Robinhood Chain (chain id 4663), plus the site, dashboard, public API, docs,
payment watcher and distribution worker that go with it.

A **node** is a position in `SitowiseFactory`. You pay 0.02 ETH, a node is recorded as yours,
and a balance accrues against it on chain. It is not an NFT and not a token: there is nothing
to trade, it cannot be transferred, and the only thing a node does is accumulate a balance you
withdraw to an address you choose.

- **App:** Next.js 16 (App Router, Turbopack), TypeScript strict, Tailwind v4.
- **Chain:** Robinhood Chain 4663 (`0x1237`), RPC `https://rpc.mainnet.chain.robinhood.com`,
  explorer `https://robinhoodchain.blockscout.com`.
- **Contract:** Foundry, solc 0.8.26 — `SitowiseFactory`, deployed and verified at
  `0x389699d7C3A754d6b82EbBBa0ebE5757ccfA1dD7`.
- **Data:** Postgres (Neon). The contract is the source of truth for money; Postgres holds the
  payment queue, credit timers and history.

---

## Where the rewards come from right now

Read this before anything else, because users pay real ETH for a node.

**During the launch period, node rewards are funded by Sitowise itself, not by swap flow.** The
distributor wallet sends real ETH into the contract with every credit. Every round is recorded
with `mode = 'treasury'` in the database and exposed through `/api/distributions`.

The site plans a Uniswap v4 hook so that accrual eventually comes from real swap volume, and the
docs describe that design. `SitowiseHook` is written and tested in `contracts/src`, with a mined
salt in `contracts/HOOK.md`, but **it is not deployed and no pool names it.** A v4 pool fixes its
hook at `initialize` and can never change it, so the hook cannot be attached to pools that already
exist. Until such a pool is created and trades, `DIST_MODE=swaps` has no source of accrual, the docs say
the hook is not deployed, and nothing claims it is producing revenue.

Nothing in this project states a rate, an interval, a payback period or an APR, because none of
those can be honestly promised while the operator is the funding source. Rewards can be reduced
or stopped at any time. `/docs/risks` says this straight, and the same disclosure ships in the
hero, the final CTA, the deploy modal, the footer and the ledger.

## The guarantee holders can check

`outstanding` is the sum of every node balance, maintained by the contract itself on every
credit and every withdrawal. `rescue` can only move `address(this).balance - outstanding`, so
the contract owner can never reach holder money, under any sequence of calls.

This is not a promise about off-chain bookkeeping: `creditBatch` is payable and demands
`msg.value == sum(amounts)`, so a balance cannot exist without the ETH behind it. A fuzz
invariant asserts `balance >= outstanding` across random sequences, and the invariant is
verified by mutation — changing `rescue`'s bound to the full balance makes the suite fail.

Pausing blocks new mints and never blocks a withdrawal.

---

## How a sale works

Payment happens **outside** the contract, which is why there are four wallets.

1. The buyer sends a plain 0.02 ETH transfer to the **payments wallet**. They never call the
   contract, so they never pay contract gas.
2. The **watcher** (`/api/cron/payments`) reads new blocks, finds transfers to that wallet and
   records each one in `payments` at status `seen` **before** anything is minted. A wrong amount
   goes to `manual_review` instead, and no node is created.
3. The **relayer** calls `mintFor(to, paymentRef)` and pays that gas. `paymentRef` is the payment
   transaction hash, recorded in `paymentRefUsed`, so one payment backs exactly one node and a
   repeat reverts `RefAlreadyUsed`. A retry hitting that error is treated as success, because it
   means the node already exists.
4. The **distributor** calls `creditBatch(ids, amounts)` on a per-node random timer, sending the
   ETH with the call.
5. The owner calls `withdraw(id, to)` or `withdrawAll(to)` from their own wallet. It takes the
   node's whole balance; there is no partial withdrawal, and no server is involved.

**A buyer must pay from a wallet they control.** The node is minted to the sending address, so
paying from an exchange withdrawal puts the node on the exchange's hot wallet, where it cannot
be recovered. The deploy modal warns about this before the wallet opens.

## Layout

```
app/            routes: site, /dashboard, /docs, /ledger, /admin, /api/*
components/     site, home, dashboard, docs, ui primitives
lib/            chain, abi, factory, rpc, onchain      contract access
                payments, schedule, watcher, mintRelay payment pipeline
                credit                                 distribution tick
                db, session, env, api, apiClient       plumbing
worker/         standalone long-running variant of the credit tick
contracts/      Foundry workspace (see contracts/README.md)
db/             schema.sql and migrations
```

## Running the app

```sh
npm install
cp .env.example .env.local     # then fill it in
npm run dev
```

The site renders without a database: pages work and API routes answer a clean
`{"error": "..."}` 503. The dashboard needs `DATABASE_URL` and `NEXT_PUBLIC_FACTORY`.

## Running the schedulers

Two passes drive everything. Both are HTTP endpoints guarded by the `x-cron-key` header, and
both take a Postgres advisory lock so overlapping calls cannot double-spend.

| Endpoint | Does | Interval |
|---|---|---|
| `/api/cron/payments` | find payments through the address index, verify them on chain, mint nodes | every minute |
| `/api/cron/credit` | credit due nodes in one `creditBatch` | every minute |
| `/api/cron/health` | last tick, staleness, balances, solvency | public, read-only |

Vercel Hobby cron fires once a **day**, which is useless here, so drive them from an external
scheduler (cron-job.org has a one-minute minimum on the free tier). `worker/` holds a
standalone long-running variant of the credit tick for hosts that can run a process.

## How payments are found

A buyer sends a plain ETH transfer to `PAYMENT_ADDRESS`. That emits no log, so there is no
`eth_getLogs` filter that can find it, and the original watcher read every block and filtered
transactions by `to`. Robinhood Chain produces ~9.8 blocks a second and that loop managed ~5, so
it fell behind ~4.8 blocks every second it ran; in production it sat 57,637 blocks behind for a
day and every scheduled pass died on its time budget.

Discovery now asks Blockscout's address index instead
(`/api/v2/addresses/{address}/transactions?filter=to`, with the ranged `txlist` API as the second
opinion). One request answers for a range of any size, so the cost of a pass no longer grows with
how far behind the cursor is: a pass over a 72,000-block gap measures about 2 seconds.

**The explorer only discovers. The chain decides.** Every candidate is re-read with
`eth_getTransactionByHash` and its receipt before anything is written: it must exist, have
succeeded, really be addressed to `PAYMENT_ADDRESS`, and carry the value and sender the index
claimed. A disagreement is recorded from the chain and parked in `manual_review`.

If the index cannot be read, the pass says so rather than reporting a quiet zero: it holds the
cursor, returns `degraded` with a stop reason, raises the `payment_discovery` alert on `/admin`,
and shows up under `paymentDiscovery` on `/api/cron/health`. A small gap (`WATCHER_MAX_BLOCKS_PER_PASS`,
200 blocks) is still covered by reading blocks directly, which is slower than the chain and so is
a way to ride out a blip, never a way to catch up — that pass is reported as degraded too.

### Fast-forwarding the cursor

One pass claims at most `WATCHER_MAX_CATCHUP_BLOCKS`, deliberately: an index that answers
"nothing there" for a range it never read looks exactly like an empty range, and unattended code
should not write off a day of chain on that evidence. To close a bigger gap in one go:

```sh
curl -X POST https://<host>/api/admin/watcher \
  -H "x-admin-key: $ADMIN_KEY" -H "content-type: application/json" \
  -d '{"action":"fast-forward","confirm":"fast-forward-payment-cursor","toBlock":"46953842"}'
```

All four parts are required and none has a default. Before the cursor moves, the route proves the
skipped range empty: the index must answer for the whole range and find nothing in it, the
explorer must have indexed past the target, and the wallet must not hold ETH that no recorded
payment explains. Anything short of that is a `409` with the reason. `GET` on the same URL is the
read-only status.

## Running the tests

```sh
cd contracts
forge install foundry-rs/forge-std --no-git
forge install OpenZeppelin/openzeppelin-contracts --no-git
forge test
```

125 tests: unit, fuzz, reentrancy and the solvency invariant, plus 13 for the hook.

## Deploying the contract

See `contracts/README.md` for the deploy and Blockscout verification commands, the gas table and
the four-wallet setup.

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `AUTH_SECRET` | HMAC key for the session cookie, 32+ chars |
| `NEXT_PUBLIC_FACTORY` | Deployed `SitowiseFactory` address. Inlined at **build** time |
| `NEXT_PUBLIC_CHAIN_ID` | `4663` |
| `NEXT_PUBLIC_RPC_URL` | Chain RPC |
| `PAYMENT_ADDRESS` | Wallet 2. Receives node payments; the contract never sees them |
| `NODE_PRICE_WEI` | `20000000000000000` (0.02 ETH). Exact match required to mint |
| `RELAYER_ADDRESS` / `RELAYER_PRIVATE_KEY` | Wallet 3. Calls `mintFor`, holds gas only |
| `DISTRIBUTOR_ADDRESS` / `DISTRIBUTOR_PRIVATE_KEY` | Wallet 4. Calls `creditBatch`, holds payout funds |
| `CRON_KEY` | Shared secret for the `x-cron-key` header |
| `ADMIN_KEY` | Guards `/admin` |
| `WATCHER_START_BLOCK` | First block to scan. Set it to the payments wallet's first block, or the first pass only covers a recent window |
| `WATCHER_MAX_CATCHUP_BLOCKS` | How much cursor one unattended pass may claim. Default `10000` (~17 min of chain). A longer gap needs several passes or a deliberate fast-forward |
| `WATCHER_MAX_BLOCKS_PER_PASS` | Ceiling on the RPC block-read fallback, used only when the explorer is down. Default `200`. `0` switches the fallback off |
| `WATCHER_EXPLORER_PAGE_SIZE` / `WATCHER_EXPLORER_MAX_PAGES` | Index paging limits per pass. Defaults `100` / `10` |
| `WATCHER_EXPLORER_TIMEOUT_MS` | Per-request timeout for the explorer, retried twice. Default `5000` |
| `WATCHER_CONFIRMATIONS` | Blocks left unread behind the head. Default `2` |
| `DIST_ENABLED` | Master switch for crediting |
| `DIST_MODE` | `treasury` today. `swaps` has no chain source until the hook exists |
| `DIST_MIN_DELAY_SEC` / `DIST_MAX_DELAY_SEC` | Per-node timer range, 60 / 180 |
| `DIST_MIN_AMOUNT_WEI` / `DIST_MAX_AMOUNT_WEI` | Per-credit amount range |
| `DIST_DAILY_CAP_WEI` | Safety rail. The worker stops when a rolling 24h exceeds it |
| `DIST_TICK_SEC` | Tick length. Quantises timers: a 60s tick makes intervals 60/120/180 |

`NEXT_PUBLIC_*` values are inlined during the build. Vercel returns secrets as empty strings from
`vercel env pull`, so a build that relies on the pulled file ships an empty factory address —
supply the value explicitly when building.

Both server keys are hot by definition. Keep the deployer/owner key and the payments wallet key
off the server entirely, and keep only a few days of payout runway on the distributor.

## What is NOT done yet

- **The Uniswap v4 hook is not deployed.** The contract and its tests are in the repo, but no
  pool names it, so `DIST_MODE=swaps` has no source of accrual until one is initialised and trades.
- **The contract is not audited.** `/docs/audits` says so.
- Nodes are permanently non-transferable, and a wallet's slots are consumed for good.
- ETH sent to the factory address by mistake lands in `freeBalance` with no automatic refund;
  recovering it is a manual `rescue` and needs an operational procedure.
- No end-to-end run against real money has been completed yet.
