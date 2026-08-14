/**
 * Shared plumbing for every route under app/api (spec section 13).
 *
 * Two rules this module exists to enforce:
 *
 *   1. One error shape, `{ error: "human readable" }`, with a correct status.
 *      Nothing that reaches a client may contain a stack trace, a SQL string,
 *      or the name of an environment variable. Those go to the server log.
 *
 *   2. Nothing is trusted until it has been parsed. Every value that arrives
 *      from a request passes through one of the parsers below, which either
 *      return a typed value or throw an ApiError the caller never has to catch.
 *
 * ID CONVENTION, because two id spaces exist and confusing them would move
 * money to the wrong node:
 *   * The chain node id is the number the contract knows: the one in
 *     NodeMinted and in every `withdraw` call. Request bodies on the money
 *     paths (/api/nodes/sync) speak only this id, under either the name
 *     `nodeId` or `chainNodeId`. The ledger row id is never accepted there.
 *   * `id` is the database row id, returned alongside `chainNodeId` in every
 *     list response. /api/node/[id] accepts either, because it is a read with
 *     no side effects and it echoes both back.
 */

import {timingSafeEqual} from "node:crypto";
import {adminKey, cronKey, EnvError, hasAdminKey, hasCronKey} from "@/lib/env";
import {isAddress} from "@/lib/format";
import {
  limitByIp,
  rateLimitHeaders,
  tooManyRequests,
  type RateLimitOptions,
} from "@/lib/rateLimit";
import {SessionError} from "@/lib/session";

/** uint256 ceiling. Anything larger cannot exist on chain and is a malformed request. */
const MAX_UINT256 = (1n << 256n) - 1n;

/** Carries the status code with the message, so routes can `throw` and stop. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

export function fail(status: number, message: string): never {
  throw new ApiError(status, message);
}

/* --------------------------------------------------------------- responses */

export type HeaderMap = Record<string, string>;

/** Public reads may sit on the CDN briefly; the ledger tolerates a few seconds of lag. */
export function publicCache(seconds: number): HeaderMap {
  return {
    "cache-control": `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds * 3}`,
  };
}

/** Anything derived from a session cookie must never be stored by a shared cache. */
export const PRIVATE_CACHE: HeaderMap = {"cache-control": "private, no-store"};

export function jsonOk<T>(data: T, headers: HeaderMap = {}, status = 200): Response {
  return Response.json(data, {status, headers});
}

export function jsonError(message: string, status: number, headers: HeaderMap = {}): Response {
  return Response.json({error: message}, {status, headers});
}

/**
 * Turn anything thrown inside a route into a response.
 *
 * `where` names the route in the server log. It is never sent to the client:
 * an EnvError message contains variable names, and an unexpected error can
 * contain anything at all.
 */
export function toResponse(err: unknown, where: string, headers: HeaderMap = {}): Response {
  if (err instanceof ApiError) return jsonError(err.message, err.status, headers);
  if (err instanceof SessionError) return jsonError(err.message, 401, headers);

  if (err instanceof EnvError) {
    console.error(`[api:${where}] configuration:`, err.message);
    return jsonError("This service is not available right now.", 503, headers);
  }

  console.error(`[api:${where}]`, err);
  return jsonError("Something went wrong. Try again in a moment.", 500, headers);
}

/* ------------------------------------------------------------- rate limits */

export type LimitCheck = {headers: HeaderMap; blocked: Response | null};

/** Count one hit and hand back the headers to attach to whatever the route returns. */
export function checkLimit(req: Request, bucket: string, opts: RateLimitOptions = {}): LimitCheck {
  const result = limitByIp(req, bucket, opts);
  return {headers: rateLimitHeaders(result), blocked: result.ok ? null : tooManyRequests(result)};
}

/** Combine rate-limit, cache and any route-specific headers into one object. */
export function mergeHeaders(...parts: HeaderMap[]): HeaderMap {
  return Object.assign({}, ...parts) as HeaderMap;
}

/* ------------------------------------------------------------------ admin */

/**
 * Gate for /api/admin/*. With no ADMIN_KEY set the route reports 404: an
 * unconfigured admin surface should not advertise that it exists.
 *
 * The comparison is constant time in the bytes but not in the length, which is
 * unavoidable without hashing first and is not worth defending: a key whose
 * length is the only secret left is already lost.
 */
export function requireAdmin(req: Request): void {
  if (!hasAdminKey()) fail(404, "Not found.");

  const provided = Buffer.from(req.headers.get("x-admin-key") ?? "", "utf8");
  const expected = Buffer.from(adminKey(), "utf8");
  const ok = provided.length === expected.length && timingSafeEqual(provided, expected);
  if (!ok) fail(401, "Not authorised.");
}

/* ------------------------------------------------------------------- cron */

/** Constant time in the bytes; length is compared first, as in requireAdmin. */
function keyMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Gate for /api/cron/*. Same shape as requireAdmin and a different secret: the
 * scheduler's key must not also open the admin console.
 *
 * `authorization: Bearer` is accepted alongside the header because several
 * hosted schedulers (Vercel Cron among them) send a GET with no custom headers
 * at all, and a watcher that cannot be triggered is a watcher that does not
 * exist. Both are compared against the same key.
 */
