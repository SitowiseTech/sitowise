/**
 * Touch ID sign-in for the admin console.
 *
 * WebAuthn, using the Mac's platform authenticator. The private key lives in
 * the Secure Enclave and never leaves it; the server stores only the public
 * half, which can verify a signature but never produce one.
 *
 * ADMIN_KEY keeps both of its jobs. You need it to enrol the first passkey, and
 * it stays a working sign-in afterwards: a console whose only key is welded to
 * one laptop is a console you lose with the laptop.
 *
 * The challenge is held in a short-lived signed cookie rather than a table.
 * It is single-use by expiry, needs no cleanup job, and survives the request
 * landing on a different serverless instance than the one that issued it.
 */

import {cookies, headers} from "next/headers";
import {createHmac, randomBytes, timingSafeEqual} from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {sql} from "@/lib/db";
import {authSecret} from "@/lib/env";

const CHALLENGE_COOKIE = "sitowise_wa";
/** Long enough to reach for a finger, short enough to be worthless if leaked. */
const CHALLENGE_TTL_SEC = 300;

const RP_NAME = "Sitowise";

export type StoredPasskey = {
  id: number;
  credentialId: string;
  publicKey: string;
  counter: bigint;
  transports: string | null;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};

export class PasskeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasskeyError";
  }
}

/* ------------------------------------------------------------------ context */

/**
 * The relying party is the site's own hostname.
 *
 * A passkey is bound by the browser to the origin that created it, so a
 * credential enrolled on sitowise.tech simply will not be offered on a
 * *.vercel.app preview. That is WebAuthn working as intended, not a bug to
 * route around: deriving the id from the request keeps each origin honest,
 * and WEBAUTHN_RP_ID exists only for the case where the site is served from a
 * subdomain but the credential should cover the parent.
 */
export async function rpContext(): Promise<{rpID: string; origin: string}> {
  const h = await headers();
  const host = h.get("host");
  if (!host) throw new PasskeyError("Cannot determine the site host.");

  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;
  const hostname = host.split(":")[0];

  const override = process.env.WEBAUTHN_RP_ID?.trim();
  if (override) {
    // Only a registrable suffix of the current host is valid; anything else
    // would be rejected by the browser anyway, and failing here says why.
    if (hostname !== override && !hostname.endsWith(`.${override}`)) {
      throw new PasskeyError(
        `WEBAUTHN_RP_ID "${override}" does not cover host "${hostname}".`,
      );
    }
    return {rpID: override, origin};
  }

  return {rpID: hostname, origin};
}

/* ---------------------------------------------------------------- challenge */

function signChallenge(challenge: string, expiry: number): string {
  return createHmac("sha256", authSecret())
    .update(`${challenge}.${expiry}`)
    .digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function stashChallenge(challenge: string): Promise<void> {
  const expiry = Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SEC;
  const value = `${challenge}.${expiry}.${signChallenge(challenge, expiry)}`;
  (await cookies()).set(CHALLENGE_COOKIE, value, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CHALLENGE_TTL_SEC,
  });
}

/** Reads the challenge back and clears it, so one challenge answers once. */
async function takeChallenge(): Promise<string> {
  const jar = await cookies();
  const raw = jar.get(CHALLENGE_COOKIE)?.value;
  jar.delete(CHALLENGE_COOKIE);
  if (!raw) throw new PasskeyError("That sign-in attempt expired. Try again.");

  const parts = raw.split(".");
  if (parts.length !== 3) throw new PasskeyError("That sign-in attempt expired. Try again.");
  const [challenge, expiryRaw, signature] = parts;

  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry) || expiry * 1000 < Date.now()) {
    throw new PasskeyError("That sign-in attempt expired. Try again.");
  }
  if (!safeEqual(signature, signChallenge(challenge, expiry))) {
    throw new PasskeyError("That sign-in attempt could not be verified.");
  }
  return challenge;
}

/* ------------------------------------------------------------------ storage */

