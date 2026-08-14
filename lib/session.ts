/**
 * Wallet sessions (spec section 10).
 *
 * Flow: GET /api/auth/nonce issues a one-time nonce in an httpOnly cookie, the
 * wallet signs the message below with personal_sign, POST /api/auth/verify
 * checks the signature and swaps the nonce for a session cookie.
 *
 * The session cookie is `address.expiry.hmac`, where the HMAC is taken over
 * "address.expiry" with AUTH_SECRET. Nothing is stored server side, so there is
 * no session table to keep or expire. Private routes must take the address from
 * `readSession()` and never from the request body: a body-supplied address is
 * just a claim.
 *
 * Uses node:crypto, so any route importing this runs on the Node.js runtime,
 * not edge.
 */

import {cookies} from "next/headers";
import {createHmac, randomBytes, timingSafeEqual} from "node:crypto";
import {verifyMessage} from "viem";
import {authSecret} from "@/lib/env";
import {isAddress} from "@/lib/format";

export const NONCE_COOKIE = "sitowise_nonce";
export const SESSION_COOKIE = "sitowise_session";

/** Long enough to sign with a hardware wallet, short enough to be worthless if leaked. */
const NONCE_TTL_SEC = 10 * 60;
const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

/** Thrown for anything the user should see as a plain sentence. */
export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionError";
  }
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

/* -------------------------------------------------------------------- nonce */

/** Issue a nonce and stash it in an httpOnly cookie. Returns it for the client. */
export async function newNonce(): Promise<string> {
  const nonce = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set(NONCE_COOKIE, nonce, cookieOptions(NONCE_TTL_SEC));
  return nonce;
}

/**
 * The exact text the wallet signs. Any change here invalidates in-flight
 * sign-in attempts, so treat it as part of the protocol.
 */
export function signInMessage(nonce: string): string {
  return [
    "Sitowise — sign in to your dashboard.",
    "This request is free and does not move funds.",
    `Nonce: ${nonce}`,
  ].join("\n");
}

/* ------------------------------------------------------------------ signing */

function sign(address: string, expiry: number): string {
  return createHmac("sha256", authSecret()).update(`${address}.${expiry}`).digest("hex");
}

/** Constant-time string compare. Only the length is allowed to leak. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Verify a personal_sign signature over the nonce this browser was issued, then
 * set the session cookie. Returns the lowercased address on success.
 */
export async function verifyAndIssue(address: string, signature: string): Promise<`0x${string}`> {
  if (!isAddress(address)) throw new SessionError("That is not a valid wallet address.");
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) throw new SessionError("That is not a valid signature.");

  const jar = await cookies();
  const nonce = jar.get(NONCE_COOKIE)?.value;
  if (!nonce) throw new SessionError("Your sign-in request expired. Please try again.");

  const valid = await verifyMessage({
    address: address as `0x${string}`,
    message: signInMessage(nonce),
    signature: signature as `0x${string}`,
  });
  if (!valid) throw new SessionError("That signature does not match the connected wallet.");

  // One signature per nonce, so a captured signature cannot be replayed.
  jar.delete(NONCE_COOKIE);

  const lower = address.toLowerCase() as `0x${string}`;
  const expiry = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  jar.set(SESSION_COOKIE, `${lower}.${expiry}.${sign(lower, expiry)}`, cookieOptions(SESSION_TTL_SEC));

  return lower;
}

/**
 * The signed-in address, or null. Reads the cookie only. Never throws, so
 * callers can branch on it directly.
 */
export async function readSession(): Promise<`0x${string}` | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [address, expiryStr, mac] = parts;

  if (!isAddress(address) || address !== address.toLowerCase()) return null;

  const expiry = Number(expiryStr);
  if (!Number.isInteger(expiry) || expiry <= Math.floor(Date.now() / 1000)) return null;

  try {
    if (!safeEqual(mac, sign(address, expiry))) return null;
  } catch {
    // AUTH_SECRET missing: treat as signed out rather than throwing at a reader.
    return null;
  }

  return address as `0x${string}`;
}

/** Same as readSession but for routes that cannot continue without one. */
export async function requireSession(): Promise<`0x${string}`> {
  const address = await readSession();
  if (!address) throw new SessionError("Connect your wallet and sign in to continue.");
  return address;
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(NONCE_COOKIE);
}
