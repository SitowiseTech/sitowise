"use client";

/**
 * Browser side of the API in spec section 13, plus the two auth routes from
 * spec section 10.
 *
 * Wei arrives as a decimal string (Postgres `numeric(78,0)`) and is converted
 * to bigint here, once, at the boundary. Nothing downstream touches Number for
 * a wei value: 0.02 ETH is already 2e16, and the moment a balance passes
 * through a float the ledger stops adding up.
 *
 * Field readers accept camelCase and snake_case. The database columns are
 * snake_case and only the route layer renames them, so tolerating both means a
 * rename on the server shows up as stale data rather than as a page full of
 * silent zeros.
 */

import {isAddress} from "@/lib/format";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }

  /** The session cookie is missing or expired. */
  get unauthorized(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      // Session lives in an httpOnly cookie; every private call needs it.
      credentials: "same-origin",
      // A cached balance is a wrong balance.
      cache: "no-store",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? {"Content-Type": "application/json"} : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError("Could not reach Sitowise. Check your connection and try again.", 0);
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text !== "") {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      isJson(payload) && typeof payload.error === "string"
        ? payload.error
        : `Request failed with status ${response.status}.`;
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

/* ---------------------------------------------------------------- decoding */

function field(row: Json, ...names: string[]): unknown {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null) return row[name];
  }
  return undefined;
}

function toBigInt(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  throw new ApiError(`The server sent an unreadable value for ${label}.`, 502);
}

function toNumber(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  throw new ApiError(`The server sent an unreadable value for ${label}.`, 502);
}

function toText(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function rows(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isJson) : [];
}

/* ------------------------------------------------------------------- shapes */

/**
 * One node as the ledger knows it: which node it is, when it was minted and
 * what paid for it.
 *
 * There are no money figures on this type, and that is the point. `/api/me`
 * does return a balance, a cumulative total and a withdrawn total per node, all
 * derived from `node_view`, and every one of them is a lagging copy of contract
 * state. The dashboard reads those three from `readNodeInfo`. Leaving them off
 * the parsed shape means a component cannot render the ledger's version by
 * reaching for the field that happened to be in scope.
 */
export type NodeSummary = {
  /** Database id. This is the `:id` in GET /api/node/:id. */
  id: number;
  /** Id from the NodeMinted event. This is what contract calls take. */
  chainNodeId: bigint;
  /** Null when the ledger has no timestamp; the UI falls back to the chain's. */
  createdAt: string | null;
  mintTx: string | null;
  status: string;
};

export type Credit = {
  id: number;
  amountWei: bigint;
  createdAt: string | null;
};

/**
 * A withdrawal that already happened.
 *
 * There is no status here any more. We stopped preparing and signing
 * withdrawals for people: the wallet calls the contract itself, and a row is
 * written only when the watcher observes the `Withdrawn` event, so every row
 * this endpoint returns is final and confirmed. The old `signed | sent | failed`
 * field described a queue that no longer exists, and defaulting a confirmed row
 * to "signed" made settled money look pending.
 */
export type Withdrawal = {
  id: number;
  amountWei: bigint;
  toAddress: string | null;
  txHash: string | null;
  blockNumber: number | null;
  /** When the event was observed. This is the row's timestamp. */
  observedAt: string | null;
};

/**
 * The history behind one node.
 *
 * Deliberately carries no balance. The route computes one from the ledger, and
 * the dashboard reads balances from the contract; parsing the ledger's figure
 * here would leave a plausible-looking number in reach of any component that
 * happens to render it.
 */
export type NodeDetail = {
  id: number;
  owner: string | null;
  credits: Credit[];
  withdrawals: Withdrawal[];
};

export type Session = {
  address: `0x${string}`;
};

/**
 * GET /api/me. One call answers three questions the dashboard opens with: who
 * the session belongs to, which nodes the ledger holds for them, and which
 * nodes the contract attributes to them that the ledger has never seen.
 */
export type Me = {
  address: `0x${string}`;
  nodes: NodeSummary[];
  /**
   * Chain ids the contract says this wallet owns that are missing from the
   * ledger, or null when the chain could not be read. Null is not an empty
   * list: "none missing" and "could not check" are different answers.
   */
  unsyncedChainNodeIds: bigint[] | null;
};

