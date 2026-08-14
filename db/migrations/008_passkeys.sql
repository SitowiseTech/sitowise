-- Migration 008: passkeys for the admin console.
--
-- Touch ID sign-in. ADMIN_KEY does not go away: it stays the bootstrap (you
-- need it to enrol the first passkey) and the recovery path (a lost laptop must
-- not lock the operator out of their own console). A passkey is an additional,
-- more convenient way in, never the only one.
--
-- The stored public key verifies signatures and cannot produce them, so this
-- table leaks nothing useful if the database is read. The private half never
-- leaves the Secure Enclave.

begin;

create table if not exists admin_passkeys (
  id             bigserial primary key,
  -- Base64url of the raw credential id, as the browser reports it.
  credential_id  text unique not null,
  -- Base64url of the COSE public key.
  public_key     text not null,
  -- Signature counter. Platform authenticators often keep this at 0; when a
  -- device does maintain it, a counter that fails to advance means a clone.
  counter        bigint not null default 0,
  -- Which authenticators the credential lives on, for the "delete this one" UI.
  transports     text,
  label          text not null default 'Passkey',
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz
);

commit;
