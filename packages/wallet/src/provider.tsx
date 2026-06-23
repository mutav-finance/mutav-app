"use client";

/**
 * provider.tsx — wallet React context.
 *
 * The consuming app wraps its tree in <WalletProvider> and passes the Stellar
 * network config (packages never read process.env). `useWallet()` exposes
 * connection state + actions. For Soroban contract bindings, prefer
 * `makeSignTransaction()` from `@mutav/wallet/signer`.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { initWalletKit, type WalletNetwork } from "./kit";
import {
  connect as kitConnect,
  disconnect as kitDisconnect,
  restore as kitRestore,
} from "./session";
import { signAndSubmit as kitSignAndSubmit, signMessage as kitSignMessage } from "./signer";
import { proveOwnership as kitProveOwnership } from "./ownership";

export interface WalletContextValue {
  /** Connected Stellar public key, or null. */
  address: string | null;
  /** True while a connect/disconnect is in flight. */
  connecting: boolean;
  /** Last connect error message, or null. */
  error: string | null;
  /** Open the wallet picker and connect. */
  connect(): Promise<void>;
  /** Disconnect the active wallet. */
  disconnect(): void;
  /** Sign an arbitrary message (SEP-53); returns the signature. No tx/fee. */
  signMessage(message: string): Promise<string>;
  /**
   * Prove control of the connected wallet via a signed challenge tx and verify
   * the signature against the address. Returns true iff verified. Client-side
   * only — not a server trust boundary (see ownership.ts).
   */
  proveOwnership(): Promise<boolean>;
  /** Sign + submit a raw XDR; returns the confirmed tx hash. */
  signAndSubmit(xdr: string): Promise<string>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export type WalletProviderProps = {
  network: WalletNetwork;
  rpcUrl: string;
  networkPassphrase: string;
  /**
   * Whether to reflect the kit's auto-restored session across reloads.
   * - `true` (default): on mount, reconcile React state with the kit's restored
   *   session (investor surfaces — keeps the user connected across reloads).
   * - `false`: clear any restored session on mount so connecting is always an
   *   explicit gesture (high-security surfaces like admin). The kit otherwise
   *   silently keeps a live, signable session that the UI wouldn't show.
   */
  persistSession?: boolean;
  children: ReactNode;
};

export function WalletProvider({
  network,
  rpcUrl,
  networkPassphrase,
  persistSession = true,
  children,
}: WalletProviderProps) {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initWalletKit(network);
    let cancelled = false;
    if (persistSession) {
      // Reconcile React state with the kit's (possibly auto-restored) session.
      void kitRestore().then((addr) => {
        if (!cancelled && addr) setAddress(addr);
      });
    } else {
      // Never silently inherit an auto-restored live session on this surface —
      // clear it so the kit and UI agree that nothing is connected until the
      // user explicitly connects.
      void kitDisconnect();
    }
    return () => {
      cancelled = true;
    };
  }, [network, persistSession]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const addr = await kitConnect(network);
      setAddress(addr);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setConnecting(false);
    }
  }, [network]);

  const disconnect = useCallback(() => {
    // Clear UI state only after the kit has actually torn down its session, so
    // the UI never reports "disconnected" while a live kit session lingers.
    void kitDisconnect().finally(() => setAddress(null));
  }, []);

  const signMessage = useCallback(
    async (message: string) => {
      const { signedMessage } = await kitSignMessage(message, networkPassphrase, address);
      return signedMessage;
    },
    [networkPassphrase, address],
  );

  const proveOwnership = useCallback(async () => {
    if (!address) throw new Error("wallet not connected");
    return kitProveOwnership(address, networkPassphrase);
  }, [address, networkPassphrase]);

  const signAndSubmit = useCallback(
    (xdr: string) => kitSignAndSubmit(xdr, { rpcUrl, networkPassphrase, address }),
    [rpcUrl, networkPassphrase, address],
  );

  return (
    <WalletContext.Provider
      value={{
        address,
        connecting,
        error,
        connect,
        disconnect,
        signMessage,
        proveOwnership,
        signAndSubmit,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

/** Access wallet state + actions. Must be inside <WalletProvider>. */
export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used inside <WalletProvider>");
  }
  return ctx;
}