function parseNode(row: Json): NodeSummary {
  return {
    id: toNumber(field(row, "id"), "node id"),
    chainNodeId: toBigInt(field(row, "chainNodeId", "chain_node_id"), "node number"),
    createdAt: toText(field(row, "createdAt", "created_at")),
    mintTx: toText(field(row, "mintTx", "mint_tx_hash", "mintTxHash")),
    status: toText(field(row, "status")) ?? "active",
  };
}

function parseCredit(row: Json): Credit {
  return {
    id: toNumber(field(row, "id"), "credit id"),
    amountWei: toBigInt(field(row, "amountWei", "amount_wei"), "credit amount"),
    createdAt: toText(field(row, "createdAt", "created_at")),
  };
}

function parseWithdrawal(row: Json): Withdrawal {
  const block = field(row, "blockNumber", "block_number");
  return {
    id: toNumber(field(row, "id"), "withdrawal id"),
    amountWei: toBigInt(field(row, "amountWei", "amount_wei"), "withdrawal amount"),
    toAddress: toText(field(row, "toAddress", "to_address")),
    txHash: toText(field(row, "txHash", "tx_hash")),
    blockNumber: block === undefined ? null : toNumber(block, "block number"),
    // `created_at` is accepted as a fallback for the same reason every other
    // reader here takes two names: a rename on the server should show up as a
    // missing timestamp at worst, not as a parse failure.
    observedAt: toText(field(row, "observedAt", "observed_at", "createdAt", "created_at")),
  };
}

/* --------------------------------------------------------------------- auth */

/** GET /api/auth/nonce. The message is built server side where possible. */
export async function getNonce(): Promise<{nonce: string; message: string}> {
  const payload = await request<Json>("/api/auth/nonce");
  const nonce = toText(field(payload, "nonce"));
  if (!nonce) throw new ApiError("The server did not issue a sign-in nonce.", 502);

  const message = toText(field(payload, "message"));
  return {nonce, message: message ?? signInMessage(nonce)};
}

/**
 * Byte-identical to `signInMessage` in lib/session.ts, which cannot be imported
 * here because it pulls in node:crypto. Used only when the nonce route does not
 * return the message; a drift between the two breaks verification, so change
 * both or neither.
 */
function signInMessage(nonce: string): string {
  return [
    "Sitowise — sign in to your dashboard.",
    "This request is free and does not move funds.",
    `Nonce: ${nonce}`,
  ].join("\n");
}

/** POST /api/auth/verify. Sets the session cookie. */
export async function verifySignature(
  address: string,
  signature: string,
): Promise<Session> {
  const payload = await request<Json>("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({address, signature}),
  });
  const verified = toText(field(payload, "address")) ?? address;
  return {address: verified.toLowerCase() as `0x${string}`};
}

/** GET /api/me. Null means "not signed in", which is a normal answer here. */
export async function getMe(): Promise<Me | null> {
  let payload: Json;
  try {
    payload = await request<Json>("/api/me");
  } catch (err) {
    if (err instanceof ApiError && (err.unauthorized || err.status === 404)) return null;
    throw err;
  }

  const address = toText(field(payload, "address"));
  if (!address) return null;

  const unsynced = field(payload, "unsyncedChainNodeIds", "unsynced_chain_node_ids");
  return {
    address: address.toLowerCase() as `0x${string}`,
    nodes: rows(field(payload, "nodes")).map(parseNode),
    unsyncedChainNodeIds: Array.isArray(unsynced)
      ? unsynced.map((id) => toBigInt(id, "node number"))
      : null,
  };
}

/**
 * POST /api/auth/logout. Best effort: a failure here leaves a cookie that the
 * next sign-in overwrites, which is not worth blocking the button for.
 */
export async function logout(): Promise<void> {
  try {
    await request("/api/auth/logout", {method: "POST"});
  } catch {
    // Ignored on purpose. See above.
  }
}

/* -------------------------------------------------------------------- nodes */

/**
 * GET /api/node/:id
 *
 * History only. The response also carries the ledger's balance and totals; they
 * are dropped here on purpose, because the dashboard takes those from
 * `readNodeInfo` and a second copy would only ever be the stale one.
 */
