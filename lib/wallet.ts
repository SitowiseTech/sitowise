"use client";

/**
 * The browser wallet layer (spec section 10).
 *
 * Wallets are found through **EIP-6963 only**. Reading `window.ethereum` is not
 * an option here: several wallets overwrite that object and at least one of
 * them (Phantom) sets `isMetaMask` on it, so flag sniffing routinely opens the
 * wrong wallet. The announce/request handshake is the only way to get a stable
 * identity (`rdns`) alongside each provider.
 *
 * Everything below talks raw EIP-1193 rather than going through a wallet
 * client: the chain-switch dance and the exact `wallet_addEthereumChain`
 * payload are part of the product behaviour, not an implementation detail.
 */

import {toHex} from "viem";
import {ADD_CHAIN_PARAMS, CHAIN_ID, CHAIN_ID_HEX} from "@/lib/chain";

/* ------------------------------------------------------------------- types */

export type RequestArgs = {method: string; params?: readonly unknown[] | object};

export type ProviderEvent = "accountsChanged" | "chainChanged" | "disconnect";

export interface Eip1193Provider {
  request(args: RequestArgs): Promise<unknown>;
  on?(event: ProviderEvent, listener: (payload: unknown) => void): void;
  removeListener?(event: ProviderEvent, listener: (payload: unknown) => void): void;
}

/** The `info` half of an EIP-6963 announcement. `icon` is a data URI. */
export type WalletInfo = {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
};

export type WalletOption = {
  info: WalletInfo;
  provider: Eip1193Provider;
};

type AnnounceDetail = {info: WalletInfo; provider: Eip1193Provider};

declare global {
  interface WindowEventMap {
    "eip6963:announceProvider": CustomEvent<AnnounceDetail>;
  }
}

/** Anything the user should read as a sentence rather than as a stack trace. */
export class WalletError extends Error {
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = "WalletError";
    this.code = code;
  }
}

/* --------------------------------------------------------------- discovery */

// Keyed by rdns, not uuid: a wallet that announces twice (extension plus
// injected shim) would otherwise appear twice in the picker, which is exactly
// the ambiguity EIP-6963 exists to remove.
const found = new Map<string, WalletOption>();
const listeners = new Set<(wallets: WalletOption[]) => void>();
let listening = false;

function isAnnouncement(detail: unknown): detail is AnnounceDetail {
  if (typeof detail !== "object" || detail === null) return false;
  const {info, provider} = detail as Partial<AnnounceDetail>;
  return (
    typeof info === "object" &&
    info !== null &&
    typeof info.rdns === "string" &&
    typeof info.name === "string" &&
    typeof info.uuid === "string" &&
    typeof provider === "object" &&
    provider !== null &&
    typeof (provider as Eip1193Provider).request === "function"
  );
}

function snapshot(): WalletOption[] {
  return [...found.values()].sort((a, b) => a.info.name.localeCompare(b.info.name));
}

function onAnnounce(event: CustomEvent<AnnounceDetail>): void {
  const detail: unknown = event.detail;
  if (!isAnnouncement(detail)) return;
  const existing = found.get(detail.info.rdns);
  // The first announcement wins. Re-announcements carry the same provider
  // object in practice, and replacing it would invalidate live subscriptions.
  if (existing) return;
  found.set(detail.info.rdns, {info: detail.info, provider: detail.provider});
  const list = snapshot();
  for (const listener of listeners) listener(list);
}

function startListening(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("eip6963:announceProvider", onAnnounce);
}

/** Ask every installed wallet to announce itself. Safe to call repeatedly. */
export function requestProviders(): void {
  if (typeof window === "undefined") return;
  startListening();
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

/**
 * Subscribe to the discovered set. The listener fires immediately with what is
 * already known and again for every new announcement, because extensions
 * inject at different points in the page lifecycle and a one-shot read taken
 * too early shows an empty picker.
 */
export function subscribeProviders(
  listener: (wallets: WalletOption[]) => void,
): () => void {
  listeners.add(listener);
  listener(snapshot());
  requestProviders();
  return () => {
    listeners.delete(listener);
  };
}

/**
 * One-shot discovery for callers outside React. Waits a short window for
 * announcements rather than returning whatever landed in the same tick.
 */
export function discoverProviders(waitMs = 400): Promise<WalletOption[]> {
  requestProviders();
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(snapshot()), waitMs);
  });
}

