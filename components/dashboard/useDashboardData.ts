"use client";

/**
 * Everything the signed-in dashboard reads, in one hook.
 *
 * Node rows come from `GET /api/me`, which answers with the session's address
 * and its nodes in one round trip; per-node credits and withdrawals come from
 * `GET /api/node/:id`. The detail calls are made for
 * every node up front rather than only on expand, because the activity feed at
 * the bottom of the page is a merge of every node's credits and there is no
 * endpoint that returns them across nodes. The cap of 25 nodes per wallet is
 * what makes that affordable; the concurrency limit keeps it from opening 25
 * sockets at once.
 *
 * BALANCES DO NOT COME FROM THE LEDGER. Every balance on this page is read from
 * the contract with `readNodeBalance`, because the contract is the only thing
 * that knows what a node holds: credits land through the distributor and
 * withdrawals leave through the user's own wallet, and the ledger learns about
 * both afterwards. What the database supplies is the list of nodes, when they
 * were minted, their lifetime totals and their history, all of which are a log
 * rather than a balance.
 *
 * The consequence is that a failed chain read is a failed load. There is a
 * number in Postgres that could be shown instead, and showing it would be
 * lying about someone's money, so the page shows the error panel instead.
 *
 * A withdrawal updates the affected rows in place (spec 5.3: the balance zeroes
 * without a reload) and a background refresh reconciles against the server.
 */

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
  getEthUsd,
  getMe,
  getNode,
  syncNode,
  type NodeDetail,
  type NodeSummary,
} from "@/lib/apiClient";
import {
  describeFactoryError,
  factoryConfigured,
  readFactoryConfig,
  readNodeInfo,
} from "@/lib/factory";
import {MAX_NODES_PER_WALLET} from "@/lib/site";

/** Background reconcile. Credits land every minute or two, so this is not idle chatter. */
const REFRESH_MS = 45_000;

/** Detail requests in flight at once. */
const DETAIL_CONCURRENCY = 5;

/** Chain reads in flight at once. One RPC call per node, capped at 25 nodes. */
const BALANCE_CONCURRENCY = 5;

/** Rows in the activity feed. Credits and withdrawals share the budget. */
const FEED_LIMIT = 30;

/**
 * Shown instead of the dashboard when the contract cannot be reached. It names
 * what is missing rather than offering the ledger's figure, which is the whole
 * point of the message.
 */
const CHAIN_UNREACHABLE =
  "Could not read your balances from Robinhood Chain. Balances are only shown when they come from the contract, so nothing is shown from the ledger instead.";

/**
 * A node with its money read from contract storage.
 *
 * `NodeSummary` carries no figures at all (see lib/apiClient.ts); this is the
 * only place they are attached, and they come from `readNodeInfo` in the same
 * call, so a row's balance, its lifetime credited total and its lifetime paid
 * out total always describe the same block.
 */
export type DashNode = NodeSummary & {
  balanceWei: bigint;
  cumulativeWei: bigint;
  withdrawnWei: bigint;
  /** Mint time from the contract, unix seconds. Zero when the id is unminted. */
  chainCreatedAt: bigint;
  /** Owner according to the contract, for the detail panel. */
  chainOwner: `0x${string}` | null;
};

/**
 * One line in the activity feed. Credits land from the distributor, withdrawals
 * leave through the owner's own wallet, and both are history rather than
 * balance, which is why they may come from the ledger.
 */
export type FeedItem = {
  key: string;
  kind: "credit" | "withdrawal";
  nodeId: number;
  chainNodeId: bigint;
  amountWei: bigint;
  createdAt: string | null;
  /** Withdrawals only. */
  txHash: string | null;
};

export type Totals = {
  count: number;
  balanceWei: bigint;
  cumulativeWei: bigint;
  withdrawnWei: bigint;
};

export type WithdrawalApplied = {nodeId: number; amountWei: bigint};