export async function getNode(id: number): Promise<NodeDetail> {
  const payload = await request<Json>(`/api/node/${id}`);
  return {
    id: toNumber(field(payload, "id"), "node id"),
    owner: toText(field(payload, "owner", "ownerAddress", "owner_address")),
    credits: rows(field(payload, "credits")).map(parseCredit),
    withdrawals: rows(field(payload, "withdrawals")).map(parseWithdrawal),
  };
}

/**
 * POST /api/nodes/sync. The route reads the owner and the price out of the
 * chain's own NodeMinted log, so it takes a transaction hash or a node id and
 * nothing else; anything the client claims about ownership is ignored.
 */
export async function syncNode(
  input: {txHash: `0x${string}`} | {nodeId: bigint},
): Promise<void> {
  await request("/api/nodes/sync", {
    method: "POST",
    body: JSON.stringify(
      "txHash" in input ? {txHash: input.txHash} : {nodeId: input.nodeId.toString()},
    ),
  });
}

/*
 * There is no withdrawal client here on purpose.
 *
 * Withdrawing is `factory.withdraw(id, to)` or `factory.withdrawAll(to)` sent
 * straight from the user's own wallet. The server has no signature to issue and
 * no permission to grant, so a round trip to it before the transaction would
 * only be a place for the money path to fail. The dashboard encodes the call
 * with lib/factory.ts and reads the result back out of the receipt.
 */

/* ------------------------------------------------------------------ deploy */

/**
 * What one node costs and where the money goes. Both come from the server's
 * environment, because the contract never sees the payment and so cannot be
 * asked either question.
 */
export type DeployQuote = {
  priceWei: bigint;
  paymentAddress: `0x${string}`;
  chainId: number;
};

/**
 * GET /api/deploy-quote.
 *
 * Failure throws rather than returning a fallback: quoting a stale price would
 * send a transfer that no longer matches, and a wrong payment address would
 * send the ETH nowhere it can be recovered from.
 */
export async function getDeployQuote(): Promise<DeployQuote> {
  const payload = await request<Json>("/api/deploy-quote");

  const address = toText(field(payload, "paymentAddress", "payment_address")) ?? "";
  if (!isAddress(address)) {
    throw new ApiError("The server did not give a payment address to send to.", 502);
  }

  const priceWei = toBigInt(field(payload, "priceWei", "price_wei"), "node price");
  if (priceWei <= 0n) {
    throw new ApiError("The server quoted a price of zero, which cannot be right.", 502);
  }

  return {
    priceWei,
    paymentAddress: address.toLowerCase() as `0x${string}`,
    chainId: toNumber(field(payload, "chainId", "chain_id"), "chain id"),
  };
}

/* -------------------------------------------------------------------- price */

/**
 * GET /api/price. Null means no quote was available, and the UI then shows ETH
 * with no dollar figure rather than a made-up one.
 */
export async function getEthUsd(): Promise<number | null> {
  try {
    const payload = await request<Json>("/api/price");
    const usd = field(payload, "usd");
    return typeof usd === "number" && Number.isFinite(usd) && usd > 0 ? usd : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------- cover */

export type Cover = {
  contract: `0x${string}`;
  balanceWei: bigint;
  outstandingWei: bigint;
  covered: boolean;
  paused: boolean;
};

/**
 * GET /api/cover. Null on any failure, and the panel then renders nothing at
 * all: a cover figure that might be stale or guessed is worse than no figure,
 * because the only reason to show it is that it can be trusted.
 */
export async function getCover(): Promise<Cover | null> {
  try {
    const payload = await request<Json>("/api/cover");
    const contract = field(payload, "contract");
    if (typeof contract !== "string" || !isAddress(contract)) return null;
    return {
      contract: contract.toLowerCase() as `0x${string}`,
      balanceWei: toBigInt(field(payload, "balanceWei", "balance_wei"), "balance"),
      outstandingWei: toBigInt(field(payload, "outstandingWei", "outstanding_wei"), "outstanding"),
      covered: field(payload, "covered") === true,
      paused: field(payload, "paused") === true,
    };
  } catch {
    return null;
  }
}
