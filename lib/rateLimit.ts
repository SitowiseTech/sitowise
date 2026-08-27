/**
 * Fixed-window rate limiting for the public API (spec section 13).
 *
 * The counters live in this process's memory. That means the effective limit is
 * per instance: two serverless instances each allow the full quota, and a cold
 * start resets it. It is enough to stop someone scraping the whole ledger from
 * one machine, which is what section 13 asks for. If Sitowise ever runs on more
 * than a couple of instances, swap the store for Upstash Redis and keep this
 * module's interface; nothing else has to change.
 */

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  /** Requests left in the current window. */
  remaining: number;
  /** Unix milliseconds when the window rolls over. */
  resetAt: number;
  retryAfterSec: number;
};

export type RateLimitOptions = {
  limit?: number;
  windowMs?: number;
};

const DEFAULT_LIMIT = 60;
const DEFAULT_WINDOW_MS = 60_000;

type Bucket = {count: number; resetAt: number};

// On globalThis so dev hot reloads do not hand every edit a fresh quota.
const store = ((globalThis as {__sitowiseRateLimit?: Map<string, Bucket>}).__sitowiseRateLimit ??= new Map());

let lastSweep = 0;

/** Drop expired buckets so a long-lived instance does not grow a map per IP seen. */
function sweep(now: number): void {
  if (now - lastSweep < DEFAULT_WINDOW_MS) return;
  lastSweep = now;
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= now) store.delete(key);
  }
}

/** Count one hit against `key`. Call once per request, before doing the work. */
export function rateLimit(key: string, opts: RateLimitOptions = {}): RateLimitResult {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const now = Date.now();
  sweep(now);

  let bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = {count: 0, resetAt: now + windowMs};
    store.set(key, bucket);
  }
  bucket.count++;

  const remaining = Math.max(0, limit - bucket.count);
  return {
    ok: bucket.count <= limit,
    limit,
    remaining,
    resetAt: bucket.resetAt,
    retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/**
 * Caller IP as seen behind Vercel's proxy. x-forwarded-for is a client-supplied
 * header everywhere else, so this is a fair-use tool, not a security boundary.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  // Left-most entry is the original client; the rest are proxies.
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Convenience for route handlers: one named bucket per route, keyed by IP. */
export function limitByIp(req: Request, bucket: string, opts: RateLimitOptions = {}): RateLimitResult {
  return rateLimit(`${bucket}:${clientIp(req)}`, opts);
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "x-ratelimit-limit": String(result.limit),
    "x-ratelimit-remaining": String(result.remaining),
    "x-ratelimit-reset": String(Math.ceil(result.resetAt / 1000)),
  };
  if (!result.ok) headers["retry-after"] = String(result.retryAfterSec);
  return headers;
}

/** 429 in the API's single error shape: `{ error: "..." }`. */
export function tooManyRequests(result: RateLimitResult): Response {
  return Response.json(
    {error: "Too many requests. Slow down and try again shortly."},
    {status: 429, headers: rateLimitHeaders(result)},
  );
}
