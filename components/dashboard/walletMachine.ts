"use client";

/**
 * The wallet phase machine, kept apart from the provider that runs it so the
 * legal transitions can be read in one screen:
 *
 *   starting ──► disconnected ──► connecting ──► unsigned ──► signing ──► ready
 *                     ▲                              │            │        │
 *                     └────────── disconnect ────────┴────────────┴────────┘
 *
 * `unsigned` means a wallet is connected but the server holds no session for
 * that address. Switching accounts in the wallet lands back here with the new
 * address, because a cookie issued for one address must never decorate
 * another address's dashboard.
 *
 * The chain is deliberately not part of the phase: being on the wrong network
 * raises a banner and blocks transactions, but balances are readable from
 * anywhere, so it never gates the screen.
 */

import type {WalletOption} from "@/lib/wallet";

export type WalletPhase =
  | "starting"
  | "disconnected"
  | "connecting"
  | "unsigned"
  | "signing"
  | "ready";

export type State = {
  phase: WalletPhase;
  wallets: WalletOption[];
  wallet: WalletOption | null;
  address: `0x${string}` | null;
  chainId: number | null;
  /** Message from the last failed wallet or sign-in action. */
  error: string | null;
  switchingChain: boolean;
};

type Action =
  | {type: "wallets"; wallets: WalletOption[]}
  | {type: "connecting"}
  | {
      type: "connected";
      wallet: WalletOption;
      address: `0x${string}`;
      chainId: number | null;
      signed: boolean;
    }
  | {type: "signing"}
  | {type: "signed"}
  | {type: "sessionLost"}
  | {type: "accountChanged"; address: `0x${string}`}
  | {type: "chainChanged"; chainId: number | null}
  | {type: "switchingChain"; value: boolean}
  | {type: "disconnected"}
  | {type: "failed"; message: string}
  | {type: "clearError"};

export const INITIAL: State = {
  phase: "starting",
  wallets: [],
  wallet: null,
  address: null,
  chainId: null,
  error: null,
  switchingChain: false,
};

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "wallets":
      return {...state, wallets: action.wallets};

    case "connecting":
      return {...state, phase: "connecting", error: null};

    case "connected":
      return {
        ...state,
        phase: action.signed ? "ready" : "unsigned",
        wallet: action.wallet,
        address: action.address,
        chainId: action.chainId,
        error: null,
      };

    case "signing":
      return {...state, phase: "signing", error: null};

    case "signed":
      return {...state, phase: "ready", error: null};

    case "sessionLost":
      // The wallet is still connected; only the cookie is gone.
      return state.address ? {...state, phase: "unsigned"} : state;

    case "accountChanged":
      return {...state, phase: "unsigned", address: action.address, error: null};

    case "chainChanged":
      return {...state, chainId: action.chainId};

    case "switchingChain":
      return {...state, switchingChain: action.value};

    case "disconnected":
      return {
        ...state,
        phase: "disconnected",
        wallet: null,
        address: null,
        chainId: null,
        error: null,
        switchingChain: false,
      };

    case "failed":
      // A failure never strands the user mid-phase: fall back to the state the
      // action started from, with the reason attached.
      return {
        ...state,
        phase: state.address ? "unsigned" : "disconnected",
        error: action.message,
        switchingChain: false,
      };

    case "clearError":
      return {...state, error: null};
  }
}