export type DashboardData = {
  status: "loading" | "ready" | "error";
  error: string | null;
  nodes: DashNode[];
  totals: Totals;
  /** Per-wallet cap, for the "3 / 25" metric. */
  limit: number;
  ethUsd: number | null;
  details: Map<number, NodeDetail>;
  detailErrors: Map<number, string>;
  detailsLoading: boolean;
  feed: FeedItem[];
  /**
   * Nodes the contract attributes to this wallet that the ledger has not
   * recorded. Null means the chain could not be read, which is not the same as
   * none, so the UI says nothing in that case.
   */
  unsynced: bigint[] | null;
  registering: boolean;
  refresh: () => Promise<void>;
  loadDetail: (nodeId: number, cumulative?: bigint) => Promise<void>;
  registerUnsynced: () => Promise<void>;
  applyWithdrawals: (applied: WithdrawalApplied[]) => void;
};

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({length: Math.min(limit, items.length)}, run));
  return results;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong loading your nodes.";
}

/** Unix seconds from the contract as an ISO string, or null for an unset time. */
function isoFromSeconds(seconds: bigint): string | null {
  if (seconds <= 0n) return null;
  return new Date(Number(seconds) * 1000).toISOString();
}

/**
 * Attach every money figure from contract storage.
 *
 * One failed read rejects the whole batch on purpose. A list where some rows
 * came from the chain and others from Postgres looks exactly like a list where
 * they all did, and the difference is somebody's money.
 *
 * The mint date still prefers the ledger's timestamp, which is a real clock
 * reading; the contract's `createdAt` is the block time and stands in only when
 * the ledger has none.
 */
async function withChainFigures(rows: NodeSummary[]): Promise<DashNode[]> {
  // No nodes means no reads and no error: the totals over an empty list are
  // zero by definition, not a figure taken from anywhere.
  if (rows.length === 0) return [];
  if (!factoryConfigured()) {
    throw new Error("This deployment has no factory contract configured yet.");
  }

  const infos = await mapLimit(rows, BALANCE_CONCURRENCY, (node) =>
    readNodeInfo(node.chainNodeId),
  );

  return rows.map((node, index) => {
    const info = infos[index];
    return {
      ...node,
      createdAt: node.createdAt ?? isoFromSeconds(info.createdAt),
      balanceWei: info.balanceWei,
      cumulativeWei: info.totalReceivedWei,
      withdrawnWei: info.totalWithdrawnWei,
      chainCreatedAt: info.createdAt,
      chainOwner: info.owner,
    };
  });
}