/* ------------------------------------------------------------------ errors */

/** EIP-1193 errors arrive wrapped by different wallets; dig for the code. */
function errorCode(err: unknown): number | undefined {
  let node: unknown = err;
  for (let depth = 0; depth < 5 && typeof node === "object" && node !== null; depth++) {
    const code = (node as {code?: unknown}).code;
    if (typeof code === "number") return code;
    node = (node as {cause?: unknown}).cause;
  }
  return undefined;
}

function errorText(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const message = (err as {message?: unknown}).message;
    if (typeof message === "string" && message.trim() !== "") return message;
  }
  return String(err);
}

/** A sentence to show the user for any wallet-originated failure. */
export function walletErrorMessage(err: unknown): string {
  if (err instanceof WalletError) return err.message;

  switch (errorCode(err)) {
    case 4001:
      return "You rejected the request in your wallet.";
    case 4100:
      return "Your wallet has not authorised this site. Reconnect and try again.";
    case 4900:
    case 4901:
      return "Your wallet is not connected to a network.";
    case -32002:
      return "Your wallet already has a request open. Finish it there, then try again.";
    default:
      break;
  }

  const text = errorText(err);
  // Wallets phrase user rejection inconsistently and some drop the code.
  if (/user rejected|user denied|rejected the request/i.test(text)) {
    return "You rejected the request in your wallet.";
  }
  return text;
}

/* ------------------------------------------------------------------ basics */

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Prompts the wallet. Returns the selected account, lowercased. */
export async function connect(provider: Eip1193Provider): Promise<`0x${string}`> {
  const accounts = asStringArray(await provider.request({method: "eth_requestAccounts"}));
  const first = accounts[0];
  if (!first) throw new WalletError("Your wallet returned no accounts.");
  return first.toLowerCase() as `0x${string}`;
}

/** Silent read, used to restore a session without a popup. */
export async function currentAccounts(provider: Eip1193Provider): Promise<`0x${string}`[]> {
  try {
    const accounts = asStringArray(await provider.request({method: "eth_accounts"}));
    return accounts.map((a) => a.toLowerCase() as `0x${string}`);
  } catch {
    // A locked wallet throws here. That is "no accounts", not an error worth
    // surfacing on a page the user has not interacted with yet.
    return [];
  }
}

export async function currentChainId(provider: Eip1193Provider): Promise<number | null> {
  try {
    const raw = await provider.request({method: "eth_chainId"});
    if (typeof raw === "string") return Number.parseInt(raw, 16);
    if (typeof raw === "number") return raw;
    return null;
  } catch {
    return null;
  }
}

/**
 * Put the wallet on Robinhood Chain, adding the network first if it has never
 * seen it. Resolves only once `eth_chainId` actually reports 4663: several
 * wallets resolve `wallet_switchEthereumChain` before their internal state has
 * moved, and a transaction sent in that gap goes to the previous chain.
 */
export async function ensureChain(provider: Eip1193Provider): Promise<void> {
  if ((await currentChainId(provider)) === CHAIN_ID) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{chainId: CHAIN_ID_HEX}],
    });
  } catch (err) {
    // 4902 is the standard "unrecognised chain"; some wallets only say it in
    // words, and a few report -32603 for the same condition.
    const code = errorCode(err);
    const unknownChain =
      code === 4902 || /unrecognized chain|unrecognised chain|add.*chain/i.test(errorText(err));
    if (!unknownChain) throw new WalletError(walletErrorMessage(err), code);

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [ADD_CHAIN_PARAMS],
    });
  }

  for (let attempt = 0; attempt < 12; attempt++) {
    if ((await currentChainId(provider)) === CHAIN_ID) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new WalletError(
    "Your wallet is still on another network. Switch to Robinhood Chain and try again.",
  );
}

