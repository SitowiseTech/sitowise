"use client";

/**
 * Wallet connection and sign-in. The phases and their transitions live in
 * walletMachine.ts; this file is the side effects around them: EIP-6963
 * discovery, the popups, the wallet's own events, and the session calls.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import {CHAIN_ID} from "@/lib/chain";
import {getMe, getNonce, logout, verifySignature} from "@/lib/apiClient";
import {
  INITIAL,
  reduce,
  type State,
  type WalletPhase,
} from "@/components/dashboard/walletMachine";
import {
  connect as requestAccounts,
  currentAccounts,
  currentChainId,
  discoverProviders,
  ensureChain,
  forgetWallet,
  lastWalletRdns,
  onAccountsChanged,
  onChainChanged,
  onDisconnect,
  rememberWallet,
  revokePermissions,
  signMessage,
  subscribeProviders,
  walletErrorMessage,
  type WalletOption,
} from "@/lib/wallet";

export type {WalletPhase};

export type WalletApi = State & {
  wrongChain: boolean;
  connectWallet: (wallet: WalletOption) => Promise<void>;
  signIn: () => Promise<void>;
  disconnect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  /** The server rejected the session cookie; fall back to the sign-in gate. */
  sessionLost: () => void;
  clearError: () => void;
};

const WalletContext = createContext<WalletApi | null>(null);

export function useWallet(): WalletApi {
  const api = useContext(WalletContext);
  if (!api) throw new Error("useWallet must be used inside <WalletProvider>");
  return api;
}

export function WalletProvider({children}: {children: ReactNode}) {
  const [state, dispatch] = useReducer(reduce, INITIAL);

  // Read inside event handlers that must not re-subscribe on every change.
  const addressRef = useRef<`0x${string}` | null>(null);
  addressRef.current = state.address;

  /* ------------------------------------------------------------ discovery */

  useEffect(() => subscribeProviders((wallets) => dispatch({type: "wallets", wallets})), []);

  /* -------------------------------------------------------------- restore */

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      // The session cookie survives a reload; the wallet connection does not,
      // so both have to line up before the dashboard can be shown.
      const [session, wallets] = await Promise.all([
        getMe().catch(() => null),
        discoverProviders(),
      ]);
      if (cancelled) return;

      const rdns = lastWalletRdns();
      const wallet = rdns ? wallets.find((w) => w.info.rdns === rdns) : undefined;
      if (!wallet) {
        dispatch({type: "disconnected"});
        return;
      }

      const accounts = await currentAccounts(wallet.provider);
      if (cancelled) return;
      const address = accounts[0];
      if (!address) {
        dispatch({type: "disconnected"});
        return;
      }

      const chainId = await currentChainId(wallet.provider);
      if (cancelled) return;

      const signed = session?.address === address;
      // A cookie for a different address is worse than no cookie.
      if (session && !signed) await logout();

      dispatch({type: "connected", wallet, address, chainId, signed});
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  /* --------------------------------------------------------- subscriptions */

  useEffect(() => {
    const wallet = state.wallet;
    if (!wallet) return;

    const stopAccounts = onAccountsChanged(wallet.provider, (accounts) => {
      const next = accounts[0];
      if (!next) {
        void logout();
        forgetWallet();
        dispatch({type: "disconnected"});
        return;
      }
      if (next === addressRef.current) return;
      // Spec 5.3: changing the account in the wallet resets the session.
      void logout();
      dispatch({type: "accountChanged", address: next});
    });

    const stopChain = onChainChanged(wallet.provider, (chainId) => {
      dispatch({type: "chainChanged", chainId});
    });

    const stopDisconnect = onDisconnect(wallet.provider, () => {
      dispatch({type: "disconnected"});
    });

    return () => {
      stopAccounts();
      stopChain();
      stopDisconnect();
    };
  }, [state.wallet]);

  /* -------------------------------------------------------------- actions */

  const connectWallet = useCallback(async (wallet: WalletOption) => {
    dispatch({type: "connecting"});
    try {
      const address = await requestAccounts(wallet.provider);
      rememberWallet(wallet.info.rdns);
      const chainId = await currentChainId(wallet.provider);

      const session = await getMe().catch(() => null);
      const signed = session?.address === address;
      if (session && !signed) await logout();

      dispatch({type: "connected", wallet, address, chainId, signed});
    } catch (err) {
      dispatch({type: "failed", message: walletErrorMessage(err)});
    }
  }, []);

  const signIn = useCallback(async () => {
    const {wallet, address} = state;
    if (!wallet || !address) return;

    dispatch({type: "signing"});
    try {
      const {message} = await getNonce();
      const signature = await signMessage(wallet.provider, address, message);
      await verifySignature(address, signature);
      dispatch({type: "signed"});
    } catch (err) {
      dispatch({type: "failed", message: walletErrorMessage(err)});
    }
  }, [state]);

  const disconnect = useCallback(async () => {
    const wallet = state.wallet;
    forgetWallet();
    dispatch({type: "disconnected"});
    await logout();
    if (wallet) await revokePermissions(wallet.provider);
  }, [state.wallet]);

  const switchNetwork = useCallback(async () => {
    const wallet = state.wallet;
    if (!wallet) return;

    dispatch({type: "switchingChain", value: true});
    try {
      await ensureChain(wallet.provider);
      dispatch({type: "chainChanged", chainId: await currentChainId(wallet.provider)});
    } catch (err) {
      dispatch({type: "failed", message: walletErrorMessage(err)});
    } finally {
      dispatch({type: "switchingChain", value: false});
    }
  }, [state.wallet]);

  const sessionLost = useCallback(() => dispatch({type: "sessionLost"}), []);

  const clearError = useCallback(() => dispatch({type: "clearError"}), []);

  const api = useMemo<WalletApi>(
    () => ({
      ...state,
      wrongChain: state.address !== null && state.chainId !== null && state.chainId !== CHAIN_ID,
      connectWallet,
      signIn,
      disconnect,
      switchNetwork,
      sessionLost,
      clearError,
    }),
    [state, connectWallet, signIn, disconnect, switchNetwork, sessionLost, clearError],
  );

  return <WalletContext.Provider value={api}>{children}</WalletContext.Provider>;
}