export function useDashboardData(
  address: `0x${string}` | null,
  /** Called when the server says the session is gone, so the page can re-gate. */
  onSessionLost: () => void,
): DashboardData {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<DashNode[]>([]);
  const [details, setDetails] = useState<Map<number, NodeDetail>>(new Map());
  const [detailErrors, setDetailErrors] = useState<Map<number, string>>(new Map());
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [ethUsd, setEthUsd] = useState<number | null>(null);
  const [limit, setLimit] = useState(MAX_NODES_PER_WALLET);
  const [unsynced, setUnsynced] = useState<bigint[] | null>(null);
  const [registering, setRegistering] = useState(false);

  // Guards every async write so a response for a previous address, or for an
  // unmounted page, never lands in state.
  const generation = useRef(0);

  // node id -> the cumulative total its detail was fetched at. A background
  // refresh re-reads only the nodes whose figure moved, which keeps a 25-node
  // wallet from spending 26 requests every 45 seconds on unchanged rows.
  const detailAt = useRef(new Map<number, string>());

  const loadDetail = useCallback(async (nodeId: number, cumulative?: bigint) => {
    const mine = generation.current;
    try {
      const detail = await getNode(nodeId);
      if (generation.current !== mine) return;
      if (cumulative !== undefined) detailAt.current.set(nodeId, cumulative.toString());
      setDetails((current) => new Map(current).set(nodeId, detail));
      setDetailErrors((current) => {
        if (!current.has(nodeId)) return current;
        const next = new Map(current);
        next.delete(nodeId);
        return next;
      });
    } catch (err) {
      if (generation.current !== mine) return;
      setDetailErrors((current) => new Map(current).set(nodeId, messageOf(err)));
    }
  }, []);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (!address) return;
      const mine = ++generation.current;
      if (mode === "initial") {
        setStatus("loading");
        setError(null);
      }

      try {
        const me = await getMe();
        if (generation.current !== mine) return;
        if (!me) {
          // The cookie expired or was cleared in another tab. Send the page
          // back to the sign-in gate rather than showing an empty dashboard.
          onSessionLost();
          return;
        }

        setUnsynced(me.unsyncedChainNodeIds);

        let rows: DashNode[];
        try {
          rows = await withChainFigures(me.nodes);
        } catch (err) {
          if (generation.current !== mine) return;
          // The ledger's figure is not a fallback. A first load becomes the
          // error panel; a refresh keeps the numbers the chain gave us last
          // time rather than replacing them with worse ones.
          if (mode === "initial") {
            setStatus("error");
            setError(`${CHAIN_UNREACHABLE} ${describeFactoryError(err)}`);
          }
          return;
        }
        if (generation.current !== mine) return;

        setNodes(rows);
        setStatus("ready");
        setError(null);

        if (rows.length === 0) {
          detailAt.current.clear();
          setDetails(new Map());
          setDetailErrors(new Map());
          return;
        }

        // Drop details for nodes that are no longer in the list, so a detail
        // cannot outlive the row it belongs to.
        const byId = new Map(rows.map((node) => [node.id, node]));
        for (const id of [...detailAt.current.keys()]) {
          if (!byId.has(id)) detailAt.current.delete(id);
        }
        setDetails((current) => {
          const orphans = [...current.keys()].filter((id) => !byId.has(id));
          if (orphans.length === 0) return current;
          const next = new Map(current);
          for (const id of orphans) next.delete(id);
          return next;
        });

        const stale = rows.filter(
          (node) => detailAt.current.get(node.id) !== node.cumulativeWei.toString(),
        );
        if (stale.length === 0) return;

        setDetailsLoading(true);
        type Loaded =
          | {ok: true; nodeId: number; detail: NodeDetail}
          | {ok: false; nodeId: number; message: string};

        const loaded = await mapLimit<DashNode, Loaded>(
          stale,
          DETAIL_CONCURRENCY,
          async (node) => {
            try {
              return {ok: true, nodeId: node.id, detail: await getNode(node.id)};
            } catch (err) {
              return {ok: false, nodeId: node.id, message: messageOf(err)};
            }
          },
        );
        if (generation.current !== mine) return;

        setDetails((current) => {
          const next = new Map(current);
          for (const entry of loaded) if (entry.ok) next.set(entry.nodeId, entry.detail);
          return next;
        });
        setDetailErrors((current) => {
          const next = new Map(current);
          for (const entry of loaded) {
            if (entry.ok) next.delete(entry.nodeId);
            else next.set(entry.nodeId, entry.message);
          }
          return next;
        });
        for (const entry of loaded) {
          if (!entry.ok) continue;
          const node = byId.get(entry.nodeId);
          if (node) detailAt.current.set(node.id, node.cumulativeWei.toString());
        }
      } catch (err) {
        if (generation.current !== mine) return;
        // A failed refresh keeps the numbers already on screen; only a failed
        // first load replaces the page with the error panel.
        if (mode === "initial") {
          setStatus("error");
          setError(messageOf(err));
        }
      } finally {
        // Every exit from the block above, including the early returns, has to
        // clear this or the activity feed keeps its skeletons forever.
        if (generation.current === mine) setDetailsLoading(false);
      }
    },
    [address, onSessionLost],
  );

  const refresh = useCallback(() => load("refresh"), [load]);

  /**
   * Register mints the ledger missed. The route re-reads each one from the
   * chain's own NodeMinted log, so this asks it to look rather than telling it
   * what to write.
   */
  const registerUnsynced = useCallback(async () => {
    if (!unsynced || unsynced.length === 0) return;
    setRegistering(true);
    try {
      for (const nodeId of unsynced) await syncNode({nodeId});
      await load("refresh");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setRegistering(false);
    }
  }, [unsynced, load]);

  useEffect(() => {
    if (!address) {
      generation.current++;
      detailAt.current.clear();
      setNodes([]);
      setDetails(new Map());
      setDetailErrors(new Map());
      setStatus("loading");
      return;
    }
    void load("initial");
  }, [address, load]);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    void getEthUsd().then((usd) => {
      if (!cancelled) setEthUsd(usd);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  useEffect(() => {
    // The cap is a contract setting, so read it from the contract. The
    // published figure in lib/site.ts is the fallback for a failed RPC read,
    // not a second source of truth.
    if (!factoryConfigured()) return;
    let cancelled = false;
    void readFactoryConfig()
      .then((config) => {
        if (!cancelled && config.maxPerWallet > 0) setLimit(config.maxPerWallet);
      })
      .catch(() => {
        // Keep the published cap.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!address) return;
    const timer = window.setInterval(() => {
      // Polling a hidden tab burns the user's battery and the API's rate limit.
      if (document.visibilityState === "visible") void load("refresh");
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [address, load]);

  const applyWithdrawals = useCallback((applied: WithdrawalApplied[]) => {
    const byNode = new Map(applied.map((entry) => [entry.nodeId, entry.amountWei]));
    // A withdrawal adds a row to the node's history without moving its
    // cumulative total, so force those details to be re-read on the next pass.
    for (const entry of applied) detailAt.current.delete(entry.nodeId);
    setNodes((current) =>
      current.map((node) => {
        const amount = byNode.get(node.id);
        if (amount === undefined) return node;
        return {
          ...node,
          balanceWei: node.balanceWei > amount ? node.balanceWei - amount : 0n,
          withdrawnWei: node.withdrawnWei + amount,
        };
      }),
    );
  }, []);

  const totals = useMemo<Totals>(() => {
    let balanceWei = 0n;
    let cumulativeWei = 0n;
    let withdrawnWei = 0n;
    for (const node of nodes) {
      balanceWei += node.balanceWei;
      cumulativeWei += node.cumulativeWei;
      withdrawnWei += node.withdrawnWei;
    }
    return {count: nodes.length, balanceWei, cumulativeWei, withdrawnWei};
  }, [nodes]);

  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];
    for (const node of nodes) {
      const detail = details.get(node.id);
      if (!detail) continue;

      for (const credit of detail.credits) {
        items.push({
          key: `credit:${node.id}:${credit.id}`,
          kind: "credit",
          nodeId: node.id,
          chainNodeId: node.chainNodeId,
          amountWei: credit.amountWei,
          createdAt: credit.createdAt,
          txHash: null,
        });
      }

      // Money leaving belongs in the same list as money arriving. Both are
      // observed events, not derived figures, so neither one can drift.
      for (const withdrawal of detail.withdrawals) {
        items.push({
          key: `withdrawal:${node.id}:${withdrawal.id}`,
          kind: "withdrawal",
          nodeId: node.id,
          chainNodeId: node.chainNodeId,
          amountWei: withdrawal.amountWei,
          createdAt: withdrawal.observedAt,
          txHash: withdrawal.txHash,
        });
      }
    }
    // A row with no timestamp sorts last rather than to the top as NaN.
    const at = (item: FeedItem) => (item.createdAt ? Date.parse(item.createdAt) : 0);
    items.sort((a, b) => at(b) - at(a));
    return items.slice(0, FEED_LIMIT);
  }, [nodes, details]);

  return {
    status,
    error,
    nodes,
    totals,
    limit,
    ethUsd,
    details,
    detailErrors,
    detailsLoading,
    feed,
    unsynced,
    registering,
    refresh,
    loadDetail,
    registerUnsynced,
    applyWithdrawals,
  };
}