/**
 * personal_sign. The message goes over as hex: passing raw UTF-8 works in some
 * wallets and silently signs a different digest in others.
 */
export async function signMessage(
  provider: Eip1193Provider,
  address: string,
  message: string,
): Promise<`0x${string}`> {
  const signature = await provider.request({
    method: "personal_sign",
    params: [toHex(message), address],
  });
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new WalletError("Your wallet returned an unreadable signature.");
  }
  return signature as `0x${string}`;
}

export type TransactionRequest = {
  from: `0x${string}`;
  to: `0x${string}`;
  /**
   * Omitted for a plain value transfer, which is how a node is bought: the
   * payment goes to a wallet, not to a contract, and a `data` field attached to
   * it makes wallets label the send as a contract interaction.
   */
  data?: `0x${string}`;
  /** Omitted for non-payable calls; wallets dislike an explicit "0x0". */
  value?: bigint;
};

export async function sendTransaction(
  provider: Eip1193Provider,
  tx: TransactionRequest,
): Promise<`0x${string}`> {
  const params: Record<string, string> = {
    from: tx.from,
    to: tx.to,
  };
  if (tx.data !== undefined) params.data = tx.data;
  if (tx.value !== undefined) params.value = toHex(tx.value);

  const hash = await provider.request({method: "eth_sendTransaction", params: [params]});
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new WalletError("Your wallet did not return a transaction hash.");
  }
  return hash as `0x${string}`;
}

/**
 * Best-effort revoke so "Disconnect" also drops the site from the wallet's own
 * permission list. Not every wallet implements it, and a wallet that refuses
 * must not break the button, so failures are swallowed.
 */
export async function revokePermissions(provider: Eip1193Provider): Promise<void> {
  try {
    await provider.request({
      method: "wallet_revokePermissions",
      params: [{eth_accounts: {}}],
    });
  } catch {
    // Nothing to do: the local session is cleared either way.
  }
}

/* ----------------------------------------------------------- subscriptions */

function subscribe(
  provider: Eip1193Provider,
  event: ProviderEvent,
  handler: (payload: unknown) => void,
): () => void {
  if (typeof provider.on !== "function") return () => {};
  provider.on(event, handler);
  return () => provider.removeListener?.(event, handler);
}

/** Fires with the lowercased account list. An empty list means locked or revoked. */
export function onAccountsChanged(
  provider: Eip1193Provider,
  handler: (accounts: `0x${string}`[]) => void,
): () => void {
  return subscribe(provider, "accountsChanged", (payload) => {
    handler(asStringArray(payload).map((a) => a.toLowerCase() as `0x${string}`));
  });
}

/** Fires with the numeric chain id. */
export function onChainChanged(
  provider: Eip1193Provider,
  handler: (chainId: number | null) => void,
): () => void {
  return subscribe(provider, "chainChanged", (payload) => {
    if (typeof payload === "string") handler(Number.parseInt(payload, 16));
    else if (typeof payload === "number") handler(payload);
    else handler(null);
  });
}

export function onDisconnect(provider: Eip1193Provider, handler: () => void): () => void {
  return subscribe(provider, "disconnect", () => handler());
}

/* ----------------------------------------------------------------- storage */

const LAST_WALLET_KEY = "sitowise.wallet.rdns";

/** Remember which wallet was used so a reload can reconnect without a popup. */
export function rememberWallet(rdns: string): void {
  try {
    window.localStorage.setItem(LAST_WALLET_KEY, rdns);
  } catch {
    // Private-mode storage failures are not worth a message; the user just
    // picks their wallet again next visit.
  }
}

export function forgetWallet(): void {
  try {
    window.localStorage.removeItem(LAST_WALLET_KEY);
  } catch {
    // As above.
  }
}

export function lastWalletRdns(): string | null {
  try {
    return window.localStorage.getItem(LAST_WALLET_KEY);
  } catch {
    return null;
  }
}