export async function listPasskeys(): Promise<StoredPasskey[]> {
  const rows = await sql<{
    id: string;
    credential_id: string;
    public_key: string;
    counter: string;
    transports: string | null;
    label: string;
    created_at: Date | string;
    last_used_at: Date | string | null;
  }>`
    select id, credential_id, public_key, counter, transports, label,
           created_at, last_used_at
      from admin_passkeys
     order by created_at
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    credentialId: r.credential_id,
    publicKey: r.public_key,
    counter: BigInt(r.counter),
    transports: r.transports,
    label: r.label,
    createdAt: new Date(r.created_at),
    lastUsedAt: r.last_used_at === null ? null : new Date(r.last_used_at),
  }));
}

export async function deletePasskey(id: number): Promise<boolean> {
  const rows = await sql`delete from admin_passkeys where id = ${id} returning id`;
  return rows.length > 0;
}

/* ------------------------------------------------------------- registration */

export async function registrationOptions() {
  const {rpID} = await rpContext();
  const existing = await listPasskeys();

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    // One operator, one identity. A stable id means enrolling a second device
    // adds a passkey rather than creating a second account.
    userID: new TextEncoder().encode("sitowise-operator"),
    userName: "Sitowise operator",
    attestationType: "none",
    // Already-enrolled credentials are excluded so the same Mac cannot be
    // registered twice and silently shadow its own earlier key.
    excludeCredentials: existing.map((p) => ({
      id: p.credentialId,
      transports: p.transports ? (JSON.parse(p.transports) as never) : undefined,
    })),
    authenticatorSelection: {
      // Touch ID rather than a roaming security key.
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required",
    },
  });

  await stashChallenge(options.challenge);
  return options;
}

export async function verifyRegistration(
  response: RegistrationResponseJSON,
  label: string,
): Promise<StoredPasskey> {
  const {rpID, origin} = await rpContext();
  const expectedChallenge = await takeChallenge();

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new PasskeyError("That passkey could not be verified.");
  }

  const {credential} = verification.registrationInfo;
  const transports = response.response.transports
    ? JSON.stringify(response.response.transports)
    : null;

  const [row] = await sql<{id: string}>`
    insert into admin_passkeys (credential_id, public_key, counter, transports, label)
    values (
      ${credential.id},
      ${Buffer.from(credential.publicKey).toString("base64url")},
      ${credential.counter},
      ${transports},
      ${label.slice(0, 60) || "Passkey"}
    )
    on conflict (credential_id) do update
      set public_key = excluded.public_key,
          counter    = excluded.counter,
          transports = excluded.transports
    returning id
  `;

  const stored = (await listPasskeys()).find((p) => Number(p.id) === Number(row.id));
  if (!stored) throw new PasskeyError("The passkey was not stored.");
  return stored;
}

/* ------------------------------------------------------------ authentication */

export async function authenticationOptions() {
  const {rpID} = await rpContext();
  const known = await listPasskeys();
  if (known.length === 0) {
    throw new PasskeyError("No passkey is enrolled yet. Sign in with the admin key first.");
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: known.map((p) => ({
      id: p.credentialId,
      transports: p.transports ? (JSON.parse(p.transports) as never) : undefined,
    })),
    userVerification: "required",
  });

  await stashChallenge(options.challenge);
  return options;
}

/**
 * Verify an assertion. Returns true only when the signature checks out against
 * a stored public key and the authenticator proved user presence — which, for a
 * platform authenticator with `userVerification: "required"`, means the finger
 * was actually on the sensor.
 */
export async function verifyAuthentication(
  response: AuthenticationResponseJSON,
): Promise<boolean> {
  const {rpID, origin} = await rpContext();
  const expectedChallenge = await takeChallenge();

  const known = await listPasskeys();
  const match = known.find((p) => p.credentialId === response.id);
  if (!match) throw new PasskeyError("That passkey is not enrolled here.");

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: match.credentialId,
      publicKey: Buffer.from(match.publicKey, "base64url"),
      counter: Number(match.counter),
      transports: match.transports ? (JSON.parse(match.transports) as never) : undefined,
    },
  });

  if (!verification.verified) return false;

  // A counter that goes backwards means two authenticators share one key, i.e.
  // a clone. Devices that do not implement the counter report 0 forever, which
  // is why this only tightens when the stored value is already above zero.
  const next = BigInt(verification.authenticationInfo.newCounter);
  if (match.counter > 0n && next <= match.counter) {
    throw new PasskeyError("That passkey looks cloned and was refused.");
  }

  await sql`
    update admin_passkeys
       set counter = ${next.toString()}::bigint, last_used_at = now()
     where id = ${match.id}
  `;
  return true;
}

/** Cheap check for the sign-in screen: is there anything to press the button for. */
export async function hasPasskeys(): Promise<boolean> {
  const [row] = await sql<{n: string}>`select count(*) as n from admin_passkeys`;
  return Number(row.n) > 0;
}

export function randomLabel(): string {
  return `Passkey ${randomBytes(2).toString("hex")}`;
}