export function requireCron(req: Request): void {
  // An unconfigured cron surface reports 404 rather than announcing itself.
  if (!hasCronKey()) fail(404, "Not found.");

  const header = req.headers.get("x-cron-key");
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const expected = cronKey();

  const ok =
    (header !== null && keyMatches(header, expected)) ||
    (bearer !== undefined && bearer !== "" && keyMatches(bearer, expected));

  if (!ok) fail(401, "Not authorised.");
}

/* ------------------------------------------------------------------ input */

export type Body = Record<string, unknown>;

/** Parse a JSON body into a plain object. Missing, empty and malformed all become 400. */
export async function readJsonBody(req: Request): Promise<Body> {
  let raw: unknown;
  try {
    const text = await req.text();
    raw = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    fail(400, "Request body must be JSON.");
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(400, "Request body must be a JSON object.");
  }
  return raw as Body;
}

function presence(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return undefined;
}

/**
 * A node id as the contract knows it. Accepts a number or a decimal string,
 * because JSON numbers lose precision above 2^53 and a client that has read a
 * large id from this API will send it back as a string.
 */
export function parseChainNodeId(value: unknown, field = "nodeId"): bigint {
  const raw = presence(value);
  if (raw === undefined) fail(400, `${field} is required.`);
  if (!/^\d+$/.test(raw)) fail(400, `${field} must be a whole number.`);
  const parsed = BigInt(raw);
  if (parsed <= 0n) fail(400, `${field} must be greater than zero.`);
  if (parsed > MAX_UINT256) fail(400, `${field} is out of range.`);
  return parsed;
}

/** A wei amount as a decimal string. Never a float: 0.1 in wei is not an integer. */
export function parseWei(value: unknown, field: string): bigint {
  const raw = presence(value);
  if (raw === undefined) fail(400, `${field} is required.`);
  if (!/^\d+$/.test(raw)) fail(400, `${field} must be a whole number of wei.`);
  const parsed = BigInt(raw);
  if (parsed > MAX_UINT256) fail(400, `${field} is out of range.`);
  return parsed;
}

export function parseAddressField(value: unknown, field: string): `0x${string}` {
  const raw = presence(value);
  if (raw === undefined) fail(400, `${field} is required.`);
  if (!isAddress(raw)) fail(400, `${field} is not a valid wallet address.`);
  if (/^0x0{40}$/i.test(raw)) fail(400, `${field} cannot be the zero address.`);
  return raw.toLowerCase() as `0x${string}`;
}

export function parseTxHash(value: unknown, field = "txHash"): `0x${string}` {
  const raw = presence(value);
  if (raw === undefined) fail(400, `${field} is required.`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) fail(400, `${field} is not a valid transaction hash.`);
  return raw.toLowerCase() as `0x${string}`;
}

/** `?limit=` with bounds, so nobody pages the whole ledger out in one call. */
export function parseLimit(url: URL, opts: {fallback: number; max: number}): number {
  const raw = url.searchParams.get("limit");
  if (raw === null || raw.trim() === "") return opts.fallback;
  if (!/^\d+$/.test(raw.trim())) fail(400, "limit must be a whole number.");
  const parsed = Number(raw.trim());
  if (parsed < 1) fail(400, "limit must be at least 1.");
  if (parsed > opts.max) fail(400, `limit may not be greater than ${opts.max}.`);
  return parsed;
}

/** A bounded whole number from a request body. */
export function parseBoundedInt(
  value: unknown,
  field: string,
  opts: {fallback: number; min: number; max: number},
): number {
  const raw = presence(value);
  if (raw === undefined) return opts.fallback;
  if (!/^\d+$/.test(raw)) fail(400, `${field} must be a whole number.`);
  const parsed = Number(raw);
  if (parsed < opts.min) fail(400, `${field} must be at least ${opts.min}.`);
  if (parsed > opts.max) fail(400, `${field} may not be greater than ${opts.max}.`);
  return parsed;
}

/** A block number from a request body, for the reconciler's optional range. */
export function parseBlockNumber(value: unknown, field: string): bigint | undefined {
  const raw = presence(value);
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) fail(400, `${field} must be a whole block number.`);
  return BigInt(raw);
}

/* -------------------------------------------------------------- db values */

/**
 * `numeric(78,0)` and `bigint` columns arrive as strings from the Postgres
 * driver, which is the only way they survive above 2^53. These normalise them
 * for JSON without ever passing through a float.
 */
export function toWeiString(value: unknown): string {
  if (value === null || value === undefined) return "0";
  if (typeof value === "bigint") return value.toString();
  const raw = String(value).trim();
  if (raw === "") return "0";
  if (!/^-?\d+$/.test(raw)) throw new Error(`Expected a whole wei value from the database, got "${raw}"`);
  return BigInt(raw).toString();
}

export function toCount(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected a count from the database, got "${String(value)}"`);
  return Math.trunc(parsed);
}

/** Timestamps go out as ISO 8601 so the client can format them in the user's locale. */
export function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}
